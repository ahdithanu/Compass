"""Central configuration for the multi-agent research system.

Anything a reviewer might want to tweak without editing agent internals -
the universe, signal weights, risk caps, allocation rules, output paths -
lives here. Agent code stays declarative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "outputs"
CHARTS_DIR = OUTPUT_DIR / "charts"
CHROMA_DIR = DATA_DIR / "chroma"


# Universe under research. Picked as a representative slice of US tech
# (megacap + GPU + cloud-data + cybersecurity).
DEFAULT_UNIVERSE: tuple[str, ...] = (
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

    max_position_size_pct: float = 0.15        # any single name
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
    max_positions: int = 6


@dataclass(frozen=True)
class Config:
    universe: tuple[str, ...] = DEFAULT_UNIVERSE
    benchmark: str = BENCHMARK_TICKER

    market: MarketSettings = field(default_factory=MarketSettings)
    weights: SignalWeights = field(default_factory=SignalWeights)
    ratings: RatingThresholds = field(default_factory=RatingThresholds)
    risk: RiskSettings = field(default_factory=RiskSettings)
    portfolio: PortfolioSettings = field(default_factory=PortfolioSettings)

    data_dir: Path = field(default_factory=lambda: DATA_DIR)
    output_dir: Path = field(default_factory=lambda: OUTPUT_DIR)
    charts_dir: Path = field(default_factory=lambda: CHARTS_DIR)
    chroma_dir: Path = field(default_factory=lambda: CHROMA_DIR)

    auto_generate_mock_data: bool = True
    random_seed: int = 7
    evidence_k: int = 6   # top-k retrieval per ticker


DEFAULT_CONFIG = Config()
