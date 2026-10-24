from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

# Versioned config lives in the repo-root `config/` (spec section 14). Files that v2.0 does not move (farmer scripts,
# health advice) stay in packages/domain/config/ and are found by the fallback.
ROOT_CONFIG_DIR = Path(os.environ.get("VAYU_CONFIG_DIR") or Path(__file__).resolve().parents[2] / "config")
CONFIG_DIR = Path(__file__).parent / "config"


def load_yaml(name: str, directory: Path | None = None) -> dict[str, Any]:
    if directory is not None:
        path = directory / name
    else:
        path = ROOT_CONFIG_DIR / name
        if not path.exists():
            path = CONFIG_DIR / name
    with open(path, encoding="utf8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{name} must contain a mapping")
    return data
