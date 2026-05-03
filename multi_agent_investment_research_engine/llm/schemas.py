"""Pydantic schemas for LangChain output parsing.

Every LLM-driven agent in this layer returns one of these. They're parsed
by `langchain_core.output_parsers.PydanticOutputParser`, so the wire
format between agents is enforced at every boundary - even when the LLM
returns malformed JSON, the parser raises a clean error.
"""

from __future__ import annotations

from datetime import date as _date
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ----- evidence (retrieved from Chroma) ------------------------------------


class EvidenceItem(BaseModel):
    """One retrieved Chroma document with metadata."""

    text: str
    ticker: str
    company_name: Optional[str] = None
    signal_type: str
    date: Optional[str] = None
    source: str = "mock"
    confidence_score: float = Field(0.5, ge=0.0, le=1.0)
    similarity: Optional[float] = None     # filled by retriever


# ----- structured outputs --------------------------------------------------


class SignalInsight(BaseModel):
    """SignalReasoningAgent output: qualitative reading of evidence."""

    ticker: str
    headline_summary: str = Field(..., description="One-sentence summary of the strongest signals.")
    bullish_signals: list[str] = Field(default_factory=list)
    bearish_signals: list[str] = Field(default_factory=list)
    qualitative_score: float = Field(..., ge=0.0, le=1.0,
                                     description="0-1 reading after weighing all evidence.")
    evidence_count: int
    rationale: str = Field(..., description="Why the qualitative score lands where it does.")


class CompanyRanking(BaseModel):
    """One row in the ranked list.

    `qualitative_score`, `headline`, and `in_reasoning_slice` only carry
    meaningful values for tickers that fell inside the LangChain reasoning
    funnel (top-N by signal score). Tickers outside the funnel get a
    placeholder qualitative_score equal to the quantitative pillar mean
    and a generic headline so the UI can still render every row.
    """

    rank: int
    ticker: str
    signal_score: float = Field(..., ge=0.0, le=100.0)
    rating: Literal["BUY", "HOLD", "AVOID"]
    qualitative_score: float = Field(..., ge=0.0, le=1.0)
    headline: str
    sector: Optional[str] = None
    company_name: Optional[str] = None
    in_reasoning_slice: bool = True


class InvestmentThesis(BaseModel):
    """ThesisAgent output."""

    ticker: str
    company_name: Optional[str] = None
    bull_case: str = Field(..., description="2-4 sentences with concrete evidence references.")
    bear_case: str = Field(..., description="2-4 sentences with concrete evidence references.")
    key_risks: list[str] = Field(..., min_length=1)
    investment_thesis: str = Field(..., description="The core 1-2 sentence investment thesis.")
    conviction: Literal["high", "medium", "low"]
    evidence_refs: list[str] = Field(
        default_factory=list,
        description="Short snippets of the retrieved evidence that backed the thesis.",
    )


class InvestmentMemoEntry(BaseModel):
    rank: int
    ticker: str
    rating: Literal["BUY", "HOLD", "AVOID"]
    signal_score: float
    allocation_pct: float = Field(..., ge=0.0, le=1.0)
    decision: str
    bull_case: str
    bear_case: str
    risk_notes: list[str] = Field(default_factory=list)


class InvestmentMemo(BaseModel):
    """MemoAgent output. ReportingAgent writes this as markdown."""

    as_of: _date
    headline: str = Field(..., description="One-line summary of the week.")
    top_pick_ticker: Optional[str] = None
    top_pick_summary: Optional[str] = None
    portfolio_snapshot_md: str = Field(..., description="A bullet block describing portfolio state.")
    entries: list[InvestmentMemoEntry]
    closing_note: str


class OutboundAngle(BaseModel):
    """OutboundAngleAgent output for one company.

    The same signals that drive a long-only thesis also indicate sales /
    GTM intent. This shows the system can support investing AND outbound.
    """

    ticker: str
    company_name: Optional[str] = None
    trigger_signal: str = Field(..., description="What just happened that creates the angle.")
    persona: str = Field(..., description="Who at the target company you'd reach.")
    pain_hypothesis: str = Field(..., description="Why they likely care right now.")
    opener: str = Field(..., description="A 1-2 sentence cold opener that references the trigger.")
    follow_up: str = Field(..., description="A 1-2 sentence follow-up if no reply.")
    confidence: Literal["high", "medium", "low"]
