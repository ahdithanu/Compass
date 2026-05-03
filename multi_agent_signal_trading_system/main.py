"""End-to-end orchestration of the multi-agent research pipeline.

Run:
    python -m multi_agent_signal_trading_system.main

Pipeline:
    1. ensure mock data exists  (data/mock_*.csv)
    2. MarketAgent              -> per-ticker market features + score panel
    3. NewsAgent                -> per-ticker news/event features
    4. FundamentalsAgent        -> per-ticker fundamentals + score
    5. AlternativeDataAgent     -> per-ticker alt-data score
    6. score()                  -> compose pillar scores into 0-100 signal
    7. PortfolioAgent.propose   -> draft target weights for BUY-rated names
    8. RiskAgent                -> review weights, produce risk report
    9. ThesisAgent              -> bull / bear / risks per ticker
    10. PortfolioAgent.backtest -> weekly rebalance simulation
    11. ReportingAgent          -> memo, CSVs, JSON, charts
"""

from __future__ import annotations

from datetime import date as _date
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from .agents import (
    AlternativeDataAgent,
    FundamentalsAgent,
    MarketAgent,
    NewsAgent,
    PortfolioAgent,
    ReportingAgent,
    RiskAgent,
    ThesisAgent,
)
from .agents.models import Rating
from .config import Config, DEFAULT_CONFIG
from .data.mock_data import ensure_mock_data


def _rating(score_0_100: float, cfg: Config) -> str:
    if score_0_100 >= cfg.ratings.buy:
        return Rating.BUY.value
    if score_0_100 >= cfg.ratings.hold:
        return Rating.HOLD.value
    return Rating.AVOID.value


def _build_feature_table(
    market_features: pd.DataFrame,
    news_features: pd.DataFrame,
    fund_features: pd.DataFrame,
    alt_features: pd.DataFrame,
    weights,
) -> pd.DataFrame:
    """Join per-pillar features and compute the composite signal_score."""
    df = market_features.copy()
    df = df.join(news_features, how="left")
    df = df.join(fund_features, how="left")
    df = df.join(alt_features, how="left")

    # Defensive fills for any column the joins may have left as NaN.
    for col, default in [
        ("market_score", 0.5),
        ("news_score", 0.5),
        ("fundamental_score", 0.5),
        ("alt_score", 0.5),
    ]:
        if col not in df.columns:
            df[col] = default
        df[col] = df[col].fillna(default)

    composite = (
        weights.market * df["market_score"]
        + weights.news * df["news_score"]
        + weights.fundamentals * df["fundamental_score"]
        + weights.alternative * df["alt_score"]
    ).clip(0.0, 1.0)
    df["signal_score"] = (composite * 100).round(1)
    return df


def _build_score_history(
    price_panel: pd.DataFrame,
    news_csv: Path,
    alt_csv: Path,
    fund_csv: Path,
    market_panels: dict[str, pd.DataFrame],
    cfg: Config,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Recompute pillar scores at every weekly rebalance date for backtesting.

    For tractability we compute Market features per-day from the precomputed
    panels and recompute News + Alt-data weights at each rebalance using
    the same `as_of`-aware decay logic. Fundamentals are treated as
    snapshot (don't change in the 1-year window) - a real system would
    update them at each earnings date.
    """
    rebal_dates = pd.bdate_range(
        price_panel.index[60], price_panel.index[-1], freq=cfg.portfolio.rebalance_frequency
    )
    rebal_dates = [d for d in rebal_dates if d in price_panel.index]
    if not rebal_dates:
        rebal_dates = [price_panel.index[-1]]

    tickers = list(market_panels.keys())

    # We'll need news + alt-data raw frames once.
    news_raw = pd.read_csv(news_csv)
    news_raw["date"] = pd.to_datetime(news_raw["date"])
    news_raw["ticker"] = news_raw["ticker"].str.upper()
    alt_raw = pd.read_csv(alt_csv)
    alt_raw["date"] = pd.to_datetime(alt_raw["date"])
    alt_raw["ticker"] = alt_raw["ticker"].str.upper()
    fund_df = pd.read_csv(fund_csv).set_index("ticker")

    # Lightweight reusable agents (silent) for per-date scoring.
    news_agent = NewsAgent(csv_path=news_csv, verbose=False)
    alt_agent = AlternativeDataAgent(csv_path=alt_csv, verbose=False)

    def _market_score_on(date: pd.Timestamp) -> pd.Series:
        rows = []
        for t, panel in market_panels.items():
            if date not in panel.index:
                continue
            r = panel.loc[date]
            rows.append(
                {
                    "ticker": t,
                    "ma_gap": float(r["ma_gap"]) if pd.notna(r["ma_gap"]) else 0.0,
                    "momentum": float(r["momentum"]) if pd.notna(r["momentum"]) else 0.0,
                    "drawdown": float(r["drawdown"]) if pd.notna(r["drawdown"]) else 0.0,
                    "rel_strength": float(r["rel_strength"]) if pd.notna(r["rel_strength"]) else 0.0,
                }
            )
        if not rows:
            return pd.Series(dtype=float)
        df = pd.DataFrame(rows).set_index("ticker")

        def mm(s):
            lo, hi = s.min(), s.max()
            if hi == lo:
                return pd.Series(0.5, index=s.index)
            return (s - lo) / (hi - lo)

        comp = (
            0.30 * mm(df["ma_gap"])
            + 0.30 * mm(df["momentum"])
            + 0.20 * mm(df["drawdown"])
            + 0.20 * mm(df["rel_strength"])
        ).clip(0.0, 1.0)
        return comp

    # Static fundamentals snapshot.
    fund_features_static = pd.DataFrame(index=tickers)
    fund_features_static["fundamental_score"] = 0.5
    if not fund_df.empty:
        # Crude blend: rank revenue_growth, margins, inverse PE.
        from .agents.fundamentals_agent import _rank_norm

        g = _rank_norm(fund_df["revenue_growth_yoy"]).reindex(tickers).fillna(0.5)
        m = _rank_norm(fund_df["operating_margin"]).reindex(tickers).fillna(0.5)
        v = _rank_norm(1.0 / fund_df["pe_ratio"].clip(lower=1e-3)).reindex(tickers).fillna(0.5)
        fund_features_static["fundamental_score"] = (
            0.45 * g + 0.35 * m + 0.20 * v
        ).clip(0.0, 1.0)

    score_rows: list[dict] = []
    rating_rows: list[dict] = []

    for d in rebal_dates:
        market_score = _market_score_on(d)
        news_feat = news_agent.run(tickers, as_of=d)["features"]
        alt_feat = alt_agent.run(tickers, as_of=d)["features"]

        row = {}
        rrow = {}
        for t in tickers:
            ms = float(market_score.get(t, 0.5))
            ns = float(news_feat.loc[t, "news_score"]) if t in news_feat.index else 0.5
            fs = float(fund_features_static.loc[t, "fundamental_score"])
            as_ = float(alt_feat.loc[t, "alt_score"]) if t in alt_feat.index else 0.5
            comp = (
                cfg.weights.market * ms
                + cfg.weights.news * ns
                + cfg.weights.fundamentals * fs
                + cfg.weights.alternative * as_
            )
            score_100 = round(float(comp) * 100, 1)
            row[t] = score_100
            rrow[t] = _rating(score_100, cfg)
        score_rows.append({"date": d, **row})
        rating_rows.append({"date": d, **rrow})

    score_hist = pd.DataFrame(score_rows).set_index("date")
    rating_hist = pd.DataFrame(rating_rows).set_index("date")
    return score_hist, rating_hist


def run(cfg: Optional[Config] = None) -> dict:
    cfg = cfg or DEFAULT_CONFIG
    np.random.seed(cfg.random_seed)

    print("=" * 72)
    print(f"Multi-agent research pipeline — universe: {', '.join(cfg.universe)}")
    print("=" * 72)

    # 0. Ensure mock data exists.
    paths = ensure_mock_data(cfg.data_dir, list(cfg.universe), seed=cfg.random_seed)

    # 1. Market.
    market_agent = MarketAgent(cfg.market, benchmark=cfg.benchmark)
    market_out = market_agent.run(cfg.universe)
    market_features: pd.DataFrame = market_out["features"]
    price_panel: pd.DataFrame = market_out["panel"]
    market_panels: dict[str, pd.DataFrame] = market_out["per_ticker"]
    benchmark_series = price_panel[cfg.benchmark] if cfg.benchmark in price_panel.columns else None

    # 2. News.
    news_agent = NewsAgent(csv_path=paths["news"])
    news_out = news_agent.run(cfg.universe, as_of=price_panel.index[-1])
    news_features: pd.DataFrame = news_out["features"]

    # 3. Fundamentals.
    fund_agent = FundamentalsAgent(mock_csv=paths["fund"], prefer_live=True)
    fund_out = fund_agent.run(cfg.universe)
    fund_features: pd.DataFrame = fund_out["features"]

    # 4. Alt-data.
    alt_agent = AlternativeDataAgent(csv_path=paths["alt"])
    alt_out = alt_agent.run(cfg.universe, as_of=price_panel.index[-1])
    alt_features: pd.DataFrame = alt_out["features"]

    # 5. Compose feature table + ratings.
    feature_table = _build_feature_table(
        market_features=market_features,
        news_features=news_features,
        fund_features=fund_features,
        alt_features=alt_features,
        weights=cfg.weights,
    )
    feature_table["rating"] = feature_table["signal_score"].apply(
        lambda v: _rating(v, cfg)
    )
    feature_table = feature_table.sort_values("signal_score", ascending=False)
    print("\nComposite ranking:")
    print(
        feature_table[["signal_score", "rating", "market_score",
                       "news_score", "fundamental_score", "alt_score"]]
        .round(2).to_string()
    )

    # 6. Portfolio: propose target weights.
    portfolio_agent = PortfolioAgent(cfg.portfolio, cfg.risk, cfg.ratings)
    proposed = portfolio_agent.propose_weights(feature_table["signal_score"])

    # 7. Risk: review.
    risk_agent = RiskAgent(cfg.risk)
    risk_report = risk_agent.run(
        proposed_weights=proposed,
        market_features=feature_table,
        as_of=price_panel.index[-1].date(),
    )

    # 8. Thesis.
    thesis_agent = ThesisAgent()
    risk_flags_by_ticker = {
        r.ticker: list(r.flags) for r in risk_report.per_ticker
    }
    theses = thesis_agent.run(
        tickers=feature_table.index.tolist(),
        feature_table=feature_table,
        risk_flags_by_ticker=risk_flags_by_ticker,
    )

    # 9. Backtest.
    score_hist, rating_hist = _build_score_history(
        price_panel=price_panel.drop(columns=[cfg.benchmark], errors="ignore"),
        news_csv=paths["news"],
        alt_csv=paths["alt"],
        fund_csv=paths["fund"],
        market_panels=market_panels,
        cfg=cfg,
    )
    bt = portfolio_agent.backtest(
        price_panel=price_panel.drop(columns=[cfg.benchmark], errors="ignore"),
        score_history=score_hist,
        ratings_history=rating_hist,
        benchmark=benchmark_series,
    )

    # Use the risk-adjusted weights for the memo's allocation column.
    risk_adjusted_weights = pd.Series(
        {r.ticker: r.suggested_weight_pct for r in risk_report.per_ticker}
    ).reindex(feature_table.index).fillna(0.0)

    # 10. Reporting.
    reporter = ReportingAgent(cfg.output_dir, cfg.charts_dir)
    reporter.run(
        feature_table=feature_table,
        risk_report=risk_report,
        equity_df=bt["equity_curve"],
        summary=bt["summary"],
        trades_df=bt["trades"],
        as_of=price_panel.index[-1].date(),
        theses=theses,
        proposed_weights=risk_adjusted_weights,
        price_panel=price_panel,
        benchmark=benchmark_series,
    )

    print("\nDone. Outputs written to", cfg.output_dir)
    return {
        "feature_table": feature_table,
        "risk_report": risk_report,
        "theses": theses,
        "backtest": bt,
        "proposed_weights": risk_adjusted_weights,
    }


if __name__ == "__main__":   # pragma: no cover
    run()
