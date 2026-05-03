"""Chroma vector store: ingest signal evidence and serve retrieval.

`build_evidence_documents` reads the three mock CSVs (news / alt-data /
fundamentals) plus the company-descriptions CSV and turns each row into a
LangChain `Document` with rich metadata: ticker, company_name,
signal_type, date, source, confidence_score.

`VectorStore.ingest()` (idempotent) embeds and persists those documents to
a local Chroma index in `data/chroma/`. Subsequent queries via
`similarity_search` return `Document`s plus distances; the
`ResearchRetrievalAgent` wraps that into typed `EvidenceItem`s.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd
from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings


# ---------------------------------------------------------------------------
# Document construction
# ---------------------------------------------------------------------------


def _doc_id(prefix: str, *parts: str) -> str:
    return prefix + ":" + "::".join(p.replace(":", "_") for p in parts)


def _news_documents(news_csv: Path) -> list[Document]:
    df = pd.read_csv(news_csv)
    df["date"] = pd.to_datetime(df["date"])
    docs: list[Document] = []
    for i, row in df.iterrows():
        docs.append(
            Document(
                id=_doc_id("news", str(row["ticker"]), str(row["date"].date()), str(i)),
                page_content=(
                    f"[NEWS][{row['event_type']}] {row['ticker']} "
                    f"({row['date'].date()}): {row['headline']}"
                ),
                metadata={
                    "ticker": str(row["ticker"]).upper(),
                    "signal_type": f"news::{row['event_type']}",
                    "date": str(row["date"].date()),
                    "source": "mock_news",
                    "confidence_score": 0.7
                    if str(row.get("sentiment_hint", "")).lower() in {"pos", "neg"}
                    else 0.5,
                    "headline": str(row["headline"]),
                    "event_type": str(row["event_type"]),
                    "doc_kind": "news",
                },
            )
        )
    return docs


def _alt_documents(alt_csv: Path) -> list[Document]:
    df = pd.read_csv(alt_csv)
    df["date"] = pd.to_datetime(df["date"])
    docs: list[Document] = []
    for i, row in df.iterrows():
        docs.append(
            Document(
                id=_doc_id("alt", str(row["ticker"]), str(row["date"].date()), str(i)),
                page_content=(
                    f"[ALT][{row['signal_type']}] {row['ticker']} "
                    f"({row['date'].date()}): {row['description']} "
                    f"(strength={float(row['signal_strength']):.2f})"
                ),
                metadata={
                    "ticker": str(row["ticker"]).upper(),
                    "signal_type": str(row["signal_type"]),
                    "date": str(row["date"].date()),
                    "source": "mock_alt_data",
                    "confidence_score": float(row["signal_strength"]),
                    "description": str(row["description"]),
                    "doc_kind": "alt_data",
                },
            )
        )
    return docs


def _fundamentals_documents(fund_csv: Path) -> list[Document]:
    df = pd.read_csv(fund_csv)
    docs: list[Document] = []
    today = datetime.utcnow().date().isoformat()
    for _, row in df.iterrows():
        bits = []
        for col, label in (
            ("revenue_growth_yoy", "rev growth"),
            ("gross_margin", "gross margin"),
            ("operating_margin", "op margin"),
            ("net_margin", "net margin"),
            ("pe_ratio", "P/E"),
            ("ps_ratio", "P/S"),
            ("return_on_equity", "ROE"),
        ):
            v = row.get(col)
            if pd.notna(v):
                if col in {"pe_ratio", "ps_ratio"}:
                    bits.append(f"{label} {v:.1f}x")
                else:
                    bits.append(f"{label} {float(v) * 100:+.0f}%")
        text = (
            f"[FUNDAMENTALS] {row['ticker']}: " + ", ".join(bits)
            if bits
            else f"[FUNDAMENTALS] {row['ticker']}: (no data)"
        )
        docs.append(
            Document(
                id=_doc_id("fund", str(row["ticker"]), today),
                page_content=text,
                metadata={
                    "ticker": str(row["ticker"]).upper(),
                    "signal_type": "fundamentals",
                    "date": today,
                    "source": "mock_fundamentals",
                    "confidence_score": 0.8,
                    "doc_kind": "fundamentals",
                },
            )
        )
    return docs


def _company_documents(desc_csv: Path) -> list[Document]:
    df = pd.read_csv(desc_csv)
    docs: list[Document] = []
    today = datetime.utcnow().date().isoformat()
    for _, row in df.iterrows():
        docs.append(
            Document(
                id=_doc_id("desc", str(row["ticker"])),
                page_content=(
                    f"[PROFILE] {row['ticker']} ({row['company_name']}): "
                    f"{row['description']}"
                ),
                metadata={
                    "ticker": str(row["ticker"]).upper(),
                    "company_name": str(row["company_name"]),
                    "signal_type": "company_description",
                    "date": today,
                    "source": "mock_company_descriptions",
                    "confidence_score": 0.9,
                    "doc_kind": "description",
                },
            )
        )
    return docs


def build_evidence_documents(
    data_dir: Path,
    universe: Iterable[str] | None = None,
) -> list[Document]:
    """Build the full set of LangChain documents for ingest.

    Args:
        data_dir: directory that holds `mock_*.csv` files.
        universe: optional ticker filter.
    """
    data_dir = Path(data_dir)
    docs: list[Document] = []
    docs.extend(_news_documents(data_dir / "mock_news_events.csv"))
    docs.extend(_alt_documents(data_dir / "mock_alternative_data.csv"))
    docs.extend(_fundamentals_documents(data_dir / "mock_fundamentals.csv"))
    desc_path = data_dir / "mock_company_descriptions.csv"
    if desc_path.exists():
        docs.extend(_company_documents(desc_path))
    if universe:
        keep = {t.upper() for t in universe}
        docs = [d for d in docs if d.metadata.get("ticker") in keep]
    return docs


# ---------------------------------------------------------------------------
# Wrapper around langchain_chroma.Chroma
# ---------------------------------------------------------------------------


class VectorStore:
    """Thin wrapper over `langchain_chroma.Chroma` with an idempotent ingest."""

    def __init__(
        self,
        persist_dir: Path,
        embeddings: Embeddings,
        collection_name: str = "signal_evidence",
    ) -> None:
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self._chroma = Chroma(
            collection_name=collection_name,
            embedding_function=embeddings,
            persist_directory=str(self.persist_dir),
        )

    @property
    def chroma(self) -> Chroma:
        return self._chroma

    def count(self) -> int:
        try:
            return self._chroma._collection.count()    # type: ignore[attr-defined]
        except Exception:    # pragma: no cover - chroma internals
            return 0

    def ingest(self, documents: list[Document]) -> int:
        """Add documents, replacing existing ones with the same id."""
        if not documents:
            return 0
        ids = [d.id for d in documents]
        # Delete-then-add gives idempotent ingest without a separate "exists" call.
        try:
            self._chroma.delete(ids=ids)
        except Exception:    # pragma: no cover - empty collection edge case
            pass
        self._chroma.add_documents(documents, ids=ids)
        return len(documents)

    def search(
        self,
        query: str,
        k: int = 6,
        ticker: Optional[str] = None,
        signal_kinds: Optional[list[str]] = None,
    ) -> list[tuple[Document, float]]:
        """Similarity search with optional metadata filters.

        `signal_kinds` is matched against the `doc_kind` metadata field
        (news / alt_data / fundamentals / description).
        """
        where: dict | None = None
        clauses: list[dict] = []
        if ticker:
            clauses.append({"ticker": ticker.upper()})
        if signal_kinds:
            clauses.append({"doc_kind": {"$in": signal_kinds}})
        if len(clauses) == 1:
            where = clauses[0]
        elif len(clauses) > 1:
            where = {"$and": clauses}
        return self._chroma.similarity_search_with_score(query, k=k, filter=where)
