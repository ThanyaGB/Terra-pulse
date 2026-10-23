"""Pilot geography (Sangrur villages, East Delhi areas). Village coordinates come from the Open-Meteo geocoder;
those marked approx were not found there and are placed near the Sangrur block they belong to."""
from __future__ import annotations

from dataclasses import dataclass
from math import asin, atan2, cos, degrees, radians, sin, sqrt

# Punjab + Haryana + Delhi-NCR window used to filter FIRMS hotspots: min_lon, min_lat, max_lon, max_lat
REGION_BBOX = (73.8, 27.6, 77.6, 32.6)
EARTH_KM = 6371.0088


@dataclass(frozen=True)
class Place:
    id: str
    name: str
    lat: float
    lon: float
    approx: bool = False


VILLAGES = [
    Place("bhawanigarh", "Bhawanigarh", 30.26685, 76.03854),
    Place("sunam", "Sunam", 30.12883, 75.79943),
    Place("dhuri", "Dhuri", 30.36846, 75.86791),
    Place("lehragaga", "Lehragaga", 29.94265, 75.80144),
    Place("dirba", "Dirba", 30.07222, 75.99607),
    Place("moonak", "Moonak", 29.82529, 75.89055),
    Place("longowal", "Longowal", 30.19846, 75.6819),
    Place("cheema", "Cheema", 30.12, 75.67, True),
    Place("ladda", "Ladda", 30.31657, 75.82478),
    Place("kauhrian", "Kauhrian", 30.25, 75.78, True),
    Place("sherpur", "Sherpur", 30.28, 75.95, True),
    Place("andana", "Andana", 29.81232, 76.03721),
    Place("balian", "Balian", 30.37, 75.93, True),
    Place("ghabdan", "Ghabdan", 30.26832, 75.93722),
]

# East Delhi / NCR monitoring areas (also the policy dashboard grid cells)
AREAS = [
    Place("anand-vihar", "Anand Vihar", 28.6469, 77.3152),
    Place("patparganj", "Patparganj", 28.6280, 77.2950),
    Place("narela", "Narela", 28.8527, 77.0929),
    Place("rohini", "Rohini", 28.7495, 77.0565),
    Place("punjabi-bagh", "Punjabi Bagh", 28.6742, 77.131),
    Place("ito", "ITO", 28.6289, 77.241),
    Place("dwarka", "Dwarka", 28.5921, 77.046),
    Place("rk-puram", "R.K. Puram", 28.5633, 77.1869),
    Place("okhla", "Okhla", 28.5355, 77.275),
]

# Pilot neighbourhoods inside the East Delhi monitoring areas (citizen location switch). Their readings are
# downscaled from the monitored areas, so they differ only as far as the model resolves.
NEIGHBOURHOODS = [
    (Place("av-204", "Anand Vihar, Colony 204", 28.6502, 77.3101), "East Delhi · near ISBT", "anand-vihar"),
    (Place("av-isbt", "Anand Vihar, ISBT side", 28.6469, 77.3152), "East Delhi · arterial road", "anand-vihar"),
    (Place("pp-mv", "Patparganj, Mayur Vihar Ph-1", 28.6070, 77.2930), "East Delhi · residential", "patparganj"),
    (Place("pp-ind", "Patparganj Industrial Area", 28.6280, 77.3050), "East Delhi · industrial", "patparganj"),
]

SANGRUR = Place("sangrur", "Sangrur", 30.2458, 75.8421)
PUNJAB_SOURCE_POINTS = [SANGRUR, Place("patiala", "Patiala", 30.3398, 76.3869), Place("malerkotla", "Malerkotla", 30.5309, 75.8801)]
STATIONS_REGION = AREAS


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    a = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_KM * asin(sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2, dl = radians(lat1), radians(lat2), radians(lon2 - lon1)
    y = sin(dl) * cos(p2)
    x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
    return (degrees(atan2(y, x)) + 360) % 360


def move(lat: float, lon: float, bearing: float, km: float) -> tuple[float, float]:
    d, b, p1, l1 = km / EARTH_KM, radians(bearing), radians(lat), radians(lon)
    p2 = asin(sin(p1) * cos(d) + cos(p1) * sin(d) * cos(b))
    l2 = l1 + atan2(sin(b) * sin(d) * cos(p1), cos(d) - sin(p1) * sin(p2))
    return degrees(p2), degrees(l2)


def nearest(places: list[Place], lat: float, lon: float) -> tuple[Place, float]:
    best = min(places, key=lambda p: haversine_km(lat, lon, p.lat, p.lon))
    return best, haversine_km(lat, lon, best.lat, best.lon)
