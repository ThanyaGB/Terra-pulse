"""Platform signing key (T3.4). Ed25519. In staging and production the key is a 32-byte seed from the secret manager
(VAYU_SIGNING_KEY, base64). In dev, if none is set, an ephemeral key is generated at start-up: signatures from it do not
survive a restart. The signing method itself (this Ed25519 signature, not a PAdES certificate signature) is a gate G2 decision."""
from __future__ import annotations

import base64
import hashlib

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


class Signer:
    def __init__(self, seed_b64: str | None = None) -> None:
        if seed_b64:
            seed = base64.b64decode(seed_b64)
            if len(seed) != 32:
                raise ValueError("signing key must be a base64-encoded 32-byte Ed25519 seed")
            self._key = Ed25519PrivateKey.from_private_bytes(seed)
            self.ephemeral = False
        else:
            self._key = Ed25519PrivateKey.generate()
            self.ephemeral = True

    @property
    def public_bytes(self) -> bytes:
        return self._key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    @property
    def key_id(self) -> str:
        return hashlib.sha256(self.public_bytes).hexdigest()[:16]

    def sign(self, payload: bytes) -> bytes:
        return self._key.sign(payload)


def verify(public_bytes: bytes, payload: bytes, signature: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public_bytes).verify(signature, payload)
        return True
    except InvalidSignature:
        return False
