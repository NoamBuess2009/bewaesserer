import csv
import io
import sqlite3
from datetime import timedelta
from types import SimpleNamespace

import pytest

from bewaesserer.app import create_app
from bewaesserer.controller import WateringController
from bewaesserer.history import WateringHistory
from test_controller_history import FakeClock, FakeOutput, FakeTimer


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    monkeypatch.setattr("bewaesserer.controller.threading.Timer", FakeTimer)
    clock = FakeClock()
    output = FakeOutput()
    history = WateringHistory(tmp_path / "watering.sqlite3")
    controller = WateringController(
        output=output, now=clock.now, monotonic=clock.monotonic, history=history,
    )
    client = create_app(controller, start_scheduler=False).test_client()
    yield SimpleNamespace(
        client=client, controller=controller, history=history, clock=clock, output=output,
    )
    controller.close()


def add_finished(api, started_at, duration, source="manual", outcome="completed"):
    run_id = api.history.start(started_at, 150, source)
    api.history.finish(run_id, started_at + timedelta(seconds=duration), duration, outcome)
    return run_id


def test_api_start_and_stop_create_one_run_with_actual_duration(api):
    started = api.client.post("/api/start")
    assert started.status_code == 200
    assert started.json["status"]["watering"] is True
    response = api.client.get("/api/history")
    assert response.status_code == 200
    assert response.json["total"] == 1
    running, = response.json["entries"]
    assert running["source"] == "manual"
    assert running["outcome"] == "running"
    assert running["planned_duration_seconds"] == 150
    assert running["actual_duration_seconds"] is None
    assert running["ended_at"] is None
    assert api.client.get("/api/statistics").json["total"]["count"] == 0

    api.clock.advance(12.75)
    stopped = api.client.post("/api/stop")
    assert stopped.status_code == 200
    assert stopped.json["status"]["watering"] is False
    finished, = api.client.get("/api/history").json["entries"]
    assert finished["id"] == running["id"]
    assert finished["outcome"] == "stopped"
    assert finished["actual_duration_seconds"] == pytest.approx(12.75)
    assert finished["ended_at"] is not None

    api.client.post("/api/stop")
    assert api.client.get("/api/history").json["total"] == 1


def test_statistics_count_known_finished_runs_and_exclude_unknown_or_running(api):
    now = api.clock.now()
    api.history.start(now - timedelta(hours=2), 150, "manual")
    api.history.recover_interrupted()
    add_finished(api, now - timedelta(days=1), 12.5, outcome="stopped")
    add_finished(api, now - timedelta(hours=1), 40, source="schedule")
    add_finished(api, now - timedelta(days=8), 5)
    api.history.start(now, 150, "manual")

    response = api.client.get("/api/statistics?days=7")

    assert response.status_code == 200
    stats = response.json
    assert stats["timezone"] == "Europe/Zurich"
    assert stats["days"] == 7
    assert stats["today"] == {"count": 1, "duration_seconds": 40}
    assert stats["period"]["count"] == 2
    assert stats["period"]["duration_seconds"] == pytest.approx(52.5)
    assert stats["period"]["average_duration_seconds"] == pytest.approx(26.25)
    assert stats["total"]["count"] == 3
    assert stats["total"]["duration_seconds"] == pytest.approx(57.5)
    assert len(stats["daily"]) == 7
    assert stats["daily"][-1]["schedule_seconds"] == 40
    assert stats["daily"][-1]["manual_seconds"] == 0
    assert stats["daily"][-2]["manual_seconds"] == pytest.approx(12.5)


def test_history_filters_source_and_calendar_period_before_pagination(api):
    now = api.clock.now()
    newest = add_finished(api, now - timedelta(hours=1), 5)
    next_manual = add_finished(api, now - timedelta(hours=2), 6)
    scheduled = add_finished(api, now - timedelta(hours=3), 7, source="schedule")
    add_finished(api, now - timedelta(days=1), 8)
    add_finished(api, now - timedelta(days=8), 9)

    page = api.client.get("/api/history?days=7&source=manual&limit=1&offset=1")
    assert page.status_code == 200
    assert page.json["total"] == 3
    assert page.json["limit"] == 1
    assert page.json["offset"] == 1
    assert [row["id"] for row in page.json["entries"]] == [next_manual]

    today = api.client.get("/api/history?days=1&source=all&limit=20&offset=0").json
    assert today["total"] == 3
    assert [row["id"] for row in today["entries"]] == [newest, next_manual, scheduled]
    schedule = api.client.get("/api/history?days=7&source=schedule").json
    assert schedule["total"] == 1
    assert schedule["entries"][0]["id"] == scheduled
    beyond = api.client.get("/api/history?source=manual&offset=99").json
    assert beyond["total"] == 3
    assert beyond["entries"] == []


def test_csv_export_is_a_download_with_bom_and_empty_unknown_duration(api):
    now = api.clock.now()
    api.history.start(now - timedelta(hours=2), 150, "manual")
    api.history.recover_interrupted()
    add_finished(api, now - timedelta(hours=1), 12.75, outcome="stopped")
    add_finished(api, now - timedelta(hours=3), 99, source="schedule")
    add_finished(api, now - timedelta(days=8), 100)

    response = api.client.get("/api/history/export.csv?days=7&source=manual")

    assert response.status_code == 200
    assert response.mimetype == "text/csv"
    assert response.headers["Content-Disposition"] == 'attachment; filename="bewaesserung-2026-10-14.csv"'
    assert response.data.startswith(b"\xef\xbb\xbf")
    rows = list(csv.DictReader(io.StringIO(response.data.decode("utf-8-sig")), delimiter=";"))
    assert len(rows) == 2
    assert list(rows[0]) == [
        "Beginn", "Ende", "Geplante Dauer (Sekunden)",
        "Tatsächliche Dauer (Sekunden)", "Auslöser", "Ergebnis",
    ]
    assert all(row["Auslöser"] == "Manuell" for row in rows)
    assert rows[0]["Tatsächliche Dauer (Sekunden)"] == "12.75"
    assert rows[0]["Geplante Dauer (Sekunden)"] == "150"
    assert rows[0]["Ergebnis"] == "Gestoppt"
    assert rows[1]["Tatsächliche Dauer (Sekunden)"] == ""
    assert rows[1]["Ende"] == ""
    assert "unbekannt" in rows[1]["Ergebnis"]


@pytest.mark.parametrize("path", [
    "/api/history?days=0", "/api/history?days=91", "/api/history?days=seven",
    "/api/history?source=invalid", "/api/history?limit=0", "/api/history?limit=501",
    "/api/history?limit=1.5", "/api/history?offset=-1", "/api/history?offset=invalid",
    "/api/statistics?days=0", "/api/statistics?days=91", "/api/statistics?days=invalid",
    "/api/history/export.csv?days=0", "/api/history/export.csv?days=91",
    "/api/history/export.csv?days=invalid", "/api/history/export.csv?source=invalid",
])
def test_invalid_history_queries_return_json_error(api, path):
    response = api.client.get(path)
    assert response.status_code == 400
    assert response.is_json
    assert response.json["error"]


@pytest.mark.parametrize("path", ["/api/history", "/api/statistics", "/api/history/export.csv"])
def test_history_api_has_cors_and_no_cache_headers(api, path):
    response = api.client.get(path, headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "Origin" in response.headers["Vary"]


def test_failed_history_write_returns_503_without_enabling_gpio(api, monkeypatch):
    def fail_start(*args, **kwargs):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(api.history, "start", fail_start)

    response = api.client.post("/api/start")

    assert response.status_code == 503
    assert response.json["error"]
    assert api.output.value == 0
    assert api.client.get("/api/status").json["watering"] is False
    assert api.history.list_runs()["total"] == 0
