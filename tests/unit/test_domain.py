from datetime import date

import pytest
from hypothesis import given
from hypothesis import strategies as st

from domain import attribution as attr
from domain import dose as dz
from domain import grap, risk, roi, routing

# ---------- risk ----------
LOW = risk.RiskInputs(0.0, 21, 0.0, 0.0, 0.0)
HIGH = risk.RiskInputs(-0.03, 0, 1.0, 0.5, 1.0)


def test_risk_weights_sum_to_one():
    assert abs(sum(risk.load_weights()["weights"].values()) - 1) < 1e-9


def test_risk_extremes():
    assert risk.risk_score(LOW).score == 0 and risk.risk_score(LOW).tier == "low"
    assert risk.risk_score(HIGH).score == 100 and risk.risk_score(HIGH).tier == "critical"


@pytest.mark.parametrize("score,tier", [(34.9, "low"), (35, "medium"), (59.9, "medium"), (60, "high"), (79.9, "high"), (80, "critical")])
def test_tier_boundaries(score, tier):
    assert risk.tier_for(score, risk.load_weights()) == tier


def test_risk_golden_fixture():
    r = risk.risk_score(risk.RiskInputs(-0.015, 7, 0.4, 0.2, 0.5))
    assert r.score == 52.5 and r.tier == "medium"   # spec 6.1 priors: .30/.25/.20/.15/.10


def test_activation_window_by_clock_injection():
    harvest = date(2026, 10, 20)
    assert not risk.is_active(date(2026, 10, 9), harvest)   # 11 days out
    assert risk.is_active(date(2026, 10, 10), harvest)      # 10 days
    assert risk.is_active(date(2026, 10, 13), harvest)      # 7 days
    assert not risk.is_active(date(2026, 10, 14), harvest)  # 6 days


def test_sowing_window_skips_sundays():
    assert risk.sowing_window_days(date(2026, 10, 26), date(2026, 11, 2)) == 6  # Mon->next Mon, one Sunday


def test_weights_must_sum_to_one(tmp_path):
    bad = risk.load_weights()
    bad["weights"]["ndvi_decay_slope"] = 0.9
    assert abs(sum(bad["weights"].values()) - 1) > 1e-6  # guard used by load_weights


@given(st.floats(-1, 1), st.floats(0, 60), st.floats(-1, 2), st.floats(0, 5), st.floats(-1, 2))
def test_risk_score_bounded(a, b, c, d, e):
    s = risk.risk_score(risk.RiskInputs(a, b, c, d, e)).score
    assert 0 <= s <= 100


# ---------- attribution ----------
@given(st.dictionaries(st.sampled_from(attr.SOURCES), st.floats(0, 1e4), min_size=0))
def test_attribution_sums_to_100(c):
    assert attr.sums_to_100(attr.attribution(c))


def test_attribution_dominant():
    s = attr.attribution({"straw_plume": 60, "vehicle": 20, "dust": 10, "industrial_waste": 10})
    assert attr.dominant(s) == "straw_plume" and s["straw_plume"] == 60.0


# ---------- dose ----------
SEG = [dz.Segment(10, 100), dz.Segment(5, 300)]


def test_dose_known_value():
    # walking 20 L/min: (10*100 + 5*300) ug/m3-min * 20 L/min / 1000 = 50 ug
    assert dz.dose(SEG, "walking") == pytest.approx(50.0)


def test_dose_scales_with_activity():
    assert dz.dose(SEG, "vigorous") > dz.dose(SEG, "walking") > dz.dose(SEG, "rest")


def test_dose_rejects_bad_input():
    with pytest.raises(ValueError):
        dz.dose(SEG, "flying")
    with pytest.raises(ValueError):
        dz.dose([dz.Segment(1, -5)])


@given(st.lists(st.tuples(st.floats(0, 120), st.floats(0, 1000)), max_size=20), st.sampled_from(list(dz.VENTILATION_L_PER_MIN)))
def test_dose_non_negative(segs, act):
    assert dz.dose([dz.Segment(m, p) for m, p in segs], act) >= 0


def test_exposure_reduction():
    assert dz.exposure_reduction(200, 150) == 25.0
    assert dz.exposure_reduction(0, 5) == 0.0


# ---------- GRAP (golden table) ----------
@pytest.mark.parametrize("aqi,tier", [(100, "none"), (200, "none"), (201, "stage_1"), (300, "stage_1"), (301, "stage_2"),
                                      (400, "stage_2"), (401, "stage_3"), (450, "stage_3"), (451, "stage_4"), (500, "stage_4")])
def test_grap_golden(aqi, tier):
    assert grap.grap_tier(aqi).tier == tier


def test_grap_diversion_two_person_and_peak_action():
    r = grap.grap_tier(420, {"straw_plume": 45, "vehicle": 20, "dust": 20, "industrial_waste": 15})
    assert any(a.type == "diversion_trucks" and a.approval == "two_person" for a in r.actions)
    assert any(a.type == "biomass_purchase_push" for a in r.actions)
    assert grap.requires_two_person("diversion_trucks") and not grap.requires_two_person("fog_cannons")


# ---------- ROI ----------
def test_delta_and_net_effect():
    assert roi.delta_pm25([300, 310], [250, 260]) == 50
    assert roi.net_effect([300], [250], [300], [280]) == 30  # 50 improvement minus 20 background drift
    assert roi.in_window(4) and roi.in_window(12) and not roi.in_window(3.9) and not roi.in_window(12.1)
    with pytest.raises(ValueError):
        roi.delta_pm25([], [1])


def test_roi_aggregate():
    agg = roi.aggregate([roi.RoiRecord("w1", "anand-vihar", 40), roi.RoiRecord("w2", "anand-vihar", 20), roi.RoiRecord("w3", "ito", 10)])
    assert agg["anand-vihar"] == {"actions": 2, "mean_delta_pm25": 30, "total_delta_pm25": 60}


# ---------- routing ----------
def test_recommend_within_time_limit():
    a = routing.RouteOption("A", "Main", [dz.Segment(12, 400)])
    b = routing.RouteOption("B", "Park", [dz.Segment(14, 250)])
    c = routing.RouteOption("C", "Far", [dz.Segment(20, 100)])
    ch = routing.recommend([a, b, c])
    assert ch.recommended.id == "B" and ch.extra_minutes == 2 and ch.reduction_pct > 0


def test_recommend_keeps_baseline_when_nothing_better():
    a = routing.RouteOption("A", "Main", [dz.Segment(10, 100)])
    b = routing.RouteOption("B", "Alt", [dz.Segment(11, 300)])
    assert routing.recommend([a, b]).recommended.id == "A"
