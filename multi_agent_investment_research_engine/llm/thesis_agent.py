"""LangChain ThesisAgent: bull case, bear case, key risks, conviction.

Replaces the older template-only ThesisAgent. The LLM receives:
* the SignalInsight (output of SignalReasoningAgent),
* the retrieved evidence,
* the quantitative composite signal score,
* the FundamentalsAgent snapshot,
* and the RiskAgent flags.

Output is parsed into an `InvestmentThesis`. Evidence references are
returned alongside the prose so the memo can cite them.
"""

from __future__ import annotations

import json
from typing import Iterable, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import Runnable

from .prompts import THESIS_PROMPT
from .schemas import EvidenceItem, InvestmentThesis, SignalInsight
from ..agents.base_agent import BaseAgent


class LangChainThesisAgent(BaseAgent):
    name = "ThesisAgent"
    description = (
        "Generates bull case, bear case, key risks, and the core "
        "investment thesis using the SignalInsight + retrieved evidence + "
        "fundamentals + risk flags."
    )

    def __init__(self, chat_model: BaseChatModel, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.parser: PydanticOutputParser[InvestmentThesis] = PydanticOutputParser(
            pydantic_object=InvestmentThesis
        )
        self.chain: Runnable = THESIS_PROMPT | chat_model | self.parser

    def run(
        self,
        ticker: str,
        insight: SignalInsight,
        evidence: Iterable[EvidenceItem],
        signal_score: float,
        fundamentals: dict | None = None,
        risk_flags: Optional[list[str]] = None,
        company_name: Optional[str] = None,
    ) -> InvestmentThesis:
        payload = {
            "ticker": ticker,
            "company_name": company_name or ticker,
            "signal_score": signal_score,
            "insight": insight.model_dump(),
            "evidence": [e.model_dump() for e in evidence],
            "fundamentals": fundamentals or {},
            "risk_flags": list(risk_flags or []),
        }
        result = self.chain.invoke({"ticker": ticker, "payload": json.dumps(payload, default=str)})
        self.log(f"  {ticker}: conviction={result.conviction}")
        return result
