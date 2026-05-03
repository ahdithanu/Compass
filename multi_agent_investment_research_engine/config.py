"""Central configuration for the multi-agent research system.

Anything a reviewer might want to tweak without editing agent internals -
the universe, signal weights, risk caps, allocation rules, output paths -
lives here. Agent code stays declarative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
CHARTS_DIR = OUTPUT_DIR / "charts"
CHROMA_DIR = DATA_DIR / "chroma"


# Tech demo slice - kept as a quick-run option for the original 9-name memo.
TECH_DEMO_UNIVERSE: tuple[str, ...] = (
    "NVDA", "MSFT", "AMZN", "META", "TSLA", "AMD", "PLTR", "CRWD", "SNOW",
)

# Benchmark used for relative-strength calculations in MarketAgent.
BENCHMARK_TICKER: str = "SPY"


@dataclass(frozen=True)
class SignalWeights:
    """Weights blend per-pillar scores into the composite signal score.

    Sum should equal 1.0. Exposed as a frozen dataclass so downstream code
    cannot mutate weights mid-run.
    """

    market: float = 0.30
    news: float = 0.20
    fundamentals: float = 0.30
    alternative: float = 0.20

    def as_dict(self) -> dict[str, float]:
        return {
            "market": self.market,
            "news": self.news,
            "fundamentals": self.fundamentals,
            "alternative": self.alternative,
        }


@dataclass(frozen=True)
class RatingThresholds:
    """Composite signal score (0-100) cutoffs for ratings."""

    buy: float = 70.0
    hold: float = 50.0
    # below `hold` = AVOID


@dataclass(frozen=True)
class RiskSettings:
    """Risk caps applied at the portfolio level."""

    max_position_size_pct: float = 0.10        # any single name
    minimum_cash_reserve_pct: float = 0.10     # never fully invested
    max_total_equity_pct: float = 0.90         # cap of risk-on exposure
    high_volatility_threshold: float = 0.45    # ann. vol above => trim 25%
    concentration_warning_pct: float = 0.20    # any name above => warn
    max_drawdown_warning_pct: float = 0.20


@dataclass(frozen=True)
class MarketSettings:
    period: str = "1y"
    interval: str = "1d"
    short_ma: int = 10
    long_ma: int = 50
    momentum_window: int = 20
    volatility_window: int = 20
    drawdown_window: int = 60
    rel_strength_window: int = 60


@dataclass(frozen=True)
class PortfolioSettings:
    starting_capital: float = 100_000.0
    rebalance_frequency: str = "W-FRI"          # weekly, Friday close
    max_positions: int = 15


@dataclass(frozen=True)
class UniverseSettings:
    """Universe selection. The cached SP500 is the default.

    `tickers`     - explicit ticker list (overrides everything else).
    `sectors`     - if set, restrict to these GICS sectors.
    `limit`       - cap to first-N after sector filter (handy for tests).
    `csv`         - filename inside `data_dir` to load constituents from.
    """

    name: str = "sp500"
    tickers: Optional[tuple[str, ...]] = None
    sectors: Optional[tuple[str, ...]] = None
    limit: Optional[int] = None
    csv: str = "sp500_constituents.csv"


@dataclass(frozen=True)
class FunnelSettings:
    """Two-stage funnel: cheap quant on all, expensive LangChain only on top-N.

    The quantitative pipeline (Market / News / Fundamentals / Alt-data /
    composite scoring / RiskAgent) runs on every ticker in the universe.
    The reasoning layer (retrieval, SignalReasoning, Thesis,
    OutboundAngle, Memo entries) runs only on the top-N by signal score
    so the demo stays affordable at 500-name scale.

    Set `top_n_for_reasoning=None` to run reasoning on the entire universe.
    """

    top_n_for_reasoning: Optional[int] = 25
    # Always include any name that cleared the BUY threshold, even if it
    # falls outside top_n. Useful when the universe is small.
    include_all_buy_rated: bool = True


@dataclass(frozen=True)
class Config:
    universe: UniverseSettings = field(default_factory=UniverseSettings)
    benchmark: str = BENCHMARK_TICKER

    market: MarketSettings = field(default_factory=MarketSettings)
    weights: SignalWeights = field(default_factory=SignalWeights)
    ratings: RatingThresholds = field(default_factory=RatingThresholds)
    risk: RiskSettings = field(default_factory=RiskSettings)
    portfolio: PortfolioSettings = field(default_factory=PortfolioSettings)
    funnel: FunnelSettings = field(default_factory=FunnelSettings)

    data_dir: Path = field(default_factory=lambda: DATA_DIR)
    output_dir: Path = field(default_factory=lambda: OUTPUT_DIR)
    charts_dir: Path = field(default_factory=lambda: CHARTS_DIR)
    chroma_dir: Path = field(default_factory=lambda: CHROMA_DIR)

    auto_generate_mock_data: bool = True
    random_seed: int = 7
    evidence_k: int = 6   # top-k retrieval per ticker


DEFAULT_CONFIG = Config()


# Convenience preset for the original tech-stock demo. Keeps the small
# universe + the legacy 6-position cap so a quick `--demo` run still works
# the same as before.
DEMO_CONFIG = Config(
    universe=UniverseSettings(
        name="tech_demo",
        tickers=TECH_DEMO_UNIVERSE,
        limit=None,
    ),
    portfolio=PortfolioSettings(
        starting_capital=100_000.0,
        rebalance_frequency="W-FRI",
        max_positions=6,
    ),
    risk=RiskSettings(
        max_position_size_pct=0.15,
        minimum_cash_reserve_pct=0.10,
        max_total_equity_pct=0.90,
        high_volatility_threshold=0.45,
        concentration_warning_pct=0.20,
        max_drawdown_warning_pct=0.20,
    ),
    funnel=FunnelSettings(top_n_for_reasoning=None),
)
