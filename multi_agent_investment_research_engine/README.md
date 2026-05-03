# multi_agent_investment_research_engine

A Python multi-agent research system that analyzes public market, news,
fundamental, and alternative-data signals across a tech-stock universe and
generates **explainable investment memos**, **risk reviews**, **company
rankings**, **outbound / GTM angles**, and a **paper-trading backtest**.

The system has two layers:
* a **quantitative pipeline** that produces numeric pillar scores (Market /
  News / Fundamentals / Alt-data) and risk caps;
* a **LangChain reasoning + retrieval layer** built on Chroma that
  retrieves signal evidence per company, reasons over it, and produces
  structured investment theses, the weekly memo, and parallel outbound
  angles.

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
* **Outbound / GTM** — the same signal that drives a thesis often signals
  buying intent for sales teams.

This project models that workflow as cooperating agents. Quantitative agents
produce numeric scores; LangChain agents retrieve evidence and reason over
it to produce the narrative. Each agent has a clean interface so its
internals can be swapped (e.g. swap the offline reasoning model for
`gpt-4o-mini`) without touching the rest of the pipeline.

## Why LangChain?

LangChain gives this engine three things hand-rolled glue would not:

1. **A common LLM interface** (`BaseChatModel`) — the same agents work with
   the offline deterministic provider used in tests, with `gpt-4o-mini` in
   production, or with any other LangChain-compatible model — no agent
   code changes.
2. **Typed structured output** via `PydanticOutputParser` — every agent's
   wire format is enforced at the boundary. If the LLM returns malformed
   JSON, the parser raises before downstream agents see garbage.
3. **A standard tool protocol.** The six core capabilities
   (`retrieve_company_signals`, `score_signal_strength`,
   `generate_company_thesis`, `compare_company_rankings`,
   `generate_investment_memo`, `generate_outbound_angles`) are exposed as
   LangChain `StructuredTool`s with explicit `args_schema`s — meaning
   another agent (or a chat UI) can drive the engine the same way the
   workflow does.

A local **Chroma** vector store sits beneath the reasoning agents. Every
mock CSV (news, alt-data, fundamentals, company descriptions) is ingested
as a typed `Document` with metadata (ticker, signal_type, date, source,
confidence_score). Retrieval is filtered by ticker and document kind, so
when the OutboundAngleAgent asks for evidence it gets material events,
not company boilerplate.

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
              │  Chroma vector store ingest     │  news / alt / fundamentals
              │  (HashingEmbeddings or OpenAI)  │  + company descriptions
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │   ResearchRetrievalAgent        │  top-k evidence per ticker
              └────────────┬────────────────────┘
                           ▼
              ┌─────────────────────────────────┐
              │   SignalReasoningAgent          │  SignalInsight (bull/bear)
              │     (LangChain + LLM)           │  qualitative score
              └────────────┬────────────────────┘
                           ▼
                ┌───────────┴────────────┐
                ▼                        ▼
   ┌────────────────────┐     ┌────────────────────┐
   │   ThesisAgent      │     │ OutboundAngleAgent │
   │ (LangChain + LLM)  │     │ (LangChain + LLM)  │
   │ bull / bear / risk │     │ trigger / persona  │
   │ + investment_thesis│     │ + opener + pain    │
   └─────────┬──────────┘     └──────────┬─────────┘
             ▼                           │
   ┌─────────────────────────────────┐   │
   │  PortfolioAgent.backtest()      │   │
   │  (weekly rebalance sim)         │   │
   └─────────┬───────────────────────┘   │
             ▼                           ▼
   ┌──────────────────────────────────────────────┐
   │            MemoAgent (LLM)                   │
   │  -> InvestmentMemo (entries + headline)      │
   └────────────┬─────────────────────────────────┘
                ▼
   ┌──────────────────────────────────────────────┐
   │              ReportingAgent                  │  memo + rankings JSON +
   │                                              │  evidence JSON + outbound
   │                                              │  + CSVs + charts/
   └──────────────────────────────────────────────┘
```

### Agents

**Quantitative pipeline (`agents/`)**

| Agent | Responsibility |
|---|---|
| **MarketAgent** | Fetch prices, compute momentum, volatility, drawdown, relative strength vs SPY, emit a 0-1 market score per ticker. |
| **NewsAgent** | Score each headline with a small finance lexicon, weight by event-type impact, decay by recency. |
| **FundamentalsAgent** | Pull revenue growth / margins / valuation / ROE (yfinance with CSV fallback), produce growth / profitability / valuation sub-scores. |
| **AlternativeDataAgent** | Aggregate hiring spikes, product launches, permits, app reviews, web-traffic proxies — exponential decay + cross-sectional normalization. |
| **RiskAgent** | Enforce single-name cap, cash reserve, equity ceiling, volatility trim; emit per-ticker `RiskReview` and a portfolio risk report. |
| **PortfolioAgent** | (a) propose target weights for BUY-rated names; (b) run a weekly-rebalance paper-trading simulation. |
| **ReportingAgent** | Serialize every artifact to disk (memo / CSVs / JSON / charts). |

**LangChain reasoning + retrieval layer (`llm/`)**

| Agent | Responsibility |
|---|---|
| **ResearchRetrievalAgent** | Vector-search Chroma for the top-k most relevant evidence per ticker. Returns typed `EvidenceItem`s. |
| **SignalReasoningAgent** | Reads retrieved evidence + quantitative pillar scores, emits a structured `SignalInsight` (bull/bear bullets, qualitative score). |
| **ThesisAgent** | Bull case, bear case, key risks, conviction, and the core investment thesis — grounded in retrieved evidence. |
| **MemoAgent** | Composes the structured `InvestmentMemo` from rankings + theses + risk reviews + allocations. |
| **OutboundAngleAgent** | Re-frames the same evidence as a GTM trigger — persona, pain hypothesis, opener, follow-up. |

---

## Universe

Default universe: **the S&P 500** (~484 constituents in
`data/sp500_constituents.csv`, organized by GICS sector).
Benchmark: **SPY**.

The list is a hand-curated snapshot bundled with the repo so the demo
runs without making a network call. Replace it with a live fetch
(iShares IVV holdings CSV, Wikipedia, FMP) by editing
`data/universe.py:_LIVE_FETCHER` - the loader's contract is just a
DataFrame with `ticker`, `company_name`, `sector`, `sub_industry`.

The original 9-name tech demo is still available as
`config.DEMO_CONFIG`:

```python
from multi_agent_investment_research_engine.config import DEMO_CONFIG
from multi_agent_investment_research_engine.main import run

run(DEMO_CONFIG)   # NVDA, MSFT, AMZN, META, TSLA, AMD, PLTR, CRWD, SNOW
```

### Two-stage funnel

At SP500 scale the cost equation flips: it is cheap to score 500 names
on the four quant pillars, but expensive (latency + tokens) to retrieve
evidence and write a thesis for each. So the engine runs as a funnel:

1. **Stage 1 — quantitative pipeline runs on the entire universe.**
   Every ticker gets a Market / News / Fundamentals / Alt-data pillar
   score, a composite signal score (0-100), a rating, and a row in
   `company_signal_scores.csv` and `company_rankings.json`.
2. **Stage 2 — LangChain reasoning runs on the top _N_ only.**
   `config.FunnelSettings.top_n_for_reasoning` (default `25`) chooses
   how many names the ResearchRetrieval / SignalReasoning / Thesis /
   OutboundAngle agents narrate. By default we also include any name
   that cleared the BUY threshold even if it sits outside the top _N_.
   Set `top_n_for_reasoning=None` to narrate the whole universe.

Tickers outside the slice still appear in the memo (compact
"watchlist tail" table) and the rankings UI (with a "tail only"
filter), so nothing is hidden — there's just no thesis written for
them this cycle.

### Pluggable data providers

Quant agents consume `MarketDataProvider` and `FundamentalsProvider`
abstractions instead of touching yfinance / CSVs directly. Bundled
implementations:

* `YFinanceMarketProvider` - batch yfinance pulls (chunks of 50 to
  stay under URL-length limits at SP500 scale) with a deterministic
  synthetic price-panel fallback when egress is blocked.
* `YFinanceFundamentalsProvider` - per-ticker `Ticker.info` with a
  mock-CSV fallback.
* `MockFundamentalsProvider` - pure CSV reader, used in tests.

Polygon / Alpaca / FMP / EDGAR are a "write a new provider" job; the
agents do not change.

---

## Outputs

After a successful run, the `outputs/` directory contains:

| File | What it is |
|---|---|
| `weekly_investment_memo.md` | Reviewer-ready memo from MemoAgent: top pick, portfolio snapshot, full ranking with bull/bear/risk per name. |
| `company_signal_scores.csv` | Per-ticker pillar scores + composite `signal_score` (0-100) + rating. |
| `company_rankings.json` | Per-ticker structured ranking + qualitative score + investment thesis snippet. |
| `risk_report.json` | Portfolio-level risk readout + per-ticker reviews, flags, notes. |
| `outbound_angles.md` | One GTM angle per company: trigger, persona, pain, opener, follow-up. |
| `retrieved_signal_evidence.json` | What the ResearchRetrievalAgent pulled from Chroma per ticker — the receipts behind every memo line. |
| `portfolio_backtest.csv` | Daily equity curve from the weekly-rebalance paper-trading simulation. |
| `trades.csv` | Every simulated rebalance leg (open / add / trim / close). |
| `performance_summary.json` | Total return, benchmark return, max drawdown, win rate, Sharpe-like. |
| `charts/` | `signal_scores_by_pillar.png`, `composite_signal_scores.png`, `equity_curve.png`, `price_<TICKER>.png` for the top names. |

### Example memo entry

```
Top Ranked Company: CRWD
Signal Score: 73/100

Bull case: CrowdStrike Holdings is supported by a composite signal score of
73/100. Retrieved evidence shows: [2024-12-10] Analysts upgrade CRWD on AI
demand; [2025-09-03] CRWD misses revenue estimates, shares drop. Underlying
fundamentals: revenue growth of +30% YoY; rich valuation (P/E ~ 95x).

Bear case: On the other side, CrowdStrike Holdings faces: outage at CRWD
sparks reliability questions; CRWD faces lawsuit over data breach.

Decision: Paper trade position approved at 15.0 percent portfolio allocation.
```

Each line you see in a memo can be traced back to a row in
`retrieved_signal_evidence.json` — the ThesisAgent does not hallucinate the
events; it cites them.

### Example outbound angle (same data, different lens)

```
CRWD — CrowdStrike Holdings
Confidence: high
Trigger signal: partnership — CRWD misses revenue estimates, shares drop
Persona: Head of BD
Pain hypothesis: CrowdStrike Holdings is taking on integration risk and
  looking for ways to make the partnership pay off fast.
Opener: Saw the partnership signal on CrowdStrike Holdings — "[event quote]".
  When that lands, the head of bd usually has 60-90 days to show measurable
  progress. Worth a 15-minute look at how peers handled it?
```

---

## Setup

```bash
pip install -r multi_agent_investment_research_engine/requirements.txt
```

Required Python packages: `pandas`, `numpy`, `yfinance`, `matplotlib`,
`pydantic`, `pytest`, `fastapi`, `uvicorn`.

## Run the pipeline (CLI)

From the repo root (`trading-bots/`):

```bash
python -m multi_agent_investment_research_engine.main
```

If yfinance is unavailable (offline / blocked-egress sandbox), `MarketAgent`
automatically falls back to a deterministic synthetic price panel and
`FundamentalsAgent` uses the bundled `mock_fundamentals.csv`. The LangChain
layer also defaults to an offline deterministic LLM + hashing embeddings,
so the whole pipeline runs end-to-end with no API keys. The pipeline logs
loudly which provider it used so consumers know the output is not market-
truth and not a hosted-LLM read.

### Swapping in a hosted LLM

The reasoning layer auto-detects an API key. Set `OPENAI_API_KEY` (and
optionally `LLM_MODEL=gpt-4o-mini`, `EMBEDDING_MODEL=text-embedding-3-small`)
and the same agents pick up `ChatOpenAI` + `OpenAIEmbeddings` with no code
changes. Any other LangChain-compatible chat model can be wired in by
constructing the `ResearchWorkflow` with `chat_model=YourModel(...)`.

To regenerate mock CSVs explicitly:

```bash
python -m multi_agent_investment_research_engine.data.mock_data
```

## Run tests

```bash
python -m pytest multi_agent_investment_research_engine/tests/ -q
```

## Web UI (FastAPI + Next.js)

A typed REST API under `multi_agent_investment_research_engine/api/` and a
Next.js 14 dashboard under `multi_agent_investment_research_engine/web/` give
the same outputs an interactive presentation: equity curve, sortable
rankings, per-ticker drill-downs (per-pillar score chart, fundamentals
snapshot, risk review, trade log), the rendered weekly memo, and a
"Re-run pipeline" button.

Run them together in two terminals:

```bash
# Terminal 1 - backend on :8000
uvicorn multi_agent_investment_research_engine.api.main:app --reload --port 8000

# Terminal 2 - frontend on :3000
cd multi_agent_investment_research_engine/web
npm install
npm run dev
```

Open http://localhost:3000 . The UI calls the API through a Next.js
rewrite (`next.config.js`), so the browser only sees relative `/api/*`
URLs - no CORS configuration required for the user.

The pipeline must have produced outputs at least once before the UI has
data to show. If it has not, the dashboard renders a friendly "backend not
ready" panel with the exact commands to fix it.

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + last-run state |
| GET | `/api/universe` | Universe, benchmark, weights, thresholds |
| GET | `/api/dashboard` | Top picks + perf + snapshot + equity curve |
| GET | `/api/rankings` | Per-ticker rows (signal_score + pillars + fundamentals) |
| GET | `/api/rankings_full` | Per-ticker structured ranking + thesis snippet |
| GET | `/api/ticker/{symbol}` | Detail: scores + thesis + risk review + retrieved evidence + trades |
| GET | `/api/evidence/{symbol}` | Just the retrieved Chroma evidence list |
| GET | `/api/memo` | Weekly memo (markdown) |
| GET | `/api/outbound` | Outbound angles (markdown) |
| GET | `/api/risk` | Portfolio + per-ticker risk review |
| GET | `/api/backtest` | Equity curve + trades + summary |
| POST | `/api/run` | Re-execute the full pipeline (synchronous) |

## Deployment

The cleanest split for a portfolio-quality deploy is **Vercel for the
Next.js UI + Render / Railway / Fly for the FastAPI service**:

* **Vercel (frontend).** Import the repo, set the project root to
  `multi_agent_investment_research_engine/web`, set env var
  `API_URL=https://<your-backend>.onrender.com`. The build is just
  `next build`; Vercel handles routing.
* **Render (backend).** New "Web Service" from the same repo,
  start command:
  `pip install -r multi_agent_investment_research_engine/requirements.txt && uvicorn multi_agent_investment_research_engine.api.main:app --host 0.0.0.0 --port $PORT`.
  Add a one-shot job (or just hit `POST /api/run` after deploy) so
  `outputs/` is populated.
* **Single VPS with Docker Compose** is also a fine option if you'd rather
  show "I can run a server": one container per service, both behind
  nginx, and a small persistent volume on `outputs/`.

Either way the rules are:
1. Frontend talks to the backend via `API_URL` (server-side fetch) and
   the rewrite proxy (browser fetch) - so production Just Works without
   CORS holes.
2. The backend needs writable `outputs/` if `POST /api/run` is enabled.
3. Treat the synthetic-data fallback as a feature: it lets the demo run
   with no egress to data vendors.

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

## What questions this engine answers

The engine is designed to give specific answers, not vibes:

* **Which companies have the strongest signal this week?** — `company_rankings.json` and the rankings page sort by composite signal score and surface the qualitative read alongside.
* **Why do those signals matter?** — `retrieved_signal_evidence.json` returns the exact Chroma documents per ticker that the ThesisAgent cited. Every claim in the memo points back to a row.
* **What is the bull case? The bear case?** — `weekly_investment_memo.md` and the per-ticker page show ThesisAgent output grounded in retrieved evidence and the latest pillar scores.
* **What risks should be considered?** — `risk_report.json` shows portfolio-level + per-ticker risk reviews (caps, vol trims, drawdown flags). The memo carries those notes into the ranking entries.
* **What outbound angle could be created from the same signal?** — `outbound_angles.md` and the Outbound page re-frame the same evidence as a GTM trigger: persona, pain, opener, follow-up.

## Extending with a new signal

1. Add a quantitative agent in `agents/<your_signal>_agent.py` inheriting from `BaseAgent`. Return a `pd.DataFrame` indexed by ticker with a `<your_signal>_score` column in [0, 1].
2. Wire it into `main.py._build_feature_table` and add a weight to `config.SignalWeights`.
3. Add a corresponding document type in `llm/vector_store.py` so the LangChain layer can retrieve and cite it.

Everything downstream — risk review, thesis, memo, outbound, reporting — picks the new pillar up automatically.

## Where this could go next

* Drop the offline reasoning model and run with `gpt-4o-mini`. Same agents, no code changes.
* Replace the lexicon news scorer with a fine-tuned classifier or hosted LLM-as-classifier.
* Plug the synthetic price-panel fallback behind a swappable data provider so Polygon / Alpaca / AlphaVantage can be wired in.
* Walk-forward weight tuning: learn `SignalWeights` from labeled outcomes instead of priors.
* **Adjacent use cases.** The same engine generalizes naturally to:
  * **GTM intelligence** — score account fit + trigger an outbound playbook from the same signals (already wired up via `OutboundAngleAgent`).
  * **Private-equity sourcing** — index private-company news, hiring, permit, and funding signals into the same Chroma store and run the same ranking workflow.
  * **Public market research** — broaden the universe and let the LangChain tools drive a chat-style research interface.

---

## Disclaimer

This project is a research and educational artifact. It is not investment
advice. It does not connect to any brokerage, does not place real trades,
and makes no profit claims. The mock data, the synthetic price-panel
fallback, and the lexicon-based sentiment scorer are demonstration-grade,
not production-grade, signal sources.
