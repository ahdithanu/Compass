"""Tests for the SP500 universe loader, provider seam, and reasoning funnel."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from multi_agent_investment_research_engine.config import (
    Config,
    DEFAULT_CONFIG,
    FunnelSettings,
    UniverseSettings,
)
from multi_agent_investment_research_engine.data.mock_data import (
    SECTOR_BIAS,
    _ticker_bias,
    ensure_mock_data,
    generate_fundamentals,
)
from multi_agent_investment_research_engine.data.sp500_seed import write_csv
from multi_agent_investment_research_engine.data.universe import (
    load_constituents,
    select_tickers,
)
from multi_agent_investment_research_engine.providers import (
    MockFundamentalsProvider,
)


@pytest.fixture(scope="module")
def universe_dir(tmp_path_factory) -> Path:
    """A scratch data dir with the SP500 CSV + mock CSVs covering ~50 tickers.

    We pick a focused subset that includes NVDA / MSFT / AAPL so tests
    can assert on hand-tuned fundamentals AND on synthesized rows in the
    same fixture.
    """
    d = tmp_path_factory.mktemp("data")
    write_csv(d / "sp500_constituents.csv")
    constituents = load_constituents(d)
    # Focused set: a few hand-tuned names plus the first 30 across the index
    # for breadth.
    explicit = ["NVDA", "MSFT", "AAPL", "AMZN", "META", "TSLA"]
    tickers = list(dict.fromkeys(
        explicit + select_tickers(constituents, limit=30)
    ))
    ensure_mock_data(d, tickers, seed=42)
    return d


# ----- universe loader -----------------------------------------------------


def test_universe_loader_returns_required_columns(universe_dir: Path):
    df = load_constituents(universe_dir)
    assert {"company_name", "sector", "sub_industry"}.issubset(df.columns)
    assert df.index.name == "ticker"
    assert len(df) > 100   # we ship close to 500 constituents


def test_universe_loader_filters(universe_dir: Path):
    df = load_constituents(universe_dir)
    # Sector filter limits the population correctly.
    energy = select_tickers(df, sectors=["Energy"])
    assert len(energy) >= 5
    assert all(df.loc[t, "sector"] == "Energy" for t in energy)
    # Limit caps the result.
    capped = select_tickers(df, limit=10)
    assert len(capped) == 10
    # Explicit ticker list intersects.
    spx_ish = select_tickers(df, tickers={"AAPL", "MSFT", "ZZZ-NOPE"})
    assert "AAPL" in spx_ish
    assert "MSFT" in spx_ish
    assert "ZZZ-NOPE" not in spx_ish


def test_universe_loader_raises_on_missing_csv(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_constituents(tmp_path)


# ----- mock-data sector bias ----------------------------------------------


def test_sector_bias_is_used_for_unknown_tickers():
    sectors = {"NEW1": "Information Technology", "NEW2": "Utilities"}
    # Ticker not in TICKER_BIAS should pick up its sector prior.
    assert _ticker_bias("NEW1", sectors) == SECTOR_BIAS["Information Technology"]
    assert _ticker_bias("NEW2", sectors) == SECTOR_BIAS["Utilities"]
    # Unknown ticker + unknown sector falls to the 0.50 neutral default.
    assert _ticker_bias("NOPE", {}) == 0.50


def test_generate_fundamentals_synthesizes_for_unknown_tickers(universe_dir: Path):
    """Tickers not in MOCK_FUNDAMENTALS get a sector-prior synthetic row."""
    # AAPL is in SP500 but not in MOCK_FUNDAMENTALS - must still come back.
    df = generate_fundamentals(["AAPL", "NVDA"], seed=42, data_dir=universe_dir)
    assert set(df["ticker"]) == {"AAPL", "NVDA"}
    aapl = df[df["ticker"] == "AAPL"].iloc[0]
    nvda = df[df["ticker"] == "NVDA"].iloc[0]
    # NVDA is in MOCK_FUNDAMENTALS - matches the curated value.
    assert nvda["revenue_growth_yoy"] == pytest.approx(0.55)
    # AAPL is synthesized within the IT prior bounds.
    assert 0.0 < aapl["revenue_growth_yoy"] < 0.50
    assert aapl["pe_ratio"] > 0


# ----- provider seam ------------------------------------------------------


def test_mock_provider_round_trips(universe_dir: Path):
    provider = MockFundamentalsProvider(
        mock_csv=universe_dir / "mock_fundamentals.csv"
    )
    snaps = provider.get_snapshots(["NVDA", "MSFT", "AAPL"])
    by_ticker = {s.ticker: s for s in snaps}
    assert by_ticker["NVDA"].source == "mock"
    # NVDA has hand-tuned fundamentals so values aren't None.
    assert by_ticker["NVDA"].operating_margin is not None
    # AAPL is synthesized in mock CSV via sector prior, so it should also be populated.
    assert by_ticker["AAPL"].operating_margin is not None


# ----- funnel logic via Config --------------------------------------------


def test_funnel_default_caps_to_top_n():
    cfg = DEFAULT_CONFIG
    assert cfg.funnel.top_n_for_reasoning == 25


def test_funnel_can_be_disabled():
    cfg = Config(funnel=FunnelSettings(top_n_for_reasoning=None))
    assert cfg.funnel.top_n_for_reasoning is None


def test_universe_settings_compose():
    """Sectors + limit compose without mutating either field."""
    cfg = Config(
        universe=UniverseSettings(
            name="energy_only",
            sectors=("Energy",),
            limit=5,
        )
    )
    assert cfg.universe.sectors == ("Energy",)
    assert cfg.universe.limit == 5
