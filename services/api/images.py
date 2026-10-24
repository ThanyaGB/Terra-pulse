"""Photo privacy (ADR-12, T3.5, T3.6): re-encode so no EXIF survives except a GPS point coarsened to a 100 m grid cell."""
from __future__ import annotations

import io
import math
from typing import Any

from PIL import Image

GPS_IFD = 0x8825
CELL_M = 100.0          # ADR-12: GPS is stored as a 100 m grid cell
M_PER_DEG_LAT = 111_320.0


def coarse_grid(lat: float, lon: float, cell_m: float = CELL_M) -> tuple[float, float, str]:
    """Snap a point to the centre of its cell_m x cell_m cell. Returns (cell lat, cell lon, grid reference)."""
    dlat = cell_m / M_PER_DEG_LAT
    glat = (math.floor(lat / dlat) + 0.5) * dlat
    dlon = cell_m / (M_PER_DEG_LAT * math.cos(math.radians(glat)))
    glon = (math.floor(lon / dlon) + 0.5) * dlon
    return round(glat, 5), round(glon, 5), f"G{glat:+.4f}{glon:+.4f}"


def sanitise_photo(data: bytes, lat: float | None, lon: float | None, max_side: int = 1600, cell_m: float = CELL_M) -> tuple[bytes, str | None]:
    """Returns (jpeg bytes, grid reference). Pixels are copied into a fresh image so no metadata is carried over."""
    with Image.open(io.BytesIO(data)) as src:
        src.load()
        clean = Image.new("RGB", src.size)
        clean.paste(src.convert("RGB"))
    clean.thumbnail((max_side, max_side))
    exif = Image.Exif()
    ref = None
    if lat is not None and lon is not None:
        glat, glon, ref = coarse_grid(lat, lon, cell_m)
        gps: dict[int, Any] = {1: "N" if glat >= 0 else "S", 2: _dms(abs(glat)),
                               3: "E" if glon >= 0 else "W", 4: _dms(abs(glon))}
        exif[GPS_IFD] = gps
    out = io.BytesIO()
    clean.save(out, format="JPEG", quality=85, exif=exif)
    return out.getvalue(), ref


def _dms(deg: float) -> tuple[float, float, float]:
    d = int(deg)
    m = int((deg - d) * 60)
    s = (deg - d - m / 60) * 3600
    return float(d), float(m), round(s, 2)


def exif_keys(data: bytes) -> set[int]:
    with Image.open(io.BytesIO(data)) as im:
        return set(im.getexif().keys())
