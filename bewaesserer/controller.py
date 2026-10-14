from __future__ import annotations

import logging
import math
import os
import threading
import time
from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from gpiozero import DigitalOutputDevice

from .config import Settings, load_settings
from .history import WateringHistory

LOG = logging.getLogger(__name__)


class WateringController:
    def __init__(self, output=None, now: Callable[[], datetime] | None = None,
                 history: WateringHistory | None = None, monotonic: Callable[[], float] | None = None):
        pin = int(os.getenv("BEWAESSERER_GPIO", "18"))
        active_high = os.getenv("BEWAESSERER_ACTIVE_HIGH", "1") != "0"
        self.output = output or DigitalOutputDevice(pin, active_high=active_high, initial_value=False)
        try:
            self.history = history if history is not None else WateringHistory()
            self.history.recover_interrupted()
        except Exception:
            self.output.close()
            raise
        timezone = ZoneInfo(os.getenv("TZ", "Europe/Zurich"))
        self._now = now or (lambda: datetime.now(timezone))
        self._monotonic = monotonic or time.monotonic
        self._lock = threading.RLock()
        self._stop_timer: threading.Timer | None = None
        self._scheduler_thread: threading.Thread | None = None
        self._shutdown = threading.Event()
        self._last_scheduled_key: str | None = None
        self.started_at: datetime | None = None
        self.last_finished_at: datetime | None = None
        self.duration_seconds = 0
        self._active_run_id: int | None = None
        self._started_monotonic: float | None = None
        self._history_error: str | None = None
        self._closed = False

    @property
    def is_watering(self) -> bool:
        return not self._closed and bool(self.output.value)

    def start(self, duration_seconds: int, source: str = "manual") -> None:
        duration_seconds = max(1, min(int(duration_seconds), 3600))
        with self._lock:
            if self._closed:
                raise RuntimeError("Die Steuerung wurde bereits geschlossen.")
            now = self._now()
            source = "schedule" if source in {"schedule", "Zeitplan"} else "manual"
            # Persist the start before switching on; a failed write must not
            # silently create an unrecorded watering run.
            try:
                run_id = self.history.start(now, duration_seconds, source)
            except Exception:
                self._history_error = "Ein Bewässerungsstart wurde wegen eines Speicherfehlers nicht ausgeführt."
                raise
            if self._stop_timer:
                self._stop_timer.cancel()
            if self._active_run_id is not None:
                self._finish_run("restarted", now)
            try:
                self.output.on()
            except Exception:
                self.output.off()
                self.history.finish(run_id, self._now(), 0, "stopped")
                raise
            self.started_at = now
            self._started_monotonic = self._monotonic()
            self._active_run_id = run_id
            self.duration_seconds = duration_seconds
            self._stop_timer = threading.Timer(duration_seconds, lambda: self.stop("completed", run_id))
            self._stop_timer.daemon = True
            self._stop_timer.start()
            LOG.info("Bewässerung gestartet (%s), Dauer: %ss", source, duration_seconds)

    def _finish_run(self, reason: str, now: datetime) -> None:
        run_id = self._active_run_id
        elapsed = max(0, self._monotonic() - self._started_monotonic) if self._started_monotonic is not None else 0
        self._active_run_id = None
        self._started_monotonic = None
        self.last_finished_at = now
        if run_id is not None:
            try:
                self.history.finish(run_id, now, elapsed, reason)
            except Exception:
                self._history_error = "Ein Durchgang konnte nicht vollständig im Verlauf gespeichert werden."
                LOG.exception("Bewässerung beendet, Verlauf konnte nicht gespeichert werden")

    def stop(self, reason: str = "stopped", expected_run_id: int | None = None) -> None:
        with self._lock:
            if self._closed or (expected_run_id is not None and expected_run_id != self._active_run_id):
                return
            if self._stop_timer:
                self._stop_timer.cancel()
                self._stop_timer = None
            was_watering = self.is_watering
            self.output.off()
            if was_watering:
                self._finish_run(reason, self._now())
                LOG.info("Bewässerung beendet")

    def start_scheduler(self) -> None:
        if self._scheduler_thread and self._scheduler_thread.is_alive():
            return
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()

    def _scheduler_loop(self) -> None:
        while not self._shutdown.wait(1):
            now = self._now()
            settings = load_settings()
            current_time = now.strftime("%H:%M")
            key = now.strftime("%Y-%m-%d %H:%M")
            if current_time in settings.times and key != self._last_scheduled_key:
                try:
                    self.start(settings.duration_seconds, source="Zeitplan")
                except Exception:
                    LOG.exception("Geplante Bewässerung konnte nicht gestartet werden")
                else:
                    self._last_scheduled_key = key

    def close(self) -> None:
        self._shutdown.set()
        with self._lock:
            if self._closed:
                return
            self.stop("shutdown")
            self.output.close()
            self._closed = True

    def status(self) -> dict:
        with self._lock:
            now = self._now()
            watering = self.is_watering
            remaining = 0
            if watering and self._started_monotonic is not None:
                remaining = max(0, math.ceil(self.duration_seconds - (self._monotonic() - self._started_monotonic)))
            return {
                "watering": watering,
                "started_at": self.started_at.isoformat(timespec="seconds") if self.started_at else None,
                "last_finished_at": self.last_finished_at.isoformat(timespec="seconds") if self.last_finished_at else None,
                "duration_seconds": self.duration_seconds,
                "remaining_seconds": remaining,
                "server_time": now.isoformat(timespec="milliseconds"),
                "history_error": self._history_error,
            }

