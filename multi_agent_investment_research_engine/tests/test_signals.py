"""Unit tests for the signal-producing agents (no network access required)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from multi_agent_investment_research_engine.agents.alternative_data_agent import (
    AlternativeDataAgent,
)
from multi_agent_investment_research_engine.agents.fundamentals_agent import (
    FundamentalsAgent,
)
from multi_agent_investment_research_engine.agents.news_agent import (
    NewsAgent,
    headline_sentiment,
)
from multi_agent_investment_research_engine.data.mock_data import ensure_mock_data


@pytest.fixture(scope="module")
def mock_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("data")
    ensure_mock_data(
        d,
        ["NVDA", "MSFT", "AMZN", "META", "TSLA", "AMD", "PLTR", "CRWD", "SNOW"],
        seed=42,
    )
    return d


def test_headline_sentiment_extremes():
    pos = headline_sentiment("NVDA beats record buyback")
    neg = headline_sentiment("NVDA misses revenue, lawsuit fraud")
    neu = headline_sentiment("NVDA holds annual conference")
    assert pos > 0
    assert neg < 0
    assert neu == 0.0


def test_news_agent_outputs_in_unit_range(mock_dir: Path):
    agent = NewsAgent(csv_path=mock_dir / "mock_news_events.csv", verbose=False)
    out = agent.run(["NVDA", "MSFT", "TSLA"], as_of=pd.Timestamp("2025-01-15"))
    feats = out["features"]
    assert set(feats.index) == {"NVDA", "MSFT", "TSLA"}
    assert feats["news_score"].between(0, 1).all()


def test_alt_agent_outputs_in_unit_range(mock_dir: Path):
    agent = AlternativeDataAgent(
        csv_path=mock_dir / "mock_alternative_data.csv", verbose=False
    )
    out = agent.run(["NVDA", "MSFT"], as_of=pd.Timestamp("2025-01-15"))
    feats = out["features"]
    assert feats["alt_score"].between(0, 1).all()


def test_fundamentals_agent_falls_back_to_mock(mock_dir: Path):
    """`prefer_live=False` forces the mock path; offline tests stay deterministic."""
    agent = FundamentalsAgent(
        mock_csv=mock_dir / "mock_fundamentals.csv",
        verbose=False,
        prefer_live=False,
    )
    out = agent.run(["NVDA", "MSFT", "TSLA"])
    feats = out["features"]
    assert feats["fundamental_score"].between(0, 1).all()
    # NVDA's fundamentals (high growth + margins) should beat TSLA's blended score.
    assert feats.loc["NVDA", "fundamental_score"] > feats.loc["TSLA", "fundamental_score"]


def test_unknown_ticker_returns_neutral_news_score(mock_dir: Path):
    agent = NewsAgent(csv_path=mock_dir / "mock_news_events.csv", verbose=False)
    out = agent.run(["NOPE"], as_of=pd.Timestamp("2025-01-15"))
    assert out["features"].loc["NOPE", "news_score"] == 0.5
    assert out["features"].loc["NOPE", "n_events"] == 0
