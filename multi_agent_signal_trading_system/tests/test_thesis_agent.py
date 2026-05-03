"""ThesisAgent should produce bull / bear / risks per ticker."""

from __future__ import annotations

import pandas as pd

from multi_agent_signal_trading_system.agents.thesis_agent import ThesisAgent


def _row(**kwargs) -> dict:
    base = {
        "signal_score": 80.0,
        "momentum": 0.10, "volatility": 0.30, "rel_strength": 0.05,
        "drawdown": -0.02, "avg_sentiment": 0.30, "avg_impact": 0.40,
        "n_events": 5, "n_signals": 3, "alt_score": 0.70,
        "revenue_growth_yoy": 0.30, "operating_margin": 0.25,
        "pe_ratio": 25.0,
    }
    base.update(kwargs)
    return base


def test_high_conviction_for_strong_inputs():
    feat = pd.DataFrame([_row()], index=["AAA"])
    out = ThesisAgent(verbose=False).run(["AAA"], feat, {"AAA": []})
    assert "AAA" in out
    t = out["AAA"]
    assert t.conviction == "high"
    assert "bull" in t.bull_case.lower()
    assert "bear" in t.bear_case.lower()


def test_low_conviction_when_high_volatility_flag():
    feat = pd.DataFrame([_row(volatility=0.60, signal_score=72.0)], index=["AAA"])
    out = ThesisAgent(verbose=False).run(
        ["AAA"], feat, {"AAA": ["high_volatility"]}
    )
    t = out["AAA"]
    assert t.conviction in {"medium", "low"}
    # Risks should mention volatility somewhere.
    assert any("volatility" in r.lower() for r in t.key_risks)


def test_negative_inputs_produce_bear_phrases():
    feat = pd.DataFrame(
        [_row(momentum=-0.10, rel_strength=-0.05, avg_sentiment=-0.40,
              revenue_growth_yoy=0.02, operating_margin=-0.05,
              pe_ratio=120.0, alt_score=0.20, n_signals=1, signal_score=35.0)],
        index=["BBB"],
    )
    out = ThesisAgent(verbose=False).run(["BBB"], feat, {"BBB": []})
    t = out["BBB"]
    assert t.conviction == "low"
    bear_text = t.bear_case.lower()
    # Multiple bear phrases should land.
    assert any(k in bear_text for k in ["negative", "negative", "rich", "lagging", "slowing"])
