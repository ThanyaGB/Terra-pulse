"""Exports the contract artefacts: OpenAPI 3.1 spec and event JSON Schemas into packages/contracts/.
    python scripts/export_contracts.py            # write
    python scripts/export_contracts.py --check    # fail if the committed files differ (CI contract diff)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services"), str(ROOT / "packages")]

from api.app import create_app  # noqa: E402
from api.settings import Settings  # noqa: E402
from contracts.events import PAYLOADS, event_schema  # noqa: E402

OUT = ROOT / "packages" / "contracts"


def build() -> dict[str, str]:
    app = create_app(Settings(env="dev", jwt_secret="contract-export", data_mode="offline", outbox_path=":memory:"), background=False)
    files = {"openapi.json": json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"}
    for name in PAYLOADS:
        files[f"events/{name}.json"] = json.dumps(event_schema(name), indent=2, sort_keys=True) + "\n"
    return files


def main() -> int:
    files = build()
    if "--check" in sys.argv:
        stale = [n for n, body in files.items() if not (OUT / n).exists() or (OUT / n).read_text(encoding="utf8") != body]
        if stale:
            print("contract drift in:", ", ".join(stale), "\nrun: python scripts/export_contracts.py")
            return 1
        print("contracts up to date")
        return 0
    for n, body in files.items():
        (OUT / n).parent.mkdir(parents=True, exist_ok=True)
        (OUT / n).write_text(body, encoding="utf8")
    print("wrote", len(files), "files to", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
