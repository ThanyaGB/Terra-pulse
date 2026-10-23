# ADR-06: Phone number masking by default

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmer phone numbers are masked (`98721-XXXXX`) in every API response and UI display. The only exception is the assigned machinery operator on a confirmed booking, shown to the farmer and FPO coordinator for that booking.

## Implementation

`api/masking.py`: every JSON response passes through `MaskedJSONResponse`, so a handler cannot leak a number by forgetting to mask; the single exception is the explicit `clear()` wrapper used in `booking_view` for confirmed bookings. Tested in `tests/contract/test_api.py`.
