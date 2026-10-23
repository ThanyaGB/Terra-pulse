"""Stubble Fire Risk Agent (T2.3). Scores parcels 7-10 days before harvest via packages/domain, aggregates
villages, and publishes `risk.updated`. Set force=True (dev/demo) to score outside the activation window."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from agents.common import BaseAgent, Event
from agents.common.events import DATA_NORMALISED, RISK_UPDATED
from agents.world import World
from domain import risk as risk_domain
from ingestion import ndvi as ndvi_mod
from ingestion.geo import VILLAGES, haversine_km
from ingestion.pipeline import hour_index

LATEST_SAFE_SOWING = (11, 15)      # wheat: latest safe sowing date, 15 November (configurable per season)
VILLAGE_AREA_KM2 = 30.0            # nominal village revenue-area used to turn a fire count into a density
CATCHMENT_KM = 15.0                # fires in neighbouring villages count: burning spreads by practice and by wind


class StubbleRiskAgent(BaseAgent):
    name = "risk_agent"
    subscribes = (DATA_NORMALISED,)

    def __init__(self, bus, world: World, force: bool = True, today: date | None = None, **kw: Any) -> None:  # type: ignore[no-untyped-def]
        super().__init__(bus, **kw)
        self.world, self.force, self._today = world, force, today
        self.weights = risk_domain.load_weights()
        self._scored_windows: set[str] = set()

    @property
    def today(self) -> date:
        return self._today or self.world.today

    def _village_inputs(self, village_id: str) -> tuple[float, float, float]:
        snap = self.world.snapshot
        assert snap is not None
        obs = snap.ndvi.get(village_id, [])
        slope = ndvi_mod.slope_per_day(obs) if len(obs) >= 2 else 0.0
        wx = snap.weather.get(village_id)
        sm = 0.0
        if wx is not None:
            raw = wx.at("soil_moisture_0_to_1cm", hour_index(wx, snap.fetched_at))
            sm = min(1.0, (raw or 0.0) / 0.5)   # volumetric m3/m3, 0.5 ~ saturation
        v = next(x for x in VILLAGES if x.id == village_id)
        nearby = sum(1 for h in snap.hotspots if haversine_km(v.lat, v.lon, h.lat, h.lon) <= CATCHMENT_KM)
        return slope, sm, nearby / VILLAGE_AREA_KM2

    def _shortfall(self, machine_need: str) -> float:
        machines = [m for m in self.world.crm.list_machines() if m.type == machine_need]
        free = sum(1 for m in machines if m.status == "available")
        return 1.0 - free / len(machines) if machines else 1.0

    async def handle(self, event: Event) -> None:
        window = event.payload["window"]
        if window in self._scored_windows:    # one scoring pass per window, however many grid events arrive
            return
        self._scored_windows.add(window)
        if self.world.snapshot is None:
            return
        by_village: dict[str, list[float]] = {}
        for p in self.world.parcels.values():
            if not (self.force or risk_domain.is_active(self.today, p.harvest_start, self.weights)):
                continue
            slope, sm, density = self._village_inputs(p.village_id)
            sow_end = date(p.harvest_start.year, *LATEST_SAFE_SOWING)
            window_days = risk_domain.sowing_window_days(p.harvest_start + timedelta(days=int(p.acres // 4) + 2), sow_end)
            res = risk_domain.risk_score(risk_domain.RiskInputs(slope, window_days, sm, density, self._shortfall(p.machine_need)), self.weights)
            rec: dict[str, Any] = {"parcel_id": p.id, "village_id": p.village_id, "score": res.score, "tier": res.tier,
                                   "components": res.components, "scored_at": event.emitted_at}
            self.world.risk[p.id] = rec
            by_village.setdefault(p.village_id, []).append(res.score)
            await self.emit(event.child(RISK_UPDATED, {"parcel_id": p.id, "score": res.score, "tier": res.tier, "village_id": p.village_id}))
        self.world.village_risk = {v: {"mean_score": round(sum(s) / len(s), 1), "parcels": len(s)} for v, s in by_village.items()}
