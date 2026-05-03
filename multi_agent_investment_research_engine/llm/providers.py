"""LLM + embedding providers.

By default the system runs **offline** with:
* `OfflineReasoningChatModel` - a deterministic `BaseChatModel` that
  parses the prompt's JSON-encoded inputs and synthesizes structured
  output via task-specific templates (no network calls).
* `HashingEmbeddings` - a deterministic embedding (token-hash → bag-of-
  features) that gives sane similarity for substring/keyword overlap.

Set `OPENAI_API_KEY` (or use any other LangChain chat model) and call
`build_chat_model()` to swap in the hosted provider. The agents never
touch the provider directly - they accept any `BaseChatModel`.

Why a custom offline LLM rather than `FakeListChatModel`?
* `FakeListChatModel` returns canned strings regardless of the prompt,
  which silently breaks `PydanticOutputParser`.
* The offline model here actually reads its inputs and synthesizes
  schema-conformant JSON, which means tests + UI work with no API keys
  and a real LLM can drop in without code changes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Iterable, Optional, Sequence

import numpy as np

try:
    # Modern LangChain (>=1.0)
    from langchain_core.callbacks import CallbackManagerForLLMRun
    from langchain_core.embeddings import Embeddings
    from langchain_core.language_models import BaseChatModel
    from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
except ImportError as e:    # pragma: no cover
    raise ImportError(
        "LangChain >=1.0 is required: `pip install langchain langchain-core`"
    ) from e


# ---------------------------------------------------------------------------
# Provider info
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderInfo:
    chat_model_name: str
    embedding_name: str
    is_offline: bool


# ---------------------------------------------------------------------------
# Offline embeddings
# ---------------------------------------------------------------------------


class HashingEmbeddings(Embeddings):
    """Deterministic hashing-based embedding for offline mode.

    Tokenizes lower-case text on word boundaries, hashes each token to one
    of `dim` buckets, and L2-normalizes the bag-of-counts vector. This is
    obviously not a semantic embedding, but it gives stable retrieval
    based on keyword overlap which is enough to power the demo and tests.
    """

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def _embed(self, text: str) -> list[float]:
        v = np.zeros(self.dim, dtype=np.float32)
        if not text:
            v[0] = 1.0
            return v.tolist()
        tokens = re.findall(r"[a-z0-9]+", text.lower())
        for tok in tokens:
            # md5 -> first 8 bytes -> int. Stable across processes.
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
            v[h % self.dim] += 1.0
        n = float(np.linalg.norm(v))
        if n == 0:
            v[0] = 1.0
            return v.tolist()
        return (v / n).tolist()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


# ---------------------------------------------------------------------------
# Offline chat model
# ---------------------------------------------------------------------------


# Task markers - prompts include a system marker so the offline model can
# dispatch deterministically. A real LLM ignores these (or treats them as
# extra context); the offline model uses them as the routing key.
TASK_MARK = "<<TASK::"
TASK_END = ">>"


def _extract_task(messages: Sequence[BaseMessage]) -> str:
    for m in messages:
        if isinstance(m, SystemMessage):
            mtch = re.search(rf"{re.escape(TASK_MARK)}([A-Z_]+){re.escape(TASK_END)}", m.text)
            if mtch:
                return mtch.group(1)
    return "GENERIC"


def _extract_payload(messages: Sequence[BaseMessage]) -> dict:
    """Find the first JSON object in any human message."""
    for m in messages:
        if isinstance(m, HumanMessage):
            text = m.text
            mtch = re.search(r"\{.*\}", text, re.DOTALL)
            if mtch:
                try:
                    return json.loads(mtch.group(0))
                except json.JSONDecodeError:
                    continue
    return {}


def _evidence_summary(payload: dict, max_items: int = 4) -> list[dict]:
    items = payload.get("evidence", [])[:max_items]
    return [
        {
            "type": e.get("signal_type"),
            "text": (e.get("text") or "").strip(),
            "date": e.get("date"),
            "confidence": e.get("confidence_score", 0.5),
        }
        for e in items
    ]


# ---- Per-task synthesizers ----


def _syn_signal_insight(payload: dict) -> dict:
    ticker = payload.get("ticker", "UNK")
    ev = _evidence_summary(payload, max_items=8)
    bull, bear = [], []
    for e in ev:
        text = e["text"][:140]
        st = (e.get("type") or "").lower()
        positive_kw = ("beat", "record", "growth", "surge", "rally", "upgrade",
                       "wins", "expansion", "approval", "exceeds", "raises",
                       "buyback", "strong", "innovative", "breakthrough",
                       "hiring", "launch", "partnership")
        negative_kw = ("miss", "weak", "decline", "drop", "downgrade", "lawsuit",
                       "investigation", "fraud", "warning", "cuts", "loss",
                       "recall", "delay", "fines", "scandal", "concerns",
                       "slowdown", "halts", "probe", "breach", "outage")
        low = text.lower()
        if st in {"hiring_spike", "product_launch", "funding_announcement",
                  "partnership", "infrastructure_expansion", "permit_activity",
                  "app_review_surge", "web_traffic_spike"} or any(k in low for k in positive_kw):
            bull.append(f"[{e.get('date') or 'recent'}] {text}")
        elif any(k in low for k in negative_kw):
            bear.append(f"[{e.get('date') or 'recent'}] {text}")
    bull = bull[:4]
    bear = bear[:3]
    qual = payload.get("market_score", 0.5) * 0.4 + payload.get("news_score", 0.5) * 0.3 \
        + payload.get("fundamental_score", 0.5) * 0.2 + payload.get("alt_score", 0.5) * 0.1
    qual = round(min(1.0, max(0.0, qual)), 2)
    headline = (
        f"{ticker} is showing {('positive' if qual >= 0.6 else 'mixed' if qual >= 0.45 else 'soft')} "
        f"signal across {len(ev)} retrieved evidence items."
    )
    rationale = (
        f"Quantitative pillars (market={payload.get('market_score', 0):.2f}, "
        f"news={payload.get('news_score', 0):.2f}, fund={payload.get('fundamental_score', 0):.2f}, "
        f"alt={payload.get('alt_score', 0):.2f}) blended with retrieved evidence "
        f"({len(bull)} bullish, {len(bear)} bearish snippets) yields qualitative_score={qual}."
    )
    return {
        "ticker": ticker,
        "headline_summary": headline,
        "bullish_signals": bull or ["No strongly bullish snippets retrieved this cycle."],
        "bearish_signals": bear or ["No strongly bearish snippets retrieved this cycle."],
        "qualitative_score": qual,
        "evidence_count": len(ev),
        "rationale": rationale,
    }


def _syn_thesis(payload: dict) -> dict:
    ticker = payload.get("ticker", "UNK")
    company = payload.get("company_name") or ticker
    score = payload.get("signal_score", 50.0)
    insight = payload.get("insight", {})
    bull = insight.get("bullish_signals", []) or ["constructive setup is thin this week"]
    bear = insight.get("bearish_signals", []) or ["no specific bearish signal stands out"]
    risks = []
    flags = payload.get("risk_flags", [])
    if "high_volatility" in flags:
        risks.append("Realized volatility is elevated; position will be trimmed by RiskAgent.")
    if "deep_drawdown" in flags:
        risks.append("Recent deep drawdown — momentum can overshoot reversal.")
    if "position_cap" in flags:
        risks.append("Single-name cap binding; cannot size up further regardless of conviction.")
    if not risks:
        risks.append("No specific risk-agent flag this cycle; standard market risk applies.")

    fund = payload.get("fundamentals", {})
    g = fund.get("revenue_growth_yoy")
    om = fund.get("operating_margin")
    pe = fund.get("pe_ratio")
    fund_phrase_bits = []
    if g is not None:
        fund_phrase_bits.append(f"revenue growth of {g * 100:+.0f}% YoY")
    if om is not None and om > 0.20:
        fund_phrase_bits.append(f"operating margin of {om * 100:.0f}%")
    if pe is not None and pe > 60:
        fund_phrase_bits.append(f"rich valuation (P/E ~ {pe:.0f}x)")
    fund_clause = "; ".join(fund_phrase_bits)

    bull_case = (
        f"{company} is supported by a composite signal score of {score:.0f}/100. "
        + ("Retrieved evidence shows: " + "; ".join(b[:120] for b in bull[:3]) + "." if bull else "")
        + (f" Underlying fundamentals: {fund_clause}." if fund_clause else "")
    ).strip()
    bear_case = (
        f"On the other side, {company} faces: "
        + "; ".join(b[:120] for b in bear[:3])
        + ".  "
        + ("Watch the elevated valuation as a near-term governor."
           if pe is not None and pe > 60
           else "Watch the next round of headlines for reversal risk.")
    ).strip()

    investment_thesis = (
        f"{('Long ' if score >= 70 else 'Watch ' if score >= 50 else 'Pass on ')}"
        f"{ticker}: {('signal regime is constructive across multiple pillars.' if score >= 70 else 'mixed signal needs confirmation.' if score >= 50 else 'signal regime is weak.')}"
    )
    conviction = "high" if score >= 75 and "high_volatility" not in flags else \
                 "medium" if score >= 60 else "low"

    evidence_refs: list[str] = []
    for e in (payload.get("evidence") or [])[:5]:
        t = (e.get("text") or "").strip()
        if t:
            evidence_refs.append(t[:160])

    return {
        "ticker": ticker,
        "company_name": company,
        "bull_case": bull_case,
        "bear_case": bear_case,
        "key_risks": risks,
        "investment_thesis": investment_thesis,
        "conviction": conviction,
        "evidence_refs": evidence_refs,
    }


def _syn_memo(payload: dict) -> dict:
    rankings = payload.get("rankings", [])
    theses = {t["ticker"]: t for t in payload.get("theses", [])}
    weights = {w["ticker"]: w["weight"] for w in payload.get("allocations", [])}
    risks = {r["ticker"]: r for r in payload.get("risk_reviews", [])}
    snap = payload.get("snapshot", {})
    as_of = payload.get("as_of")

    entries = []
    top_buy = None
    # Only build full memo entries for rows with a thesis (i.e. inside the
    # reasoning slice). The reporter renders the rest as a compact tail.
    for row in rankings:
        tk = row["ticker"]
        if tk not in theses:
            continue
        thesis = theses[tk]
        rating = row["rating"]
        score = row["signal_score"]
        weight = float(weights.get(tk, 0.0))
        if rating == "BUY" and weight > 0:
            decision = (
                f"Paper trade position approved at {weight * 100:.1f} percent portfolio allocation."
            )
        elif rating == "BUY":
            decision = "Buy-rated but capacity is full this cycle. Watchlist."
        elif rating == "HOLD":
            decision = "Hold-rated. No action this cycle."
        else:
            decision = "Avoid-rated. Excluded from the portfolio."
        risk_notes = []
        rev = risks.get(tk)
        if rev:
            if rev.get("flags"):
                risk_notes.append("Flags: " + ", ".join(rev["flags"]))
            risk_notes.extend(rev.get("notes", []))
        entry = {
            "rank": row["rank"],
            "ticker": tk,
            "rating": rating,
            "signal_score": score,
            "allocation_pct": weight,
            "decision": decision,
            "bull_case": thesis.get("bull_case", ""),
            "bear_case": thesis.get("bear_case", ""),
            "risk_notes": risk_notes,
        }
        entries.append(entry)
        if top_buy is None and rating == "BUY":
            top_buy = entry

    n_buy = sum(1 for r in rankings if r["rating"] == "BUY")
    n_hold = sum(1 for r in rankings if r["rating"] == "HOLD")
    headline = (
        f"{n_buy} BUY-rated, {n_hold} HOLD-rated this week"
        + (f"; top conviction is {top_buy['ticker']} ({top_buy['signal_score']:.0f}/100)." if top_buy else ".")
    )

    snap_md = (
        f"- Cash: **{snap.get('cash_pct', 0) * 100:.1f}%**  \n"
        f"- Top single-name weight: **{snap.get('concentration_pct_top', 0) * 100:.1f}%**  \n"
        f"- Portfolio volatility (proxy): **{snap.get('portfolio_volatility', 0) * 100:.1f}%**  \n"
    )

    closing = (
        "Memo produced by the multi-agent investment research engine. The "
        "LangChain layer retrieved evidence per name and reasoned over it; "
        "the quantitative pipeline produced the numeric signal scores and "
        "risk caps. This is a research simulation, not investment advice."
    )

    return {
        "as_of": as_of,
        "headline": headline,
        "top_pick_ticker": top_buy["ticker"] if top_buy else None,
        "top_pick_summary": (
            f"{top_buy['ticker']} — score {top_buy['signal_score']:.0f}/100. {top_buy['bull_case'][:280]}"
            if top_buy
            else None
        ),
        "portfolio_snapshot_md": snap_md,
        "entries": entries,
        "closing_note": closing,
    }


def _signal_subtype(signal_type: str) -> str:
    """News docs use 'news::earnings'; alt docs use raw 'hiring_spike'."""
    s = (signal_type or "").lower()
    return s.split("::", 1)[-1] if "::" in s else s


# Ranked GTM utility - alt-data signals come first because they precede
# news flow; high-impact news event types come next; "color" is last
# because it's just generic market chatter.
GTM_TYPE_PRIORITY = [
    "hiring_spike",
    "infrastructure_expansion",
    "product_launch",
    "funding_announcement",
    "permit_activity",
    "app_review_surge",
    "web_traffic_spike",
    "partnership",
    "earnings",
    "guidance",
    "regulatory",
    "analyst",
    "macro",
    "color",
]


PERSONA_BY_TYPE = {
    "hiring_spike": "Head of Engineering",
    "infrastructure_expansion": "VP Infrastructure",
    "product_launch": "Head of Product",
    "funding_announcement": "CFO",
    "permit_activity": "VP Real Estate",
    "app_review_surge": "Head of Product",
    "web_traffic_spike": "VP Growth",
    "partnership": "Head of BD",
    "earnings": "CFO",
    "guidance": "CFO",
    "regulatory": "General Counsel",
    "analyst": "Head of Investor Relations",
    "macro": "Head of Strategy",
    "color": "Head of Strategy",
}


PAIN_BY_TYPE = {
    "hiring_spike":
        "{c} is staffing aggressively, which usually means tooling, onboarding, "
        "and platform spend is about to spike.",
    "infrastructure_expansion":
        "{c} is scaling capacity - cost-of-infra, reliability, and supply-chain "
        "leverage are top of mind right now.",
    "product_launch":
        "{c} just shipped - they're focused on adoption, monitoring, and "
        "post-launch fires for the next 60 days.",
    "funding_announcement":
        "{c} just raised - the team has explicit budget pressure to convert "
        "the round into measurable outcomes this quarter.",
    "permit_activity":
        "{c} is expanding physical footprint - construction, security, and ops "
        "budgets are open and time-boxed.",
    "app_review_surge":
        "{c}'s consumer surface is moving - product and CX teams are watching "
        "every release for retention impact.",
    "web_traffic_spike":
        "{c}'s top-of-funnel is moving fast - marketing and ops are both "
        "looking for ways to convert without breaking unit economics.",
    "partnership":
        "{c} is taking on integration risk and looking for ways to make the "
        "partnership pay off fast.",
    "earnings":
        "{c} just reported - whatever was missed will be the operational "
        "priority for the next 90 days.",
    "guidance":
        "{c} just reset guidance - the leadership team is building the playbook "
        "to defend or rebuild the number.",
    "regulatory":
        "{c} is operating under fresh regulatory scrutiny - GC, security, and "
        "compliance are reviewing every contract.",
    "analyst":
        "{c} is in the spotlight after analyst coverage - IR and FP&A are "
        "tightening the narrative for the next print.",
    "color":
        "{c}'s headlines are moving - leadership wants to know what's signal vs noise.",
    "macro":
        "{c} is rebalancing in response to the macro backdrop - capital "
        "allocation decisions are open this quarter.",
}


def _syn_outbound(payload: dict) -> dict:
    ticker = payload.get("ticker", "UNK")
    company = payload.get("company_name") or ticker
    evidence = payload.get("evidence", [])
    insight = payload.get("insight", {})
    score = payload.get("signal_score", 50.0)

    # Score each evidence item by GTM-priority and similarity, pick the best.
    best = None
    best_rank = float("inf")
    for e in evidence:
        sub = _signal_subtype(e.get("signal_type", ""))
        if sub == "fundamentals" or sub == "company_description":
            continue
        try:
            rank = GTM_TYPE_PRIORITY.index(sub)
        except ValueError:
            rank = len(GTM_TYPE_PRIORITY)
        # Prefer higher-priority types; break ties by similarity.
        sim = float(e.get("similarity") or 0.0)
        score_e = rank * 1000 - sim    # lower is better
        if score_e < best_rank:
            best_rank = score_e
            best = (sub, e)

    if best is None:
        signal_subtype = "color"
        trigger_evidence = ""
        trigger_text = (
            f"{company}'s composite signal score of {score:.0f}/100 this cycle"
        )
    else:
        signal_subtype, ev = best
        trigger_evidence = (ev.get("text") or "").strip()
        # Strip the leading "[NEWS][type] TKR (date): " prefix if present.
        clean = re.sub(r"^\[[A-Z_]+\](\[[a-z_]+\])?\s*[A-Z]+\s*\([^)]+\):\s*",
                       "", trigger_evidence)
        trigger_text = (
            f"{signal_subtype.replace('_', ' ')} — {clean[:200]}"
            if clean
            else f"{signal_subtype.replace('_', ' ')} — {trigger_evidence[:200]}"
        )

    persona = PERSONA_BY_TYPE.get(signal_subtype, "Head of Strategy")
    pain = PAIN_BY_TYPE.get(
        signal_subtype,
        f"{company}'s recent signal is reshaping team priorities this quarter.",
    ).format(c=company)

    opener_event = signal_subtype.replace("_", " ")
    quote = (
        re.sub(r"^\[[A-Z_]+\](\[[a-z_]+\])?\s*[A-Z]+\s*\([^)]+\):\s*",
               "", trigger_evidence)[:120]
        if trigger_evidence
        else ""
    )
    opener = (
        f"Saw the {opener_event} signal on {company}"
        + (f" — \"{quote}\"" if quote else "")
        + f". When that lands, the {persona.lower()} usually has 60-90 days to "
        + "show measurable progress. Worth a 15-minute look at how peers handled it?"
    )
    follow_up = (
        f"No worries if timing's off. We tracked three other {opener_event} "
        f"events at comparable companies in the last 90 days - happy to share "
        "the playbooks that worked."
    )
    confidence = (
        "high" if (insight.get("qualitative_score") or 0) >= 0.65 and best is not None
        else "medium" if best is not None
        else "low"
    )

    return {
        "ticker": ticker,
        "company_name": company,
        "trigger_signal": trigger_text,
        "persona": persona,
        "pain_hypothesis": pain,
        "opener": opener,
        "follow_up": follow_up,
        "confidence": confidence,
    }


_SYNTHESIZERS = {
    "SIGNAL_INSIGHT": _syn_signal_insight,
    "THESIS": _syn_thesis,
    "MEMO": _syn_memo,
    "OUTBOUND": _syn_outbound,
}


class OfflineReasoningChatModel(BaseChatModel):
    """Deterministic offline `BaseChatModel` for tests and no-key demos.

    Routes on a `<<TASK::NAME>>` marker found in the system prompt.
    Reads the latest human message as JSON-encoded inputs.
    Returns valid JSON conforming to the corresponding pydantic schema.
    """

    @property
    def _llm_type(self) -> str:
        return "offline-reasoning"

    def _generate(
        self,
        messages: Sequence[BaseMessage],
        stop: Optional[list[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> ChatResult:
        task = _extract_task(messages)
        payload = _extract_payload(messages)
        synth = _SYNTHESIZERS.get(task)
        if synth is None:
            text = (
                "Offline reasoning model: no synthesizer for task "
                f"{task!r}. Configure OPENAI_API_KEY to use a hosted LLM."
            )
            content = json.dumps({"task": task, "note": text})
        else:
            content = json.dumps(synth(payload), default=str)
        msg = AIMessage(content=content)
        return ChatResult(generations=[ChatGeneration(message=msg)])


# ---------------------------------------------------------------------------
# Factories
# ---------------------------------------------------------------------------


def build_chat_model() -> tuple[BaseChatModel, ProviderInfo]:
    """Return a `(chat_model, provider_info)` pair.

    Selection rules:
    1. If `OPENAI_API_KEY` is set and `langchain-openai` is importable,
       return ChatOpenAI with `gpt-4o-mini` (or `LLM_MODEL` env).
    2. Otherwise use the deterministic offline model.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from langchain_openai import ChatOpenAI

            model_name = os.environ.get("LLM_MODEL", "gpt-4o-mini")
            return (
                ChatOpenAI(model=model_name, temperature=0.2),
                ProviderInfo(model_name, "openai-text-embedding-3-small", False),
            )
        except ImportError:
            pass    # Fall through to offline.
    return (
        OfflineReasoningChatModel(),
        ProviderInfo("offline-reasoning", "hashing-bow", True),
    )


def build_embeddings() -> Embeddings:
    """Return an `Embeddings` provider.

    Hosted OpenAI embeddings if key + package are available, otherwise the
    offline hashing embedding so the rest of the pipeline still runs.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key:
        try:
            from langchain_openai import OpenAIEmbeddings

            return OpenAIEmbeddings(
                model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
            )
        except ImportError:
            pass
    return HashingEmbeddings()
