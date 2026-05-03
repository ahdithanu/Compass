"""NewsAgent: scores news/event impact per ticker.

Each event row carries a headline, an event_type, and a sentiment_hint.
We compute:
* sentiment_score    - lexicon scoring of the headline, plus the hint
* impact_score       - importance of the event_type (regulatory > color)
* recency-weighted aggregation per ticker

Scoring stays simple and lexicon-based on purpose. The point of this agent
is to *demonstrate the seam* where a stronger NLP backend would slot in
later (e.g. a finetuned classifier or a hosted LLM-as-classifier).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from .base_agent import BaseAgent


POSITIVE_WORDS = {
    "beat", "beats", "record", "growth", "surge", "surges", "rally",
    "upgrade", "upgraded", "outperform", "strong", "expansion", "expand",
    "wins", "approval", "approved", "exceed", "exceeds", "raise", "raises",
    "bullish", "innovative", "breakthrough", "soars", "soar", "jump",
    "profitable", "profits", "buyback", "partnership", "demand",
}
NEGATIVE_WORDS = {
    "miss", "misses", "weak", "decline", "declines", "drop", "drops",
    "downgrade", "downgraded", "underperform", "lawsuit", "investigation",
    "fraud", "warning", "cuts", "cut", "loss", "losses", "bearish",
    "recall", "delay", "delayed", "fines", "fine", "scandal", "concerns",
    "slowdown", "halts", "halt", "probe", "breach", "outage",
}

# Event-type weights: how impactful is each kind of event regardless of tone.
EVENT_TYPE_WEIGHT: dict[str, float] = {
    "earnings": 1.00,
    "guidance": 0.90,
    "regulatory": 0.85,
    "product_launch": 0.70,
    "partnership": 0.60,
    "analyst": 0.55,
    "macro": 0.45,
    "color": 0.30,    # generic market color, low impact
}


def headline_sentiment(text: str) -> float:
    """Lexicon score in [-1, 1]; 0 if no hits."""
    if not isinstance(text, str) or not text:
        return 0.0
    tokens = [t.strip(".,!?:;\"'()").lower() for t in text.split()]
    pos = sum(1 for t in tokens if t in POSITIVE_WORDS)
    neg = sum(1 for t in tokens if t in NEGATIVE_WORDS)
    total = pos + neg
    if total == 0:
        return 0.0
    return (pos - neg) / total


class NewsAgent(BaseAgent):
    name = "NewsAgent"
    description = (
        "Reads news/events for each ticker and produces a sentiment score, "
        "an event-impact score, and a recency-weighted news score."
    )

    def __init__(
        self,
        csv_path: Path,
        recency_halflife_days: int = 5,
        verbose: bool = True,
    ) -> None:
        super().__init__(verbose=verbose)
        self.csv_path = Path(csv_path)
        self.halflife = recency_halflife_days

    def _load(self) -> pd.DataFrame:
        df = pd.read_csv(self.csv_path)
        df["date"] = pd.to_datetime(df["date"])
        df["ticker"] = df["ticker"].str.upper()

        df["sentiment_score"] = df["headline"].apply(headline_sentiment)
        if "sentiment_hint" in df.columns:
            mask = df["sentiment_score"] == 0
            hint = (
                df.loc[mask, "sentiment_hint"]
                .astype(str)
                .str.lower()
                .map({"pos": 0.5, "neg": -0.5, "neu": 0.0})
                .fillna(0.0)
            )
            df.loc[mask, "sentiment_score"] = hint

        df["event_weight"] = (
            df["event_type"].astype(str).str.lower().map(EVENT_TYPE_WEIGHT).fillna(0.4)
        )
        df["impact_score"] = df["sentiment_score"].abs() * df["event_weight"]
        return df

    def run(self, tickers: Iterable[str], as_of: pd.Timestamp | None = None) -> dict:
        tickers = [t.upper() for t in tickers]
        if as_of is None:
            as_of = pd.Timestamp(datetime.utcnow().date())
        as_of = pd.Timestamp(as_of).tz_localize(None)

        self.log(f"Loading events from {self.csv_path}")
        df = self._load()
        self.log(f"  parsed {len(df)} event rows")

        # Recency weight: w = 0.5 ** (age_days / halflife). Future-dated rows
        # are clipped to age 0 (i.e. weight 1).
        ages = (as_of - df["date"]).dt.days.clip(lower=0)
        df["recency_weight"] = 0.5 ** (ages / max(1, self.halflife))

        per_ticker_rows = []
        for t in tickers:
            sub = df[df["ticker"] == t]
            if sub.empty:
                per_ticker_rows.append(
                    {
                        "ticker": t,
                        "n_events": 0,
                        "avg_sentiment": 0.0,
                        "avg_impact": 0.0,
                        "weighted_sentiment": 0.0,
                        "news_score": 0.5,    # neutral when there is no news
                    }
                )
                continue
            w = sub["recency_weight"]
            wsum = float(w.sum())
            avg_sent = float((sub["sentiment_score"] * w).sum() / wsum) if wsum > 0 else 0.0
            avg_imp = float((sub["impact_score"] * w).sum() / wsum) if wsum > 0 else 0.0
            # Map weighted sentiment in [-1, 1] -> [0, 1], then bias by impact:
            # high-impact events pull the score further from neutral 0.5.
            base = (avg_sent + 1.0) / 2.0
            news_score = float(np.clip(0.5 + (base - 0.5) * (0.5 + avg_imp), 0.0, 1.0))
            per_ticker_rows.append(
                {
                    "ticker": t,
                    "n_events": int(len(sub)),
                    "avg_sentiment": avg_sent,
                    "avg_impact": avg_imp,
                    "weighted_sentiment": float((sub["sentiment_score"] * w).sum()),
                    "news_score": news_score,
                }
            )

        feat = pd.DataFrame(per_ticker_rows).set_index("ticker")
        self.log(
            "News scores: "
            + ", ".join(f"{t}={v:.2f}" for t, v in feat["news_score"].items())
        )
        return {"events": df, "features": feat}
