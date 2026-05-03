"""FundamentalsAgent: revenue growth, margins, valuation, profitability.

Reads fundamentals snapshots from a `FundamentalsProvider` (default:
yfinance with mock-CSV fallback). Three sub-scores are computed and
combined:

* growth_score        - revenue growth YoY (cross-sectional rank)
* profitability_score - operating + net margin + ROE blend
* valuation_score     - inverse P/E and inverse P/S (cheaper = higher)

Output `fundamental_score` is a 0-1 blend of the three.

Swap `provider=` for any other backend (FMP / Polygon / EDGAR XBRL) -
this agent does not care where the snapshot came from.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .base_agent import BaseAgent
from .models import FundamentalSnapshot
from ..providers import (
    FundamentalsProvider,
    YFinanceFundamentalsProvider,
)


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
        "valuation multiples, ROE) via a FundamentalsProvider and produces "
        "growth / profitability / valuation sub-scores plus a combined "
        "fundamental_score."
    )

    def __init__(
        self,
        mock_csv: Optional[Path] = None,
        provider: Optional[FundamentalsProvider] = None,
        verbose: bool = True,
        prefer_live: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        if provider is None:
            if mock_csv is None:
                raise ValueError(
                    "FundamentalsAgent needs either a `provider` or `mock_csv`."
                )
            provider = YFinanceFundamentalsProvider(
                mock_csv=mock_csv, prefer_live=prefer_live, verbose=verbose
            )
        self.provider = provider

    def run(self, tickers: Iterable[str]) -> dict:
        tickers = [t.upper() for t in tickers]
        self.log(
            f"Fundamentals via {self.provider.name} for {len(tickers)} tickers"
        )
        raw_snapshots = self.provider.get_snapshots(tickers)
        snaps = [
            FundamentalSnapshot(
                ticker=s.ticker,
                revenue_growth_yoy=s.revenue_growth_yoy,
                gross_margin=s.gross_margin,
                operating_margin=s.operating_margin,
                net_margin=s.net_margin,
                pe_ratio=s.pe_ratio,
                ps_ratio=s.ps_ratio,
                return_on_equity=s.return_on_equity,
                source=s.source,
            )
            for s in raw_snapshots
        ]
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

        if len(df) <= 12:
            self.log(
                "Fundamental scores: "
                + ", ".join(f"{t}={v:.2f}" for t, v in df["fundamental_score"].items())
            )
        else:
            top = df["fundamental_score"].sort_values(ascending=False).head(5)
            self.log(
                f"Fundamental scores (top 5 of {len(df)}): "
                + ", ".join(f"{t}={v:.2f}" for t, v in top.items())
            )
        return {"snapshots": snaps, "features": df}
