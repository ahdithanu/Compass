"""ReportingAgent: turns the analysis pipeline into reviewer-ready outputs.

Writes:
* outputs/weekly_investment_memo.md     - prose memo, ranked by score
* outputs/company_signal_scores.csv     - per-pillar + composite scores
* outputs/portfolio_backtest.csv        - daily equity curve
* outputs/risk_report.json              - portfolio-level risk readout
* outputs/charts/*.png                  - equity curve, score panel, etc.

The memo is what a reviewer should read first - it should tell the story
of *why* each name is in the portfolio.
"""

from __future__ import annotations

import json
from datetime import date as _date
from pathlib import Path

import matplotlib

matplotlib.use("Agg")    # headless rendering for CI / WSL
import matplotlib.pyplot as plt
import pandas as pd

from .base_agent import BaseAgent
from .models import (
    InvestmentMemoEntry,
    PortfolioRiskReport,
    Rating,
    Thesis,
)


class ReportingAgent(BaseAgent):
    name = "ReportingAgent"
    description = (
        "Writes the investment memo, signal scores CSV, portfolio backtest "
        "CSV, risk report JSON, and supporting charts."
    )

    def __init__(
        self,
        output_dir: Path,
        charts_dir: Path,
        verbose: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.output_dir = Path(output_dir)
        self.charts_dir = Path(charts_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.charts_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Files
    # ------------------------------------------------------------------
    def write_signal_scores(self, feature_table: pd.DataFrame) -> Path:
        path = self.output_dir / "company_signal_scores.csv"
        cols = [
            c
            for c in [
                "rating",
                "signal_score",
                "market_score",
                "news_score",
                "fundamental_score",
                "alt_score",
                "momentum",
                "volatility",
                "drawdown",
                "rel_strength",
                "revenue_growth_yoy",
                "operating_margin",
                "pe_ratio",
                "n_events",
                "n_signals",
            ]
            if c in feature_table.columns
        ]
        feature_table[cols].sort_values("signal_score", ascending=False).to_csv(path)
        self.log(f"Wrote {path}")
        return path

    def write_risk_report(self, report: PortfolioRiskReport) -> Path:
        path = self.output_dir / "risk_report.json"
        path.write_text(json.dumps(report.model_dump(mode="json"), indent=2, default=str))
        self.log(f"Wrote {path}")
        return path

    def write_backtest(
        self,
        equity_df: pd.DataFrame,
        summary: dict,
        trades_df: pd.DataFrame,
    ) -> Path:
        path = self.output_dir / "portfolio_backtest.csv"
        equity_df.to_csv(path)
        self.log(f"Wrote {path}")

        # Also persist trades and the JSON summary as a sibling.
        (self.output_dir / "trades.csv").write_text(trades_df.to_csv(index=False))
        (self.output_dir / "performance_summary.json").write_text(
            json.dumps(summary, indent=2, default=str)
        )
        return path

    def write_memo(
        self,
        as_of: _date,
        feature_table: pd.DataFrame,
        theses: dict[str, Thesis],
        proposed_weights: pd.Series,
        risk_report: PortfolioRiskReport,
        summary: dict,
    ) -> Path:
        risk_by_ticker = {r.ticker: r for r in risk_report.per_ticker}
        ranked = feature_table.sort_values("signal_score", ascending=False)

        entries: list[InvestmentMemoEntry] = []
        for rank, ticker in enumerate(ranked.index, start=1):
            row = ranked.loc[ticker]
            score = float(row["signal_score"])
            rating = Rating(row["rating"])
            thesis = theses.get(ticker)
            review = risk_by_ticker.get(ticker)
            weight = float(proposed_weights.get(ticker, 0.0))

            if rating == Rating.BUY and weight > 0:
                decision = (
                    f"Paper trade position approved at "
                    f"{weight * 100:.1f} percent portfolio allocation."
                )
            elif rating == Rating.BUY and weight == 0:
                decision = (
                    "Buy-rated but capacity is full this cycle. Watchlist."
                )
            elif rating == Rating.HOLD:
                decision = "Hold-rated. No action this cycle."
            else:
                decision = "Avoid-rated. Excluded from the portfolio."

            risk_notes: list[str] = []
            if review is not None:
                risk_notes = list(review.notes)
                if review.flags:
                    risk_notes.insert(0, "Flags: " + ", ".join(review.flags))

            entries.append(
                InvestmentMemoEntry(
                    rank=rank,
                    ticker=ticker,
                    signal_score=score,
                    rating=rating,
                    decision=decision,
                    allocation_pct=weight,
                    bull_case=thesis.bull_case if thesis else "",
                    bear_case=thesis.bear_case if thesis else "",
                    risk_notes=risk_notes,
                )
            )

        path = self.output_dir / "weekly_investment_memo.md"
        with path.open("w") as f:
            f.write("# Weekly Investment Memo\n\n")
            f.write(f"_As of {as_of.isoformat()}_\n\n")
            f.write(
                "This memo is produced by the multi-agent research system "
                "for paper-trading and educational purposes only. It is not "
                "investment advice.\n\n"
            )

            top = next((e for e in entries if e.rating == Rating.BUY), None)
            if top:
                f.write("## Top Ranked Company\n\n")
                f.write(f"**{top.ticker}** — Signal Score: **{top.signal_score:.0f}/100**\n\n")
                f.write(f"**{top.bull_case}**\n\n")
                f.write(f"**{top.bear_case}**\n\n")
                f.write(f"**Decision:** {top.decision}\n\n")
                if top.risk_notes:
                    f.write("**Risk Notes:**\n")
                    for note in top.risk_notes:
                        f.write(f"- {note}\n")
                    f.write("\n")

            f.write("## Portfolio Snapshot\n\n")
            bench_ret = summary.get("benchmark_return_pct")
            bench_str = (
                f"{bench_ret:.1f}%"
                if isinstance(bench_ret, (int, float)) and bench_ret == bench_ret
                else "n/a"
            )
            f.write(
                f"- Cash: **{risk_report.cash_pct * 100:.1f}%**  \n"
                f"- Top single-name weight: **{risk_report.concentration_pct_top * 100:.1f}%**  \n"
                f"- Portfolio volatility (proxy): **{risk_report.portfolio_volatility * 100:.1f}%**  \n"
                f"- Backtest total return: **{summary.get('total_return_pct', 0):.1f}%**  \n"
                f"- Benchmark return: **{bench_str}**  \n"
                f"- Max drawdown: **{summary.get('max_drawdown_pct', 0):.1f}%**  \n"
                f"- Sharpe-like: **{summary.get('sharpe_like', 0):.2f}**\n\n"
            )

            f.write("## Full Ranking\n\n")
            for e in entries:
                f.write(f"### {e.rank}. {e.ticker} — {e.rating.value} (score {e.signal_score:.0f}/100)\n\n")
                f.write(f"**Allocation:** {e.allocation_pct * 100:.1f}%  \n")
                f.write(f"**Decision:** {e.decision}\n\n")
                f.write(f"{e.bull_case}\n\n")
                f.write(f"{e.bear_case}\n\n")
                if e.risk_notes:
                    f.write("**Risk Notes:**\n")
                    for note in e.risk_notes:
                        f.write(f"- {note}\n")
                    f.write("\n")

            f.write("## How to read this memo\n\n")
            f.write(
                "Every signal score on this page can be traced back to a "
                "specific agent: MarketAgent for momentum / volatility / "
                "drawdown / relative strength, NewsAgent for sentiment + "
                "event impact, FundamentalsAgent for growth / margins / "
                "valuation, and AlternativeDataAgent for hiring, product, "
                "and traffic signals. RiskAgent decides whether each name "
                "fits inside the portfolio's caps. ThesisAgent stitches the "
                "narrative. PortfolioAgent runs the paper-trading simulation.\n"
            )

        self.log(f"Wrote {path}")
        return path

    # ------------------------------------------------------------------
    # Charts
    # ------------------------------------------------------------------
    def write_charts(
        self,
        feature_table: pd.DataFrame,
        equity_df: pd.DataFrame,
        price_panel: pd.DataFrame,
        benchmark: pd.Series | None,
    ) -> list[Path]:
        out: list[Path] = []

        # 1. Score panel: stacked bars per pillar.
        fig, ax = plt.subplots(figsize=(10, 5))
        cols = ["market_score", "news_score", "fundamental_score", "alt_score"]
        pillars = feature_table[cols].sort_values(by="market_score", ascending=False)
        pillars.plot(kind="bar", stacked=False, ax=ax)
        ax.set_title("Per-pillar signal scores by ticker")
        ax.set_ylabel("Score (0-1)")
        ax.set_ylim(0, 1)
        ax.set_xlabel("")
        ax.legend(loc="upper right", fontsize=8)
        fig.tight_layout()
        p = self.charts_dir / "signal_scores_by_pillar.png"
        fig.savefig(p, dpi=120)
        plt.close(fig)
        out.append(p)

        # 2. Composite score ranking.
        fig, ax = plt.subplots(figsize=(10, 4))
        ranked = feature_table["signal_score"].sort_values(ascending=False)
        ax.bar(ranked.index, ranked.values)
        ax.axhline(70, linestyle="--", linewidth=1, label="BUY threshold")
        ax.axhline(50, linestyle=":", linewidth=1, label="HOLD threshold")
        ax.set_title("Composite signal score (0-100)")
        ax.set_ylabel("Signal score")
        ax.legend(loc="upper right", fontsize=8)
        fig.tight_layout()
        p = self.charts_dir / "composite_signal_scores.png"
        fig.savefig(p, dpi=120)
        plt.close(fig)
        out.append(p)

        # 3. Equity curve vs benchmark.
        fig, ax = plt.subplots(figsize=(10, 5))
        pv = equity_df["portfolio_value"]
        ax.plot(pv.index, pv.values / pv.iloc[0], label="Strategy")
        if benchmark is not None and not benchmark.empty:
            b = benchmark.reindex(pv.index).ffill().bfill()
            ax.plot(b.index, b.values / b.iloc[0], label="Benchmark", alpha=0.8)
        ax.set_title("Paper-trading equity curve (normalized to 1.0)")
        ax.legend(loc="upper left", fontsize=8)
        fig.tight_layout()
        p = self.charts_dir / "equity_curve.png"
        fig.savefig(p, dpi=120)
        plt.close(fig)
        out.append(p)

        # 4. Per-ticker price + buy markers (if any) for the top 4.
        top = feature_table["signal_score"].sort_values(ascending=False).head(4).index
        for t in top:
            if t not in price_panel.columns:
                continue
            fig, ax = plt.subplots(figsize=(9, 3.5))
            px = price_panel[t].dropna()
            ax.plot(px.index, px.values, label=t)
            ax.set_title(f"{t} - close price ({px.index[0].date()} → {px.index[-1].date()})")
            ax.legend(loc="upper left", fontsize=8)
            fig.tight_layout()
            p = self.charts_dir / f"price_{t}.png"
            fig.savefig(p, dpi=120)
            plt.close(fig)
            out.append(p)

        self.log(f"Wrote {len(out)} chart(s) to {self.charts_dir}")
        return out

    # ------------------------------------------------------------------
    # Top-level run helper
    # ------------------------------------------------------------------
    def run(self, **kwargs) -> dict[str, Path]:
        """Convenience wrapper that calls the writers in the expected order."""
        out: dict[str, Path] = {}
        out["scores"] = self.write_signal_scores(kwargs["feature_table"])
        out["risk"] = self.write_risk_report(kwargs["risk_report"])
        out["backtest"] = self.write_backtest(
            kwargs["equity_df"], kwargs["summary"], kwargs["trades_df"]
        )
        out["memo"] = self.write_memo(
            kwargs["as_of"],
            kwargs["feature_table"],
            kwargs["theses"],
            kwargs["proposed_weights"],
            kwargs["risk_report"],
            kwargs["summary"],
        )
        charts = self.write_charts(
            kwargs["feature_table"],
            kwargs["equity_df"],
            kwargs["price_panel"],
            kwargs.get("benchmark"),
        )
        out["charts"] = self.charts_dir
        return out
