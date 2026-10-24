"""Offline risk-weight calibration (T2.8). Runs only with CALIBRATION_MODE on. Writes a report, never config.
    python scripts/calibrate_risk.py --samples pilot_samples.csv --out var/calibration/report.json"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services"), str(ROOT / "packages")]

from domain.calibration import calibration_report  # noqa: E402
from domain.features import FeatureFlags  # noqa: E402


def run(samples: Path, out: Path, flags: FeatureFlags) -> dict[str, Any]:
    if not flags.enabled("CALIBRATION_MODE"):
        raise SystemExit("CALIBRATION_MODE is off. An admin enables it (audited) before an offline calibration run.")
    report = calibration_report(samples.read_text(encoding="utf8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1, sort_keys=True), encoding="utf8")
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", required=True)
    ap.add_argument("--out", default="var/calibration/report.json")
    ap.add_argument("--flags-state", default="var/feature_overrides.json", help="admin flag overrides file written by the API")
    a = ap.parse_args()
    report = run(Path(a.samples), Path(a.out), FeatureFlags.load(overrides_path=a.flags_state))
    print("report written to", a.out, "- proposed weights:", report["proposed_weights"], "(config not changed)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
