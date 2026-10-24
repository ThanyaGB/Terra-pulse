"""FastAPI app factory (T3.1): routers per domain, RBAC, Problem Details, pagination, request tracing, /ws/live."""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from agents.common.events import BOOKING_CREATED, FORECAST_UPDATED, WORKORDER_CREATED
from agents.runtime import Platform, build_platform
from api import problem
from api.masking import MaskedJSONResponse
from api.problem import ProblemError
from api.routers import admin, ops, read
from api.security import decode_token
from api.services import Ops
from api.settings import Settings, get_settings
from api.ws import Client, Hub
from domain import aqi as aqi_domain
from domain.features import FeatureFlags
from ingestion.pipeline import Snapshot, build_snapshot
from ingestion.rawstore import FileRawStore
from integrations.ratelimit import MemoryLimiter, RedisLimiter
from integrations.telephony import FakeProvider, TelephonyAdapter

log = logging.getLogger("api")
BAND_ORDER = ["good", "satisfactory", "moderate", "poor", "very_poor", "severe", "severe_plus"]


def _provider(settings: Settings) -> Any:
    raw = FileRawStore(settings.raw_store_dir)

    def provider() -> Snapshot:
        return build_snapshot(raw, offline=settings.data_mode == "offline", live_ndvi=settings.live_ndvi, data_gov_key=settings.data_gov_in_key)

    return provider


def _wire_hub(platform: Platform, hub: Hub) -> None:
    """Bridge bus events to WebSocket channels."""
    last_band: dict[str, int] = {}

    def tap(ev: Any) -> None:
        p = ev.payload
        if ev.type == FORECAST_UPDATED:
            f = platform.world.forecast.get(p["grid_id"], {})
            hub.publish("aqi.update", {"area_id": p["grid_id"], "name": f.get("name", p["grid_id"]), "aqi": p["aqi"], "pm25": f.get("pm25")}, ev.trace_id)
            band = BAND_ORDER.index(aqi_domain.band(p["aqi"]))
            if band >= BAND_ORDER.index("very_poor") and band > last_band.get(p["grid_id"], -1):
                hub.publish("alert.fired", {"kind": "aqi", "area_id": p["grid_id"], "band": BAND_ORDER[band], "aqi": p["aqi"]}, ev.trace_id)
            last_band[p["grid_id"]] = band
        elif ev.type == WORKORDER_CREATED:
            hub.publish("alert.fired", {"kind": "work_order", **p}, ev.trace_id)
        elif ev.type == BOOKING_CREATED:
            hub.publish("booking.update", p, ev.trace_id)

    platform.bus.taps.append(tap)  # type: ignore[attr-defined]


async def _refresh_loop(app: FastAPI) -> None:
    s: Settings = app.state.settings
    first = True
    while True:
        try:
            await app.state.platform.run_cycle()
            snap = app.state.platform.world.snapshot
            if snap is not None:
                app.state.hub.publish("agent.status", {"kind": "fire", "active_fires": len(snap.hotspots), "new_detections": 0})
            if first:
                log.info("first ingestion cycle complete (%s)", s.data_mode)
                first = False
        except Exception:  # noqa: BLE001 - keep serving the last good snapshot
            log.exception("ingestion cycle failed")
        await asyncio.sleep(max(60, s.refresh_minutes * 60))


async def _status_loop(app: FastAPI) -> None:
    while True:
        await asyncio.sleep(10)
        for h in app.state.platform.health_report():
            app.state.hub.publish("agent.status", {"kind": "agent", **h})


def create_app(settings: Settings | None = None, platform: Platform | None = None, background: bool = True) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        tasks = []
        if background:
            tasks = [asyncio.create_task(_refresh_loop(app)), asyncio.create_task(_status_loop(app))]
        yield
        for t in tasks:
            t.cancel()

    app = FastAPI(title="Vayu-Swachh API", version="1.0.0", default_response_class=MaskedJSONResponse, lifespan=lifespan,
                  description="Closed-loop air quality action platform. Contract-first: this schema is exported to packages/contracts/openapi.json.")
    app.state.settings = settings
    app.state.hub = Hub()
    plat = platform or build_platform(provider=_provider(settings), outbox_path=settings.outbox_path if settings.outbox_path != ":memory:" else ":memory:")
    app.state.platform = plat
    app.state.features = FeatureFlags.load(audit=plat.audit.append, overrides_path=settings.feature_overrides_path)
    providers = {"twilio": FakeProvider("twilio"), "exotel": FakeProvider("exotel")}   # real providers need credentials from the secret manager
    secondary = "exotel" if settings.telephony_primary == "twilio" else "twilio"
    tel = TelephonyAdapter(providers[settings.telephony_primary], providers[secondary], on_alert=lambda m: app.state.hub.publish("alert.fired", {"kind": "telephony", "message": m}))
    app.state.telephony = tel
    limiter = RedisLimiter(settings.redis_url, settings.call_rate_limit, settings.call_rate_window_s) if settings.redis_url else \
        MemoryLimiter(settings.call_rate_limit, settings.call_rate_window_s)
    app.state.ops = Ops(plat, tel, limiter)
    app.state.reports = {}
    _wire_hub(plat, app.state.hub)

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_list, allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+" if settings.env == "dev" else None, allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Trace-Id", "Retry-After"])

    @app.middleware("http")
    async def tracing(request: Request, call_next: Any) -> Any:
        request.state.trace_id = request.headers.get("x-trace-id") or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
        return response

    problem.install(app)
    app.include_router(read.router, prefix="/v1")
    app.include_router(ops.router, prefix="/v1")
    app.include_router(admin.router, prefix="/v1")

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, Any]:
        return {"status": "ok", "data_ready": plat.world.snapshot is not None}

    @app.get("/v1/realtime/snapshot", summary="Polling fallback for /ws/live (extension)", tags=["realtime"])
    def realtime_snapshot(request: Request) -> list[dict[str, Any]]:
        from api.security import current_principal
        current_principal(request)
        from api.ws import envelope
        w = plat.world
        out = [envelope("aqi.update", {"area_id": k, "name": f["name"], "aqi": f["aqi"], "pm25": f["pm25"]}) for k, f in w.forecast.items()]
        if w.snapshot is not None:
            out.append(envelope("agent.status", {"kind": "fire", "active_fires": len(w.snapshot.hotspots), "new_detections": 0}))
        out += [envelope("agent.status", {"kind": "agent", **h}) for h in plat.health_report()]
        return out

    @app.websocket("/ws/live")
    async def ws_live(ws: WebSocket, token: str = "") -> None:
        try:
            claims = decode_token(settings.jwt_secret, token)
        except ProblemError:
            await ws.close(code=4401)
            return
        await ws.accept()
        hub: Hub = app.state.hub
        client = Client(ws, claims["role"])
        hub.clients.add(client)
        pump = asyncio.create_task(hub.pump(client))
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                if msg.get("action") == "subscribe":
                    ok, denied = hub.subscribe(client, list(msg.get("channels", [])))
                    await ws.send_text(json.dumps({"channel": "system", "ts": "", "trace_id": "", "payload": {"subscribed": ok, "denied": denied}}))
        except (WebSocketDisconnect, json.JSONDecodeError):
            pass
        finally:
            pump.cancel()
            hub.clients.discard(client)

    return app


def app_factory() -> FastAPI:
    return create_app()
