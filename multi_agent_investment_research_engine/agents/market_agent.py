"""MarketAgent: turns OHLCV history into a 0-1 market score per ticker.

The market score blends four sub-features:
* Trend         - short MA vs long MA gap
* Momentum      - rolling N-day return
* Drawdown      - 1 - (current drawdown / window max drawdown)
* Relative Str. - cumulative return vs benchmark (SPY) over the window

Each sub-feature is min-max scaled cross-sectionally across the universe
so we are comparing companies to their peers, not absolute levels.

The agent does not fetch data itself - it consumes a `MarketDataProvider`
(default: yfinance with synthetic fallback). Swap in a Polygon or Alpaca
provider without touching this code.
"""

from __future__ import annotations

from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .base_agent import BaseAgent
from ..config import MarketSettings
from ..providers import MarketDataProvider, YFinanceMarketProvider


def _min_max(s: pd.Series) -> pd.Series:
    """Min-max into [0, 1]. Constant series -> 0.5 (neutral)."""
    s = s.astype(float)
    lo, hi = s.min(skipna=True), s.max(skipna=True)
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        return pd.Series(0.5, index=s.index)
    return (s - lo) / (hi - lo)


class MarketAgent(BaseAgent):
    name = "MarketAgent"
    description = (
        "Reads close-price history from a MarketDataProvider and computes "
        "momentum, volatility, drawdown, and relative strength vs. a "
        "benchmark for each ticker."
    )

    def __init__(
        self,
        settings: MarketSettings,
        benchmark: str = "SPY",
        provider: Optional[MarketDataProvider] = None,
        verbose: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.settings = settings
        self.benchmark = benchmark.upper()
        self.provider = provider or YFinanceMarketProvider(verbose=verbose)
        self.synthetic = False

    def run(self, tickers: Iterable[str]) -> dict[str, pd.DataFrame | pd.Series]:
        tickers = [t.upper() for t in tickers]
        all_tickers = sorted(set(tickers + [self.benchmark]))
        self.log(
            f"Fetching {len(all_tickers)} tickers via "
            f"{self.provider.name} (period={self.settings.period}, "
            f"interval={self.settings.interval})"
        )
        panel = self.provider.get_prices(
            tickers=all_tickers,
            period=self.settings.period,
            interval=self.settings.interval,
        )
        self.synthetic = panel.is_synthetic
        if panel.is_synthetic:
            self.logger.warn(
                f"MarketDataProvider {self.provider.name} returned a synthetic "
                "panel - downstream features are not market-truth."
            )

        closes = panel.closes.copy()
        if closes.empty:
            raise RuntimeError("MarketDataProvider returned an empty panel.")

        if self.benchmark not in closes.columns:
            raise RuntimeError(
                f"Benchmark {self.benchmark} missing from price panel."
            )

        s = self.settings
        per_ticker: dict[str, pd.DataFrame] = {}
        latest_features: list[dict] = []

        bench = closes[self.benchmark]
        bench_ret_window = bench.pct_change(s.rel_strength_window)

        skipped = 0
        for t in tickers:
            if t not in closes.columns:
                skipped += 1
                continue

            px = closes[t].dropna()
            if len(px) < max(s.long_ma, s.drawdown_window) + 5:
                skipped += 1
                continue

            df = pd.DataFrame({"close": px})
            df["return_1d"] = df["close"].pct_change()
            df["short_ma"] = df["close"].rolling(s.short_ma).mean()
            df["long_ma"] = df["close"].rolling(s.long_ma).mean()
            df["ma_gap"] = (df["short_ma"] - df["long_ma"]) / df["long_ma"]
            df["momentum"] = df["close"].pct_change(s.momentum_window)
            df["volatility"] = (
                df["return_1d"].rolling(s.volatility_window).std()
                * np.sqrt(252)
            )
            roll_max = df["close"].rolling(s.drawdown_window).max()
            df["drawdown"] = df["close"] / roll_max - 1.0
            ret_window = df["close"].pct_change(s.rel_strength_window)
            df["rel_strength"] = ret_window - bench_ret_window.reindex(df.index)
            df["ticker"] = t
            per_ticker[t] = df

            last = df.iloc[-1]
            latest_features.append(
                {
                    "ticker": t,
                    "ma_gap": _f(last["ma_gap"]),
                    "momentum": _f(last["momentum"]),
                    "drawdown": _f(last["drawdown"]),
                    "rel_strength": _f(last["rel_strength"]),
                    "volatility": _f(last["volatility"]),
                    "close": float(last["close"]),
                }
            )

        if skipped:
            self.log(
                f"  skipped {skipped} ticker(s) for missing data / insufficient history"
            )

        feat = pd.DataFrame(latest_features).set_index("ticker")
        if feat.empty:
            raise RuntimeError(
                "MarketAgent produced no features - panel was empty for every ticker."
            )

        # Cross-sectional rank into [0, 1]. Drawdown: less negative is better,
        # which is what the raw value already captures (closer to 0).
        feat["market_score"] = (
            0.30 * _min_max(feat["ma_gap"])
            + 0.30 * _min_max(feat["momentum"])
            + 0.20 * _min_max(feat["drawdown"])
            + 0.20 * _min_max(feat["rel_strength"])
        ).clip(0.0, 1.0)

        if len(feat) <= 12:
            self.log(
                "Market scores: "
                + ", ".join(f"{t}={v:.2f}" for t, v in feat["market_score"].items())
            )
        else:
            top = feat["market_score"].sort_values(ascending=False).head(5)
            bot = feat["market_score"].sort_values(ascending=True).head(3)
            self.log(
                "Market scores (top 5 / bottom 3 of "
                f"{len(feat)}): "
                + ", ".join(f"{t}={v:.2f}" for t, v in top.items())
                + " | "
                + ", ".join(f"{t}={v:.2f}" for t, v in bot.items())
            )

        return {
            "panel": closes,
            "per_ticker": per_ticker,
            "features": feat,
            "is_synthetic": panel.is_synthetic,
        }


def _f(v) -> float:
    return float(v) if pd.notna(v) else 0.0
