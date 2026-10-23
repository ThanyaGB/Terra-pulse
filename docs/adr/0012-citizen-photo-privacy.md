# ADR-12: Privacy for citizen photo reports

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Photo uploads are stripped of EXIF except the GPS point, which is stored as a coarse grid reference; reports get a reference ID and no personal identifiers.

## Implementation

`api/images.py` re-encodes the pixels into a new image (no metadata carried over) and writes only a GPS IFD rounded to a ~1 km grid. Tested by reading the saved file's EXIF.
