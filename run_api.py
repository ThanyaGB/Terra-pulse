"""Run the API: `python run_api.py` (set VAYU_* env vars or a .env file; see .env.example)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "services"), str(ROOT / "packages")]

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.app:app_factory", factory=True, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8010")),
                reload=False, log_level="info")
