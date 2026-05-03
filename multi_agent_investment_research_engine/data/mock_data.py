"""Generators for the three mock CSVs that the system reads.

Run this module directly to regenerate:
    python -m multi_agent_investment_research_engine.data.mock_data

`main.py` will also call `ensure_mock_data(...)` on startup and create the
files if they are missing, so a fresh clone of the repo can run end-to-end
without any manual setup.

The generated data is realistic in *shape* - sensible date distributions,
plausible event types per ticker, mix of positive and negative news - but
the underlying numbers are synthetic and should not be confused with live
fundamentals.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd


HEADLINES_POS = [
    "{tk} beats Q earnings, raises guidance",
    "Analysts upgrade {tk} on AI demand",
    "{tk} announces record buyback program",
    "{tk} wins major partnership for cloud expansion",
    "Strong product launch from {tk} drives bullish reaction",
    "{tk} margins expand on operating leverage",
    "{tk} signals breakthrough in enterprise segment",
    "Hiring surge at {tk} suggests aggressive expansion",
]

HEADLINES_NEG = [
    "{tk} misses revenue estimates, shares drop",
    "Regulator opens investigation into {tk}",
    "{tk} issues weak forward guidance",
    "{tk} faces lawsuit over data breach",
    "Analyst downgrades {tk} citing valuation concerns",
    "{tk} delays product launch, cuts outlook",
    "Slowdown concerns weigh on {tk}",
    "Outage at {tk} sparks reliability questions",
]

HEADLINES_NEU = [
    "{tk} files routine 10-Q with regulator",
    "{tk} CEO speaks at industry conference",
    "{tk} announces upcoming earnings date",
    "Analysts mixed on {tk} ahead of print",
]

EVENT_TYPES = ["earnings", "guidance", "regulatory", "product_launch",
               "partnership", "analyst", "macro", "color"]

ALT_SIGNAL_TYPES = [
    "hiring_spike",
    "funding_announcement",
    "product_launch",
    "permit_activity",
    "infrastructure_expansion",
    "app_review_surge",
    "web_traffic_spike",
]


# Per-ticker fundamentals snapshot used as a fallback when yfinance does
# not return fundamentals data. Numbers are coarse plausible values, not
# live data.
MOCK_FUNDAMENTALS: list[dict] = [
    {"ticker": "NVDA", "revenue_growth_yoy": 0.55, "gross_margin": 0.74,
     "operating_margin": 0.53, "net_margin": 0.48, "pe_ratio": 60.0,
     "ps_ratio": 25.0, "return_on_equity": 0.95},
    {"ticker": "MSFT", "revenue_growth_yoy": 0.13, "gross_margin": 0.69,
     "operating_margin": 0.43, "net_margin": 0.36, "pe_ratio": 33.0,
     "ps_ratio": 11.0, "return_on_equity": 0.40},
    {"ticker": "AMZN", "revenue_growth_yoy": 0.12, "gross_margin": 0.47,
     "operating_margin": 0.10, "net_margin": 0.08, "pe_ratio": 45.0,
     "ps_ratio": 3.5, "return_on_equity": 0.20},
    {"ticker": "META", "revenue_growth_yoy": 0.22, "gross_margin": 0.81,
     "operating_margin": 0.40, "net_margin": 0.34, "pe_ratio": 28.0,
     "ps_ratio": 9.0, "return_on_equity": 0.35},
    {"ticker": "TSLA", "revenue_growth_yoy": 0.05, "gross_margin": 0.18,
     "operating_margin": 0.07, "net_margin": 0.07, "pe_ratio": 70.0,
     "ps_ratio": 7.0, "return_on_equity": 0.18},
    {"ticker": "AMD", "revenue_growth_yoy": 0.20, "gross_margin": 0.50,
     "operating_margin": 0.10, "net_margin": 0.07, "pe_ratio": 80.0,
     "ps_ratio": 9.0, "return_on_equity": 0.07},
    {"ticker": "PLTR", "revenue_growth_yoy": 0.30, "gross_margin": 0.80,
     "operating_margin": 0.18, "net_margin": 0.15, "pe_ratio": 130.0,
     "ps_ratio": 35.0, "return_on_equity": 0.10},
    {"ticker": "CRWD", "revenue_growth_yoy": 0.30, "gross_margin": 0.78,
     "operating_margin": 0.20, "net_margin": 0.10, "pe_ratio": 95.0,
     "ps_ratio": 22.0, "return_on_equity": 0.20},
    {"ticker": "SNOW", "revenue_growth_yoy": 0.28, "gross_margin": 0.70,
     "operating_margin": -0.05, "net_margin": -0.10, "pe_ratio": float("nan"),
     "ps_ratio": 18.0, "return_on_equity": -0.10},
]


def _business_days(end: datetime, days_back: int) -> list[datetime]:
    return [
        d.to_pydatetime() for d in pd.bdate_range(
            end - timedelta(days=days_back * 2), end
        )[-days_back:]
    ]


# Per-ticker bias for mock generation: roughly mirrors the fundamentals
# tier so the demo memo lands on names that "deserve" their signal score.
# Higher = more positive news / more frequent + stronger alt signals.
TICKER_BIAS: dict[str, float] = {
    "NVDA": 0.85,
    "MSFT": 0.70,
    "META": 0.65,
    "CRWD": 0.65,
    "AMD": 0.55,
    "PLTR": 0.55,
    "AMZN": 0.45,
    "SNOW": 0.40,
    "TSLA": 0.30,
}


def generate_news_events(
    tickers: list[str],
    end: datetime | None = None,
    days_back: int = 365,
    events_per_ticker: int = 18,
    seed: int = 7,
) -> pd.DataFrame:
    rng = random.Random(seed)
    end = end or datetime.utcnow()
    rows = []
    bdays = _business_days(end, days_back)
    for tk in tickers:
        bias = TICKER_BIAS.get(tk, 0.50)
        # Probability-of-positive scales with bias; probability-of-negative
        # is the symmetric complement (with neutral fixed at 15%).
        p_pos = 0.20 + 0.60 * bias    # bias=0.85 -> 0.71; bias=0.30 -> 0.38
        p_neu = 0.15
        p_neg = max(0.0, 1.0 - p_pos - p_neu)
        for _ in range(events_per_ticker):
            d = rng.choice(bdays)
            roll = rng.random()
            if roll < p_pos:
                template = rng.choice(HEADLINES_POS)
                hint = "pos"
            elif roll < p_pos + p_neg:
                template = rng.choice(HEADLINES_NEG)
                hint = "neg"
            else:
                template = rng.choice(HEADLINES_NEU)
                hint = "neu"
            rows.append(
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "ticker": tk,
                    "headline": template.format(tk=tk),
                    "sentiment_hint": hint,
                    "event_type": rng.choices(
                        EVENT_TYPES,
                        weights=[5, 3, 2, 3, 3, 4, 1, 4],
                        k=1,
                    )[0],
                }
            )
    df = pd.DataFrame(rows)
    return df.sort_values(["ticker", "date"]).reset_index(drop=True)


def generate_alt_signals(
    tickers: list[str],
    end: datetime | None = None,
    days_back: int = 365,
    signals_per_ticker: int = 12,
    seed: int = 7,
) -> pd.DataFrame:
    rng = random.Random(seed)
    end = end or datetime.utcnow()
    rows = []
    bdays = _business_days(end, days_back)
    for tk in tickers:
        bias = TICKER_BIAS.get(tk, 0.50)
        # Higher-tier names get more signals AND those signals are stronger.
        # Recent-date probability also rises with bias so decay still pays.
        n_signals = max(4, int(signals_per_ticker * (0.6 + bias)))
        recent_window = bdays[-int(60 + 90 * bias):]
        for _ in range(n_signals):
            # 70% draw from the recent window for high-bias names, 30% across.
            pool = recent_window if rng.random() < (0.4 + 0.5 * bias) else bdays
            d = rng.choice(pool)
            stype = rng.choice(ALT_SIGNAL_TYPES)
            strength = round(rng.uniform(0.30 + 0.5 * bias, 0.50 + 0.5 * bias), 2)
            strength = min(1.0, strength)
            descr_map = {
                "hiring_spike":           f"{tk} job postings up materially this week",
                "funding_announcement":   f"{tk}-related ecosystem startup announces funding round",
                "product_launch":         f"{tk} unveils new product / SKU",
                "permit_activity":        f"{tk} files new construction permits",
                "infrastructure_expansion":
                    f"{tk} expands data-center / supply footprint",
                "app_review_surge":       f"{tk} app store reviews jump",
                "web_traffic_spike":      f"{tk} web-traffic proxies spike",
            }
            rows.append(
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "ticker": tk,
                    "signal_type": stype,
                    "signal_strength": strength,
                    "description": descr_map[stype],
                }
            )
    df = pd.DataFrame(rows)
    return df.sort_values(["ticker", "date"]).reset_index(drop=True)


def generate_fundamentals(tickers: list[str]) -> pd.DataFrame:
    """Hand-tuned fundamentals snapshot. Used as fallback to live data."""
    df = pd.DataFrame(MOCK_FUNDAMENTALS)
    df = df[df["ticker"].isin(tickers)].reset_index(drop=True)
    return df


# Short company profiles - these get ingested into Chroma so the
# retrieval agent can return "what does this company actually do?"
# evidence alongside news + alt-data.
COMPANY_PROFILES: dict[str, dict[str, str]] = {
    "NVDA": {
        "company_name": "NVIDIA Corporation",
        "description": (
            "Designs GPUs and accelerated-computing platforms. Dominant "
            "supplier of training silicon for AI infrastructure; expanding "
            "into networking (InfiniBand / Spectrum-X) and software (CUDA, "
            "NIM, Omniverse)."
        ),
    },
    "MSFT": {
        "company_name": "Microsoft Corporation",
        "description": (
            "Cloud (Azure), productivity (M365 / Copilot), and Windows. "
            "Largest commercial AI distribution channel via Azure OpenAI "
            "and Copilot integration across the enterprise SKU stack."
        ),
    },
    "AMZN": {
        "company_name": "Amazon.com, Inc.",
        "description": (
            "Online retail, AWS cloud, advertising, and Prime media. "
            "Investing heavily in AI infrastructure (Trainium / Inferentia, "
            "Bedrock) and logistics automation."
        ),
    },
    "META": {
        "company_name": "Meta Platforms, Inc.",
        "description": (
            "Family of apps (Facebook, Instagram, WhatsApp, Threads), "
            "Reality Labs, and an open-weights AI strategy (Llama). "
            "Revenue is concentrated in performance advertising."
        ),
    },
    "TSLA": {
        "company_name": "Tesla, Inc.",
        "description": (
            "Electric vehicles, energy storage, and FSD / Optimus AI. "
            "Margin profile tied tightly to factory utilization and "
            "average selling price."
        ),
    },
    "AMD": {
        "company_name": "Advanced Micro Devices, Inc.",
        "description": (
            "CPUs (Ryzen / EPYC) and AI accelerators (MI300 / MI325). "
            "Primary credible alternative to NVIDIA in data-center AI "
            "training and inference."
        ),
    },
    "PLTR": {
        "company_name": "Palantir Technologies",
        "description": (
            "Foundry + AIP platforms for ontology-driven enterprise AI; "
            "concentrated US government and defense exposure plus a "
            "growing commercial book."
        ),
    },
    "CRWD": {
        "company_name": "CrowdStrike Holdings",
        "description": (
            "Cloud-native endpoint security (Falcon platform). Land-and-"
            "expand model with rising attach rate of identity, cloud, and "
            "log-management modules."
        ),
    },
    "SNOW": {
        "company_name": "Snowflake Inc.",
        "description": (
            "Cloud data platform with a consumption pricing model. "
            "Shifting from analytics warehouse positioning toward an AI "
            "data-platform message (Cortex, Snowpark)."
        ),
    },
}


def generate_company_descriptions(tickers: list[str]) -> pd.DataFrame:
    rows = []
    for tk in tickers:
        prof = COMPANY_PROFILES.get(tk)
        if prof is None:
            rows.append({"ticker": tk, "company_name": tk, "description": ""})
            continue
        rows.append({"ticker": tk, **prof})
    return pd.DataFrame(rows)


def ensure_mock_data(
    data_dir: Path,
    tickers: list[str],
    end: datetime | None = None,
    seed: int = 7,
    overwrite: bool = False,
) -> dict[str, Path]:
    """Ensure all four CSVs exist in `data_dir`. Returns the file paths."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "news": data_dir / "mock_news_events.csv",
        "alt": data_dir / "mock_alternative_data.csv",
        "fund": data_dir / "mock_fundamentals.csv",
        "desc": data_dir / "mock_company_descriptions.csv",
    }
    if overwrite or not files["news"].exists():
        generate_news_events(tickers, end=end, seed=seed).to_csv(
            files["news"], index=False
        )
    if overwrite or not files["alt"].exists():
        generate_alt_signals(tickers, end=end, seed=seed).to_csv(
            files["alt"], index=False
        )
    if overwrite or not files["fund"].exists():
        generate_fundamentals(tickers).to_csv(files["fund"], index=False)
    if overwrite or not files["desc"].exists():
        generate_company_descriptions(tickers).to_csv(files["desc"], index=False)
    return files


if __name__ == "__main__":   # pragma: no cover
    from ..config import DEFAULT_CONFIG

    paths = ensure_mock_data(
        DEFAULT_CONFIG.data_dir,
        list(DEFAULT_CONFIG.universe),
        overwrite=True,
    )
    for k, v in paths.items():
        print(f"Wrote {k} -> {v}")
