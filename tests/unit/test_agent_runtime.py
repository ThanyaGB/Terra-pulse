from agents.common import BaseAgent, Event, InMemoryBus, SqliteOutbox


class Counter(BaseAgent):
    name = "counter"
    subscribes = ("data.normalised",)

    def __init__(self, *a, fail_first=False, **k):
        super().__init__(*a, **k)
        self.calls = 0
        self.done: list[str] = []
        self.fail_first = fail_first

    async def handle(self, event):
        self.calls += 1
        if self.fail_first and self.calls == 1:
            raise RuntimeError("crash mid-handler")
        self.done.append(event.event_id)


async def test_replayed_event_processed_once():
    bus = InMemoryBus()
    a = Counter(bus)
    ev = Event(type="data.normalised", payload={"x": 1})
    await bus.publish(ev)
    await bus.publish(ev)  # same event_id replayed
    await bus.drain()
    assert a.done == [ev.event_id] and a.duplicates_skipped == 1


async def test_crash_mid_handler_redelivers_and_completes():
    bus = InMemoryBus()
    a = Counter(bus, fail_first=True)
    ev = Event(type="data.normalised")
    await bus.publish(ev)
    await bus.drain(max_rounds=1)
    assert a.done == [] and a.errors == 1 and bus.pending_count() == 1
    await bus.drain()
    assert a.done == [ev.event_id] and bus.pending_count() == 0


async def test_health_endpoint_shape():
    a = Counter(InMemoryBus())
    h = a.health()
    assert h["agent"] == "counter" and h["status"] == "ok" and "events_processed" in h


async def test_outbox_persists_then_relays_after_crash():
    ob = SqliteOutbox()
    bus = InMemoryBus()
    ev = Event(type="data.normalised")
    ob.add(ev)                       # written, but process died before publish
    assert len(ob.pending()) == 1
    assert await ob.relay(bus) == 1 and ob.pending() == [] and bus.published[0].event_id == ev.event_id
    assert await ob.relay(bus) == 0  # nothing re-sent


async def test_trace_id_propagates_to_child():
    ev = Event(type="data.normalised")
    assert ev.child("risk.updated", {}).trace_id == ev.trace_id
