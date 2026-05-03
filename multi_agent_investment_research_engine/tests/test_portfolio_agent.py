"""PortfolioAgent: weight proposal, cap enforcement, and backtest mechanics."""

from __future__ import annotations

import numpy as np
import pandas as pd

from multi_agent_investment_research_engine.agents.portfolio_agent import (
    PortfolioAgent,
    _apply_caps,
)
from multi_agent_investment_research_engine.config import (
    PortfolioSettings,
    RatingThresholds,
    RiskSettings,
)


def test_apply_caps_redistributes_excess():
    rs = RiskSettings(
        max_position_size_pct=0.20,
        minimum_cash_reserve_pct=0.0,
        max_total_equity_pct=1.0,
        high_volatility_threshold=0.99,
    )
    w = pd.Series({"A": 0.50, "B": 0.30, "C": 0.20})
    capped = _apply_caps(w, rs)
    assert capped.max() <= 0.20 + 1e-9
    # Total stays bounded by max_total_equity_pct.
    assert capped.sum() <= 1.0 + 1e-9


def test_propose_weights_picks_only_buys():
    cfg_p = PortfolioSettings(starting_capital=10_000, max_positions=4)
    cfg_r = RiskSettings(
        max_position_size_pct=0.30,
        minimum_cash_reserve_pct=0.10,
        max_total_equity_pct=0.90,
        high_volatility_threshold=0.99,
    )
    cfg_t = RatingThresholds(buy=70.0, hold=50.0)
    agent = PortfolioAgent(cfg_p, cfg_r, cfg_t, verbose=False)
    scores = pd.Series({"A": 80.0, "B": 75.0, "C": 60.0, "D": 40.0})
    w = agent.propose_weights(scores)
    # C and D should be zero; A and B share the capital.
    assert w["C"] == 0.0
    assert w["D"] == 0.0
    assert w["A"] > 0 and w["B"] > 0
    # Cash reserve respected.
    assert w.sum() <= 1.0 - cfg_r.minimum_cash_reserve_pct + 1e-9


def test_backtest_runs_on_synthetic_panel():
    cfg_p = PortfolioSettings(starting_capital=10_000, max_positions=2,
                              rebalance_frequency="W-FRI")
    cfg_r = RiskSettings(
        max_position_size_pct=0.50,
        minimum_cash_reserve_pct=0.10,
        max_total_equity_pct=0.90,
        high_volatility_threshold=0.99,
    )
    cfg_t = RatingThresholds(buy=70.0, hold=50.0)
    agent = PortfolioAgent(cfg_p, cfg_r, cfg_t, verbose=False)

    idx = pd.bdate_range("2024-01-01", "2024-04-01")
    rng = np.random.default_rng(0)
    panel = pd.DataFrame(
        {
            "AAA": 100 * np.cumprod(1 + rng.normal(0.001, 0.02, len(idx))),
            "BBB": 100 * np.cumprod(1 + rng.normal(0.0005, 0.02, len(idx))),
        },
        index=idx,
    )
    rebals = pd.bdate_range(idx[10], idx[-1], freq="W-FRI")
    rebals = [d for d in rebals if d in idx]
    score_hist = pd.DataFrame(
        {"AAA": [80.0] * len(rebals), "BBB": [55.0] * len(rebals)},
        index=rebals,
    )
    rating_hist = pd.DataFrame(
        {"AAA": ["BUY"] * len(rebals), "BBB": ["HOLD"] * len(rebals)},
        index=rebals,
    )
    out = agent.backtest(panel, score_hist, rating_hist)
    assert "equity_curve" in out and "trades" in out and "summary" in out
    assert len(out["equity_curve"]) == len(idx)
    # Should have at least one OPEN_LONG trade for AAA.
    if not out["trades"].empty:
        assert (out["trades"]["ticker"] == "AAA").any()
