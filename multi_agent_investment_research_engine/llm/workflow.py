"""ResearchWorkflow: orchestrates the LangChain reasoning layer.

`ResearchWorkflow.run(...)` is what `main.py` calls after the
quantitative pipeline has produced numeric scores + risk flags. It:

1. Ingests the same source CSVs into Chroma (idempotent).
2. For each ticker in the universe:
   - retrieves top-k evidence from Chroma,
   - asks SignalReasoningAgent for a structured SignalInsight,
   - asks ThesisAgent for an InvestmentThesis,
   - asks OutboundAngleAgent for a structured GTM angle.
3. Asks MemoAgent for a structured InvestmentMemo.
4. Returns a `WorkflowOutput` containing every artifact - the
   ReportingAgent serializes them to disk.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as _date
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel

from .memo_agent import MemoAgent
from .outbound_angle_agent import OutboundAngleAgent
from .providers import ProviderInfo, build_chat_model, build_embeddings
from .research_retrieval_agent import ResearchRetrievalAgent
from .schemas import (
    CompanyRanking,
    EvidenceItem,
    InvestmentMemo,
    InvestmentThesis,
    OutboundAngle,
    SignalInsight,
)
from .signal_reasoning_agent import SignalReasoningAgent
from .thesis_agent import LangChainThesisAgent
from .vector_store import VectorStore, build_evidence_documents
from ..agents.base_agent import AgentLogger


@dataclass
class WorkflowOutput:
    rankings: list[CompanyRanking]
    insights: dict[str, SignalInsight]
    theses: dict[str, InvestmentThesis]
    outbound_angles: dict[str, OutboundAngle]
    memo: InvestmentMemo
    evidence_by_ticker: dict[str, list[EvidenceItem]]
    provider: ProviderInfo


class ResearchWorkflow:
    """Bundles agents + vector store + provider into a single callable.

    `main.py` constructs one of these and calls `run(...)`. Tests can
    construct it directly with a synthetic Chroma directory.
    """

    def __init__(
        self,
        chroma_dir: Path,
        chat_model: Optional[BaseChatModel] = None,
        embeddings: Optional[Embeddings] = None,
        provider: Optional[ProviderInfo] = None,
        verbose: bool = True,
    ) -> None:
        self.logger = AgentLogger(name="ResearchWorkflow", verbose=verbose)
        if chat_model is None:
            chat_model, provider = build_chat_model()
        self.provider = provider or ProviderInfo("custom", "custom", True)
        self.embeddings = embeddings or build_embeddings()
        self.store = VectorStore(persist_dir=chroma_dir, embeddings=self.embeddings)
        self.retrieval = ResearchRetrievalAgent(self.store, verbose=verbose)
        self.reasoner = SignalReasoningAgent(chat_model, verbose=verbose)
        self.thesis = LangChainThesisAgent(chat_model, verbose=verbose)
        self.memo = MemoAgent(chat_model, verbose=verbose)
        self.outbound = OutboundAngleAgent(chat_model, verbose=verbose)

    # -- ingest -----------------------------------------------------------
    def ingest(self, data_dir: Path, universe: Iterable[str] | None = None) -> int:
        docs = build_evidence_documents(data_dir, universe=universe)
        n = self.store.ingest(docs)
        self.logger.info(
            f"Chroma ingest: {n} documents (collection size now "
            f"{self.store.count()})"
        )
        return n

    # -- main entry -------------------------------------------------------
    def run(
        self,
        universe: Iterable[str],
        feature_table: pd.DataFrame,
        risk_reviews: list[dict],
        allocations: dict[str, float],
        portfolio_snapshot: dict,
        as_of: _date,
        company_names: dict[str, str] | None = None,
        evidence_k: int = 6,
    ) -> WorkflowOutput:
        company_names = company_names or {}
        risk_flags_by_ticker = {r["ticker"]: list(r.get("flags", [])) for r in risk_reviews}

        evidence_by_ticker: dict[str, list[EvidenceItem]] = {}
        insights: dict[str, SignalInsight] = {}
        theses: dict[str, InvestmentThesis] = {}
        outbound_angles: dict[str, OutboundAngle] = {}
        rankings: list[CompanyRanking] = []

        ranked = feature_table.sort_values("signal_score", ascending=False)
        for rank, ticker in enumerate(ranked.index, start=1):
            row = ranked.loc[ticker]
            score = float(row["signal_score"])
            rating = str(row["rating"])
            pillar = {
                "market_score": float(row.get("market_score", 0.5)),
                "news_score": float(row.get("news_score", 0.5)),
                "fundamental_score": float(row.get("fundamental_score", 0.5)),
                "alt_score": float(row.get("alt_score", 0.5)),
            }
            self.logger.info(f"[{rank}/{len(ranked)}] {ticker} (score {score:.0f}, {rating})")

            evidence = self.retrieval.for_ticker(ticker=ticker, k=evidence_k)
            evidence_by_ticker[ticker] = evidence

            insight = self.reasoner.run(
                ticker=ticker, evidence=evidence, pillar_scores=pillar
            )
            insights[ticker] = insight

            fundamentals = {
                k: float(row[k]) if pd.notna(row.get(k)) else None
                for k in (
                    "revenue_growth_yoy",
                    "operating_margin",
                    "net_margin",
                    "pe_ratio",
                )
                if k in row.index
            }
            thesis = self.thesis.run(
                ticker=ticker,
                insight=insight,
                evidence=evidence,
                signal_score=score,
                fundamentals=fundamentals,
                risk_flags=risk_flags_by_ticker.get(ticker, []),
                company_name=company_names.get(ticker, ticker),
            )
            theses[ticker] = thesis

            # Outbound triggers should be concrete events, not company
            # descriptions or static fundamentals - retrieve with a kind
            # filter so the GTM angle always references something material.
            outbound_evidence = self.retrieval.for_ticker(
                ticker=ticker,
                k=max(evidence_k, 6),
                signal_kinds=["news", "alt_data"],
            )
            angle = self.outbound.run(
                ticker=ticker,
                insight=insight,
                evidence=outbound_evidence or evidence,
                signal_score=score,
                company_name=company_names.get(ticker, ticker),
            )
            outbound_angles[ticker] = angle

            rankings.append(
                CompanyRanking(
                    rank=rank,
                    ticker=ticker,
                    signal_score=score,
                    rating=rating if rating in {"BUY", "HOLD", "AVOID"} else "HOLD",
                    qualitative_score=insight.qualitative_score,
                    headline=insight.headline_summary,
                )
            )

        memo = self.memo.run(
            as_of=as_of.isoformat(),
            rankings=rankings,
            theses=theses,
            risk_reviews=risk_reviews,
            allocations=allocations,
            portfolio_snapshot=portfolio_snapshot,
        )

        return WorkflowOutput(
            rankings=rankings,
            insights=insights,
            theses=theses,
            outbound_angles=outbound_angles,
            memo=memo,
            evidence_by_ticker=evidence_by_ticker,
            provider=self.provider,
        )

    # -- expose tools -----------------------------------------------------
    def tools(self):
        from .tools import make_tools

        return make_tools(self)
