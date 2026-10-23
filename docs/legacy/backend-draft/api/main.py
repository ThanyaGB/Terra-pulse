"""
Vayu-Swachh API server.

Serves the REST + WebSocket contract the web front end expects (frontend/src/api/contract.ts):
  REST  /api/v1/...        WebSocket  /ws/v1/stream
Reference data lives in data/seed.json (exported from the front end's fixtures by
frontend/scripts/dump-seed.ts); state-changing endpoints mutate it in memory.
The original data-driven routers (/api/v1/aqi, /attribution, /plume) are mounted as well.
No database or Redis is needed to run this.
"""
import asyncio
import copy
import json
import random
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from api.routers import aqi, attribution, plume

SEED = json.loads((Path(__file__).resolve().parent.parent / "data" / "seed.json").read_text(encoding="utf8"))

app = FastAPI(title="Vayu-Swachh API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (aqi.router, attribution.router, plume.router):
    app.include_router(r, prefix="/api")

V1 = "/api/v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def rid(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(3).upper()}"


# Mutable session state
machinery = copy.deepcopy(SEED["machinery"])
farmers = copy.deepcopy(SEED["farmers"]["farmers"])
call_logs = {k: copy.deepcopy(v["log"]) for k, v in SEED["callDetails"].items()}
report_counter = 4200


def find_farmer(fid: str):
    f = next((x for x in farmers if x["id"] == fid), None)
    if not f:
        raise HTTPException(404, "Farmer not found")
    return f


def label_of(t: str) -> str:
    return {"baler": "baler", "super_seeder": "Super Seeder"}.get(t, "Happy Seeder")


# ---------- policy ----------
@app.get(f"{V1}/policy/attribution")
def get_attribution(cell: Optional[str] = None):
    data = SEED["attribution"].get(cell) or SEED["attribution"]["anand-vihar"]
    return {**data, "updatedAt": now()}


@app.get(f"{V1}/policy/plume")
def get_plume():
    return {**SEED["plume"], "generatedAt": now()}


@app.get(f"{V1}/policy/compliance")
def get_compliance():
    return {**SEED["compliance"], "updatedAt": now()}


@app.get(f"{V1}/system/health")
def get_health():
    h = copy.deepcopy(SEED["health"])
    for i in h["items"]:
        i["updatedAt"] = now()
    return h


@app.get(f"{V1}/policy/directives/preview")
def directive_preview(type: str):
    if type not in SEED["directives"]:
        raise HTTPException(400, "Unknown directive type")
    return SEED["directives"][type]


@app.post(f"{V1}/policy/directives")
def issue_directive(body: dict):
    if body.get("type") not in SEED["directives"]:
        raise HTTPException(400, "Unknown directive type")
    return {"id": rid("DIR"), "type": body["type"], "issuedAt": now(), "status": "queued"}


# ---------- FPO ----------
@app.get(f"{V1}/fpo/machinery")
def get_machinery():
    return machinery


@app.get(f"{V1}/fpo/biomass")
def get_biomass():
    return SEED["biomass"]


@app.get(f"{V1}/fpo/farmers")
def get_farmers():
    return {"villages": SEED["farmers"]["villages"], "farmers": farmers}


@app.get(f"{V1}/fpo/farmers/{{fid}}/call-details")
def call_details(fid: str):
    find_farmer(fid)
    base = SEED["callDetails"][fid]
    return {**base, "log": call_logs.get(fid, [])}


@app.post(f"{V1}/fpo/farmers/{{fid}}/call")
def trigger_call(fid: str):
    f = find_farmer(fid)
    at = now()
    call_logs.setdefault(fid, []).insert(
        0, {"id": rid("c"), "at": at, "direction": "outbound", "outcome": "queued", "note": "Voice call queued (Punjabi)"}
    )
    f["lastContactAt"] = at
    if f["status"] == "to_contact":
        f["status"] = "called"
    return {"callId": rid("CALL"), "status": "queued", "at": at}


@app.post(f"{V1}/fpo/farmers/{{fid}}/assign")
def assign_machine(fid: str, body: dict):
    f = find_farmer(fid)
    mt = body.get("machineType")
    m = next((x for x in machinery if x["type"] == mt), None)
    if not m or m["inUse"] >= m["total"]:
        raise HTTPException(409, "No machine of this type is free")
    m["inUse"] += 1
    f["status"] = "dispatched"
    call_logs.setdefault(fid, []).insert(
        0, {"id": rid("c"), "at": now(), "direction": "outbound", "outcome": "queued", "note": f"{label_of(mt)} assigned on-site"}
    )
    return {"assignmentId": rid("ASG"), "machineType": mt, "etaMinutes": round(25 + (f["riskScore"] % 20))}


# ---------- farmer call ----------
@app.get(f"{V1}/farmer/call-session")
def call_session(lang: str = "pa"):
    if lang not in SEED["scripts"]:
        lang = "en"
    return {
        "sessionId": rid("SES"),
        "callerName": "Sangrur Machinery Cooperative",
        "callerId": "01672-XXXXXX",
        "farmerFirstName": "Gurpreet",
        "lang": lang,
        "audioUrl": None,
        "lines": SEED["scripts"][lang],
        "prices": {"superSeederPerAcre": 750, "strawPerTonne": 1650},
    }


@app.post(f"{V1}/farmer/bookings")
def book_key(body: dict):
    key = body.get("key")
    if key not in ("1", "2", "9"):
        raise HTTPException(400, "Unknown key")
    return {"referenceId": rid("BK"), "key": key, "status": "connecting" if key == "9" else "confirmed"}


# ---------- citizen ----------
@app.get(f"{V1}/citizen/areas")
def citizen_areas():
    return SEED["areas"]


@app.get(f"{V1}/citizen/snapshot")
def citizen_snapshot(area: Optional[str] = None):
    snap = SEED["snapshots"].get(area) or next(iter(SEED["snapshots"].values()))
    return {**snap, "updatedAt": now()}


@app.get(f"{V1}/citizen/advice")
def citizen_advice(profile: str = "general", hour: int = 12):
    items = SEED["advice"].get(profile) or SEED["advice"]["general"]
    return items[max(0, min(23, hour))]


@app.get(f"{V1}/citizen/routes")
def citizen_routes(from_: str = Query("", alias="from"), to: str = ""):
    return {"from": from_, "to": to, "options": SEED["routes"]}


@app.post(f"{V1}/citizen/reports")
def submit_report(body: dict):
    global report_counter
    if body.get("category") not in ("open_burning", "construction", "road_dust"):
        raise HTTPException(400, "Unknown category")
    report_counter += 1
    return {"referenceId": f"VS-R-{report_counter}", "receivedAt": now()}


# ---------- realtime ----------
def realtime_events():
    ts = now()
    out = []
    for e in SEED["realtime"]:
        e = copy.deepcopy(e)
        e["ts"] = ts
        if e["type"] == "aqi":
            e["aqi"] = max(20, round(e["aqi"] + random.uniform(-6, 6)))
            e["pm25"] = max(5, round(e["pm25"] + random.uniform(-4, 4)))
        elif e["type"] == "fire":
            e["activeFires"] = max(0, e["activeFires"] + random.randint(-3, 5))
            e["newDetections"] = random.randint(0, 9)
        out.append(e)
    return out


@app.get(f"{V1}/realtime/snapshot")
def realtime_snapshot():
    return realtime_events()


@app.websocket("/ws/v1/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            for e in realtime_events():
                await ws.send_text(json.dumps(e))
            await asyncio.sleep(5)
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.get("/health")
def health():
    return {"status": "ok"}
