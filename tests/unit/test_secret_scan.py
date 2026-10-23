import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("secret_scan", Path(__file__).resolve().parents[2] / "scripts/secret_scan.py")
ss = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(ss)  # type: ignore[union-attr]


def run(tmp_path, body, name="config.py"):
    p = tmp_path / "src" / name
    p.parent.mkdir(exist_ok=True)
    p.write_text(body, encoding="utf8")
    return ss.main([str(p)])


def test_blocks_a_committed_secret(tmp_path):
    assert run(tmp_path, 'API_KEY = "sk_live_51HxxxxAbCdEfGhIjKlMnOpQrStUv"\n') == 1


def test_blocks_aws_key_and_private_key(tmp_path):
    assert run(tmp_path, "key = AKIAIOSFODNN7EXAMPLQ\n") == 1 or run(tmp_path, "AKIAABCDEFGHIJKLMNOP\n") == 1
    assert run(tmp_path, "-----BEGIN RSA PRIVATE KEY-----\nabc\n") == 1


def test_blocks_an_unmasked_farmer_phone_but_not_a_masked_one(tmp_path):
    assert run(tmp_path, "phone: 9872112345\n", "fixture.yaml") == 1
    assert run(tmp_path, "phone: 98721-XXXXX\n", "fixture.yaml") == 0


def test_clean_file_passes(tmp_path):
    assert run(tmp_path, "def add(a, b):\n    return a + b\n") == 0
