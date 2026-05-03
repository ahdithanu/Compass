"""ThesisAgent: writes bull / bear / risks for each ticker.

This is intentionally template-driven, not LLM-driven. The point of the
agent is to *show how each signal pillar feeds into a narrative* - a
reviewer can read the memo and trace every sentence back to a numeric
input. The same interface would later let a hosted LLM step in: it would
receive the same per-ticker dict and emit the same Thesis schema.
"""

from __future__ import annotations

from typing import Iterable

import pandas as pd

from .base_agent import BaseAgent
from .models import Thesis


def _phrase_market(row: pd.Series) -> tuple[str, str]:
    """Return (positive phrase, negative phrase) about market signals."""
    mom = float(row.get("momentum", 0.0) or 0.0)
    vol = float(row.get("volatility", 0.0) or 0.0)
    rs = float(row.get("rel_strength", 0.0) or 0.0)
    dd = float(row.get("drawdown", 0.0) or 0.0)

    pos_bits, neg_bits = [], []
    if mom > 0.05:
        pos_bits.append(f"price momentum is positive ({mom:+.0%} over the window)")
    elif mom < -0.05:
        neg_bits.append(f"price momentum is negative ({mom:+.0%})")
    if rs > 0.02:
        pos_bits.append(f"outperforming the benchmark by {rs:+.0%}")
    elif rs < -0.02:
        neg_bits.append(f"lagging the benchmark by {rs:+.0%}")
    if vol > 0.45:
        neg_bits.append(f"realized volatility is elevated ({vol:.0%} annualized)")
    if dd <= -0.15:
        neg_bits.append(f"shares are {dd:.0%} below recent highs")
    return ", ".join(pos_bits), ", ".join(neg_bits)


def _phrase_news(row: pd.Series) -> tuple[str, str]:
    sent = float(row.get("avg_sentiment", 0.0) or 0.0)
    impact = float(row.get("avg_impact", 0.0) or 0.0)
    n = int(row.get("n_events", 0) or 0)
    if n == 0:
        return "", "no recent news flow to lean on"
    if sent > 0.2:
        return (
            f"news flow is constructive (avg sentiment {sent:+.2f}, "
            f"impact {impact:.2f} across {n} events)",
            "",
        )
    if sent < -0.2:
        return (
            "",
            f"news flow is negative (avg sentiment {sent:+.2f}, {n} recent events)",
        )
    return f"news flow is mixed-to-neutral across {n} events", ""


def _phrase_fundamentals(row: pd.Series) -> tuple[str, str]:
    pos_bits, neg_bits = [], []
    g = row.get("revenue_growth_yoy")
    if g is not None and pd.notna(g):
        if g > 0.20:
            pos_bits.append(f"revenue growth of {g:+.0%} YoY")
        elif g < 0.05:
            neg_bits.append(f"slowing revenue growth ({g:+.0%} YoY)")
    om = row.get("operating_margin")
    if om is not None and pd.notna(om):
        if om > 0.20:
            pos_bits.append(f"healthy operating margin ({om:.0%})")
        elif om < 0:
            neg_bits.append("operating margin is negative")
    pe = row.get("pe_ratio")
    if pe is not None and pd.notna(pe):
        if pe > 60:
            neg_bits.append(f"valuation is rich (P/E ~ {pe:.0f}x)")
        elif pe < 20:
            pos_bits.append(f"valuation is reasonable (P/E ~ {pe:.0f}x)")
    return ", ".join(pos_bits), ", ".join(neg_bits)


def _phrase_alt(row: pd.Series) -> tuple[str, str]:
    n = int(row.get("n_signals", 0) or 0)
    score = float(row.get("alt_score", 0.5) or 0.5)
    if n == 0:
        return "", "no alt-data signals on file this window"
    if score > 0.65:
        return (
            f"strong alt-data pulse ({n} recent signals, score {score:.2f}) "
            "consistent with continued investment",
            "",
        )
    if score < 0.35:
        return "", f"alt-data signals are quiet ({n} signals, score {score:.2f})"
    return f"moderate alt-data activity ({n} signals)", ""


def _conviction(score: float, flags: list[str]) -> str:
    if score >= 75 and not flags:
        return "high"
    if score >= 60 and "high_volatility" not in flags:
        return "medium"
    return "low"


class ThesisAgent(BaseAgent):
    name = "ThesisAgent"
    description = (
        "Synthesizes Market / News / Fundamentals / Alt-Data features and "
        "RiskAgent flags into a bull case, a bear case, and key risks per "
        "ticker."
    )

    def run(
        self,
        tickers: Iterable[str],
        feature_table: pd.DataFrame,
        risk_flags_by_ticker: dict[str, list[str]],
    ) -> dict[str, Thesis]:
        out: dict[str, Thesis] = {}
        for t in tickers:
            if t not in feature_table.index:
                continue
            row = feature_table.loc[t]

            mp, mn = _phrase_market(row)
            np_, nn = _phrase_news(row)
            fp, fn = _phrase_fundamentals(row)
            ap, an = _phrase_alt(row)

            bull_bits = [b for b in (mp, np_, fp, ap) if b]
            bear_bits = [b for b in (mn, nn, fn, an) if b]

            if not bull_bits:
                bull_bits.append(
                    "constructive setup is thin; rely on cross-sectional rank "
                    "rather than any one pillar"
                )
            if not bear_bits:
                bear_bits.append(
                    "no obvious red flags in the inputs - main risk is mean "
                    "reversion of the bullish signals"
                )

            risks: list[str] = []
            flags = risk_flags_by_ticker.get(t, [])
            if "high_volatility" in flags:
                risks.append("Elevated realized volatility (position will be trimmed).")
            if "deep_drawdown" in flags:
                risks.append("Recent deep drawdown - momentum can overshoot.")
            if "position_cap" in flags:
                risks.append("Single-name cap binding - can't size up further.")
            if not risks:
                risks.append("No specific risk-agent flag; standard market risk applies.")

            score = float(row.get("signal_score", 50.0))
            out[t] = Thesis(
                ticker=t,
                bull_case="Bull case: " + "; ".join(bull_bits) + ".",
                bear_case="Bear case: " + "; ".join(bear_bits) + ".",
                key_risks=risks,
                conviction=_conviction(score, flags),
            )

        self.log(
            "Theses produced for: " + ", ".join(out.keys())
        )
        return out
