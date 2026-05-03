"""MemoAgent: composes the weekly investment memo as structured output.

Receives:
* the ranked list (CompanyRanking entries with rating + signal_score),
* per-ticker theses,
* per-ticker risk reviews,
* allocations,
* a portfolio snapshot.

Returns an `InvestmentMemo`. The ReportingAgent serializes that to
markdown - the LLM never has to know about formatting.
"""

from __future__ import annotations

import json
from typing import Iterable

from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.runnables import Runnable

from .prompts import MEMO_PROMPT
from .schemas import (
    CompanyRanking,
    InvestmentMemo,
    InvestmentThesis,
)
from ..agents.base_agent import BaseAgent


class MemoAgent(BaseAgent):
    name = "MemoAgent"
    description = (
        "Composes the weekly investment memo from rankings, theses, and "
        "risk reviews. Output is a typed InvestmentMemo."
    )

    def __init__(self, chat_model: BaseChatModel, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.parser: PydanticOutputParser[InvestmentMemo] = PydanticOutputParser(
            pydantic_object=InvestmentMemo
        )
        self.chain: Runnable = MEMO_PROMPT | chat_model | self.parser

    def run(
        self,
        as_of: str,
        rankings: Iterable[CompanyRanking],
        theses: dict[str, InvestmentThesis],
        risk_reviews: list[dict],
        allocations: dict[str, float],
        portfolio_snapshot: dict,
    ) -> InvestmentMemo:
        payload = {
            "as_of": as_of,
            "rankings": [r.model_dump() for r in rankings],
            "theses": [t.model_dump() for t in theses.values()],
            "allocations": [
                {"ticker": k, "weight": float(v)} for k, v in allocations.items()
            ],
            "risk_reviews": risk_reviews,
            "snapshot": portfolio_snapshot,
        }
        result = self.chain.invoke({"payload": json.dumps(payload, default=str)})
        self.log(
            f"Memo composed: {result.headline}"
        )
        return result
