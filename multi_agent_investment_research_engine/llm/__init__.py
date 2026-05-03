"""LangChain reasoning + retrieval layer for the research engine.

The quantitative pipeline (`agents/`) produces numeric scores. This layer
ingests the same evidence into a Chroma vector store and uses LangChain
agents to reason over it: retrieve relevant signals per company, score
their qualitative strength, write a thesis, compose the weekly memo, and
produce an "outbound angle" view (what a GTM team would do with the
same signal).

Designed to run offline with a deterministic local LLM and a
hashing-based embedding so the whole pipeline works without API keys.
Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` and re-instantiate the
providers via `llm.providers.build_chat_model()` to swap in a hosted LLM.
"""

from .providers import build_chat_model, build_embeddings, ProviderInfo
from .schemas import (
    SignalInsight,
    CompanyRanking,
    InvestmentThesis,
    InvestmentMemo,
    InvestmentMemoEntry,
    OutboundAngle,
    EvidenceItem,
)
from .vector_store import VectorStore, build_evidence_documents
from .research_retrieval_agent import ResearchRetrievalAgent
from .signal_reasoning_agent import SignalReasoningAgent
from .thesis_agent import LangChainThesisAgent
from .memo_agent import MemoAgent
from .outbound_angle_agent import OutboundAngleAgent
from .workflow import ResearchWorkflow, WorkflowOutput

__all__ = [
    "ProviderInfo",
    "build_chat_model",
    "build_embeddings",
    "SignalInsight",
    "CompanyRanking",
    "InvestmentThesis",
    "InvestmentMemo",
    "InvestmentMemoEntry",
    "OutboundAngle",
    "EvidenceItem",
    "VectorStore",
    "build_evidence_documents",
    "ResearchRetrievalAgent",
    "SignalReasoningAgent",
    "LangChainThesisAgent",
    "MemoAgent",
    "OutboundAngleAgent",
    "ResearchWorkflow",
    "WorkflowOutput",
]
