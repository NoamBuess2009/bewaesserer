from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from bewaesserer.app import create_app
from bewaesserer.config import load_settings
from bewaesserer.controller import WateringController
from test_app import FakeOutput


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    clock = [datetime(2026, 10, 14, 10, 0, tzinfo=ZoneInfo("Europe/Zurich"))]
    controller = WateringController(output=FakeOutput(), now=lambda: clock[0])
    client = create_app(controller, start_scheduler=False).test_client()
    yield client, controller, clock
    controller.close()


def test_api_settings_and_manual_controls(api):
    client, controller, clock = api
    assert client.get("/api/state").json["settings"]["duration_seconds"] == 150
    settings = {"times": ["06:15", "20:45"], "duration_seconds": 42}
    saved = client.put("/api/settings", json=settings)
    assert saved.status_code == 200
    assert saved.json["settings"] == settings
    assert load_settings().times == ("06:15", "20:45")
    started = client.post("/api/start").json["status"]
    assert started["watering"] is True
    assert started["duration_seconds"] == started["remaining_seconds"] == 42
    clock[0] += timedelta(seconds=12)
    assert client.get("/api/state").json["status"]["remaining_seconds"] == 30
    stopped = client.post("/api/stop").json["status"]
    assert stopped["watering"] is False
    assert stopped["remaining_seconds"] == 0


@pytest.mark.parametrize("settings", [
    None, [], {}, {"times": ["07:00"], "duration_seconds": 10},
    {"times": ["07:00", "19:00", "20:00"], "duration_seconds": 10},
    {"times": ["24:00", "19:00"], "duration_seconds": 10},
    {"times": [None, "19:00"], "duration_seconds": 10},
    {"times": ["07:00", "19:00"], "duration_seconds": 0},
    {"times": ["07:00", "19:00"], "duration_seconds": 3601},
    {"times": ["07:00", "19:00"], "duration_seconds": True},
    {"times": ["07:00", "19:00"], "duration_seconds": "30"},
])
def test_invalid_api_settings_do_not_change_plan(api, settings):
    client, _, _ = api
    response = client.put("/api/settings", json=settings)
    assert response.status_code == 400
    assert response.json["error"]
    assert load_settings().duration_seconds == 150


def test_static_frontend_can_read_and_write_from_port_3000(api):
    client, _, _ = api
    headers = {"Origin": "http://localhost:3000"}
    preflight = client.options("/api/settings", headers={**headers,
        "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "Content-Type"})
    assert preflight.status_code == 200
    assert preflight.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "PUT" in preflight.headers["Access-Control-Allow-Methods"]
    response = client.get("/api/state", headers=headers)
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert response.headers["Cache-Control"] == "no-store"


def test_same_pi_hostname_is_allowed(api):
    client, _, _ = api
    response = client.get("/api/state", base_url="http://raspberrypi.local:8080", headers={"Origin": "http://raspberrypi.local:3000"})
    assert response.headers["Access-Control-Allow-Origin"] == "http://raspberrypi.local:3000"


def test_unapproved_website_cannot_start_watering(api):
    client, controller, _ = api
    response = client.post("/api/start", headers={"Origin": "https://unapproved.example"})
    assert response.status_code == 403
    assert not controller.is_watering
    assert "Access-Control-Allow-Origin" not in response.headers


def test_configurable_frontend_origin(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setenv("BEWAESSERER_ALLOWED_ORIGINS", "http://192.168.1.10:3000")
    response = client.get("/api/state", headers={"Origin": "http://192.168.1.10:3000"})
    assert response.headers["Access-Control-Allow-Origin"] == "http://192.168.1.10:3000"
