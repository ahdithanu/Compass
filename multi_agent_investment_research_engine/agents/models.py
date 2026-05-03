"""Pydantic models shared between agents.

One module so that any agent can import any schema without circular
imports, and the wire format between agents is documented in one place.
"""

from __future__ import annotations

from datetime import date as _date
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Rating(str, Enum):
    BUY = "BUY"
    HOLD = "HOLD"
    AVOID = "AVOID"


class FinalAction(str, Enum):
    OPEN_LONG = "OPEN_LONG"
    ADD = "ADD"
    HOLD = "HOLD"
    TRIM = "TRIM"
    CLOSE = "CLOSE"
    REJECT = "REJECT"


class SignalBreakdown(BaseModel):
    """Per-pillar contribution that produced a composite signal score."""

    market: float = Field(0.0, ge=0.0, le=1.0)
    news: float = Field(0.0, ge=0.0, le=1.0)
    fundamentals: float = Field(0.0, ge=0.0, le=1.0)
    alternative: float = Field(0.0, ge=0.0, le=1.0)


class CompanyScore(BaseModel):
    """Cross-pillar composite score for one ticker on one snapshot date."""

    ticker: str
    as_of: _date
    signal_score: float = Field(..., ge=0.0, le=100.0)
    rating: Rating
    breakdown: SignalBreakdown
    notes: list[str] = Field(default_factory=list)


class FundamentalSnapshot(BaseModel):
    ticker: str
    revenue_growth_yoy: Optional[float] = None    # e.g. 0.42 = +42%
    gross_margin: Optional[float] = None
    operating_margin: Optional[float] = None
    net_margin: Optional[float] = None
    pe_ratio: Optional[float] = None
    ps_ratio: Optional[float] = None
    return_on_equity: Optional[float] = None
    profitability_score: float = Field(0.5, ge=0.0, le=1.0)
    valuation_score: float = Field(0.5, ge=0.0, le=1.0)
    growth_score: float = Field(0.5, ge=0.0, le=1.0)
    fundamental_score: float = Field(0.5, ge=0.0, le=1.0)
    source: str = "unknown"


class RiskReview(BaseModel):
    """Output of RiskAgent for a single ticker recommendation."""

    ticker: str
    approved: bool
    suggested_weight_pct: float = Field(..., ge=0.0, le=1.0)
    flags: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class PortfolioRiskReport(BaseModel):
    """Portfolio-level risk readout produced after RiskAgent runs."""

    as_of: _date
    concentration_pct_top: float
    portfolio_volatility: float
    portfolio_drawdown: float
    cash_pct: float
    flags: list[str] = Field(default_factory=list)
    per_ticker: list[RiskReview] = Field(default_factory=list)


class Thesis(BaseModel):
    """Bull / bear / risks narrative for one ticker."""

    ticker: str
    bull_case: str
    bear_case: str
    key_risks: list[str]
    conviction: str   # "high" | "medium" | "low"


class InvestmentMemoEntry(BaseModel):
    """One entry in the weekly investment memo."""

    rank: int
    ticker: str
    signal_score: float
    rating: Rating
    decision: str            # plain-English execution decision
    allocation_pct: float    # 0-1
    bull_case: str
    bear_case: str
    risk_notes: list[str]


class TradeRecord(BaseModel):
    """One simulated rebalance trade leg."""

    date: _date
    ticker: str
    action: FinalAction
    shares: float
    price: float
    trade_value: float
    cash_after: float


class PerformanceSummary(BaseModel):
    starting_capital: float
    ending_capital: float
    total_return_pct: float
    benchmark_return_pct: float
    num_trades: int
    win_rate_pct: float
    max_drawdown_pct: float
    sharpe_like: float
    start_date: _date
    end_date: _date
