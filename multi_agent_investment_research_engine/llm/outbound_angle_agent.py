"""OutboundAngleAgent: turns the same signals into a GTM angle.

The pitch of this project is that signal infrastructure is dual-use: an
investor sees a buy thesis, a sales / GTM team sees an outbound trigger.
This agent reads the same SignalInsight + retrieved evidence and emits a
structured `OutboundAngle` (trigger, persona, pain, opener, follow-up,
confidence).
"""

from __future__ import annotations

import json
from typing import Iterable, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import Runnable

from .prompts import OUTBOUND_PROMPT
from .schemas import EvidenceItem, OutboundAngle, SignalInsight
from ..agents.base_agent import BaseAgent


class OutboundAngleAgent(BaseAgent):
    name = "OutboundAngleAgent"
    description = (
        "Generates a GTM / outbound sales angle from the same signal "
        "evidence used for the investment thesis."
    )

    def __init__(self, chat_model: BaseChatModel, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.parser: PydanticOutputParser[OutboundAngle] = PydanticOutputParser(
            pydantic_object=OutboundAngle
        )
        self.chain: Runnable = OUTBOUND_PROMPT | chat_model | self.parser

    def run(
        self,
        ticker: str,
        insight: SignalInsight,
        evidence: Iterable[EvidenceItem],
        signal_score: float,
        company_name: Optional[str] = None,
    ) -> OutboundAngle:
        payload = {
            "ticker": ticker,
            "company_name": company_name or ticker,
            "signal_score": signal_score,
            "insight": insight.model_dump(),
            "evidence": [e.model_dump() for e in evidence],
        }
        result = self.chain.invoke({"ticker": ticker, "payload": json.dumps(payload, default=str)})
        self.log(f"  {ticker}: outbound angle ({result.confidence}) -> {result.persona}")
        return result
