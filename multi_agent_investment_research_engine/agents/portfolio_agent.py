"""PortfolioAgent: position sizing + paper-trading backtest.

The agent has two responsibilities, used at different stages of the pipeline:

1. `propose_weights(scores, ratings)` - draft target weights from composite
   scores, before RiskAgent reviews them. BUY-rated names share the equity
   budget proportionally to their score.

2. `backtest(price_panel, score_history, ...)` - run a weekly rebalance
   simulation across the full price history. At each rebalance date the
   agent picks the top-N BUY-rated names, allocates by score weight, and
   applies the same risk caps as the live recommendation. Cash earns 0%.

The backtest output is a DataFrame with cash + equity + portfolio value,
trades, and per-ticker holdings over time.
"""

from __future__ import annotations

from datetime import date as _date
from typing import Iterable

import numpy as np
import pandas as pd

from .base_agent import BaseAgent
from .models import FinalAction, TradeRecord
from ..config import PortfolioSettings, RatingThresholds, RiskSettings


def _apply_caps(
    weights: pd.Series,
    risk: RiskSettings,
) -> pd.Series:
    """Apply single-name cap, equity cap, and minimum cash reserve."""
    w = weights.clip(lower=0).copy()
    if w.sum() <= 0:
        return w * 0.0
    # Single-name cap (iterative redistribution).
    for _ in range(8):
        excess = (w - risk.max_position_size_pct).clip(lower=0)
        if excess.sum() == 0:
            break
        w = w - excess
        # Redistribute excess to under-cap names proportionally.
        room = (risk.max_position_size_pct - w).clip(lower=0)
        if room.sum() == 0:
            break
        w = w + excess.sum() * room / room.sum()
    # Total equity cap and cash reserve.
    cap = min(risk.max_total_equity_pct, 1.0 - risk.minimum_cash_reserve_pct)
    if w.sum() > cap:
        w = w * (cap / w.sum())
    return w


class PortfolioAgent(BaseAgent):
    name = "PortfolioAgent"
    description = (
        "Proposes target weights from signal scores, runs a weekly "
        "rebalance paper-trading simulation, and reports trades + equity."
    )

    def __init__(
        self,
        settings: PortfolioSettings,
        risk: RiskSettings,
        ratings: RatingThresholds,
        verbose: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.settings = settings
        self.risk = risk
        self.ratings = ratings

    # --- BaseAgent contract ----------------------------------------------
    def run(self, mode: str = "propose", **kwargs):
        """Dispatch to the appropriate sub-method.

        `mode="propose"` calls `propose_weights(scores=...)`.
        `mode="backtest"` calls `backtest(...)` and forwards kwargs.
        """
        if mode == "propose":
            return self.propose_weights(kwargs["scores"])
        if mode == "backtest":
            return self.backtest(**kwargs)
        raise ValueError(f"Unknown PortfolioAgent.run mode: {mode!r}")

    # --- live recommendation path -----------------------------------------
    def propose_weights(self, scores: pd.Series) -> pd.Series:
        """Distribute capital across BUY-rated names proportional to score.

        `scores` is in [0, 100]. Names below `ratings.buy` get 0 weight.
        """
        s = scores.copy()
        eligible = s[s >= self.ratings.buy].sort_values(ascending=False)
        if eligible.empty:
            self.log("No BUY-rated names; portfolio will be 100% cash.")
            return pd.Series(0.0, index=s.index)
        eligible = eligible.head(self.settings.max_positions)
        weights = eligible / eligible.sum()
        # Pre-scale so that the universe equity cap is respected before risk.
        equity_budget = min(
            self.risk.max_total_equity_pct, 1.0 - self.risk.minimum_cash_reserve_pct
        )
        weights = weights * equity_budget
        # Apply risk caps so the proposal is already feasible.
        weights = _apply_caps(weights, self.risk)
        full = pd.Series(0.0, index=s.index)
        full.loc[weights.index] = weights.values
        self.log(
            "Proposed target weights: "
            + ", ".join(f"{t}={w:.1%}" for t, w in full[full > 0].items())
        )
        return full

    # --- backtest path ----------------------------------------------------
    def backtest(
        self,
        price_panel: pd.DataFrame,
        score_history: pd.DataFrame,
        ratings_history: pd.DataFrame,
        benchmark: pd.Series | None = None,
    ) -> dict:
        """Weekly-rebalance paper trading.

        Args
        ----
        price_panel:     wide DataFrame, one column per ticker, daily close.
        score_history:   wide DataFrame, one column per ticker, signal score
                         per rebalance date.
        ratings_history: wide DataFrame, one column per ticker, "BUY"/"HOLD"/
                         "AVOID" per rebalance date.
        benchmark:       optional benchmark close series for comparison.
        """
        rebalance_dates = score_history.index
        if len(rebalance_dates) == 0:
            raise ValueError("score_history must have at least one date")

        cash = float(self.settings.starting_capital)
        shares: dict[str, float] = {t: 0.0 for t in price_panel.columns}
        equity_rows: list[dict] = []
        trades: list[TradeRecord] = []

        # Daily walk so the equity curve has full resolution.
        all_days = price_panel.index
        rebalance_set = set(pd.to_datetime(rebalance_dates))

        last_target: pd.Series | None = None
        for ts in all_days:
            prices = price_panel.loc[ts]
            if ts in rebalance_set:
                scores = score_history.loc[ts]
                ratings = ratings_history.loc[ts]
                buy_mask = ratings.eq("BUY")
                eligible = scores[buy_mask].dropna()
                if not eligible.empty:
                    eligible = eligible.sort_values(ascending=False).head(
                        self.settings.max_positions
                    )
                    weights = eligible / eligible.sum()
                    equity_budget = min(
                        self.risk.max_total_equity_pct,
                        1.0 - self.risk.minimum_cash_reserve_pct,
                    )
                    weights = weights * equity_budget
                    weights = _apply_caps(weights, self.risk)
                else:
                    weights = pd.Series(dtype=float)

                # Convert to dollar targets using current portfolio value.
                pv = cash + sum(
                    shares[t] * float(prices.get(t, np.nan))
                    for t in shares
                    if pd.notna(prices.get(t, np.nan))
                )
                target_dollars = pd.Series(0.0, index=price_panel.columns)
                for t, w in weights.items():
                    target_dollars[t] = pv * float(w)
                last_target = target_dollars

                # Sell-down or close positions not in target.
                for t in price_panel.columns:
                    px = float(prices.get(t, np.nan))
                    if not np.isfinite(px) or px <= 0:
                        continue
                    cur_dollars = shares[t] * px
                    tgt = float(target_dollars.get(t, 0.0))
                    delta = tgt - cur_dollars
                    if abs(delta) < 1.0:    # ignore < $1 noise
                        continue
                    delta_shares = delta / px
                    new_cash = cash - delta_shares * px
                    if new_cash < -1e-6:
                        # Not enough cash to fully buy; scale down.
                        affordable = max(0.0, cash) / px
                        delta_shares = affordable
                        if delta_shares <= 0:
                            continue
                    shares[t] += delta_shares
                    cash -= delta_shares * px
                    if shares[t] < 1e-9:
                        shares[t] = 0.0
                    if delta_shares > 0:
                        action = (
                            FinalAction.OPEN_LONG
                            if cur_dollars == 0
                            else FinalAction.ADD
                        )
                    else:
                        action = (
                            FinalAction.CLOSE
                            if shares[t] == 0
                            else FinalAction.TRIM
                        )
                    trades.append(
                        TradeRecord(
                            date=ts.date(),
                            ticker=t,
                            action=action,
                            shares=float(delta_shares),
                            price=px,
                            trade_value=float(delta_shares * px),
                            cash_after=float(cash),
                        )
                    )

            # End-of-day mark-to-market.
            equity_value = sum(
                shares[t] * float(prices.get(t, np.nan))
                for t in shares
                if pd.notna(prices.get(t, np.nan))
            )
            equity_rows.append(
                {
                    "date": ts,
                    "cash": float(cash),
                    "equity_value": float(equity_value),
                    "portfolio_value": float(cash + equity_value),
                    **{f"shares_{t}": float(shares[t]) for t in shares},
                }
            )

        equity_df = pd.DataFrame(equity_rows).set_index("date")
        trades_df = pd.DataFrame([t.model_dump() for t in trades])

        pv = equity_df["portfolio_value"]
        starting = self.settings.starting_capital
        ending = float(pv.iloc[-1])
        total_return = ending / starting - 1.0

        roll_max = pv.cummax()
        max_dd = float((pv / roll_max - 1.0).min())

        bench_return = float("nan")
        if benchmark is not None and not benchmark.empty:
            b = benchmark.dropna()
            bench_return = float(b.iloc[-1] / b.iloc[0] - 1.0)

        # Win rate proxy: fraction of CLOSE/TRIM trades that locked in a gain
        # vs the average price of preceding OPEN/ADD on the same ticker.
        wins, total = 0, 0
        if not trades_df.empty:
            for t in trades_df["ticker"].unique():
                legs = trades_df[trades_df["ticker"] == t].sort_values("date")
                cost_basis_shares = 0.0
                cost_basis_dollars = 0.0
                for _, leg in legs.iterrows():
                    a = leg["action"]
                    if a in {FinalAction.OPEN_LONG.value, FinalAction.ADD.value}:
                        cost_basis_shares += leg["shares"]
                        cost_basis_dollars += leg["trade_value"]
                    elif a in {FinalAction.TRIM.value, FinalAction.CLOSE.value}:
                        if cost_basis_shares > 1e-9:
                            avg_cost = cost_basis_dollars / cost_basis_shares
                            sold = -leg["shares"]    # negative shares
                            if leg["price"] > avg_cost:
                                wins += 1
                            total += 1
                            cost_basis_shares = max(0.0, cost_basis_shares - sold)
                            cost_basis_dollars = avg_cost * cost_basis_shares
        win_rate = (wins / total) * 100 if total > 0 else 0.0

        # Sharpe-like: mean daily return / std daily return * sqrt(252).
        daily_ret = pv.pct_change().dropna()
        sharpe = (
            float(daily_ret.mean() / daily_ret.std() * np.sqrt(252))
            if daily_ret.std() > 0
            else 0.0
        )

        summary = {
            "starting_capital": starting,
            "ending_capital": ending,
            "total_return_pct": total_return * 100,
            "benchmark_return_pct": bench_return * 100 if bench_return == bench_return else None,
            "num_trades": int(len(trades_df)),
            "win_rate_pct": float(win_rate),
            "max_drawdown_pct": max_dd * 100,
            "sharpe_like": sharpe,
            "start_date": equity_df.index[0].date(),
            "end_date": equity_df.index[-1].date(),
        }

        self.log(
            f"Backtest: {summary['num_trades']} trades, "
            f"return {summary['total_return_pct']:.1f}% "
            f"vs bench {summary['benchmark_return_pct']!r}, "
            f"max_dd {summary['max_drawdown_pct']:.1f}%"
        )

        return {
            "equity_curve": equity_df,
            "trades": trades_df,
            "summary": summary,
        }
