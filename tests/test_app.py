from bewaesserer.app import create_app


class FakeOutput:
    value = 0
    def on(self): self.value = 1
    def off(self): self.value = 0
    def close(self): pass


def test_manual_start_and_stop(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    from bewaesserer.controller import WateringController
    controller = WateringController(output=FakeOutput())
    client = create_app(controller, start_scheduler=False).test_client()
    assert client.post("/start").status_code == 302
    assert client.get("/api/status").json["watering"] is True
    assert client.post("/stop").status_code == 302
    assert client.get("/api/status").json["watering"] is False
    controller.close()


def test_settings_validation(tmp_path, monkeypatch):
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "settings.json"))
    from bewaesserer.controller import WateringController
    controller = WateringController(output=FakeOutput())
    client = create_app(controller, start_scheduler=False).test_client()
    assert client.post("/settings", data={"time_1": "07:00", "time_2": "19:00", "duration": "30"}).status_code == 302
    assert client.post("/settings", data={"time_1": "99:00", "time_2": "19:00", "duration": "30"}).status_code == 400
    controller.close()

