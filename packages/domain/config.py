from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).parent / "config"


def load_yaml(name: str, directory: Path | None = None) -> dict[str, Any]:
    with open((directory or CONFIG_DIR) / name, encoding="utf8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{name} must contain a mapping")
    return data
