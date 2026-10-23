"""Raw object storage, partitioned by source and date (spec 6.2). Local filesystem here; the S3/MinIO
implementation has the same two methods and is selected by settings."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol


class RawStore(Protocol):
    def put(self, source: str, name: str, data: bytes) -> str: ...
    def list(self, source: str) -> list[str]: ...


class FileRawStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def put(self, source: str, name: str, data: bytes) -> str:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        path = self.root / source / day / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

    def list(self, source: str) -> list[str]:
        base = self.root / source
        return sorted(str(p) for p in base.rglob("*") if p.is_file()) if base.exists() else []


class S3RawStore:
    """MinIO / S3-compatible. Requires boto3 (not installed by default)."""

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str) -> None:
        import boto3

        self.s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=access_key, aws_secret_access_key=secret_key)
        self.bucket = bucket

    def put(self, source: str, name: str, data: bytes) -> str:
        key = f"{source}/{datetime.now(timezone.utc):%Y-%m-%d}/{name}"
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        return f"s3://{self.bucket}/{key}"

    def list(self, source: str) -> list[str]:
        res = self.s3.list_objects_v2(Bucket=self.bucket, Prefix=source + "/")
        return [o["Key"] for o in res.get("Contents", [])]
