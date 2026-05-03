"""Tests for the LangChain reasoning layer.

These exercise the offline-friendly providers + Chroma ingest + each
agent's structured output. No network access required.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from multi_agent_investment_research_engine.data.mock_data import ensure_mock_data
from multi_agent_investment_research_engine.llm.providers import (
    HashingEmbeddings,
    OfflineReasoningChatModel,
    build_chat_model,
    build_embeddings,
)
from multi_agent_investment_research_engine.llm.research_retrieval_agent import (
    ResearchRetrievalAgent,
)
from multi_agent_investment_research_engine.llm.schemas import (
    EvidenceItem,
    InvestmentMemo,
    InvestmentThesis,
    OutboundAngle,
    SignalInsight,
)
from multi_agent_investment_research_engine.llm.signal_reasoning_agent import (
    SignalReasoningAgent,
)
from multi_agent_investment_research_engine.llm.thesis_agent import (
    LangChainThesisAgent,
)
from multi_agent_investment_research_engine.llm.outbound_angle_agent import (
    OutboundAngleAgent,
)
from multi_agent_investment_research_engine.llm.memo_agent import MemoAgent
from multi_agent_investment_research_engine.llm.vector_store import (
    VectorStore,
    build_evidence_documents,
)
from multi_agent_investment_research_engine.llm.workflow import ResearchWorkflow


UNIVERSE = ["NVDA", "MSFT", "AMZN", "META", "TSLA", "AMD", "PLTR", "CRWD", "SNOW"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def data_dir(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("data")
    ensure_mock_data(d, UNIVERSE, seed=42)
    return d


@pytest.fixture(scope="module")
def store(tmp_path_factory, data_dir) -> VectorStore:
    persist = tmp_path_factory.mktemp("chroma")
    s = VectorStore(persist_dir=persist, embeddings=HashingEmbeddings())
    docs = build_evidence_documents(data_dir, universe=UNIVERSE)
    s.ingest(docs)
    return s


# ---------------------------------------------------------------------------
# Provider + embedding tests
# ---------------------------------------------------------------------------


def test_hashing_embeddings_are_deterministic_and_normalized():
    emb = HashingEmbeddings(dim=64)
    a = emb.embed_query("CRWD beats earnings on cloud demand")
    b = emb.embed_query("CRWD beats earnings on cloud demand")
    c = emb.embed_query("TSLA misses revenue, weak guidance")
    assert a == b
    assert a != c
    # Approximately L2-normalized.
    n_a = sum(x * x for x in a) ** 0.5
    assert abs(n_a - 1.0) < 1e-3


def test_offline_chat_model_returns_signal_insight_json():
    """The offline model must return JSON our parsers accept."""
    chat = OfflineReasoningChatModel()
    agent = SignalReasoningAgent(chat, verbose=False)
    evidence = [
        EvidenceItem(text="NVDA beats earnings on AI demand",
                     ticker="NVDA", signal_type="news::earnings", source="t"),
        EvidenceItem(text="NVDA hiring spike across product team",
                     ticker="NVDA", signal_type="hiring_spike", source="t"),
    ]
    insight = agent.run(
        ticker="NVDA",
        evidence=evidence,
        pillar_scores={"market_score": 0.7, "news_score": 0.8,
                       "fundamental_score": 0.9, "alt_score": 0.4},
    )
    assert isinstance(insight, SignalInsight)
    assert 0.0 <= insight.qualitative_score <= 1.0
    assert insight.evidence_count == 2


def test_build_chat_model_returns_offline_when_no_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    chat, info = build_chat_model()
    assert info.is_offline is True
    assert chat._llm_type == "offline-reasoning"


# ---------------------------------------------------------------------------
# Vector store tests
# ---------------------------------------------------------------------------


def test_vector_store_count_matches_ingest(store: VectorStore):
    assert store.count() > 0


def test_retrieval_filters_by_ticker(store: VectorStore):
    agent = ResearchRetrievalAgent(store, verbose=False)
    items = agent.for_ticker("NVDA", k=5)
    assert all(e.ticker == "NVDA" for e in items)
    assert len(items) <= 5


def test_retrieval_filters_by_signal_kind(store: VectorStore):
    agent = ResearchRetrievalAgent(store, verbose=False)
    items = agent.for_ticker("NVDA", k=10, signal_kinds=["alt_data"])
    # If any are returned, every one must be alt_data; the corpus is small
    # so it's also acceptable to return zero (then the assertion is vacuous).
    for e in items:
        sub_kind = e.signal_type.split("::")[0] if "::" in e.signal_type else e.signal_type
        # alt_data signal_type is the raw alt-type (e.g. hiring_spike); description docs
        # are filtered out by the kind clause.
        assert sub_kind != "company_description"


# ---------------------------------------------------------------------------
# Agent output tests
# ---------------------------------------------------------------------------


def test_thesis_agent_produces_high_conviction_for_strong_inputs(store: VectorStore):
    chat, _ = build_chat_model()
    retr = ResearchRetrievalAgent(store, verbose=False)
    reas = SignalReasoningAgent(chat, verbose=False)
    thesis_agent = LangChainThesisAgent(chat, verbose=False)
    ev = retr.for_ticker("NVDA", k=6)
    insight = reas.run("NVDA", ev, pillar_scores={
        "market_score": 0.9, "news_score": 0.9,
        "fundamental_score": 0.9, "alt_score": 0.9,
    })
    thesis = thesis_agent.run(
        ticker="NVDA", insight=insight, evidence=ev,
        signal_score=82.0,
        fundamentals={"revenue_growth_yoy": 0.55, "operating_margin": 0.53,
                      "pe_ratio": 60.0},
        risk_flags=[],
        company_name="NVIDIA Corporation",
    )
    assert isinstance(thesis, InvestmentThesis)
    assert thesis.conviction == "high"
    assert thesis.bull_case
    assert thesis.bear_case
    assert thesis.key_risks


def test_outbound_agent_produces_specific_persona(store: VectorStore):
    chat, _ = build_chat_model()
    retr = ResearchRetrievalAgent(store, verbose=False)
    reas = SignalReasoningAgent(chat, verbose=False)
    out_agent = OutboundAngleAgent(chat, verbose=False)
    # Filter to material signals (news + alt_data) - the workflow does the
    # same so the outbound trigger is never a company-description doc.
    ev = retr.for_ticker("NVDA", k=8, signal_kinds=["news", "alt_data"])
    insight = reas.run("NVDA", ev)
    angle = out_agent.run(
        ticker="NVDA", insight=insight, evidence=ev,
        signal_score=82.0, company_name="NVIDIA Corporation",
    )
    assert isinstance(angle, OutboundAngle)
    assert angle.persona
    assert angle.opener
    assert angle.follow_up
    # The trigger must reference one of the known signal-type names.
    assert any(
        keyword in angle.trigger_signal.lower()
        for keyword in [
            "hiring", "infrastructure", "product", "funding", "permit",
            "earnings", "guidance", "analyst", "partnership", "color",
            "regulatory", "macro", "app review", "web traffic",
        ]
    )


# ---------------------------------------------------------------------------
# Workflow + tools
# ---------------------------------------------------------------------------


def test_workflow_run_produces_memo_and_outbound_angles(tmp_path, data_dir):
    persist = tmp_path / "chroma"
    workflow = ResearchWorkflow(chroma_dir=persist, verbose=False)
    workflow.ingest(data_dir, universe=UNIVERSE)

    feature_table = pd.DataFrame(
        {
            "signal_score": [80.0, 65.0, 35.0],
            "rating": ["BUY", "HOLD", "AVOID"],
            "market_score": [0.8, 0.5, 0.2],
            "news_score": [0.9, 0.5, 0.3],
            "fundamental_score": [0.8, 0.6, 0.3],
            "alt_score": [0.7, 0.4, 0.2],
            "revenue_growth_yoy": [0.55, 0.13, 0.05],
            "operating_margin": [0.53, 0.43, 0.07],
            "pe_ratio": [60.0, 33.0, 70.0],
        },
        index=["NVDA", "MSFT", "TSLA"],
    )
    risk_reviews = [
        {"ticker": "NVDA", "approved": True, "suggested_weight_pct": 0.15,
         "flags": [], "notes": []},
        {"ticker": "MSFT", "approved": False, "suggested_weight_pct": 0.0,
         "flags": [], "notes": []},
        {"ticker": "TSLA", "approved": False, "suggested_weight_pct": 0.0,
         "flags": ["high_volatility"], "notes": ["vol elevated"]},
    ]
    out = workflow.run(
        universe=["NVDA", "MSFT", "TSLA"],
        feature_table=feature_table,
        risk_reviews=risk_reviews,
        allocations={"NVDA": 0.15, "MSFT": 0.0, "TSLA": 0.0},
        portfolio_snapshot={
            "cash_pct": 0.85,
            "concentration_pct_top": 0.15,
            "portfolio_volatility": 0.10,
            "flags": [],
        },
        as_of=pd.Timestamp("2026-05-01").date(),
        company_names={"NVDA": "NVIDIA Corporation", "MSFT": "Microsoft", "TSLA": "Tesla"},
    )
    assert isinstance(out.memo, InvestmentMemo)
    assert "NVDA" in out.outbound_angles and "MSFT" in out.outbound_angles
    assert out.rankings[0].ticker == "NVDA"
    # Top entry's bull case should reference NVIDIA.
    assert "nvidia" in out.theses["NVDA"].bull_case.lower()


def test_tools_are_structured_and_callable(tmp_path, data_dir):
    persist = tmp_path / "chroma_tools"
    workflow = ResearchWorkflow(chroma_dir=persist, verbose=False)
    workflow.ingest(data_dir, universe=UNIVERSE)
    tools = workflow.tools()
    names = {t.name for t in tools}
    assert names == {
        "retrieve_company_signals",
        "score_signal_strength",
        "generate_company_thesis",
        "compare_company_rankings",
        "generate_investment_memo",
        "generate_outbound_angles",
    }
    retrieve = next(t for t in tools if t.name == "retrieve_company_signals")
    items = retrieve.invoke({"ticker": "NVDA", "k": 3})
    assert isinstance(items, list)
    assert all(isinstance(d, dict) and d.get("ticker") == "NVDA" for d in items)
