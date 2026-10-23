"""Pre-commit secret scanner (T0.3, definition of done #5). Exit 1 with the offending lines when a file contains
credentials or an unmasked 10-digit Indian mobile number. Usage: python scripts/secret_scan.py FILE..."""
import re
import sys
from pathlib import Path

PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "generic secret assignment": re.compile(r"(?i)\b(?:secret|token|password|api[_-]?key)\b\s*[:=]\s*['\"][A-Za-z0-9/+_\-]{20,}['\"]"),
    "bearer token": re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{30,}"),
    "slack/github token": re.compile(r"\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{30,})\b"),
    "unmasked mobile number": re.compile(r"(?<![\d.])(?:\+91[- ]?)?[6-9]\d{4}[- ]?\d{5}(?![\d.])"),
}
ALLOW = re.compile(r"(?i)(example|placeholder|replace_me|dummy|test-secret|dev-only|contract-export|changeme|local-only|\bx{8,})")
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2", ".lock", ".svg", ".pyc", ".csv", ".sqlite"}
SKIP_NAMES = {"secret_scan.py", "package-lock.json"}
# files that legitimately hold sample numbers: the masking rules and their tests assert on these patterns
SKIP_PARTS = ("tests/", "docs/legacy/", "packages/contracts/", "node_modules/")


def scan(path: Path) -> list[str]:
    if path.suffix.lower() in SKIP_SUFFIX or path.name in SKIP_NAMES or any(p in path.as_posix() for p in SKIP_PARTS):
        return []
    try:
        text = path.read_text(encoding="utf8")
    except (UnicodeDecodeError, OSError):
        return []
    hits = []
    for n, line in enumerate(text.splitlines(), 1):
        if ALLOW.search(line):
            continue
        for label, rx in PATTERNS.items():
            if rx.search(line):
                hits.append(f"{path}:{n}: {label}")
    return hits


def main(argv: list[str]) -> int:
    bad = [h for a in argv for h in scan(Path(a))]
    if bad:
        print("secret scan failed:\n  " + "\n  ".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
