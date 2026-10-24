"""Bhashini TTS adapter (T4.2), used only when TTS_PROVIDER=bhashini. Generated audio is cached by SHA-256 of the normalised
script (ADR-10), so an identical script never triggers a second provider call. There is no speech recognition anywhere:
farmers act by keypad only (ADR-09)."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from pathlib import Path
from typing import Callable

import httpx

LANG_CODES = {"pa": "pa", "hi": "hi", "en": "en"}


def normalise_script(text: str, lang: str) -> str:
    t = unicodedata.normalize("NFC", text).strip()
    return re.sub(r"\s+", " ", t) + f"|{lang}"


def script_hash(text: str, lang: str) -> str:
    return hashlib.sha256(normalise_script(text, lang).encode("utf8")).hexdigest()


class AudioCache:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def get(self, key: str) -> bytes | None:
        p = self.root / f"{key}.wav"
        return p.read_bytes() if p.exists() else None

    def put(self, key: str, audio: bytes) -> None:
        (self.root / f"{key}.wav").write_bytes(audio)


class BhashiniClient:
    """ULCA/Dhruva-style compute call. The endpoint and credentials come from settings; the transport is injectable."""

    def __init__(self, url: str, api_key: str, cache: AudioCache, tts: Callable[[str, str], bytes] | None = None,
                 client: httpx.Client | None = None) -> None:
        self.url, self.key, self.cache = url, api_key, cache
        self._tts = tts or self._http_tts
        self.client = client or httpx.Client(timeout=30)
        self.provider_calls = 0

    def _http_tts(self, text: str, lang: str) -> bytes:
        r = self.client.post(self.url, headers={"Authorization": self.key}, json={
            "pipelineTasks": [{"taskType": "tts", "config": {"language": {"sourceLanguage": LANG_CODES[lang]}, "gender": "female"}}],
            "inputData": {"input": [{"source": text}]}})
        r.raise_for_status()
        import base64
        return base64.b64decode(r.json()["pipelineResponse"][0]["audio"][0]["audioContent"])

    def synthesize(self, text: str, lang: str) -> tuple[bytes, bool]:
        """Returns (audio, from_cache)."""
        key = script_hash(text, lang)
        hit = self.cache.get(key)
        if hit is not None:
            return hit, True
        self.provider_calls += 1
        audio = self._tts(text, lang)
        self.cache.put(key, audio)
        return audio, False
