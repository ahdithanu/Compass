"""FundamentalsAgent: revenue growth, margins, valuation, profitability.

Pulls a snapshot of fundamental metrics per ticker from yfinance and falls
back to a CSV (`mock_fundamentals.csv`) for any ticker yfinance does not
return, so the pipeline is deterministic and offline-runnable.

Three sub-scores are computed and combined:
* growth_score        - revenue growth YoY (cross-sectional rank)
* profitability_score - operating + net margin + ROE blend
* valuation_score     - inverse P/E and inverse P/S (cheaper = higher)

Output `fundamental_score` is a 0-1 blend of the three.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .base_agent import BaseAgent
from .models import FundamentalSnapshot


def _safe_float(x) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)
        if not np.isfinite(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def _rank_norm(s: pd.Series) -> pd.Series:
    """Cross-sectional rank into [0, 1]; ties handled with average rank."""
    if s.dropna().empty:
        return pd.Series(0.5, index=s.index)
    ranks = s.rank(method="average", na_option="bottom")
    n = len(ranks)
    if n <= 1:
        return pd.Series(0.5, index=s.index)
    return (ranks - 1) / (n - 1)


class FundamentalsAgent(BaseAgent):
    name = "FundamentalsAgent"
    description = (
        "Pulls a fundamentals snapshot per ticker (revenue growth, margins, "
        "valuation multiples, ROE) and produces growth / profitability / "
        "valuation sub-scores plus a combined fundamental_score."
    )

    def __init__(
        self,
        mock_csv: Path,
        verbose: bool = True,
        prefer_live: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.mock_csv = Path(mock_csv)
        self.prefer_live = prefer_live
        self._mock_df: Optional[pd.DataFrame] = None

    def _load_mock(self) -> pd.DataFrame:
        if self._mock_df is None:
            df = pd.read_csv(self.mock_csv)
            df["ticker"] = df["ticker"].str.upper()
            self._mock_df = df.set_index("ticker")
        return self._mock_df

    def _live_snapshot(self, ticker: str) -> Optional[FundamentalSnapshot]:
        try:
            import yfinance as yf

            info = yf.Ticker(ticker).info or {}
        except Exception as exc:    # network / parse failures both land here
            self.log(f"  {ticker}: live fetch failed ({exc!s}), will use mock")
            return None
        snap = FundamentalSnapshot(
            ticker=ticker,
            revenue_growth_yoy=_safe_float(info.get("revenueGrowth")),
            gross_margin=_safe_float(info.get("grossMargins")),
            operating_margin=_safe_float(info.get("operatingMargins")),
            net_margin=_safe_float(info.get("profitMargins")),
            pe_ratio=_safe_float(info.get("trailingPE") or info.get("forwardPE")),
            ps_ratio=_safe_float(info.get("priceToSalesTrailing12Months")),
            return_on_equity=_safe_float(info.get("returnOnEquity")),
            source="yfinance",
        )
        # If almost everything is missing, treat as failure and fall back.
        non_null = [
            snap.revenue_growth_yoy, snap.gross_margin, snap.operating_margin,
            snap.net_margin, snap.pe_ratio, snap.ps_ratio, snap.return_on_equity,
        ]
        if sum(1 for x in non_null if x is not None) < 3:
            return None
        return snap

    def _mock_snapshot(self, ticker: str) -> FundamentalSnapshot:
        df = self._load_mock()
        if ticker not in df.index:
            self.log(f"  {ticker}: not in mock CSV, using neutral defaults")
            return FundamentalSnapshot(ticker=ticker, source="default")
        row = df.loc[ticker]
        return FundamentalSnapshot(
            ticker=ticker,
            revenue_growth_yoy=_safe_float(row.get("revenue_growth_yoy")),
            gross_margin=_safe_float(row.get("gross_margin")),
            operating_margin=_safe_float(row.get("operating_margin")),
            net_margin=_safe_float(row.get("net_margin")),
            pe_ratio=_safe_float(row.get("pe_ratio")),
            ps_ratio=_safe_float(row.get("ps_ratio")),
            return_on_equity=_safe_float(row.get("return_on_equity")),
            source="mock",
        )

    def _snapshot(self, ticker: str) -> FundamentalSnapshot:
        if self.prefer_live:
            live = self._live_snapshot(ticker)
            if live is not None:
                return live
        return self._mock_snapshot(ticker)

    def run(self, tickers: Iterable[str]) -> dict:
        tickers = [t.upper() for t in tickers]
        snaps: list[FundamentalSnapshot] = []
        for t in tickers:
            self.log(f"Fundamentals: {t}")
            snaps.append(self._snapshot(t))

        rows = [s.model_dump() for s in snaps]
        df = pd.DataFrame(rows).set_index("ticker")

        growth_rank = _rank_norm(df["revenue_growth_yoy"])
        # Profitability is the average of three normalized margins / ROE.
        prof_inputs = pd.DataFrame(
            {
                "om": _rank_norm(df["operating_margin"]),
                "nm": _rank_norm(df["net_margin"]),
                "roe": _rank_norm(df["return_on_equity"]),
            }
        )
        profit_rank = prof_inputs.mean(axis=1)

        # Valuation: cheaper is better. Invert P/E and P/S, then rank.
        inv_pe = 1.0 / df["pe_ratio"].clip(lower=1e-3)
        inv_ps = 1.0 / df["ps_ratio"].clip(lower=1e-3)
        val_rank = (_rank_norm(inv_pe) + _rank_norm(inv_ps)) / 2.0

        df["growth_score"] = growth_rank.fillna(0.5)
        df["profitability_score"] = profit_rank.fillna(0.5)
        df["valuation_score"] = val_rank.fillna(0.5)
        df["fundamental_score"] = (
            0.45 * df["growth_score"]
            + 0.35 * df["profitability_score"]
            + 0.20 * df["valuation_score"]
        ).clip(0.0, 1.0)

        self.log(
            "Fundamental scores: "
            + ", ".join(f"{t}={v:.2f}" for t, v in df["fundamental_score"].items())
        )
        return {"snapshots": snaps, "features": df}
