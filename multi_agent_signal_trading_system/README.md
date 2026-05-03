# multi_agent_signal_trading_system

A Python multi-agent research system that analyzes public market, news,
fundamental, and alternative-data signals across a tech-stock universe and
generates **explainable investment memos**, **risk reviews**, **company
rankings**, and a **paper-trading backtest**.

> **For education, research, and paper-trading simulation only.**
> No connection to a real brokerage. No live orders are placed.
> No profit claims are made.

---

## Why a multi-agent approach (and not just a moving-average bot)?

A textbook moving-average crossover bot is a single decision rule applied to
one stream of data. Real research desks don't work that way. They blend:

* **Market data** — momentum, volatility, drawdown, relative strength.
* **News flow** — what just happened, how impactful, how positive/negative.
* **Fundamentals** — is the business actually growing, profitable, cheap?
* **Alternative data** — hiring, product launches, web traffic, app reviews.
* **Risk discipline** — caps, vol limits, concentration warnings.
* **Narrative** — a bull case, a bear case, and the key risks.

This project models that workflow as eight cooperating agents. Each agent
is responsible for one pillar of analysis and exposes a clean interface so
its internals can be swapped (e.g. trade the lexicon-based news scorer for a
fine-tuned classifier) without touching the rest of the pipeline.

---

## Architecture (text diagram)

```
                        ┌──────────────┐
                        │   main.py    │  orchestrator
                        └──────┬───────┘
            ┌──────────────────┼──────────────────────────────┐
            ▼                  ▼                              ▼
   ┌──────────────┐   ┌────────────────┐           ┌──────────────────┐
   │  MarketAgent │   │   NewsAgent    │           │ AlternativeData  │
   │ (yfinance)   │   │  (lexicon NLP) │           │ Agent (CSV)      │
   └──────┬───────┘   └────────┬───────┘           └────────┬─────────┘
          │                    │                            │
          │           ┌────────▼─────────┐                  │
          │           │  Fundamentals    │                  │
          │           │  Agent (yf+CSV)  │                  │
          │           └────────┬─────────┘                  │
          ▼                    ▼                            ▼
                 ┌──────────────────────────────┐
                 │  composite signal_score      │  (config-weighted blend)
                 │  per ticker, 0–100, ranked   │
                 └────────────┬─────────────────┘
                              ▼
              ┌─────────────────────────────────┐
              │       PortfolioAgent            │  proposes target weights
              │       (BUY-rated names only)    │
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │           RiskAgent             │  caps + vol trim + flags
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │          ThesisAgent            │  bull / bear / risks
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │  PortfolioAgent.backtest()      │  weekly rebalance sim
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │        ReportingAgent           │  memo + CSVs + JSON +
              │                                 │  charts/
              └─────────────────────────────────┘
```

### The 8 agents

| Agent | Responsibility |
|---|---|
| **MarketAgent** | Fetch prices, compute momentum, volatility, drawdown, relative strength vs SPY, emit a 0-1 market score per ticker (cross-sectional rank). |
| **NewsAgent** | Score each headline with a small finance lexicon, weight by event-type impact, decay by recency, emit a 0-1 news score per ticker. |
| **FundamentalsAgent** | Pull revenue growth / margins / valuation / ROE (yfinance with CSV fallback), produce growth / profitability / valuation sub-scores. |
| **AlternativeDataAgent** | Aggregate hiring spikes, product launches, permits, app reviews, web-traffic proxies — exponential decay + cross-sectional normalization. |
| **RiskAgent** | Enforce single-name cap, cash reserve, equity ceiling, volatility trim; emit per-ticker `RiskReview` and a portfolio-level risk report. |
| **ThesisAgent** | Translate the numeric features + risk flags into a bull case, bear case, and key risks for every name. |
| **PortfolioAgent** | (a) propose target weights for BUY-rated names; (b) run a weekly-rebalance paper-trading simulation across the full price history. |
| **ReportingAgent** | Write the weekly memo, signal-scores CSV, backtest CSV, risk JSON, and the charts directory. |

---

## Universe

Default universe: **NVDA, MSFT, AMZN, META, TSLA, AMD, PLTR, CRWD, SNOW**.
Benchmark: **SPY**.

The universe and benchmark are configured in `config.py` and can be edited
without touching agent code.

---

## Outputs

After a successful run, the `outputs/` directory contains:

| File | What it is |
|---|---|
| `weekly_investment_memo.md` | Reviewer-ready memo: top pick, portfolio snapshot, full ranking with bull/bear/risk per name. |
| `company_signal_scores.csv` | Per-ticker pillar scores + composite `signal_score` (0-100) + rating. |
| `portfolio_backtest.csv` | Daily equity curve from the weekly-rebalance paper-trading simulation. |
| `trades.csv` | Every simulated rebalance leg (open / add / trim / close). |
| `performance_summary.json` | Total return, benchmark return, max drawdown, win rate, Sharpe-like. |
| `risk_report.json` | Portfolio-level risk readout + per-ticker reviews and flags. |
| `charts/` | `signal_scores_by_pillar.png`, `composite_signal_scores.png`, `equity_curve.png`, `price_<TICKER>.png` for the top names. |

### Example memo

```
Top Ranked Company: CRWD
Signal Score: 73/100

Bull case: price momentum is positive (+6% over the window); news flow is
  constructive (avg sentiment +0.99, impact 0.55 across 18 events); revenue
  growth of +30% YoY; moderate alt-data activity (15 signals).

Bear case: valuation is rich (P/E ~ 95x).

Decision: Paper trade position approved at 15.0 percent portfolio allocation.
```

---

## Setup

```bash
pip install -r requirements.txt
```

Required: `pandas`, `numpy`, `yfinance`, `matplotlib`, `pydantic`, `pytest`.

## Run

From the repo root (`trading-bots/`):

```bash
python -m multi_agent_signal_trading_system.main
```

If yfinance is unavailable (offline / blocked-egress sandbox), `MarketAgent`
automatically falls back to a deterministic synthetic price panel and
`FundamentalsAgent` uses the bundled `mock_fundamentals.csv`. The pipeline
will log loudly when it does this so consumers know the output is not
market-truth.

To regenerate mock CSVs explicitly:

```bash
python -m multi_agent_signal_trading_system.data.mock_data
```

## Run tests

```bash
python -m pytest multi_agent_signal_trading_system/tests/ -q
```

---

## How the composite signal score is built

```
signal_score (0-100) = 100 * (
      0.30 * market_score
    + 0.20 * news_score
    + 0.30 * fundamental_score
    + 0.20 * alt_score
)
```

Each pillar score is in [0, 1]. Weights live in `config.SignalWeights` and
are easy to retune. Ratings come from `config.RatingThresholds`:

* `>= 70` → **BUY**
* `>= 50` → **HOLD**
* otherwise → **AVOID**

PortfolioAgent only allocates to BUY-rated names, sized by relative score
weight and capped per `RiskSettings`.

---

## Extending with a new signal

1. Add an agent in `agents/<your_signal>_agent.py` inheriting from `BaseAgent`.
2. Have it return a `pd.DataFrame` indexed by ticker with a single
   `<your_signal>_score` column in [0, 1].
3. Wire it into `main.py._build_feature_table` and add a weight to
   `config.SignalWeights`.

Everything downstream — risk review, thesis, portfolio sizing, reporting —
will pick the new pillar up automatically.

---

## Future improvements

* Replace the lexicon news scorer with a fine-tuned classifier or hosted
  LLM-as-classifier; the `NewsAgent.run` interface stays identical.
* Add a per-event embedding-similarity signal (e.g. compare new headlines to
  a stored "guidance-cut" exemplar set).
* Promote the synthetic price-panel fallback into a swappable data
  provider abstraction so Polygon / Alpaca / AlphaVantage can be plugged in.
* Walk-forward weight tuning: learn `SignalWeights` from labeled outcomes.
* Add an event-study module to attribute future N-day returns to specific
  signal categories (so we can answer "which signals were most predictive?"
  empirically rather than narratively).

---

## Disclaimer

This project is a research and educational artifact. It is not investment
advice. It does not connect to any brokerage, does not place real trades,
and makes no profit claims. The mock data, the synthetic price-panel
fallback, and the lexicon-based sentiment scorer are demonstration-grade,
not production-grade, signal sources.
