"""Pluggable data providers.

The quantitative agents consume these abstractions instead of calling
yfinance / reading CSVs directly. Swapping in Polygon / Alpaca / FMP /
EDGAR is a matter of writing a new `MarketDataProvider`,
`FundamentalsProvider`, etc., and dropping it into the constructor.
"""

from .base import (
    FundamentalsProvider,
    FundamentalsSnapshot,
    MarketDataProvider,
    PricePanel,
)
from .yfinance_provider import YFinanceMarketProvider, YFinanceFundamentalsProvider
from .mock_provider import MockFundamentalsProvider

__all__ = [
    "FundamentalsProvider",
    "FundamentalsSnapshot",
    "MarketDataProvider",
    "MockFundamentalsProvider",
    "PricePanel",
    "YFinanceFundamentalsProvider",
    "YFinanceMarketProvider",
]
