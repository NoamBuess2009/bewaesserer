from __future__ import annotations

import atexit
import os
import re
from dataclasses import asdict
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, redirect, request, url_for

from .config import Settings, load_settings, save_settings
from .controller import WateringController

TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def create_app(controller: WateringController | None = None, start_scheduler: bool = True) -> Flask:
    frontend = Path(__file__).resolve().parent.parent / "dist"
    app = Flask(__name__, static_folder=str(frontend), static_url_path="")
    app.config["SECRET_KEY"] = os.getenv("BEWAESSERER_SECRET_KEY", os.urandom(32))
    watering = controller or WateringController()
    app.extensions["watering"] = watering
    if start_scheduler:
        watering.start_scheduler()
        atexit.register(watering.close)

    @app.get("/")
    def index():
        if (frontend / "index.html").exists():
            return app.send_static_file("index.html")
        address = urlsplit(request.host_url)
        host = f"[{address.hostname}]" if ":" in address.hostname else address.hostname
        address = address._replace(netloc=host + ":3000")
        return redirect(address.geturl())

    def allowed_origin(origin: str) -> bool:
        allowed = {
            "http://localhost:3000", "http://127.0.0.1:3000",
            "http://localhost:5173", "http://127.0.0.1:5173",
            request.host_url.rstrip("/"),
        }
        allowed.update(item.strip() for item in os.getenv("BEWAESSERER_ALLOWED_ORIGINS", "").split(",") if item.strip())
        if origin in allowed:
            return True
        try:
            source = urlsplit(origin)
            return (source.scheme in {"http", "https"}
                    and source.hostname == urlsplit(request.host_url).hostname
                    and source.port in {3000, 5173})
        except ValueError:
            return False

    @app.before_request
    def check_api_origin():
        origin = request.headers.get("Origin")
        if request.path.startswith("/api/") and origin and not allowed_origin(origin):
            return jsonify(error="Diese Webadresse ist für die Steuerung nicht freigegeben."), 403

    @app.after_request
    def api_headers(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            origin = request.headers.get("Origin")
            if origin and allowed_origin(origin):
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type"
                response.vary.add("Origin")
        return response

    def state():
        return jsonify(settings=asdict(load_settings()), status=watering.status())

    @app.get("/api/state")
    @app.get("/api/settings")
    def api_state():
        return state()

    @app.put("/api/settings")
    def api_settings():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error="Bitte einen gültigen Zeitplan senden."), 400
        times = data.get("times")
        duration = data.get("duration_seconds")
        if (not isinstance(times, list) or len(times) != 2
                or not all(isinstance(time, str) and TIME_PATTERN.fullmatch(time) for time in times)
                or type(duration) is not int or not 1 <= duration <= 3600):
            return jsonify(error="Zwei gültige Uhrzeiten und eine Dauer von 1–3600 Sekunden sind erforderlich."), 400
        save_settings(Settings(times=tuple(times), duration_seconds=duration))
        return state()

    @app.post("/api/start")
    def api_start():
        watering.start(load_settings().duration_seconds)
        return state()

    @app.post("/api/stop")
    def api_stop():
        watering.stop()
        return state()

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
