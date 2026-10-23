"""Photo privacy (ADR-12, T3.5): re-encode so no EXIF survives except a GPS point coarsened to a ~1 km grid reference."""
from __future__ import annotations

import io
from typing import Any

from PIL import Image

GPS_IFD = 0x8825
GRID_DEG = 0.01   # ~1.1 km


def coarse_grid(lat: float, lon: float) -> tuple[float, float, str]:
    glat, glon = round(round(lat / GRID_DEG) * GRID_DEG, 2), round(round(lon / GRID_DEG) * GRID_DEG, 2)
    return glat, glon, f"G{glat:+.2f}{glon:+.2f}"


def sanitise_photo(data: bytes, lat: float | None, lon: float | None, max_side: int = 1600) -> tuple[bytes, str | None]:
    """Returns (jpeg bytes, grid reference). Pixels are copied into a fresh image so no metadata is carried over."""
    with Image.open(io.BytesIO(data)) as src:
        src.load()
        clean = Image.new("RGB", src.size)
        clean.paste(src.convert("RGB"))
    clean.thumbnail((max_side, max_side))
    exif = Image.Exif()
    ref = None
    if lat is not None and lon is not None:
        glat, glon, ref = coarse_grid(lat, lon)
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
