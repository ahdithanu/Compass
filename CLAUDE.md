# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains one project: `multi_agent_investment_research_engine/` — a Python multi-agent research system that turns market / news / fundamentals / alternative-data signals into explainable investment memos, risk reviews, company rankings, and a paper-trading backtest. A FastAPI service (`api/`) and a Next.js 14 dashboard (`web/`) sit on top of the same outputs.

It is **simulation only**: no brokerage integration, no live orders, no profit claims. Keep it that way.

## Commands

Run from the repo root.

```bash
# Install deps
pip install -r multi_agent_investment_research_engine/requirements.txt

# End-to-end pipeline (writes outputs/ + outputs/charts/)
python -m multi_agent_investment_research_engine.main

# Regenerate the three mock CSVs in data/
python -m multi_agent_investment_research_engine.data.mock_data

# All tests
python -m pytest multi_agent_investment_research_engine/tests/ -q

# A single test file
python -m pytest multi_agent_investment_research_engine/tests/test_risk_agent.py -q

# Backend (port 8000) — reads outputs/ produced by main.py
uvicorn multi_agent_investment_research_engine.api.main:app --reload --port 8000

# Frontend (port 3000) — proxies /api/* to the backend
cd multi_agent_investment_research_engine/web
npm install   # first time only
npm run dev
```

## Architecture

Two layers, executed in order. The whole thing is a deterministic ordered DAG — no message bus, no async loop. `main.py` orchestrates the agents in this order:

**Quantitative pipeline (`agents/`)**

1. **MarketAgent** (`agents/market_agent.py`) — yfinance OHLCV → momentum / volatility / drawdown / relative strength → `market_score` per ticker. Falls back to a deterministic synthetic price panel when yfinance is unreachable; the fallback is logged as a warning.
2. **NewsAgent** (`agents/news_agent.py`) — reads `data/mock_news_events.csv`, scores each headline with a small finance lexicon, weights by event-type impact, decays by recency → `news_score`.
3. **FundamentalsAgent** (`agents/fundamentals_agent.py`) — yfinance `Ticker.info`, falls back to `data/mock_fundamentals.csv` when fetch fails or returns mostly nulls. Produces growth / profitability / valuation sub-scores → `fundamental_score`.
4. **AlternativeDataAgent** (`agents/alternative_data_agent.py`) — reads `data/mock_alternative_data.csv` (hiring, product launches, permits, app reviews, web traffic), exponential decay + cross-sectional normalization → `alt_score`.
5. `main._build_feature_table` blends the four pillar scores into `signal_score` (0–100) using weights in `config.SignalWeights`, and assigns ratings (BUY/HOLD/AVOID) per `config.RatingThresholds`.
6. **PortfolioAgent.propose_weights** — distributes capital across BUY-rated names by relative score, pre-applies single-name + equity caps.
7. **RiskAgent** (`agents/risk_agent.py`) — final caps + volatility trim + drawdown flags; emits a `PortfolioRiskReport`.
8. **PortfolioAgent.backtest** — weekly rebalance paper-trading sim across the full price history, recomputes pillar scores at each rebalance date.

**LangChain reasoning + retrieval layer (`llm/`)**

9. **`ResearchWorkflow.ingest`** — embeds news, alt-data, fundamentals, and `mock_company_descriptions.csv` into a Chroma vector store at `data/chroma/` via `langchain_chroma.Chroma`. Idempotent (delete-then-add by id).
10. For each ticker (in score-ranked order):
    - **ResearchRetrievalAgent** (`llm/research_retrieval_agent.py`) — vector-search Chroma for top-k evidence; metadata-filterable by ticker + `doc_kind` (news / alt_data / fundamentals / description).
    - **SignalReasoningAgent** (`llm/signal_reasoning_agent.py`) — LangChain `ChatPromptTemplate | chat_model | PydanticOutputParser(SignalInsight)`. Reads retrieved evidence + pillar scores, emits a `SignalInsight`.
    - **ThesisAgent** (`llm/thesis_agent.py`) — emits a structured `InvestmentThesis` (bull/bear/risks/conviction, plus `evidence_refs`).
    - **OutboundAngleAgent** (`llm/outbound_angle_agent.py`) — re-frames evidence as a GTM trigger / persona / opener / follow-up. Retrieval is filtered to `news + alt_data` so the trigger is always material.
11. **MemoAgent** (`llm/memo_agent.py`) — composes a structured `InvestmentMemo` from rankings + theses + risk reviews + allocations.
12. **ReportingAgent** (`agents/reporting_agent.py`) — writes `outputs/weekly_investment_memo.md`, `company_signal_scores.csv`, `company_rankings.json`, `risk_report.json`, `outbound_angles.md`, `retrieved_signal_evidence.json`, `portfolio_backtest.csv`, `trades.csv`, `performance_summary.json`, and PNGs into `outputs/charts/`.

### LLM provider

`llm/providers.py` defines `build_chat_model()` and `build_embeddings()`. Selection rules:

- If `OPENAI_API_KEY` is set and `langchain-openai` is importable, return `ChatOpenAI(model=os.environ.get("LLM_MODEL", "gpt-4o-mini"))` and `OpenAIEmbeddings(model=os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"))`.
- Otherwise, return `OfflineReasoningChatModel` (a deterministic `BaseChatModel` that parses the prompt's JSON-encoded inputs and synthesizes schema-conformant JSON) + `HashingEmbeddings` (token-hash bag-of-features). The offline path is what powers the tests and the demo run with no API keys — do not delete it.

Every prompt in `llm/prompts.py` carries a `<<TASK::NAME>>` marker in its system message so the offline model can dispatch deterministically; a hosted LLM treats the marker as harmless extra context.

### LangChain tools

Six `StructuredTool`s are exposed by `ResearchWorkflow.tools()` (`llm/tools.py`):

- `retrieve_company_signals` — top-k evidence per ticker (input: ticker, k, signal_kinds).
- `score_signal_strength` — produce `SignalInsight` for a ticker.
- `generate_company_thesis` — produce `InvestmentThesis`.
- `compare_company_rankings` — counts by rating + top-N + median.
- `generate_investment_memo` — produce `InvestmentMemo`.
- `generate_outbound_angles` — produce `OutboundAngle`.

These exist so another agent (or a chat UI) can drive the engine the same way the workflow does. Don't add new tools without an `args_schema` and a clear input/output contract.

### Conventions

- Every agent inherits from `BaseAgent` (`agents/base_agent.py`), has a `name` + `description`, owns an `AgentLogger`, and exposes `run(...)`. `PortfolioAgent.run(mode=...)` dispatches between `propose_weights` and `backtest`. The LangChain agents in `llm/` also subclass `BaseAgent` for logging consistency.
- Quantitative inter-agent contracts live in `agents/models.py`. LangChain output schemas live in `llm/schemas.py` (`SignalInsight`, `CompanyRanking`, `InvestmentThesis`, `InvestmentMemo`, `InvestmentMemoEntry`, `OutboundAngle`, `EvidenceItem`). Don't put new schemas next to the agent that emits them.
- Configuration is centralized in `config.py` as frozen dataclasses. The new `chroma_dir` and `evidence_k` fields control the vector store.
- Mock data is *bias-tuned* per ticker (see `TICKER_BIAS` in `data/mock_data.py`) so the demo memo lands on a realistic top pick. `mock_company_descriptions.csv` provides a short profile for each name and is ingested into Chroma.

### Adding a new signal pillar

1. New quantitative agent under `agents/<your_signal>_agent.py` returning a DataFrame indexed by ticker with a `<pillar>_score` column in [0, 1].
2. Wire it into `main._build_feature_table` and add a weight to `config.SignalWeights`.
3. Add a corresponding document type in `llm/vector_store.py:build_evidence_documents` so the LangChain retrieval can cite it.
4. Update `agents/__init__.py` and add a unit test under `tests/`.

Risk, thesis, memo, outbound, and reporting will all pick up the new pillar without further changes.

### Offline / sandbox runs

If yfinance is blocked, both `MarketAgent` and `FundamentalsAgent` fall back to deterministic mock data; if `OPENAI_API_KEY` is unset, the LangChain layer falls back to `OfflineReasoningChatModel` + `HashingEmbeddings`. The pipeline still produces all output files. Do not delete any of the fallback paths — CI and hosted sandboxes rely on them.

### Web stack

- `api/main.py` — FastAPI service. GET endpoints (`/api/dashboard`, `/api/rankings`, `/api/rankings_full`, `/api/ticker/{symbol}`, `/api/evidence/{symbol}`, `/api/memo`, `/api/outbound`, `/api/risk`, `/api/backtest`) read from `outputs/` so navigation is fast. `POST /api/run` triggers a synchronous pipeline rebuild and is guarded by a thread lock. CORS is open to `:3000` only.
- `web/` — Next.js 14 App Router with TypeScript + Tailwind + Recharts + react-markdown. Server components fetch from the FastAPI URL; client components hit `/api/*` on the same origin via the rewrite in `web/next.config.js` (configurable with the `API_URL` env var for production).
- The frontend is decorative: every fact it shows is in `outputs/`. Don't duplicate logic into TS — keep new analytics in the Python agents and surface them through one API field.
