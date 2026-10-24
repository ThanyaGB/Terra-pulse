"""ADR-17: a rate exists only when an active contract backs it; unconfirmed config rows count as absent."""
from datetime import date

import pytest

from domain import partners
from domain.config import load_yaml

ROW = {"contract_id": "PC-1", "area_id": "sangrur", "status": "active", "valid_from": None, "valid_to": None,
       "rates": {"straw_floor_inr_per_tonne": 1650}}


def test_shipped_config_has_no_active_contract():
    assert all(c["status"] != "active" for c in load_yaml("partner_rates.yaml")["contracts"])
    assert partners.rate("sangrur", "straw_floor_inr_per_tonne") is None


def test_active_contract_returns_rate_with_source():
    r = partners.rate("sangrur", "straw_floor_inr_per_tonne", contracts=[ROW])
    assert r is not None and r.value == 1650 and r.source == "partner_contract:PC-1"


@pytest.mark.parametrize("patch", [{"status": "unconfirmed"}, {"status": "expired"}, {"area_id": "patiala"}, {"valid_to": "2020-01-01"}, {"valid_from": "2999-01-01"}])
def test_inactive_or_other_area_contract_gives_no_rate(patch):
    assert partners.rate("sangrur", "straw_floor_inr_per_tonne", date(2026, 10, 24), [{**ROW, **patch}]) is None


def test_missing_rate_key_is_absent():
    assert partners.rate("sangrur", "nope", contracts=[ROW]) is None
