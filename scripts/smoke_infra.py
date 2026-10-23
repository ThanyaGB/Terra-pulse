"""Connects to each local service (T0.2). Run after `docker compose up -d`:  python scripts/smoke_infra.py"""
import os
import sys
import urllib.request

OK, FAIL = "ok", "FAIL"


def check_postgres() -> str:
    import psycopg
    url = os.environ.get("VAYU_DATABASE_URL", "postgresql://vayu:vayu_local@localhost:5432/vayu").replace("+psycopg", "")
    with psycopg.connect(url, connect_timeout=5) as c:
        c.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        c.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
        postgis = c.execute("SELECT postgis_version()").fetchone()[0]
        ts = c.execute("SELECT extversion FROM pg_extension WHERE extname='timescaledb'").fetchone()[0]
    return f"postgis {postgis}, timescaledb {ts}"


def check_redis() -> str:
    import redis
    r = redis.from_url(os.environ.get("VAYU_REDIS_URL", "redis://localhost:6379/0"), socket_connect_timeout=5)
    r.ping()
    r.xadd("vayu:smoke", {"x": "1"}, maxlen=10)
    return "ping ok, streams ok"


def check_minio() -> str:
    with urllib.request.urlopen(os.environ.get("MINIO_URL", "http://localhost:9000") + "/minio/health/live", timeout=5) as r:
        return f"health {r.status}"


def main() -> int:
    bad = 0
    for name, fn in (("postgres", check_postgres), ("redis", check_redis), ("minio", check_minio)):
        try:
            print(f"{OK:4} {name}: {fn()}")
        except Exception as exc:  # noqa: BLE001
            bad += 1
            print(f"{FAIL:4} {name}: {exc}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
