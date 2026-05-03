"""Pure-mock providers for tests / no-egress demos."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import pandas as pd

from .base import FundamentalsProvider, FundamentalsSnapshot
from .yfinance_provider import _safe_float


class MockFundamentalsProvider(FundamentalsProvider):
    """Reads only from a CSV - never tries the network. Used in unit tests."""

    name = "mock-csv"

    def __init__(self, mock_csv: Path) -> None:
        self.mock_csv = Path(mock_csv)
        self._df = pd.read_csv(self.mock_csv).set_index("ticker")

    def get_snapshots(self, tickers: Iterable[str]) -> list[FundamentalsSnapshot]:
        out = []
        for t in tickers:
            t = t.upper()
            if t not in self._df.index:
                out.append(FundamentalsSnapshot(ticker=t, source="default"))
                continue
            row = self._df.loc[t]
            out.append(
                FundamentalsSnapshot(
                    ticker=t,
                    revenue_growth_yoy=_safe_float(row.get("revenue_growth_yoy")),
                    gross_margin=_safe_float(row.get("gross_margin")),
                    operating_margin=_safe_float(row.get("operating_margin")),
                    net_margin=_safe_float(row.get("net_margin")),
                    pe_ratio=_safe_float(row.get("pe_ratio")),
                    ps_ratio=_safe_float(row.get("ps_ratio")),
                    return_on_equity=_safe_float(row.get("return_on_equity")),
                    source="mock",
                )
            )
        return out
