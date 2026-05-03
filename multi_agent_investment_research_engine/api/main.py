"""HTTP API surface for the multi-agent research pipeline.

The API is a thin layer over the agents:
* GET endpoints serve the most recent run from `outputs/` (so the UI is
  fast and doesn't trigger a long pipeline on every navigation).
* POST /api/run re-executes the full pipeline and refreshes the cache.

Run:
    uvicorn multi_agent_investment_research_engine.api.main:app --reload --port 8000
"""

from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from ..config import DEFAULT_CONFIG, Config
from .. import main as pipeline


app = FastAPI(
    title="Multi-Agent Signal Research API",
    version="0.1.0",
    description=(
        "Read-only access to the pipeline outputs (rankings, memo, "
        "backtest, risk report) plus a POST endpoint to re-run the agents."
    ),
)

# Permissive CORS for the dev UI on :3000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


_run_lock = threading.Lock()
_run_state: dict[str, Any] = {
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "error": None,
}


def _output_dir() -> Path:
    return DEFAULT_CONFIG.output_dir


def _read_json(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(404, f"{path.name} not found - run the pipeline first")
    return json.loads(path.read_text())


def _read_scores() -> pd.DataFrame:
    p = _output_dir() / "company_signal_scores.csv"
    if not p.exists():
        raise HTTPException(404, "company_signal_scores.csv not found - run the pipeline first")
    return pd.read_csv(p).set_index("ticker")


def _read_backtest() -> pd.DataFrame:
    p = _output_dir() / "portfolio_backtest.csv"
    if not p.exists():
        raise HTTPException(404, "portfolio_backtest.csv not found - run the pipeline first")
    df = pd.read_csv(p)
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
    return df


def _read_trades() -> pd.DataFrame:
    p = _output_dir() / "trades.csv"
    if not p.exists():
        return pd.DataFrame()
    df = pd.read_csv(p)
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"]).dt.date.astype(str)
    return df


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "outputs_dir": str(_output_dir()),
        "has_outputs": (_output_dir() / "company_signal_scores.csv").exists(),
        "run_state": _run_state,
    }


@app.get("/api/universe")
def universe() -> dict:
    cfg: Config = DEFAULT_CONFIG
    return {
        "universe": list(cfg.universe),
        "benchmark": cfg.benchmark,
        "weights": cfg.weights.as_dict(),
        "thresholds": {"buy": cfg.ratings.buy, "hold": cfg.ratings.hold},
        "starting_capital": cfg.portfolio.starting_capital,
    }


@app.get("/api/rankings")
def rankings() -> list[dict]:
    df = _read_scores().reset_index()
    # Replace NaN with None for clean JSON.
    return json.loads(df.to_json(orient="records"))


@app.get("/api/ticker/{symbol}")
def ticker_detail(symbol: str) -> dict:
    sym = symbol.upper()
    df = _read_scores()
    if sym not in df.index:
        raise HTTPException(404, f"Unknown ticker {sym}")
    row = df.loc[sym]

    # Pull this ticker's position series out of the backtest CSV's
    # `shares_<TICKER>` columns.
    bt = _read_backtest()
    shares_col = f"shares_{sym}"
    if shares_col not in bt.columns:
        position_series = []
    else:
        position_series = [
            {"date": d.strftime("%Y-%m-%d"), "shares": float(v)}
            for d, v in bt[shares_col].items()
        ]

    trades = _read_trades()
    ticker_trades: list[dict] = []
    if not trades.empty and "ticker" in trades.columns:
        ticker_trades = json.loads(
            trades[trades["ticker"] == sym].to_json(orient="records")
        )

    risk = _read_json(_output_dir() / "risk_report.json")
    review = next(
        (r for r in risk.get("per_ticker", []) if r.get("ticker") == sym),
        None,
    )

    # LangChain layer outputs.
    rankings_path = _output_dir() / "company_rankings.json"
    rankings = json.loads(rankings_path.read_text()) if rankings_path.exists() else []
    ranking_row = next((r for r in rankings if r.get("ticker") == sym), None)

    evidence_path = _output_dir() / "retrieved_signal_evidence.json"
    evidence_all = json.loads(evidence_path.read_text()) if evidence_path.exists() else {}
    evidence = evidence_all.get(sym, [])

    return {
        "ticker": sym,
        "scores": json.loads(row.to_json()),
        "position_series": position_series,
        "trades": ticker_trades,
        "risk_review": review,
        "ranking": ranking_row,
        "evidence": evidence,
    }


@app.get("/api/rankings_full")
def rankings_full() -> list[dict]:
    """Per-ticker structured ranking + thesis snippet (from MemoAgent)."""
    p = _output_dir() / "company_rankings.json"
    if not p.exists():
        raise HTTPException(404, "company_rankings.json not found - run the pipeline first")
    return json.loads(p.read_text())


@app.get("/api/outbound", response_class=PlainTextResponse)
def outbound_md() -> str:
    p = _output_dir() / "outbound_angles.md"
    if not p.exists():
        raise HTTPException(404, "outbound_angles.md not found - run the pipeline first")
    return p.read_text()


@app.get("/api/evidence/{symbol}")
def evidence_for(symbol: str) -> list[dict]:
    sym = symbol.upper()
    p = _output_dir() / "retrieved_signal_evidence.json"
    if not p.exists():
        raise HTTPException(404, "retrieved_signal_evidence.json not found")
    all_ev = json.loads(p.read_text())
    if sym not in all_ev:
        raise HTTPException(404, f"No evidence for {sym}")
    return all_ev[sym]


@app.get("/api/dashboard")
def dashboard() -> dict:
    df = _read_scores().reset_index()
    perf = _read_json(_output_dir() / "performance_summary.json")
    risk = _read_json(_output_dir() / "risk_report.json")

    bt = _read_backtest()
    pv = bt["portfolio_value"]
    eq = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in pv.items()
    ]

    top = df.sort_values("signal_score", ascending=False).head(5)
    return {
        "as_of": risk.get("as_of"),
        "performance": perf,
        "portfolio_snapshot": {
            "cash_pct": risk.get("cash_pct"),
            "concentration_pct_top": risk.get("concentration_pct_top"),
            "portfolio_volatility": risk.get("portfolio_volatility"),
            "flags": risk.get("flags", []),
        },
        "top_picks": json.loads(top.to_json(orient="records")),
        "equity_curve": eq,
    }


@app.get("/api/memo", response_class=PlainTextResponse)
def memo() -> str:
    p = _output_dir() / "weekly_investment_memo.md"
    if not p.exists():
        raise HTTPException(404, "weekly_investment_memo.md not found - run the pipeline first")
    return p.read_text()


@app.get("/api/risk")
def risk_report() -> dict:
    return _read_json(_output_dir() / "risk_report.json")


@app.get("/api/backtest")
def backtest() -> dict:
    bt = _read_backtest()
    pv = bt["portfolio_value"]
    cash = bt["cash"] if "cash" in bt.columns else None
    eq = []
    for d, v in pv.items():
        row = {"date": d.strftime("%Y-%m-%d"), "portfolio_value": float(v)}
        if cash is not None:
            row["cash"] = float(cash.loc[d])
        eq.append(row)

    perf = _read_json(_output_dir() / "performance_summary.json")
    trades = _read_trades()
    return {
        "summary": perf,
        "equity_curve": eq,
        "trades": json.loads(trades.to_json(orient="records")) if not trades.empty else [],
    }


@app.post("/api/run")
def run_pipeline() -> dict:
    """Trigger a synchronous re-run of the pipeline.

    The pipeline takes ~5s on the synthetic-data path, so we run it in the
    request rather than dispatching a job. A lock prevents concurrent runs.
    """
    if not _run_lock.acquire(blocking=False):
        return {"status": "already_running", "state": _run_state}
    try:
        _run_state["status"] = "running"
        _run_state["started_at"] = datetime.utcnow().isoformat()
        _run_state["error"] = None
        pipeline.run()
        _run_state["status"] = "ok"
        _run_state["finished_at"] = datetime.utcnow().isoformat()
        return {"status": "ok", "state": _run_state}
    except Exception as exc:    # noqa: BLE001
        _run_state["status"] = "error"
        _run_state["error"] = str(exc)
        _run_state["finished_at"] = datetime.utcnow().isoformat()
        raise HTTPException(500, f"Pipeline failed: {exc}")
    finally:
        _run_lock.release()
