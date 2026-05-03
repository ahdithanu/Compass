"""yfinance-backed providers with offline-deterministic fallback.

Both the market-data and fundamentals providers prefer live yfinance and
fall back to synthetic / mock data when the network is unavailable - so
the engine still produces all artifacts in CI and on hosted sandboxes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .base import (
    FundamentalsProvider,
    FundamentalsSnapshot,
    MarketDataProvider,
    PricePanel,
)


try:
    import yfinance as yf
    _HAS_YF = True
except Exception:    # pragma: no cover
    _HAS_YF = False


# Per-ticker starting price + drift + idio-vol that gives the synthetic
# panel some character. Tickers not in this map use a generic profile.
_SYNTH_SEEDS: dict[str, tuple[float, float, float]] = {
    "SPY":  (510.0, 0.00040, 0.012),
    "NVDA": (480.0, 0.00170, 0.035),
    "MSFT": (415.0, 0.00065, 0.018),
    "AMZN": (175.0, 0.00060, 0.022),
    "META": (475.0, 0.00075, 0.028),
    "TSLA": (240.0, 0.00010, 0.040),
    "AMD":  (160.0, 0.00080, 0.038),
    "PLTR": (24.0,  0.00150, 0.045),
    "CRWD": (310.0, 0.00100, 0.030),
    "SNOW": (180.0, 0.00040, 0.035),
}


def _synth_close_panel(
    tickers: list[str], days: int = 252, seed: int = 42
) -> pd.DataFrame:
    """Deterministic correlated random walks across the tickers + benchmark.

    60% market-factor + 40% idiosyncratic. Per-ticker drift and vol are
    seeded by the ticker symbol so the same ticker gets the same shape
    across runs.
    """
    idx = pd.bdate_range(end=pd.Timestamp.utcnow().normalize(), periods=days)
    days = len(idx)
    rng = np.random.default_rng(seed)
    market_shocks = rng.normal(0.0003, 0.010, days)

    out = {}
    for t in tickers:
        if t in _SYNTH_SEEDS:
            start, drift, vol = _SYNTH_SEEDS[t]
        else:
            # Hash the ticker into stable per-symbol parameters.
            h = abs(hash(t))
            start = 50.0 + (h % 600)               # $50-$650
            drift = 0.0002 + ((h // 600) % 100) / 1e5    # ~0-0.0012
            vol = 0.018 + ((h // 60000) % 60) / 1500     # ~0.018-0.058
        local_rng = np.random.default_rng(seed + (abs(hash(t)) % 10_000))
        idio = local_rng.normal(0, vol, days)
        rets = drift + 0.6 * market_shocks + 0.4 * idio
        out[t] = float(start) * np.cumprod(1 + rets)

    df = pd.DataFrame(out, index=idx)
    df.index.name = "date"
    return df


class YFinanceMarketProvider(MarketDataProvider):
    """Live yfinance pulls with synthetic fallback."""

    name = "yfinance"

    def __init__(self, batch_size: int = 50, verbose: bool = True) -> None:
        self.batch_size = batch_size
        self.verbose = verbose

    def get_prices(
        self,
        tickers: Iterable[str],
        period: str,
        interval: str,
    ) -> PricePanel:
        ticker_list = sorted({t.upper() for t in tickers})
        if _HAS_YF:
            try:
                closes = self._fetch_yf(ticker_list, period, interval)
                if closes is not None and not closes.empty:
                    return PricePanel(
                        closes=closes, is_synthetic=False, source="yfinance"
                    )
            except Exception as exc:    # noqa: BLE001
                if self.verbose:
                    print(f"[YFinanceMarketProvider] live fetch failed: {exc!s}")
        # Fallback.
        if self.verbose:
            print(
                "[YFinanceMarketProvider] using synthetic price panel "
                f"({len(ticker_list)} tickers)"
            )
        return PricePanel(
            closes=_synth_close_panel(ticker_list),
            is_synthetic=True,
            source="synthetic",
        )

    def _fetch_yf(
        self, tickers: list[str], period: str, interval: str
    ) -> Optional[pd.DataFrame]:
        """Batch fetch in chunks of `self.batch_size` to avoid yfinance's
        per-request URL-length limit at SP500 scale."""
        frames: list[pd.DataFrame] = []
        for i in range(0, len(tickers), self.batch_size):
            chunk = tickers[i : i + self.batch_size]
            raw = yf.download(
                tickers=chunk,
                period=period,
                interval=interval,
                auto_adjust=True,
                group_by="ticker",
                progress=False,
                threads=True,
            )
            if raw is None or raw.empty:
                continue
            frames.append(_extract_closes(raw, chunk))
        if not frames:
            return None
        return pd.concat(frames, axis=1).dropna(how="all")


def _extract_closes(raw: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    """Pull the Close column for each ticker from a yfinance batch result."""
    out = {}
    if isinstance(raw.columns, pd.MultiIndex):
        for t in tickers:
            if t in raw.columns.get_level_values(0):
                out[t] = raw[t]["Close"]
    else:
        # Single-ticker batches return a flat frame.
        out[tickers[0]] = raw["Close"]
    df = pd.DataFrame(out)
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.index.name = "date"
    return df


class YFinanceFundamentalsProvider(FundamentalsProvider):
    """Live yfinance `Ticker.info` per name, with mock-CSV fallback."""

    name = "yfinance+mock"

    def __init__(
        self,
        mock_csv: Path,
        prefer_live: bool = True,
        verbose: bool = True,
    ) -> None:
        self.mock_csv = Path(mock_csv)
        self.prefer_live = prefer_live
        self.verbose = verbose
        self._mock_cache: Optional[pd.DataFrame] = None

    def _mock(self) -> pd.DataFrame:
        if self._mock_cache is None:
            self._mock_cache = pd.read_csv(self.mock_csv).set_index("ticker")
        return self._mock_cache

    def get_snapshots(self, tickers: Iterable[str]) -> list[FundamentalsSnapshot]:
        out: list[FundamentalsSnapshot] = []
        for t in tickers:
            t = t.upper()
            snap = self._live_one(t) if self.prefer_live and _HAS_YF else None
            if snap is None:
                snap = self._mock_one(t)
            out.append(snap)
        return out

    def _live_one(self, ticker: str) -> Optional[FundamentalsSnapshot]:
        try:
            info = yf.Ticker(ticker).info or {}
        except Exception:
            return None
        snap = FundamentalsSnapshot(
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
        non_null = sum(
            1
            for v in (
                snap.revenue_growth_yoy, snap.gross_margin, snap.operating_margin,
                snap.net_margin, snap.pe_ratio, snap.ps_ratio, snap.return_on_equity,
            )
            if v is not None
        )
        if non_null < 3:
            return None
        return snap

    def _mock_one(self, ticker: str) -> FundamentalsSnapshot:
        df = self._mock()
        if ticker not in df.index:
            return FundamentalsSnapshot(ticker=ticker, source="default")
        row = df.loc[ticker]
        return FundamentalsSnapshot(
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
