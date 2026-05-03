"""RiskAgent: portfolio-level risk review.

Inputs:
* `signal_scores`     - per-ticker composite scores (output of scoring step)
* `market_features`   - latest cross-sectional market features (volatility,
                        drawdown) used to flag risky names
* `proposed_weights`  - draft target weights produced before risk review

Outputs:
* per-ticker `RiskReview` (approved + suggested_weight + flags + notes)
* a portfolio-level `PortfolioRiskReport`

The agent does NOT pick winners. It only enforces caps:
1. Single-name cap (`max_position_size_pct`)
2. Cash reserve (`minimum_cash_reserve_pct`)
3. Total equity exposure (`max_total_equity_pct`)
4. Volatility trim - high-vol names get scaled down 25%
5. Concentration warning - any name above warning threshold is flagged
"""

from __future__ import annotations

from datetime import date as _date

import pandas as pd

from .base_agent import BaseAgent
from .models import PortfolioRiskReport, RiskReview
from ..config import RiskSettings


class RiskAgent(BaseAgent):
    name = "RiskAgent"
    description = (
        "Stress-tests proposed allocations: caps single-name size, enforces "
        "cash reserve, trims high-volatility names, and flags concentration."
    )

    def __init__(self, settings: RiskSettings, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.settings = settings

    def run(
        self,
        proposed_weights: pd.Series,
        market_features: pd.DataFrame,
        as_of: _date,
    ) -> PortfolioRiskReport:
        s = self.settings
        proposed = proposed_weights.copy().astype(float)

        per_ticker: list[RiskReview] = []
        adjusted = proposed.copy()

        for ticker, w in proposed.items():
            flags: list[str] = []
            notes: list[str] = []
            new_w = float(w)

            if new_w > s.max_position_size_pct:
                flags.append("position_cap")
                notes.append(
                    f"Trimmed from {new_w:.1%} to single-name cap "
                    f"{s.max_position_size_pct:.0%}"
                )
                new_w = s.max_position_size_pct

            vol = float(market_features.loc[ticker, "volatility"]) \
                if ticker in market_features.index else 0.0
            if vol > s.high_volatility_threshold:
                flags.append("high_volatility")
                trim = new_w * 0.25
                notes.append(
                    f"Vol {vol:.0%} > {s.high_volatility_threshold:.0%}; "
                    f"trimmed by {trim:.1%}"
                )
                new_w = max(0.0, new_w - trim)

            dd = float(market_features.loc[ticker, "drawdown"]) \
                if ticker in market_features.index else 0.0
            if dd <= -s.max_drawdown_warning_pct:
                flags.append("deep_drawdown")
                notes.append(
                    f"Recent drawdown {dd:.0%} exceeds warning "
                    f"({s.max_drawdown_warning_pct:.0%}); proceed with caution"
                )

            adjusted[ticker] = new_w
            approved = new_w > 0.0 and "rejected" not in flags
            per_ticker.append(
                RiskReview(
                    ticker=ticker,
                    approved=approved,
                    suggested_weight_pct=new_w,
                    flags=flags,
                    notes=notes,
                )
            )

        # Enforce total equity cap and minimum cash reserve as a final pass.
        total_equity_target = min(s.max_total_equity_pct, 1.0 - s.minimum_cash_reserve_pct)
        gross = float(adjusted.sum())
        if gross > total_equity_target and gross > 0:
            scale = total_equity_target / gross
            adjusted = adjusted * scale
            for r in per_ticker:
                if r.suggested_weight_pct > 0:
                    r.suggested_weight_pct = float(adjusted.loc[r.ticker])
                    r.notes.append(
                        f"Universe scaled to {total_equity_target:.0%} equity cap"
                    )
                    r.flags.append("equity_cap_scale")

        cash_pct = float(max(0.0, 1.0 - adjusted.sum()))

        port_flags: list[str] = []
        top = float(adjusted.max()) if not adjusted.empty else 0.0
        if top > s.concentration_warning_pct:
            port_flags.append("concentration")

        # Portfolio vol = weighted average of name vols (cheap proxy).
        if not adjusted.empty and "volatility" in market_features.columns:
            port_vol = float(
                (adjusted * market_features["volatility"].reindex(adjusted.index).fillna(0.0)).sum()
            )
        else:
            port_vol = 0.0

        if "drawdown" in market_features.columns and not adjusted.empty:
            port_dd = float(
                (adjusted * market_features["drawdown"].reindex(adjusted.index).fillna(0.0)).sum()
            )
        else:
            port_dd = 0.0

        report = PortfolioRiskReport(
            as_of=as_of,
            concentration_pct_top=top,
            portfolio_volatility=port_vol,
            portfolio_drawdown=port_dd,
            cash_pct=cash_pct,
            flags=port_flags,
            per_ticker=per_ticker,
        )

        self.log(
            f"Risk review: top={top:.1%} cash={cash_pct:.1%} "
            f"port_vol={port_vol:.0%} flags={port_flags or 'none'}"
        )
        return report
