"""Farmer call audio (ADR-10, T4.2). Default: a library of pre-recorded Punjabi and Hindi clips keyed by the SHA-256 of the
normalised script. Bhashini TTS is optional (TTS_PROVIDER=bhashini) and its output is cached under the same key. If Bhashini
fails, the library is used (spec section 13). DTMF prompts (press 1 / 2 / 9) come from a static set that never needs a
provider. There is no speech recognition: input is keypad only."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from integrations.bhashini import BhashiniClient, script_hash

log = logging.getLogger("audio")
LANGS = ("pa", "hi", "en")
DTMF_PROMPTS = ("press_1", "press_2", "press_9", "invalid_key", "thank_you", "callback_offer")


@dataclass(frozen=True)
class AudioResult:
    key: str
    source: str            # prerecorded | bhashini | bhashini-cache | missing
    audio: bytes | None    # None when no clip exists: the caller shows subtitles only and the gap is reported
    text: str


class AudioLibrary:
    """Pre-recorded clips: <root>/<lang>/<sha256>.wav, and static DTMF prompts: <root>/prompts/<lang>/<name>.wav."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def clip_path(self, text: str, lang: str) -> Path:
        return self.root / lang / f"{script_hash(text, lang)}.wav"

    def get(self, text: str, lang: str) -> bytes | None:
        p = self.clip_path(text, lang)
        return p.read_bytes() if p.exists() else None

    def prompt(self, name: str, lang: str) -> bytes | None:
        """Static DTMF prompt; falls back to English, then None. Never calls a provider."""
        for lg in (lang, "en"):
            p = self.root / "prompts" / lg / f"{name}.wav"
            if p.exists():
                return p.read_bytes()
        return None

    def coverage(self, required: Iterable[tuple[str, str]]) -> dict[str, Any]:
        """required: (lang, text) pairs. Reports which clips still have to be recorded."""
        req = sorted(set(required))
        missing = [{"lang": lg, "key": script_hash(t, lg), "text": t} for lg, t in req if not self.clip_path(t, lg).exists()]
        prompts_missing = [{"lang": lg, "prompt": n} for lg in ("pa", "hi") for n in DTMF_PROMPTS if not (self.root / "prompts" / lg / f"{n}.wav").exists()]
        return {"required": len(req), "present": len(req) - len(missing), "missing": missing, "prompts_missing": prompts_missing}


class AudioService:
    def __init__(self, library: AudioLibrary, provider: Callable[[], str], bhashini: BhashiniClient | None = None) -> None:
        self.library, self.provider, self.bhashini = library, provider, bhashini
        self.missing: list[tuple[str, str]] = []     # clips the library could not supply (surfaced to ops)

    def audio_for(self, text: str, lang: str) -> AudioResult:
        key = script_hash(text, lang)
        if self.provider() == "bhashini" and self.bhashini is not None:
            try:
                audio, cached = self.bhashini.synthesize(text, lang)
                return AudioResult(key, "bhashini-cache" if cached else "bhashini", audio, text)
            except Exception:  # noqa: BLE001 - Bhashini down: the library covers it
                log.warning("Bhashini unavailable; using the pre-recorded library")
        clip = self.library.get(text, lang)
        if clip is None:
            self.missing.append((lang, text))
        return AudioResult(key, "prerecorded" if clip is not None else "missing", clip, text)

    def dtmf_prompt(self, name: str, lang: str) -> bytes | None:
        return self.library.prompt(name, lang)
