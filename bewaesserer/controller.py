from __future__ import annotations

import logging
import os
import threading
from datetime import datetime
from typing import Callable
from zoneinfo import ZoneInfo

from gpiozero import DigitalOutputDevice

from .config import Settings, load_settings

LOG = logging.getLogger(__name__)


class WateringController:
    def __init__(self, output=None, now: Callable[[], datetime] | None = None):
        pin = int(os.getenv("BEWAESSERER_GPIO", "18"))
        active_high = os.getenv("BEWAESSERER_ACTIVE_HIGH", "1") != "0"
        self.output = output or DigitalOutputDevice(pin, active_high=active_high, initial_value=False)
        timezone = ZoneInfo(os.getenv("TZ", "Europe/Zurich"))
        self._now = now or (lambda: datetime.now(timezone))
        self._lock = threading.RLock()
        self._stop_timer: threading.Timer | None = None
        self._scheduler_thread: threading.Thread | None = None
        self._shutdown = threading.Event()
        self._last_scheduled_key: str | None = None
        self.started_at: datetime | None = None
        self.last_finished_at: datetime | None = None

    @property
    def is_watering(self) -> bool:
        return bool(self.output.value)

    def start(self, duration_seconds: int, source: str = "manual") -> None:
        duration_seconds = max(1, min(int(duration_seconds), 3600))
        with self._lock:
            if self._stop_timer:
                self._stop_timer.cancel()
            self.output.on()
            self.started_at = self._now()
            self._stop_timer = threading.Timer(duration_seconds, self.stop)
            self._stop_timer.daemon = True
            self._stop_timer.start()
            LOG.info("Bewässerung gestartet (%s), Dauer: %ss", source, duration_seconds)

    def stop(self) -> None:
        with self._lock:
            if self._stop_timer:
                self._stop_timer.cancel()
                self._stop_timer = None
            was_watering = self.is_watering
            self.output.off()
            if was_watering:
                self.last_finished_at = self._now()
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
                self._last_scheduled_key = key
                self.start(settings.duration_seconds, source="Zeitplan")

    def close(self) -> None:
        self._shutdown.set()
        self.stop()
        self.output.close()

    def status(self) -> dict:
        return {
            "watering": self.is_watering,
            "started_at": self.started_at.isoformat(timespec="seconds") if self.started_at else None,
            "last_finished_at": self.last_finished_at.isoformat(timespec="seconds") if self.last_finished_at else None,
        }

