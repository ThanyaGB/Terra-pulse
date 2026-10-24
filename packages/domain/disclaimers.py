"""Required disclaimers (ADR-18), served from config/disclaimers.yaml so legal can change wording without a release."""
from __future__ import annotations

from .config import load_yaml


def disclaimer(kind: str, lang: str = "en") -> str:
    texts = load_yaml("disclaimers.yaml")["disclaimers"][kind]
    return str(texts.get(lang) or texts["en"])


def all_disclaimers() -> dict[str, dict[str, str]]:
    return {k: dict(v) for k, v in load_yaml("disclaimers.yaml")["disclaimers"].items()}
