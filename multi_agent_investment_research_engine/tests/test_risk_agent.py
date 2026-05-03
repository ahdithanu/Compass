"""RiskAgent enforces caps, volatility trims, and emits flags."""

from __future__ import annotations

from datetime import date

import pandas as pd

from multi_agent_investment_research_engine.agents.risk_agent import RiskAgent
from multi_agent_investment_research_engine.config import RiskSettings


def _features(vol_a: float, vol_b: float, dd_a: float = 0.0, dd_b: float = 0.0) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "volatility": [vol_a, vol_b],
            "drawdown": [dd_a, dd_b],
        },
        index=["AAA", "BBB"],
    )


def test_position_cap_is_applied():
    rs = RiskSettings(
        max_position_size_pct=0.10,
        minimum_cash_reserve_pct=0.0,
        max_total_equity_pct=1.0,
        high_volatility_threshold=0.99,
    )
    agent = RiskAgent(rs, verbose=False)
    proposed = pd.Series({"AAA": 0.40, "BBB": 0.05})
    rep = agent.run(
        proposed_weights=proposed,
        market_features=_features(0.20, 0.20),
        as_of=date(2024, 1, 1),
    )
    by_t = {r.ticker: r for r in rep.per_ticker}
    assert by_t["AAA"].suggested_weight_pct <= rs.max_position_size_pct + 1e-9
    assert "position_cap" in by_t["AAA"].flags


def test_volatility_trim():
    rs = RiskSettings(
        max_position_size_pct=0.50,
        minimum_cash_reserve_pct=0.0,
        max_total_equity_pct=1.0,
        high_volatility_threshold=0.30,
    )
    agent = RiskAgent(rs, verbose=False)
    rep = agent.run(
        proposed_weights=pd.Series({"AAA": 0.40, "BBB": 0.40}),
        market_features=_features(0.50, 0.10),
        as_of=date(2024, 1, 1),
    )
    by_t = {r.ticker: r for r in rep.per_ticker}
    # AAA is high-vol => trimmed; BBB stays put.
    assert by_t["AAA"].suggested_weight_pct < 0.40
    assert "high_volatility" in by_t["AAA"].flags
    assert by_t["BBB"].suggested_weight_pct == 0.40


def test_cash_reserve_enforced():
    rs = RiskSettings(
        max_position_size_pct=0.60,
        minimum_cash_reserve_pct=0.20,
        max_total_equity_pct=1.0,
        high_volatility_threshold=0.99,
    )
    agent = RiskAgent(rs, verbose=False)
    rep = agent.run(
        proposed_weights=pd.Series({"AAA": 0.50, "BBB": 0.50}),
        market_features=_features(0.20, 0.20),
        as_of=date(2024, 1, 1),
    )
    total = sum(r.suggested_weight_pct for r in rep.per_ticker)
    # Cash reserve must be honored => total equity <= 0.80
    assert total <= 0.80 + 1e-9
    assert rep.cash_pct >= 0.20 - 1e-9


def test_drawdown_warning_flag():
    rs = RiskSettings(
        max_drawdown_warning_pct=0.10,
        max_position_size_pct=0.50,
        high_volatility_threshold=0.99,
    )
    agent = RiskAgent(rs, verbose=False)
    rep = agent.run(
        proposed_weights=pd.Series({"AAA": 0.20, "BBB": 0.20}),
        market_features=_features(0.20, 0.20, dd_a=-0.30, dd_b=-0.05),
        as_of=date(2024, 1, 1),
    )
    by_t = {r.ticker: r for r in rep.per_ticker}
    assert "deep_drawdown" in by_t["AAA"].flags
    assert "deep_drawdown" not in by_t["BBB"].flags
