"""Universe loader.

Provides the engine with a list of tickers (plus company name + sector
metadata) without hard-coding the universe in `config.py`. Defaults to
the S&P 500 snapshot bundled in `data/sp500_constituents.csv`.

A real deployment can swap `_LIVE_FETCHER` (or call `load_constituents`
with `source="ishares"` / `"wikipedia"`) without touching downstream
code - the loader's contract is "give me a DataFrame with ticker,
company_name, sector, sub_industry" no matter where the rows came from.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable, Optional

import pandas as pd


REQUIRED_COLUMNS = ("ticker", "company_name", "sector", "sub_industry")


# Hook for swapping in a live fetch. Receives the data_dir; should return a
# DataFrame with the four required columns or None to fall back to local CSV.
_LIVE_FETCHER = None    # type: ignore[var-annotated]


def load_constituents(
    data_dir: Path,
    source: str = "local",
    universe_csv: str = "sp500_constituents.csv",
) -> pd.DataFrame:
    """Load the universe as a DataFrame indexed by ticker.

    Args:
        data_dir: project data directory (where `sp500_constituents.csv` lives).
        source: "local" reads the cached CSV; "live" calls `_LIVE_FETCHER`
            and falls back to local on failure.
        universe_csv: filename within `data_dir` for the local cache.
    """
    data_dir = Path(data_dir)
    csv_path = data_dir / universe_csv

    if source == "live" and _LIVE_FETCHER is not None:
        try:
            df = _LIVE_FETCHER(data_dir)
            if df is not None and not df.empty:
                return _validate(df).set_index("ticker")
        except Exception:    # pragma: no cover
            pass    # fall through to local

    if not csv_path.exists():
        raise FileNotFoundError(
            f"Universe CSV not found at {csv_path}. Run "
            "`python -m multi_agent_investment_research_engine.data.sp500_seed` "
            "to generate it."
        )
    df = pd.read_csv(csv_path)
    return _validate(df).set_index("ticker")


def _validate(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"Universe CSV missing required columns: {missing}. "
            f"Required: {list(REQUIRED_COLUMNS)}"
        )
    df = df.copy()
    df["ticker"] = df["ticker"].astype(str).str.upper()
    return df.drop_duplicates(subset=["ticker"], keep="first")


def select_tickers(
    constituents: pd.DataFrame,
    tickers: Optional[Iterable[str]] = None,
    sectors: Optional[Iterable[str]] = None,
    limit: Optional[int] = None,
) -> list[str]:
    """Pick a subset of constituents.

    Useful for tests / partial runs where the full S&P 500 is too big.
    Filters compose: `tickers` ∩ `sectors` ∩ first-`limit`.
    """
    df = constituents
    if tickers:
        wanted = {t.upper() for t in tickers}
        df = df[df.index.isin(wanted)]
    if sectors:
        sset = set(sectors)
        df = df[df["sector"].isin(sset)]
    out = df.index.tolist()
    if limit is not None:
        out = out[:limit]
    return out
