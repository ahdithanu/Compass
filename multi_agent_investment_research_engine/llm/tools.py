"""LangChain `@tool` definitions backed by the reasoning agents.

These tools have explicit Pydantic input/output schemas so they can be
discovered and called by a LangChain agent (e.g. `create_react_agent` or
`bind_tools`) - making the engine dual-use as a research-style automation
*and* as a tool box that another agent (or a human via a chat UI) can
drive interactively.

The tools never run a hosted LLM unless one is configured: under the
hood they call the same offline-friendly chains the workflow uses.
"""

from __future__ import annotations

import json
from typing import Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from .schemas import (
    CompanyRanking,
    EvidenceItem,
    InvestmentMemo,
    InvestmentThesis,
    OutboundAngle,
    SignalInsight,
)


# ---------------------------------------------------------------------------
# Input schemas
# ---------------------------------------------------------------------------


class RetrieveSignalsInput(BaseModel):
    ticker: str = Field(..., description="Ticker symbol, e.g. 'NVDA'.")
    k: int = Field(6, ge=1, le=25, description="Top-k evidence items to return.")
    signal_kinds: Optional[list[str]] = Field(
        None,
        description=(
            "Optional filter on doc_kind metadata: news / alt_data / "
            "fundamentals / description."
        ),
    )


class ScoreStrengthInput(BaseModel):
    ticker: str
    pillar_scores: dict = Field(
        default_factory=dict,
        description="market_score, news_score, fundamental_score, alt_score (0-1 each).",
    )
    k: int = 6


class ThesisInput(BaseModel):
    ticker: str
    signal_score: float = Field(..., ge=0.0, le=100.0)
    fundamentals: dict = Field(default_factory=dict)
    risk_flags: list[str] = Field(default_factory=list)
    company_name: Optional[str] = None
    pillar_scores: dict = Field(default_factory=dict)
    k: int = 6


class CompareRankingsInput(BaseModel):
    rows: list[CompanyRanking]
    top_n: int = Field(5, ge=1, le=50)


class MemoInput(BaseModel):
    as_of: str
    rankings: list[CompanyRanking]
    theses: dict[str, InvestmentThesis]
    risk_reviews: list[dict]
    allocations: dict[str, float]
    portfolio_snapshot: dict


class OutboundInput(BaseModel):
    ticker: str
    signal_score: float
    pillar_scores: dict = Field(default_factory=dict)
    company_name: Optional[str] = None
    k: int = 6


# ---------------------------------------------------------------------------
# Tool factory
# ---------------------------------------------------------------------------


def make_tools(workflow: "ResearchWorkflow") -> list[StructuredTool]:
    """Build the list of LangChain tools bound to a `ResearchWorkflow`.

    Imported lazily inside the function so this module remains importable
    when `workflow.py` is being constructed (no circular import).
    """
    from .workflow import ResearchWorkflow  # noqa: F401  (type hint only)

    def _retrieve_company_signals(
        ticker: str, k: int = 6, signal_kinds: Optional[list[str]] = None
    ) -> list[dict]:
        items = workflow.retrieval.for_ticker(
            ticker=ticker, k=k, signal_kinds=signal_kinds
        )
        return [i.model_dump() for i in items]

    def _score_signal_strength(
        ticker: str, pillar_scores: Optional[dict] = None, k: int = 6
    ) -> dict:
        evidence = workflow.retrieval.for_ticker(ticker=ticker, k=k)
        insight = workflow.reasoner.run(
            ticker=ticker, evidence=evidence, pillar_scores=pillar_scores or {}
        )
        return insight.model_dump()

    def _generate_company_thesis(
        ticker: str,
        signal_score: float,
        fundamentals: Optional[dict] = None,
        risk_flags: Optional[list[str]] = None,
        company_name: Optional[str] = None,
        pillar_scores: Optional[dict] = None,
        k: int = 6,
    ) -> dict:
        evidence = workflow.retrieval.for_ticker(ticker=ticker, k=k)
        insight = workflow.reasoner.run(
            ticker=ticker, evidence=evidence, pillar_scores=pillar_scores or {}
        )
        thesis = workflow.thesis.run(
            ticker=ticker,
            insight=insight,
            evidence=evidence,
            signal_score=signal_score,
            fundamentals=fundamentals or {},
            risk_flags=risk_flags or [],
            company_name=company_name,
        )
        return thesis.model_dump()

    def _compare_company_rankings(
        rows: list[CompanyRanking], top_n: int = 5
    ) -> dict:
        ranked = sorted(rows, key=lambda r: r.signal_score, reverse=True)
        top = ranked[:top_n]
        return {
            "n_buy": sum(1 for r in ranked if r.rating == "BUY"),
            "n_hold": sum(1 for r in ranked if r.rating == "HOLD"),
            "n_avoid": sum(1 for r in ranked if r.rating == "AVOID"),
            "top": [r.model_dump() for r in top],
            "median_score": float(
                sorted(r.signal_score for r in ranked)[len(ranked) // 2]
            ) if ranked else 0.0,
        }

    def _generate_investment_memo(
        as_of: str,
        rankings: list[CompanyRanking],
        theses: dict[str, InvestmentThesis],
        risk_reviews: list[dict],
        allocations: dict[str, float],
        portfolio_snapshot: dict,
    ) -> dict:
        memo = workflow.memo.run(
            as_of=as_of,
            rankings=rankings,
            theses=theses,
            risk_reviews=risk_reviews,
            allocations=allocations,
            portfolio_snapshot=portfolio_snapshot,
        )
        return memo.model_dump()

    def _generate_outbound_angles(
        ticker: str,
        signal_score: float,
        pillar_scores: Optional[dict] = None,
        company_name: Optional[str] = None,
        k: int = 6,
    ) -> dict:
        evidence = workflow.retrieval.for_ticker(ticker=ticker, k=k)
        insight = workflow.reasoner.run(
            ticker=ticker, evidence=evidence, pillar_scores=pillar_scores or {}
        )
        angle = workflow.outbound.run(
            ticker=ticker,
            insight=insight,
            evidence=evidence,
            signal_score=signal_score,
            company_name=company_name,
        )
        return angle.model_dump()

    return [
        StructuredTool.from_function(
            func=_retrieve_company_signals,
            name="retrieve_company_signals",
            description=(
                "Retrieve the top-k most relevant signal evidence documents "
                "for a ticker from the Chroma vector store. Returns a list of "
                "EvidenceItem dicts with metadata (signal_type, date, "
                "source, confidence_score)."
            ),
            args_schema=RetrieveSignalsInput,
        ),
        StructuredTool.from_function(
            func=_score_signal_strength,
            name="score_signal_strength",
            description=(
                "Read retrieved evidence + quantitative pillar scores and "
                "produce a SignalInsight with bullish/bearish bullets and a "
                "qualitative score in [0,1]."
            ),
            args_schema=ScoreStrengthInput,
        ),
        StructuredTool.from_function(
            func=_generate_company_thesis,
            name="generate_company_thesis",
            description=(
                "Generate a structured InvestmentThesis (bull case, bear "
                "case, key risks, conviction) for a ticker. Uses retrieved "
                "evidence + signal score + risk flags."
            ),
            args_schema=ThesisInput,
        ),
        StructuredTool.from_function(
            func=_compare_company_rankings,
            name="compare_company_rankings",
            description=(
                "Compare a list of CompanyRanking rows: counts by rating, "
                "the top-N, and the median signal score."
            ),
            args_schema=CompareRankingsInput,
        ),
        StructuredTool.from_function(
            func=_generate_investment_memo,
            name="generate_investment_memo",
            description=(
                "Compose a structured InvestmentMemo from rankings + theses "
                "+ risk reviews + allocations + portfolio snapshot."
            ),
            args_schema=MemoInput,
        ),
        StructuredTool.from_function(
            func=_generate_outbound_angles,
            name="generate_outbound_angles",
            description=(
                "Convert the same signal evidence into a GTM / outbound "
                "angle: trigger, persona, pain hypothesis, opener, follow-up."
            ),
            args_schema=OutboundInput,
        ),
    ]
