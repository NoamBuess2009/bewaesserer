from __future__ import annotations

import atexit
import os
import re

from flask import Flask, jsonify, redirect, render_template, request, url_for

from .config import Settings, load_settings, save_settings
from .controller import WateringController

TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def create_app(controller: WateringController | None = None, start_scheduler: bool = True) -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.getenv("BEWAESSERER_SECRET_KEY", os.urandom(32))
    watering = controller or WateringController()
    app.extensions["watering"] = watering
    if start_scheduler:
        watering.start_scheduler()
        atexit.register(watering.close)

    @app.get("/")
    def index():
        return render_template("index.html", settings=load_settings(), status=watering.status())

    @app.post("/start")
    def start():
        settings = load_settings()
        watering.start(settings.duration_seconds)
        return redirect(url_for("index"))

    @app.post("/stop")
    def stop():
        watering.stop()
        return redirect(url_for("index"))

    @app.post("/settings")
    def settings():
        times = (request.form.get("time_1", ""), request.form.get("time_2", ""))
        try:
            duration = int(request.form.get("duration", ""))
        except ValueError:
            duration = 0
        if not all(TIME_PATTERN.fullmatch(item) for item in times) or not 1 <= duration <= 3600:
            return "Ungültige Eingabe (Dauer: 1–3600 Sekunden).", 400
        save_settings(Settings(times=times, duration_seconds=duration))
        return redirect(url_for("index"))

    @app.get("/api/status")
    def api_status():
        return jsonify(watering.status())

    return app
