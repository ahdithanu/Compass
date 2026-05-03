"""ResearchRetrievalAgent: pulls relevant signal evidence per ticker.

This is the first reasoning hop: given a ticker (or a free-text query),
rank evidence documents from Chroma and return them as typed
`EvidenceItem`s. Every downstream LLM agent consumes this output.

There is no LLM call inside this agent - retrieval is pure vector
search. We still expose it as a LangChain "agent" so it composes with
the rest of the layer and gets logged uniformly.
"""

from __future__ import annotations

from typing import Iterable, Optional

from langchain_core.documents import Document

from .schemas import EvidenceItem
from .vector_store import VectorStore
from ..agents.base_agent import BaseAgent


def _to_item(doc: Document, distance: float) -> EvidenceItem:
    md = doc.metadata or {}
    # Chroma returns a distance (lower = closer). Convert to a 0-1 similarity.
    sim = float(max(0.0, 1.0 - distance))
    return EvidenceItem(
        text=doc.page_content,
        ticker=md.get("ticker", "UNK"),
        company_name=md.get("company_name"),
        signal_type=md.get("signal_type", "unknown"),
        date=md.get("date"),
        source=md.get("source", "mock"),
        confidence_score=float(md.get("confidence_score", 0.5)),
        similarity=sim,
    )


class ResearchRetrievalAgent(BaseAgent):
    name = "ResearchRetrievalAgent"
    description = (
        "Vector-search Chroma for the most relevant signal evidence per "
        "company. Returns typed EvidenceItem objects with similarity + "
        "metadata."
    )

    def __init__(self, store: VectorStore, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.store = store

    def for_ticker(
        self,
        ticker: str,
        k: int = 6,
        signal_kinds: Optional[list[str]] = None,
        query: Optional[str] = None,
    ) -> list[EvidenceItem]:
        """Retrieve top-k evidence for one ticker.

        `query`: optional free-text query. If omitted, the ticker symbol is
        used; the metadata filter ensures we only pull this ticker's docs.
        """
        q = query or f"{ticker} signal evidence"
        results = self.store.search(
            q, k=k, ticker=ticker.upper(), signal_kinds=signal_kinds
        )
        items = [_to_item(d, dist) for d, dist in results]
        self.log(
            f"  {ticker}: retrieved {len(items)} evidence items"
            + (f" (kinds={signal_kinds})" if signal_kinds else "")
        )
        return items

    def for_universe(
        self,
        tickers: Iterable[str],
        k: int = 6,
    ) -> dict[str, list[EvidenceItem]]:
        out: dict[str, list[EvidenceItem]] = {}
        for t in tickers:
            out[t] = self.for_ticker(t, k=k)
        return out

    def run(self, ticker: str, k: int = 6) -> list[EvidenceItem]:
        return self.for_ticker(ticker=ticker, k=k)
