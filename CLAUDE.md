# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo contains one project: `multi_agent_signal_trading_system/` — a Python multi-agent research system that turns market / news / fundamentals / alternative-data signals into explainable investment memos, risk reviews, company rankings, and a paper-trading backtest. A FastAPI service (`api/`) and a Next.js 14 dashboard (`web/`) sit on top of the same outputs.

It is **simulation only**: no brokerage integration, no live orders, no profit claims. Keep it that way.

## Commands

Run from the repo root.

```bash
# Install deps
pip install -r multi_agent_signal_trading_system/requirements.txt

# End-to-end pipeline (writes outputs/ + outputs/charts/)
python -m multi_agent_signal_trading_system.main

# Regenerate the three mock CSVs in data/
python -m multi_agent_signal_trading_system.data.mock_data

# All tests
python -m pytest multi_agent_signal_trading_system/tests/ -q

# A single test file
python -m pytest multi_agent_signal_trading_system/tests/test_risk_agent.py -q

# Backend (port 8000) — reads outputs/ produced by main.py
uvicorn multi_agent_signal_trading_system.api.main:app --reload --port 8000

# Frontend (port 3000) — proxies /api/* to the backend
cd multi_agent_signal_trading_system/web
npm install   # first time only
npm run dev
```

## Architecture

The whole system is a deterministic ordered DAG of agents — no message bus, no async loop. `main.py` orchestrates them in this order:

1. **MarketAgent** (`agents/market_agent.py`) — yfinance OHLCV → momentum / volatility / drawdown / relative strength → `market_score` per ticker. Falls back to a deterministic synthetic price panel when yfinance is unreachable; the fallback is logged as a warning.
2. **NewsAgent** (`agents/news_agent.py`) — reads `data/mock_news_events.csv`, scores each headline with a small finance lexicon, weights by event-type impact, decays by recency → `news_score`.
3. **FundamentalsAgent** (`agents/fundamentals_agent.py`) — yfinance `Ticker.info`, falls back to `data/mock_fundamentals.csv` when fetch fails or returns mostly nulls. Produces growth / profitability / valuation sub-scores → `fundamental_score`.
4. **AlternativeDataAgent** (`agents/alternative_data_agent.py`) — reads `data/mock_alternative_data.csv` (hiring, product launches, permits, app reviews, web traffic), exponential decay + cross-sectional normalization → `alt_score`.
5. `main._build_feature_table` blends the four pillar scores into `signal_score` (0–100) using weights in `config.SignalWeights`, and assigns ratings (BUY/HOLD/AVOID) per `config.RatingThresholds`.
6. **PortfolioAgent.propose_weights** — distributes capital across BUY-rated names by relative score, pre-applies single-name + equity caps.
7. **RiskAgent** (`agents/risk_agent.py`) — final caps + volatility trim + drawdown flags; emits a `PortfolioRiskReport`.
8. **ThesisAgent** (`agents/thesis_agent.py`) — template-driven bull case / bear case / key risks per ticker, conviction inferred from score + risk flags.
9. **PortfolioAgent.backtest** — weekly rebalance paper-trading sim across the full price history, recomputes pillar scores at each rebalance date.
10. **ReportingAgent** (`agents/reporting_agent.py`) — writes `outputs/weekly_investment_memo.md`, `company_signal_scores.csv`, `portfolio_backtest.csv`, `trades.csv`, `performance_summary.json`, `risk_report.json`, and PNGs into `outputs/charts/`.

### Conventions

- Every agent inherits from `BaseAgent` (`agents/base_agent.py`), has a `name` + `description`, owns an `AgentLogger`, and exposes `run(...)`. `PortfolioAgent.run(mode=...)` dispatches between `propose_weights` and `backtest`.
- Inter-agent contracts are pydantic models in `agents/models.py` (`Rating`, `FinalAction`, `SignalBreakdown`, `CompanyScore`, `FundamentalSnapshot`, `RiskReview`, `PortfolioRiskReport`, `Thesis`, `InvestmentMemoEntry`, `TradeRecord`, `PerformanceSummary`). Add new schemas there, not next to the agent that emits them.
- Configuration is centralized in `config.py` as frozen dataclasses (`SignalWeights`, `RatingThresholds`, `RiskSettings`, `MarketSettings`, `PortfolioSettings`, `Config`). Don't scatter tunables into agent internals.
- Mock data is *bias-tuned* per ticker (see `TICKER_BIAS` in `data/mock_data.py`) so the demo memo lands on a realistic top pick. The fundamentals snapshot in `MOCK_FUNDAMENTALS` is also hand-tuned and used as the offline fallback.

### Adding a new signal pillar

1. New agent under `agents/<your_signal>_agent.py` returning a DataFrame indexed by ticker with a `<pillar>_score` column in [0, 1].
2. Wire it into `main._build_feature_table` and add a weight to `config.SignalWeights`.
3. Update `agents/__init__.py` and add a unit test under `tests/`.

Risk, thesis, portfolio, and reporting will all pick up the new pillar without further changes.

### Offline / sandbox runs

If yfinance is blocked, both `MarketAgent` and `FundamentalsAgent` fall back to deterministic mock data — the pipeline still produces all output files. Do not delete the fallback paths; CI and hosted sandboxes rely on them.

### Web stack

- `api/main.py` — FastAPI service. GET endpoints (`/api/dashboard`, `/api/rankings`, `/api/ticker/{symbol}`, `/api/memo`, `/api/risk`, `/api/backtest`) read from `outputs/` so navigation is fast. `POST /api/run` triggers a synchronous pipeline rebuild and is guarded by a thread lock. CORS is open to `:3000` only.
- `web/` — Next.js 14 App Router with TypeScript + Tailwind + Recharts + react-markdown. Server components fetch from the FastAPI URL; client components hit `/api/*` on the same origin via the rewrite in `web/next.config.js` (configurable with the `API_URL` env var for production).
- The frontend is decorative: every fact it shows is in `outputs/`. Don't duplicate logic into TS — keep new analytics in the Python agents and surface them through one API field.
