"""AlternativeDataAgent: alt-data style signals (mock).

Represents real-world business pulse inputs an alpha team might license:
hiring spikes, product launches, permit / construction activity, app
review sentiment, web-traffic proxies. Each row carries a strength in
[0, 1] and a date; signals decay exponentially after their date so a
spike on Tuesday still elevates Wednesday-Friday.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from .base_agent import BaseAgent


# How "alpha" each signal type is, used as a multiplicative prior.
SIGNAL_TYPE_WEIGHT: dict[str, float] = {
    "hiring_spike": 0.85,
    "funding_announcement": 1.00,
    "product_launch": 0.90,
    "permit_activity": 0.65,
    "infrastructure_expansion": 0.80,
    "app_review_surge": 0.70,
    "web_traffic_spike": 0.75,
}

# Half-life in business days for impulse decay.
DECAY_HALFLIFE_DAYS = 7


class AlternativeDataAgent(BaseAgent):
    name = "AlternativeDataAgent"
    description = (
        "Loads alt-data signals (hiring, product launches, permits, app "
        "reviews, web traffic) and produces a recency-weighted alt_score "
        "per ticker."
    )

    def __init__(self, csv_path: Path, verbose: bool = True) -> None:
        super().__init__(verbose=verbose)
        self.csv_path = Path(csv_path)

    def run(
        self,
        tickers: Iterable[str],
        as_of: pd.Timestamp | None = None,
    ) -> dict:
        tickers = [t.upper() for t in tickers]
        if as_of is None:
            as_of = pd.Timestamp(datetime.utcnow().date())
        as_of = pd.Timestamp(as_of).tz_localize(None)

        self.log(f"Loading alt-data signals from {self.csv_path}")
        df = pd.read_csv(self.csv_path)
        df["date"] = pd.to_datetime(df["date"])
        df["ticker"] = df["ticker"].str.upper()

        df["type_weight"] = (
            df["signal_type"].astype(str).str.lower().map(SIGNAL_TYPE_WEIGHT).fillna(0.5)
        )
        df["weighted_strength"] = df["signal_strength"].astype(float) * df["type_weight"]

        ages = (as_of - df["date"]).dt.days.clip(lower=0)
        df["recency_weight"] = 0.5 ** (ages / max(1, DECAY_HALFLIFE_DAYS))
        df["impulse"] = df["weighted_strength"] * df["recency_weight"]

        rows = []
        for t in tickers:
            sub = df[df["ticker"] == t]
            if sub.empty:
                rows.append(
                    {
                        "ticker": t,
                        "n_signals": 0,
                        "alt_decayed": 0.0,
                        "alt_score": 0.5,    # neutral when nothing is on file
                    }
                )
                continue
            decayed = float(sub["impulse"].sum())
            rows.append(
                {
                    "ticker": t,
                    "n_signals": int(len(sub)),
                    "alt_decayed": decayed,
                    "alt_score": float(np.clip(decayed, 0.0, 1.0)),
                }
            )

        feat = pd.DataFrame(rows).set_index("ticker")

        # Re-normalize cross-sectionally so the *strongest* alt-signal cluster
        # in the universe maps to ~1.0 (and the weakest stays near 0).
        s = feat["alt_decayed"]
        if s.max() > s.min():
            feat["alt_score"] = ((s - s.min()) / (s.max() - s.min())).clip(0.0, 1.0)

        self.log(
            "Alt-data scores: "
            + ", ".join(f"{t}={v:.2f}" for t, v in feat["alt_score"].items())
        )

        return {"signals": df, "features": feat}
