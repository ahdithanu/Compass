"""LangChain ChatPromptTemplates for each reasoning agent.

Every prompt:
* Tags the system message with a `<<TASK::NAME>>` marker so the offline
  reasoning model can dispatch deterministically. A hosted LLM treats the
  marker as harmless extra context.
* Embeds inputs as a single JSON object in the human message, so a real
  LLM and the offline synthesizer can both parse the same payload.
* Pairs with a `PydanticOutputParser` so the response is type-checked
  before agents downstream consume it.
"""

from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

from .schemas import (
    InvestmentMemo,
    InvestmentThesis,
    OutboundAngle,
    SignalInsight,
)


# ---------------------------------------------------------------------------
# Helper: wrap a system instruction with the task marker.
# ---------------------------------------------------------------------------


def _system_prompt(task: str, role: str, schema_class) -> str:
    """Return a system message string carrying the task marker + schema docs.

    The schema doc string is emitted so a hosted LLM can produce valid JSON.
    The offline model uses the task marker, not the schema doc.
    """
    schema_json = schema_class.model_json_schema()
    fields = ", ".join(schema_json.get("properties", {}).keys())
    return (
        f"<<TASK::{task}>>\n"
        f"You are the {role}. Respond ONLY with a single JSON object that "
        f"strictly matches the {schema_class.__name__} schema. Do not "
        f"include markdown fences. Required fields: {fields}."
    )


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------


SIGNAL_REASONING_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _system_prompt(
            "SIGNAL_INSIGHT",
            "SignalReasoningAgent in a multi-agent investment research engine",
            SignalInsight,
        )),
        (
            "human",
            (
                "Analyze the retrieved evidence for {ticker} and produce a "
                "SignalInsight. Combine the qualitative reading of the evidence "
                "with the quantitative pillar scores. Inputs:\n{payload}"
            ),
        ),
    ]
)


THESIS_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _system_prompt(
            "THESIS",
            "ThesisAgent in a multi-agent investment research engine",
            InvestmentThesis,
        )),
        (
            "human",
            (
                "Write the investment thesis for {ticker}. Use the signal "
                "insight + retrieved evidence + risk flags. Inputs:\n{payload}"
            ),
        ),
    ]
)


MEMO_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _system_prompt(
            "MEMO",
            "MemoAgent in a multi-agent investment research engine",
            InvestmentMemo,
        )),
        (
            "human",
            (
                "Compose this week's investment memo. The portfolio is "
                "paper-traded only. Inputs (rankings + theses + risk reviews "
                "+ allocations + portfolio snapshot):\n{payload}"
            ),
        ),
    ]
)


OUTBOUND_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _system_prompt(
            "OUTBOUND",
            "OutboundAngleAgent that converts the same signals into GTM angles",
            OutboundAngle,
        )),
        (
            "human",
            (
                "For {ticker}, propose a sales / GTM outbound angle that the "
                "same signal evidence justifies. Be specific about the trigger "
                "and persona. Inputs:\n{payload}"
            ),
        ),
    ]
)
