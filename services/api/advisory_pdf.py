"""Signed PDF advisory for an approved directive (ADR-14, T3.4, T4.6). The platform sends nothing to any traffic system: a policy
officer downloads this file and sends it through official channels. The page text is built from `payload`; the same payload
(canonical JSON) is signed with the platform key and embedded in the PDF Info dictionary together with the signature, so the
document can be checked with `verify_pdf` and the public key. The text uses the standard Helvetica font (Latin-1 only), so the
PDF carries the English disclaimer; Hindi and Punjabi wording stays in the apps."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from api import signing

LEFT, TOP, LEADING = 56, 790, 17


def canonical(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _esc(s: str) -> str:
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str, width: int = 88) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    return lines + ([cur] if cur else [])


def _page_lines(payload: dict[str, Any], key_id: str) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = [("Vayu-Swachh | Advisory (recommendation to authorities)", 15), ("", 11)]
    for label, value in (("Directive ID", payload["directive_id"]), ("Type", payload["type"]), ("Area", ", ".join(payload["areas"]) or "-"),
                         ("Issued at", payload["issued_at"]), ("Created by", payload["created_by"]), ("Approved by", payload["approved_by"] or "not required for this type"),
                         ("Approved at", payload["approved_at"] or "-")):
        out.append((f"{label}: {value}", 11))
    out += [("", 11), ("Recommended action", 12)]
    out += [(ln, 11) for ln in _wrap(payload["action"])]
    out += [("", 11), ("Disclaimer", 12)]
    out += [(ln, 11) for ln in _wrap(payload["disclaimer"])]
    out += [("", 11), (f"Platform signature key: {key_id}", 9), ("The signed payload is embedded in this file (see /VayuPayload).", 9)]
    return out


def build_pdf(payload: dict[str, Any], signer: signing.Signer) -> bytes:
    body = canonical(payload)
    sig = signer.sign(body)
    content = ["BT"]
    y = TOP
    for text, size in _page_lines(payload, signer.key_id):
        content.append(f"/F1 {size} Tf 1 0 0 1 {LEFT} {y} Tm ({_esc(text)}) Tj")
        y -= LEADING
    content.append("ET")
    stream = "\n".join(content).encode("latin-1")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            (f"<< /Title (Advisory {_esc(payload['directive_id'])}) /Producer (Vayu-Swachh) /VayuKeyId ({signer.key_id}) "
             f"/VayuPayload <{body.hex()}> /VayuSignature <{sig.hex()}> >>").encode()]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def read_signed_payload(pdf: bytes) -> tuple[dict[str, Any], bytes, bytes]:
    """(payload, canonical payload bytes, signature) as embedded in the PDF."""
    import re
    pm = re.search(rb"/VayuPayload <([0-9a-f]+)>", pdf)
    sm = re.search(rb"/VayuSignature <([0-9a-f]+)>", pdf)
    if not pm or not sm:
        raise ValueError("not a Vayu-Swachh signed advisory")
    raw = bytes.fromhex(pm.group(1).decode())
    return json.loads(raw), raw, bytes.fromhex(sm.group(1).decode())


def verify_pdf(pdf: bytes, public_bytes: bytes) -> bool:
    """True if the embedded signature verifies AND every line printed on the page is the one built from the signed payload."""
    try:
        payload, raw, sig = read_signed_payload(pdf)
    except ValueError:
        return False
    if not signing.verify(public_bytes, raw, sig):
        return False
    key_id = hashlib.sha256(public_bytes).hexdigest()[:16]
    return all(f"({_esc(text)}) Tj".encode("latin-1") in pdf for text, _ in _page_lines(payload, key_id) if text)
