"""MarketAgent: turns OHLCV history into a 0-1 market score per ticker.

The market score blends four sub-features:
* Trend         - short MA vs long MA gap
* Momentum      - rolling N-day return
* Drawdown      - 1 - (current drawdown / window max drawdown)
* Relative Str. - cumulative return vs benchmark (SPY) over the window

Each sub-feature is min-max scaled cross-sectionally across the universe
when possible (so we are comparing companies to their peers, not absolute
levels in a vacuum). The final score is in [0, 1].

If yfinance is unreachable (offline sandbox, CI without egress), the agent
falls back to a deterministic synthetic price panel so the pipeline still
runs end-to-end. Synthetic mode is logged loudly so consumers know the
output is not market-truth.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

try:
    import yfinance as yf
    _HAS_YFINANCE = True
except Exception:    # pragma: no cover - import-time only
    _HAS_YFINANCE = False

from .base_agent import BaseAgent
from ..config import MarketSettings


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
        "Fetches price history and computes momentum, volatility, drawdown, "
        "and relative strength versus a benchmark for each ticker."
    )

    def __init__(
        self,
        settings: MarketSettings,
        benchmark: str = "SPY",
        verbose: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.settings = settings
        self.benchmark = benchmark.upper()

    def _download(self, tickers: list[str]) -> tuple[pd.DataFrame, bool]:
        """Return (raw_yf_frame, synthetic_flag)."""
        if _HAS_YFINANCE:
            self.log(
                f"Fetching {len(tickers)} tickers via yfinance "
                f"(period={self.settings.period}, interval={self.settings.interval})"
            )
            try:
                raw = yf.download(
                    tickers=tickers,
                    period=self.settings.period,
                    interval=self.settings.interval,
                    auto_adjust=True,
                    group_by="ticker",
                    progress=False,
                    threads=True,
                )
                if raw is not None and not raw.empty:
                    # Validate at least one ticker has Close prices.
                    flat = self._close_panel(raw, tickers)
                    if not flat.empty and flat.dropna(how="all").shape[0] > 0:
                        return raw, False
            except Exception as exc:    # noqa: BLE001
                self.log(f"yfinance error: {exc!s}")
        # Fallback: synthetic, deterministic price panel.
        self.logger.warn(
            "yfinance unavailable / blocked - generating synthetic price panel "
            "for offline run."
        )
        return self._synthetic_panel(tickers), True

    def _synthetic_panel(self, tickers: list[str]) -> pd.DataFrame:
        """Deterministic correlated random walks across the universe.

        Designed to look like the input shape yfinance would return when
        called with `group_by='ticker'`: a MultiIndex (ticker, OHLCV) on
        columns. We populate only Close to keep the rest of the pipeline
        simple - downstream code only reads `Close`.
        """
        idx = pd.bdate_range(
            end=pd.Timestamp.utcnow().normalize(), periods=252
        )
        days = len(idx)
        rng = np.random.default_rng(seed=42)

        # Per-ticker starting price + drift gives the panel some character.
        seeds = {
            "SPY": (510.0, 0.00040, 0.012),
            "NVDA": (480.0, 0.00170, 0.035),
            "MSFT": (415.0, 0.00065, 0.018),
            "AMZN": (175.0, 0.00060, 0.022),
            "META": (475.0, 0.00075, 0.028),
            "TSLA": (240.0, 0.00010, 0.040),
            "AMD": (160.0, 0.00080, 0.038),
            "PLTR": (24.0, 0.00150, 0.045),
            "CRWD": (310.0, 0.00100, 0.030),
            "SNOW": (180.0, 0.00040, 0.035),
        }
        # Common market factor so relative-strength is meaningful.
        market_shocks = rng.normal(0.0003, 0.010, days)
        out = {}
        for t in tickers:
            start, drift, vol = seeds.get(t, (100.0, 0.0005, 0.025))
            idio = rng.normal(0, vol, days)
            # 60% market beta + 40% idiosyncratic.
            rets = drift + 0.6 * market_shocks + 0.4 * idio
            prices = start * np.cumprod(1 + rets)
            out[t] = prices
        df = pd.DataFrame(out, index=idx)
        df.index.name = "Date"
        # Mimic yfinance's grouped-by-ticker MultiIndex shape.
        cols = pd.MultiIndex.from_product([df.columns, ["Close"]])
        wide = pd.DataFrame(index=df.index, columns=cols, dtype=float)
        for t in df.columns:
            wide[(t, "Close")] = df[t]
        return wide

    @staticmethod
    def _close_panel(raw: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
        """Extract Close prices for each ticker into a wide DataFrame."""
        if isinstance(raw.columns, pd.MultiIndex):
            closes = {}
            for t in tickers:
                if t in raw.columns.get_level_values(0):
                    closes[t] = raw[t]["Close"]
            df = pd.DataFrame(closes)
        else:
            # Single-ticker download
            df = raw[["Close"]].rename(columns={"Close": tickers[0]})
        df.index = pd.to_datetime(df.index).tz_localize(None)
        df.index.name = "date"
        return df.dropna(how="all")

    def run(self, tickers: Iterable[str]) -> dict[str, pd.DataFrame | pd.Series]:
        tickers = [t.upper() for t in tickers]
        all_tickers = sorted(set(tickers + [self.benchmark]))
        raw, synthetic = self._download(all_tickers)
        closes = self._close_panel(raw, all_tickers)
        self.synthetic = synthetic

        if self.benchmark not in closes.columns:
            raise RuntimeError(
                f"Benchmark {self.benchmark} missing from yfinance response."
            )

        s = self.settings
        per_ticker: dict[str, pd.DataFrame] = {}
        latest_features: list[dict] = []

        bench = closes[self.benchmark]
        bench_ret_window = bench.pct_change(s.rel_strength_window)

        for t in tickers:
            if t not in closes.columns:
                self.log(f"  skipping {t}: no price data returned")
                continue

            px = closes[t].dropna()
            if len(px) < max(s.long_ma, s.drawdown_window) + 5:
                self.log(f"  skipping {t}: insufficient history ({len(px)} rows)")
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
            df["drawdown"] = df["close"] / roll_max - 1.0   # <= 0
            ret_window = df["close"].pct_change(s.rel_strength_window)
            df["rel_strength"] = ret_window - bench_ret_window.reindex(df.index)
            df["ticker"] = t
            per_ticker[t] = df

            last = df.iloc[-1]
            latest_features.append(
                {
                    "ticker": t,
                    "ma_gap": float(last["ma_gap"]) if pd.notna(last["ma_gap"]) else 0.0,
                    "momentum": float(last["momentum"]) if pd.notna(last["momentum"]) else 0.0,
                    "drawdown": float(last["drawdown"]) if pd.notna(last["drawdown"]) else 0.0,
                    "rel_strength": float(last["rel_strength"]) if pd.notna(last["rel_strength"]) else 0.0,
                    "volatility": float(last["volatility"]) if pd.notna(last["volatility"]) else 0.0,
                    "close": float(last["close"]),
                }
            )

        feat = pd.DataFrame(latest_features).set_index("ticker")

        # Cross-sectional min-max so we are scoring companies vs. peers.
        # Drawdown: less negative (closer to 0) is better, so feed it raw.
        comp_trend = _min_max(feat["ma_gap"])
        comp_mom = _min_max(feat["momentum"])
        comp_dd = _min_max(feat["drawdown"])  # already-non-positive
        comp_rs = _min_max(feat["rel_strength"])

        feat["market_score"] = (
            0.30 * comp_trend
            + 0.30 * comp_mom
            + 0.20 * comp_dd
            + 0.20 * comp_rs
        ).clip(0.0, 1.0)

        self.log(
            "Market scores: "
            + ", ".join(f"{t}={v:.2f}" for t, v in feat["market_score"].items())
        )

        return {
            "panel": closes,            # wide close-price panel (incl. benchmark)
            "per_ticker": per_ticker,   # dict[ticker -> per-day feature df]
            "features": feat,           # latest cross-section, indexed by ticker
        }
