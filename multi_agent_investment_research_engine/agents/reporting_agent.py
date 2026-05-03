"""ReportingAgent: serializes the LangChain workflow output to disk.

Writes:
* outputs/weekly_investment_memo.md         - prose memo from MemoAgent
* outputs/company_signal_scores.csv         - per-pillar + composite scores
* outputs/company_rankings.json             - ranked list with qual scores
* outputs/risk_report.json                  - portfolio-level risk readout
* outputs/outbound_angles.md                - GTM angles per top-rated name
* outputs/retrieved_signal_evidence.json    - what Chroma returned per name
* outputs/portfolio_backtest.csv            - daily equity curve
* outputs/trades.csv                        - simulated rebalance legs
* outputs/performance_summary.json          - return, drawdown, win rate
* outputs/charts/*.png                      - equity curve, score panel...

The reporter is purely I/O: every fact it writes was produced upstream.
That separation matters for testability - swapping the LLM provider does
not change reporting code.
"""

from __future__ import annotations

import json
from datetime import date as _date
from pathlib import Path
from typing import Iterable

import matplotlib

matplotlib.use("Agg")    # headless rendering for CI / WSL
import matplotlib.pyplot as plt
import pandas as pd

from .base_agent import BaseAgent
from .models import PortfolioRiskReport


def _to_jsonable(obj):
    """Recursively turn pydantic / numpy / dates into JSON-friendly values."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    return obj


class ReportingAgent(BaseAgent):
    name = "ReportingAgent"
    description = (
        "Writes the investment memo, rankings JSON, signal scores CSV, "
        "outbound angles MD, retrieved evidence JSON, backtest, and charts."
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
    # CSV / JSON writers
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

    def write_rankings(self, rankings: list, theses: dict) -> Path:
        """company_rankings.json: full structured ranking + thesis snippets."""
        path = self.output_dir / "company_rankings.json"
        rows = []
        for r in rankings:
            t = theses.get(r.ticker)
            rows.append(
                {
                    "rank": r.rank,
                    "ticker": r.ticker,
                    "rating": r.rating,
                    "signal_score": r.signal_score,
                    "qualitative_score": r.qualitative_score,
                    "headline": r.headline,
                    "investment_thesis": t.investment_thesis if t else "",
                    "conviction": t.conviction if t else None,
                }
            )
        path.write_text(json.dumps(rows, indent=2, default=str))
        self.log(f"Wrote {path}")
        return path

    def write_risk_report(self, report: PortfolioRiskReport) -> Path:
        path = self.output_dir / "risk_report.json"
        path.write_text(json.dumps(report.model_dump(mode="json"), indent=2, default=str))
        self.log(f"Wrote {path}")
        return path

    def write_evidence(self, evidence_by_ticker: dict) -> Path:
        path = self.output_dir / "retrieved_signal_evidence.json"
        out = {
            tk: [e.model_dump() for e in items]
            for tk, items in evidence_by_ticker.items()
        }
        path.write_text(json.dumps(out, indent=2, default=str))
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
        (self.output_dir / "trades.csv").write_text(trades_df.to_csv(index=False))
        (self.output_dir / "performance_summary.json").write_text(
            json.dumps(summary, indent=2, default=str)
        )
        return path

    # ------------------------------------------------------------------
    # Markdown writers
    # ------------------------------------------------------------------
    def write_memo(
        self,
        memo,                               # InvestmentMemo (llm.schemas)
        risk_report: PortfolioRiskReport,
        backtest_summary: dict,
    ) -> Path:
        """Render an InvestmentMemo to weekly_investment_memo.md."""
        path = self.output_dir / "weekly_investment_memo.md"
        bench = backtest_summary.get("benchmark_return_pct")
        bench_str = (
            f"{bench:.1f}%" if isinstance(bench, (int, float)) and bench == bench else "n/a"
        )
        with path.open("w") as f:
            f.write("# Weekly Investment Memo\n\n")
            f.write(f"_As of {memo.as_of}_\n\n")
            f.write(f"_{memo.headline}_\n\n")
            f.write(
                "This memo is produced by a multi-agent research engine. "
                "Numeric scores come from quantitative agents; the bull/bear "
                "narrative and outbound angles are written by LangChain "
                "agents grounded in retrieved evidence. **Research and paper-"
                "trading simulation only - not investment advice.**\n\n"
            )
            if memo.top_pick_ticker:
                f.write("## Top Ranked Company\n\n")
                f.write(f"**{memo.top_pick_ticker}**\n\n")
                if memo.top_pick_summary:
                    f.write(memo.top_pick_summary + "\n\n")

            f.write("## Portfolio Snapshot\n\n")
            f.write(memo.portfolio_snapshot_md)
            f.write(f"- Backtest total return: **{backtest_summary.get('total_return_pct', 0):.1f}%**  \n")
            f.write(f"- Benchmark return: **{bench_str}**  \n")
            f.write(f"- Max drawdown: **{backtest_summary.get('max_drawdown_pct', 0):.1f}%**  \n")
            f.write(f"- Sharpe-like: **{backtest_summary.get('sharpe_like', 0):.2f}**\n\n")

            f.write("## Full Ranking\n\n")
            for e in memo.entries:
                f.write(
                    f"### {e.rank}. {e.ticker} — {e.rating} (score {e.signal_score:.0f}/100)\n\n"
                )
                f.write(f"**Allocation:** {e.allocation_pct * 100:.1f}%  \n")
                f.write(f"**Decision:** {e.decision}\n\n")
                if e.bull_case:
                    f.write(e.bull_case + "\n\n")
                if e.bear_case:
                    f.write(e.bear_case + "\n\n")
                if e.risk_notes:
                    f.write("**Risk Notes:**\n")
                    for n in e.risk_notes:
                        f.write(f"- {n}\n")
                    f.write("\n")

            f.write("## How to read this memo\n\n")
            f.write(memo.closing_note + "\n")

        self.log(f"Wrote {path}")
        return path

    def write_outbound_angles(self, outbound_angles: dict, rankings: list) -> Path:
        """outbound_angles.md: same signals, sales / GTM lens."""
        path = self.output_dir / "outbound_angles.md"
        # Order by composite score so the top opportunities lead.
        ordered = [r.ticker for r in rankings]
        with path.open("w") as f:
            f.write("# Outbound Angles\n\n")
            f.write(
                "Same signal evidence the investment memo used, re-framed for "
                "a sales / GTM motion. The trigger is the specific event, the "
                "persona is who you'd reach, and the opener / follow-up are "
                "concrete starting points - not finished copy.\n\n"
            )
            for tk in ordered:
                a = outbound_angles.get(tk)
                if a is None:
                    continue
                f.write(f"## {tk}{(' — ' + a.company_name) if a.company_name else ''}\n\n")
                f.write(f"**Confidence:** {a.confidence}  \n")
                f.write(f"**Trigger signal:** {a.trigger_signal}\n\n")
                f.write(f"**Persona:** {a.persona}\n\n")
                f.write(f"**Pain hypothesis:** {a.pain_hypothesis}\n\n")
                f.write("**Opener:**\n\n")
                f.write(f"> {a.opener}\n\n")
                f.write("**Follow-up:**\n\n")
                f.write(f"> {a.follow_up}\n\n")
                f.write("---\n\n")
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

        # 1. Per-pillar score bars.
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

        # 4. Per-ticker price for top-4 names.
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
    # Top-level orchestration helper
    # ------------------------------------------------------------------
    def run(self, **kwargs) -> dict[str, Path]:
        out: dict[str, Path] = {}
        out["scores"] = self.write_signal_scores(kwargs["feature_table"])
        out["rankings"] = self.write_rankings(kwargs["rankings"], kwargs["theses"])
        out["risk"] = self.write_risk_report(kwargs["risk_report"])
        out["evidence"] = self.write_evidence(kwargs["evidence_by_ticker"])
        out["backtest"] = self.write_backtest(
            kwargs["equity_df"], kwargs["summary"], kwargs["trades_df"]
        )
        out["memo"] = self.write_memo(
            kwargs["memo"], kwargs["risk_report"], kwargs["summary"]
        )
        out["outbound"] = self.write_outbound_angles(
            kwargs["outbound_angles"], kwargs["rankings"]
        )
        self.write_charts(
            kwargs["feature_table"],
            kwargs["equity_df"],
            kwargs["price_panel"],
            kwargs.get("benchmark"),
        )
        out["charts"] = self.charts_dir
        return out
