"""Provider interfaces - what every data backend must implement.

The quantitative agents talk to these, never to yfinance / pandas / CSVs
directly. Two reasons:

1. **Swapability.** Polygon / Alpaca / FMP / EDGAR / Tiingo all become
   "write a new provider" jobs. Agents stay untouched.
2. **Testability.** Unit tests inject a fake provider and exercise the
   agent without spinning up a network call or loading a 200MB CSV.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional, Protocol

import pandas as pd


@dataclass
class PricePanel:
    """Returned by a `MarketDataProvider`.

    `closes` is a wide DataFrame: index = trading day, columns = ticker.
    `is_synthetic` flags fallback / mock data so callers can warn loudly.
    """

    closes: pd.DataFrame
    is_synthetic: bool = False
    source: str = "unknown"


@dataclass
class FundamentalsSnapshot:
    """Returned by a `FundamentalsProvider` per ticker."""

    ticker: str
    revenue_growth_yoy: Optional[float] = None
    gross_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    net_margin: Optional[float] = None
    pe_ratio: Optional[float] = None
    ps_ratio: Optional[float] = None
    return_on_equity: Optional[float] = None
    source: str = "unknown"

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        return d


class MarketDataProvider(Protocol):
    """Interface for fetching close-price history.

    Implementations:
    * `YFinanceMarketProvider` - hits yfinance, falls back to a deterministic
      synthetic panel if the network is blocked.
    * (planned) `PolygonMarketProvider`, `AlpacaMarketProvider`, ...
    """

    name: str

    def get_prices(
        self,
        tickers: Iterable[str],
        period: str,
        interval: str,
    ) -> PricePanel:
        ...


class FundamentalsProvider(Protocol):
    """Interface for fetching point-in-time fundamentals snapshots.

    Implementations:
    * `YFinanceFundamentalsProvider` - hits yfinance per ticker, falls
      back to mock data.
    * `MockFundamentalsProvider` - deterministic mock CSV reader, used in
      tests + offline mode.
    """

    name: str

    def get_snapshots(self, tickers: Iterable[str]) -> list[FundamentalsSnapshot]:
        ...
