"""SignalReasoningAgent: turns retrieved evidence into structured insights.

Composes a LangChain chain:
    SIGNAL_REASONING_PROMPT | chat_model | PydanticOutputParser(SignalInsight)

The agent feeds the prompt:
* the ticker,
* the per-pillar quantitative scores from the upstream pipeline, and
* the JSON-serialized evidence retrieved from Chroma.

The hosted-LLM path produces a real qualitative read; the offline-model
path produces a deterministic synthesized read using the same template
logic. Either way the result is parsed into a `SignalInsight`.
"""

from __future__ import annotations

import json
from typing import Iterable

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import Runnable

from .prompts import SIGNAL_REASONING_PROMPT
from .schemas import EvidenceItem, SignalInsight
from ..agents.base_agent import BaseAgent


class SignalReasoningAgent(BaseAgent):
    name = "SignalReasoningAgent"
    description = (
        "Reads retrieved signal evidence + quantitative pillar scores, "
        "writes a structured SignalInsight (bull / bear bullets, "
        "qualitative score, rationale)."
    )

    def __init__(self, chat_model: BaseChatModel, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.parser: PydanticOutputParser[SignalInsight] = PydanticOutputParser(
            pydantic_object=SignalInsight
        )
        self.chain: Runnable = SIGNAL_REASONING_PROMPT | chat_model | self.parser

    def run(
        self,
        ticker: str,
        evidence: Iterable[EvidenceItem],
        pillar_scores: dict | None = None,
    ) -> SignalInsight:
        ev_list = [e.model_dump() for e in evidence]
        payload = {
            "ticker": ticker,
            "evidence": ev_list,
            "market_score": (pillar_scores or {}).get("market_score", 0.5),
            "news_score": (pillar_scores or {}).get("news_score", 0.5),
            "fundamental_score": (pillar_scores or {}).get("fundamental_score", 0.5),
            "alt_score": (pillar_scores or {}).get("alt_score", 0.5),
        }
        result = self.chain.invoke({"ticker": ticker, "payload": json.dumps(payload)})
        self.log(
            f"  {ticker}: qualitative_score={result.qualitative_score:.2f} "
            f"({result.evidence_count} evidence items)"
        )
        return result
