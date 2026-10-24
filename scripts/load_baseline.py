"""Build and store the pilot baseline snapshot (T1.6).
    python scripts/load_baseline.py --firms firms_sangrur_2023_2025.csv --cpcb cpcb_delhi_history.csv --pre-end 2025-09-30
The archive inputs are downloaded by a person (FIRMS archive request, CPCB/OGD history export); see docs/adr/0023-pilot-baseline.md."""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services"), str(ROOT / "packages")]

from ingestion import baseline  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--firms", required=True)
    ap.add_argument("--cpcb", required=True)
    ap.add_argument("--pre-end", required=True, help="last date (YYYY-MM-DD) of the pre-period")
    ap.add_argument("--out", default="var/baseline")
    a = ap.parse_args()
    snap = baseline.build_baseline(Path(a.firms).read_text(encoding="utf8"), Path(a.cpcb).read_text(encoding="utf8"), a.pre_end)
    path = baseline.save(snap, a.out)
    print(snap["snapshot_id"], path)
    print("controls kept:", ", ".join(snap["body"]["air"]["pre_period"]["selected"]) or "none")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
