"""Writes docs/data-licences.md from the data source registry (T1.7).
    python scripts/gen_data_licences.py            # write
    python scripts/gen_data_licences.py --check    # fail if the committed file differs
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "packages")]

from domain.data_sources import licences_markdown  # noqa: E402

OUT = ROOT / "docs" / "data-licences.md"


def main() -> int:
    body = licences_markdown()
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf8").replace("\r\n", "\n") == body
        print("data-licences.md up to date" if ok else "docs/data-licences.md is stale; run python scripts/gen_data_licences.py")
        return 0 if ok else 1
    OUT.write_text(body, encoding="utf8", newline="\n")
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
