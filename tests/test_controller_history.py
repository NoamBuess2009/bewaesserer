from datetime import datetime, timedelta
from threading import Event
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from bewaesserer.controller import WateringController
from bewaesserer.history import WateringHistory


class FakeOutput:
    def __init__(self):
        self.value = 0
        self.close_calls = 0
        self.before_on = None
        self.off_event = Event()

    def on(self):
        if self.before_on:
            self.before_on()
        self.value = 1

    def off(self):
        self.value = 0
        self.off_event.set()

    def close(self):
        self.close_calls += 1


class FakeClock:
    def __init__(self):
        self.wall = datetime(2026, 10, 14, 10, 0, tzinfo=ZoneInfo("Europe/Zurich"))
        self.tick = 1000.0

    def now(self):
        return self.wall

    def monotonic(self):
        return self.tick

    def advance(self, seconds, *, wall_seconds=None):
        self.tick += seconds
        self.wall += timedelta(seconds=seconds if wall_seconds is None else wall_seconds)


class FakeTimer:
    def __init__(self, interval, function, args=None, kwargs=None):
        self.interval = interval
        self.function = function
        self.args = args or ()
        self.kwargs = kwargs or {}
        self.daemon = False
        self.started = False
        self.cancelled = False

    def start(self):
        self.started = True

    def cancel(self):
        self.cancelled = True

    def fire(self):
        # A cancelled callback can already be waiting for the controller lock.
        self.function(*self.args, **self.kwargs)


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    monkeypatch.setattr("bewaesserer.controller.threading.Timer", FakeTimer)
    return SimpleNamespace(
        clock=FakeClock(),
        path=tmp_path / "history.sqlite3",
        output=FakeOutput(),
    )


@pytest.fixture
def rig(prepared):
    prepared.history = WateringHistory(prepared.path)
    prepared.controller = WateringController(
        output=prepared.output,
        now=prepared.clock.now,
        monotonic=prepared.clock.monotonic,
        history=prepared.history,
    )
    yield prepared
    prepared.controller.close()


def entries(history):
    return history.list_runs()["entries"]


@pytest.mark.parametrize("source, normalized", [
    ("manual", "manual"),
    ("schedule", "schedule"),
    ("Zeitplan", "schedule"),
])
def test_start_records_running_session_before_gpio_is_enabled(rig, source, normalized):
    def check_record():
        record, = entries(rig.history)
        assert record["source"] == normalized
        assert record["outcome"] == "running"
        assert record["planned_duration_seconds"] == 150
        assert record["actual_duration_seconds"] is None
        assert record["ended_at"] is None
        assert datetime.fromisoformat(record["started_at"]) == rig.clock.now()

    rig.output.before_on = check_record
    rig.controller.start(150, source=source)

    assert rig.controller.is_watering
    assert rig.controller._stop_timer.started


def test_stop_records_elapsed_monotonic_time_even_when_wall_clock_changes(rig):
    rig.controller.start(150)
    rig.clock.advance(12.75, wall_seconds=-3600)

    rig.controller.stop()

    record, = entries(rig.history)
    assert not rig.controller.is_watering
    assert record["outcome"] == "stopped"
    assert record["actual_duration_seconds"] == pytest.approx(12.75)
    assert record["planned_duration_seconds"] == 150
    assert datetime.fromisoformat(record["ended_at"]) == rig.clock.now()


def test_timer_records_completed_session(rig):
    rig.controller.start(30)
    timer = rig.controller._stop_timer
    rig.clock.advance(30.4)

    timer.fire()

    record, = entries(rig.history)
    assert not rig.controller.is_watering
    assert record["outcome"] == "completed"
    assert record["actual_duration_seconds"] == pytest.approx(30.4)


def test_repeated_stop_does_not_duplicate_or_rewrite_history(rig):
    rig.controller.start(150)
    rig.clock.advance(8)
    rig.controller.stop()
    first_result = entries(rig.history)
    rig.clock.advance(90)

    rig.controller.stop()
    rig.controller.stop()

    assert entries(rig.history) == first_result
    assert rig.history.list_runs()["total"] == 1


def test_restart_finishes_previous_session_and_stale_timer_cannot_stop_new_one(rig):
    rig.controller.start(150)
    old_timer = rig.controller._stop_timer
    old_id = entries(rig.history)[0]["id"]
    rig.clock.advance(7.25)

    rig.controller.start(45, source="schedule")

    records = {record["id"]: record for record in entries(rig.history)}
    assert len(records) == 2
    assert records[old_id]["outcome"] == "restarted"
    assert records[old_id]["actual_duration_seconds"] == pytest.approx(7.25)
    current, = [record for record in records.values() if record["id"] != old_id]
    assert current["outcome"] == "running"
    assert current["source"] == "schedule"
    assert current["planned_duration_seconds"] == 45
    assert old_timer.cancelled

    old_timer.fire()

    assert rig.controller.is_watering
    assert {record["id"]: record for record in entries(rig.history)} == records


def test_close_records_shutdown_and_is_idempotent(rig):
    rig.controller.start(150)
    rig.clock.advance(19.5)

    rig.controller.close()
    rig.controller.close()

    # Reopen the database so the assertion also works if close releases its store.
    persisted = WateringHistory(rig.path)
    record, = entries(persisted)
    assert record["outcome"] == "shutdown"
    assert record["actual_duration_seconds"] == pytest.approx(19.5)
    assert rig.output.value == 0
    assert rig.output.close_calls == 1


def test_startup_recovers_unfinished_session_without_inventing_duration(prepared):
    history = WateringHistory(prepared.path)
    started_at = prepared.clock.now() - timedelta(hours=3)
    history.start(started_at, 150, "schedule")

    controller = WateringController(
        output=prepared.output,
        now=prepared.clock.now,
        monotonic=prepared.clock.monotonic,
        history=history,
    )
    try:
        record, = entries(history)
        assert record["outcome"] == "interrupted"
        assert record["actual_duration_seconds"] is None
        assert record["ended_at"] is None
        assert datetime.fromisoformat(record["started_at"]) == started_at
        assert not controller.is_watering
    finally:
        controller.close()


class FailingHistory:
    def __init__(self, *, fail_start=False, fail_finish=False):
        self.fail_start = fail_start
        self.fail_finish = fail_finish
        self.finish_calls = 0

    def recover_interrupted(self):
        return 0

    def start(self, started_at, duration_seconds, source):
        if self.fail_start:
            raise OSError("database is full")
        return 1

    def finish(self, run_id, ended_at, duration_seconds, outcome):
        self.finish_calls += 1
        if self.fail_finish:
            raise OSError("database is full")


def test_finish_failure_still_turns_gpio_off_and_reports_history_error(prepared):
    history = FailingHistory(fail_finish=True)
    controller = WateringController(
        output=prepared.output,
        now=prepared.clock.now,
        monotonic=prepared.clock.monotonic,
        history=history,
    )
    try:
        controller.start(150)
        prepared.clock.advance(8)
        try:
            controller.stop()
        except OSError:
            pass
        assert prepared.output.value == 0
        assert controller.status()["history_error"]
        assert history.finish_calls == 1
    finally:
        controller.close()


def test_failed_start_is_not_allowed_to_turn_gpio_on(prepared):
    controller = WateringController(
        output=prepared.output,
        now=prepared.clock.now,
        monotonic=prepared.clock.monotonic,
        history=FailingHistory(fail_start=True),
    )
    try:
        try:
            controller.start(150)
        except OSError:
            pass
        assert prepared.output.value == 0
        assert controller._stop_timer is None
    finally:
        controller.close()


def test_real_timer_switches_gpio_off_and_persists_completion(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    history = WateringHistory(tmp_path / "history.sqlite3")
    output = FakeOutput()
    controller = WateringController(output=output, history=history)
    try:
        controller.start(1)
        output.off_event.clear()
        assert output.off_event.wait(3), "The automatic stop did not switch GPIO off"
        assert controller.status()["watering"] is False
        record, = entries(history)
        assert record["outcome"] == "completed"
        assert 1 <= record["actual_duration_seconds"] < 3
    finally:
        controller.close()
