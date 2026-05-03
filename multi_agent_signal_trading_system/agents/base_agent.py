"""BaseAgent: shared behavior for every agent in the pipeline.

Every agent in this system inherits from `BaseAgent`. The base class enforces
a minimal contract:

* Each agent has a `name` and a `description`.
* Each agent exposes a `run(...)` method whose signature varies per agent.
* Each agent owns an `AgentLogger` so its console output is consistent and
  readable when a reviewer follows the pipeline end-to-end.

We intentionally avoid heavier abstractions (no message bus, no async event
loop). The pipeline is a deterministic, ordered DAG today and that is enough
for the simulation goals of the project.
"""

from __future__ import annotations

import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class AgentLogger:
    """Tiny structured logger keyed by agent name.

    We avoid the stdlib `logging` module here for two reasons:
    1. The desired output is human-readable narration of the pipeline, not
       structured logs that would be parsed by ops tooling.
    2. We want the user to see logs immediately, in order, even when stdout is
       buffered (CI / nohup style runs).
    """

    name: str
    verbose: bool = True

    def info(self, message: str) -> None:
        if not self.verbose:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] [{self.name}] {message}", file=sys.stdout, flush=True)

    def warn(self, message: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}] [{self.name}] WARNING: {message}", file=sys.stderr, flush=True)


class BaseAgent(ABC):
    """Abstract base class for all agents.

    Subclasses must define `name`, `description`, and implement `run`.
    `run` signatures vary by agent because each agent consumes different
    inputs - a single uniform signature would force everything through a
    bag-of-kwargs dict, which is worse for type-checking and readability.
    """

    name: str = "BaseAgent"
    description: str = "Override me."

    def __init__(self, verbose: bool = True) -> None:
        self.logger = AgentLogger(name=self.name, verbose=verbose)

    @abstractmethod
    def run(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover - abstract
        ...

    def log(self, message: str) -> None:
        self.logger.info(message)
