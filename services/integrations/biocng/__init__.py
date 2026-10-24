"""Bio-CNG / briquette partners (T4.5): collection requests out, weighbridge receipts in, reconciled to the FPO
ledger. A receipt whose weight differs from the request by more than the tolerance raises a reconciliation item.
The floor price comes from an active partner contract (ADR-17); without one the request carries no rate."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

WEIGHT_TOLERANCE_PCT = 5.0


@dataclass
class CollectionRequest:
    request_id: str
    parcel_id: str
    estimated_tonnes: float
    floor_price_inr: int | None     # None when no active contract backs a rate (ADR-17)
    status: str = "requested"


@dataclass
class LedgerEntry:
    request_id: str
    tonnes: float
    amount_inr: int | None          # None when the request had no contract rate


@dataclass
class ReconciliationItem:
    request_id: str
    expected_tonnes: float
    received_tonnes: float
    reason: str


class BioCngPartner:
    def __init__(self, send: Callable[[CollectionRequest], None] | None = None) -> None:
        self.send = send or (lambda _r: None)
        self.requests: dict[str, CollectionRequest] = {}
        self.ledger: list[LedgerEntry] = []
        self.reconciliation: list[ReconciliationItem] = []

    def request_collection(self, request: CollectionRequest) -> CollectionRequest:
        self.send(request)
        self.requests[request.request_id] = request
        return request

    def weighbridge_receipt(self, request_id: str, tonnes: float) -> LedgerEntry | ReconciliationItem:
        req = self.requests.get(request_id)
        if req is None:
            item = ReconciliationItem(request_id, 0.0, tonnes, "receipt without a matching request")
            self.reconciliation.append(item)
            return item
        drift = abs(tonnes - req.estimated_tonnes) / req.estimated_tonnes * 100 if req.estimated_tonnes else 100.0
        if drift > WEIGHT_TOLERANCE_PCT:
            item = ReconciliationItem(request_id, req.estimated_tonnes, tonnes, f"weight differs by {drift:.1f}%")
            self.reconciliation.append(item)
            return item
        req.status = "reconciled"
        entry = LedgerEntry(request_id, tonnes, round(tonnes * req.floor_price_inr) if req.floor_price_inr is not None else None)
        self.ledger.append(entry)
        return entry
