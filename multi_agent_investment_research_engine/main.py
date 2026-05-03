"""End-to-end orchestration of the multi-agent investment research engine.

Run:
    python -m multi_agent_investment_research_engine.main

Pipeline (quantitative + LangChain reasoning):

    1.  ensure mock data exists  (data/mock_*.csv)
    2.  MarketAgent             -> per-ticker market features + score panel
    3.  NewsAgent               -> per-ticker news/event features
    4.  FundamentalsAgent       -> per-ticker fundamentals + score
    5.  AlternativeDataAgent    -> per-ticker alt-data score
    6.  _build_feature_table    -> compose pillar scores into 0-100 signal
    7.  PortfolioAgent.propose  -> draft target weights for BUY-rated names
    8.  RiskAgent               -> review weights, produce risk report
    9.  PortfolioAgent.backtest -> weekly rebalance simulation
    10. ResearchWorkflow.ingest -> embed evidence into Chroma
    11. ResearchWorkflow.run    -> retrieve, reason, thesis, memo, outbound
    12. ReportingAgent          -> memo + CSVs + JSON + outbound + evidence
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
)
from .agents.models import Rating
from .config import Config, DEFAULT_CONFIG
from .data.mock_data import COMPANY_PROFILES, ensure_mock_data
from .data.universe import load_constituents, select_tickers
from .llm import ResearchWorkflow


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
    df = market_features.copy()
    df = df.join(news_features, how="left")
    df = df.join(fund_features, how="left")
    df = df.join(alt_features, how="left")
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
    rebal_dates = pd.bdate_range(
        price_panel.index[60], price_panel.index[-1], freq=cfg.portfolio.rebalance_frequency
    )
    rebal_dates = [d for d in rebal_dates if d in price_panel.index]
    if not rebal_dates:
        rebal_dates = [price_panel.index[-1]]

    tickers = list(market_panels.keys())
    fund_df = pd.read_csv(fund_csv).set_index("ticker")
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

    fund_features_static = pd.DataFrame(index=tickers)
    fund_features_static["fundamental_score"] = 0.5
    if not fund_df.empty:
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
        row, rrow = {}, {}
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

    return (
        pd.DataFrame(score_rows).set_index("date"),
        pd.DataFrame(rating_rows).set_index("date"),
    )


def _resolve_universe(cfg: Config) -> tuple[list[str], pd.DataFrame]:
    """Apply the UniverseSettings filters and return (tickers, constituents).

    `constituents` is the raw DataFrame from the loader (indexed by ticker)
    so callers can pull sector / company-name metadata downstream.
    """
    constituents = load_constituents(
        cfg.data_dir, source="local", universe_csv=cfg.universe.csv
    )
    tickers = select_tickers(
        constituents,
        tickers=cfg.universe.tickers,
        sectors=cfg.universe.sectors,
        limit=cfg.universe.limit,
    )
    if not tickers:
        raise RuntimeError(
            f"Universe filters produced an empty list "
            f"(name={cfg.universe.name!r}, sectors={cfg.universe.sectors})."
        )
    return tickers, constituents


def run(cfg: Optional[Config] = None) -> dict:
    cfg = cfg or DEFAULT_CONFIG
    np.random.seed(cfg.random_seed)

    tickers, constituents = _resolve_universe(cfg)
    sector_lookup = constituents["sector"].to_dict()
    name_lookup = constituents["company_name"].to_dict()

    print("=" * 72)
    print(
        f"Multi-agent investment research engine — universe={cfg.universe.name!r} "
        f"({len(tickers)} tickers); funnel top_n={cfg.funnel.top_n_for_reasoning}"
    )
    print("=" * 72)

    paths = ensure_mock_data(cfg.data_dir, tickers, seed=cfg.random_seed)

    # 1-4. Quantitative agents.
    market_agent = MarketAgent(cfg.market, benchmark=cfg.benchmark)
    market_out = market_agent.run(tickers)
    market_features: pd.DataFrame = market_out["features"]
    price_panel: pd.DataFrame = market_out["panel"]
    market_panels: dict[str, pd.DataFrame] = market_out["per_ticker"]
    benchmark_series = (
        price_panel[cfg.benchmark] if cfg.benchmark in price_panel.columns else None
    )

    news_features = NewsAgent(csv_path=paths["news"]).run(
        tickers, as_of=price_panel.index[-1]
    )["features"]
    fund_features = FundamentalsAgent(mock_csv=paths["fund"], prefer_live=True).run(
        tickers
    )["features"]
    alt_features = AlternativeDataAgent(csv_path=paths["alt"]).run(
        tickers, as_of=price_panel.index[-1]
    )["features"]

    # 5. Compose feature table + ratings + sector tag.
    feature_table = _build_feature_table(
        market_features, news_features, fund_features, alt_features, cfg.weights
    )
    feature_table["rating"] = feature_table["signal_score"].apply(lambda v: _rating(v, cfg))
    feature_table["sector"] = feature_table.index.map(lambda t: sector_lookup.get(t))
    feature_table["company_name"] = feature_table.index.map(lambda t: name_lookup.get(t, t))
    feature_table = feature_table.sort_values("signal_score", ascending=False)

    # Compact print for big universes.
    if len(feature_table) <= 20:
        print("\nComposite ranking:")
        print(
            feature_table[["signal_score", "rating", "market_score",
                           "news_score", "fundamental_score", "alt_score"]]
            .round(2).to_string()
        )
    else:
        print(
            f"\nComposite ranking: {len(feature_table)} names. "
            f"Top 5: "
            + ", ".join(
                f"{t}({feature_table.loc[t, 'signal_score']:.0f}/{feature_table.loc[t, 'rating']})"
                for t in feature_table.head(5).index
            )
        )

    # 6-7. Portfolio proposal + risk review.
    portfolio_agent = PortfolioAgent(cfg.portfolio, cfg.risk, cfg.ratings)
    proposed = portfolio_agent.propose_weights(feature_table["signal_score"])
    risk_agent = RiskAgent(cfg.risk)
    risk_report = risk_agent.run(
        proposed_weights=proposed,
        market_features=feature_table,
        as_of=price_panel.index[-1].date(),
    )
    risk_adjusted_weights = pd.Series(
        {r.ticker: r.suggested_weight_pct for r in risk_report.per_ticker}
    ).reindex(feature_table.index).fillna(0.0)

    # 8. Backtest.
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

    # 9-11. LangChain workflow.
    # Two-stage funnel: only the top-N + (optionally) all BUY-rated names get
    # the expensive retrieve / reason / thesis / outbound hops.
    if cfg.funnel.top_n_for_reasoning is None:
        reason_on = list(feature_table.index)
    else:
        head = feature_table.head(cfg.funnel.top_n_for_reasoning).index.tolist()
        if cfg.funnel.include_all_buy_rated:
            buys = feature_table[feature_table["rating"] == Rating.BUY.value].index.tolist()
            reason_on = list(dict.fromkeys(head + buys))
        else:
            reason_on = head

    print(
        f"\nReasoning slice: {len(reason_on)} of {len(tickers)} names "
        f"will be retrieved + reasoned + narrated."
    )

    workflow = ResearchWorkflow(chroma_dir=cfg.chroma_dir)
    print(f"LLM provider: {workflow.provider.chat_model_name} "
          f"(embeddings: {workflow.provider.embedding_name}, "
          f"offline={workflow.provider.is_offline})")
    # Only ingest the reasoning slice into Chroma. Rest of the universe
    # never gets retrieved against, so embedding the whole 484 set would
    # be wasted compute (and at 500 names with hosted embeddings, $$).
    workflow.ingest(cfg.data_dir, universe=reason_on)

    snapshot = {
        "cash_pct": risk_report.cash_pct,
        "concentration_pct_top": risk_report.concentration_pct_top,
        "portfolio_volatility": risk_report.portfolio_volatility,
        "flags": list(risk_report.flags),
    }
    company_names = {
        tk: name_lookup.get(tk, COMPANY_PROFILES.get(tk, {}).get("company_name", tk))
        for tk in tickers
    }

    workflow_out = workflow.run(
        universe=tickers,
        feature_table=feature_table,
        risk_reviews=[r.model_dump() for r in risk_report.per_ticker],
        allocations=risk_adjusted_weights.to_dict(),
        portfolio_snapshot=snapshot,
        as_of=price_panel.index[-1].date(),
        company_names=company_names,
        sectors=sector_lookup,
        evidence_k=cfg.evidence_k,
        reason_on=reason_on,
    )

    # 12. Reporter.
    reporter = ReportingAgent(cfg.output_dir, cfg.charts_dir)
    reporter.run(
        feature_table=feature_table,
        rankings=workflow_out.rankings,
        theses=workflow_out.theses,
        outbound_angles=workflow_out.outbound_angles,
        evidence_by_ticker=workflow_out.evidence_by_ticker,
        memo=workflow_out.memo,
        risk_report=risk_report,
        equity_df=bt["equity_curve"],
        summary=bt["summary"],
        trades_df=bt["trades"],
        price_panel=price_panel,
        benchmark=benchmark_series,
    )

    print("\nDone. Outputs written to", cfg.output_dir)
    return {
        "feature_table": feature_table,
        "risk_report": risk_report,
        "workflow": workflow_out,
        "backtest": bt,
        "proposed_weights": risk_adjusted_weights,
    }


if __name__ == "__main__":   # pragma: no cover
    run()
