"""Fire clustering (T1.5): deterministic single-linkage grouping of hotspots, each cluster assigned to the
nearest village polygon (approximated by a radius around the village centre)."""
from __future__ import annotations

from dataclasses import dataclass

from .firms import Hotspot
from .geo import VILLAGES, Place, haversine_km, nearest

LINK_KM = 1.5            # two detections closer than this belong to one cluster (VIIRS pixel ~0.375 km)
VILLAGE_RADIUS_KM = 12   # a cluster further than this from every pilot village is "unassigned"


@dataclass(frozen=True)
class FireCluster:
    id: str
    lat: float
    lon: float
    fires: int
    frp_total: float
    village_id: str | None
    village_distance_km: float


def cluster(hotspots: list[Hotspot], villages: list[Place] | None = None, link_km: float = LINK_KM) -> list[FireCluster]:
    villages = villages or VILLAGES
    pts = sorted(hotspots, key=lambda h: (round(h.lat, 5), round(h.lon, 5), h.acquired_at))
    parent = list(range(len(pts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # grid hash keeps this O(n) for the thousands of hotspots in a Punjab burning-season day
    cell = link_km / 111.0
    grid: dict[tuple[int, int], list[int]] = {}
    for i, h in enumerate(pts):
        key = (int(h.lat / cell), int(h.lon / cell))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((key[0] + dx, key[1] + dy), []):
                    if haversine_km(h.lat, h.lon, pts[j].lat, pts[j].lon) <= link_km:
                        parent[find(i)] = find(j)
        grid.setdefault(key, []).append(i)

    groups: dict[int, list[Hotspot]] = {}
    for i, h in enumerate(pts):
        groups.setdefault(find(i), []).append(h)

    out: list[FireCluster] = []
    for members in groups.values():
        lat = sum(m.lat for m in members) / len(members)
        lon = sum(m.lon for m in members) / len(members)
        v, dist = nearest(villages, lat, lon)
        assigned = v.id if dist <= VILLAGE_RADIUS_KM else None
        out.append(FireCluster("", round(lat, 5), round(lon, 5), len(members), round(sum(m.frp for m in members), 1), assigned, round(dist, 2)))
    out.sort(key=lambda c: (-c.fires, c.lat, c.lon))
    return [FireCluster(f"FC-{i + 1:04d}", c.lat, c.lon, c.fires, c.frp_total, c.village_id, c.village_distance_km) for i, c in enumerate(out)]


def fires_by_village(clusters: list[FireCluster]) -> dict[str, int]:
    out: dict[str, int] = {}
    for c in clusters:
        if c.village_id:
            out[c.village_id] = out.get(c.village_id, 0) + c.fires
    return out
