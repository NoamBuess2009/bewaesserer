from __future__ import annotations

import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import config_path


LOCAL_TIMEZONE = ZoneInfo("Europe/Zurich")
FINISHED_OUTCOMES = ("completed", "stopped", "restarted", "shutdown")


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Zeitstempel müssen eine Zeitzone enthalten.")
    return value.astimezone(timezone.utc)


def _positive_integer(value: int, name: str, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{name} muss eine ganze Zahl ab {minimum} sein.")
    return value


class WateringHistory:
    """Persist actual watering runs; every operation owns its SQLite connection."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path is not None else Path(
            os.getenv("BEWAESSERER_HISTORY") or config_path().with_name("watering.sqlite3")
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS watering_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_at TEXT NOT NULL,
                    started_timestamp REAL NOT NULL,
                    ended_at TEXT,
                    planned_duration_seconds INTEGER NOT NULL CHECK(planned_duration_seconds > 0),
                    actual_duration_seconds REAL CHECK(actual_duration_seconds >= 0),
                    source TEXT NOT NULL CHECK(source IN ('manual', 'schedule')),
                    outcome TEXT NOT NULL CHECK(outcome IN (
                        'running', 'completed', 'stopped', 'restarted', 'shutdown', 'interrupted'
                    ))
                );
                CREATE INDEX IF NOT EXISTS watering_runs_started
                    ON watering_runs(started_timestamp DESC, id DESC);
            """)

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def start(self, started_at: datetime, planned_duration_seconds: int, source: str) -> int:
        started_at = _utc(started_at)
        _positive_integer(planned_duration_seconds, "Dauer")
        if source not in ("manual", "schedule"):
            raise ValueError("Unbekannte Bewässerungsquelle.")
        with self._connection() as connection:
            cursor = connection.execute(
                """INSERT INTO watering_runs
                   (started_at, started_timestamp, planned_duration_seconds, source, outcome)
                   VALUES (?, ?, ?, ?, 'running')""",
                (started_at.isoformat(), started_at.timestamp(), planned_duration_seconds, source),
            )
            return cursor.lastrowid

    def finish(self, run_id: int, ended_at: datetime, actual_duration_seconds: float, outcome: str) -> None:
        ended_at = _utc(ended_at)
        if (
            isinstance(actual_duration_seconds, bool)
            or not isinstance(actual_duration_seconds, (int, float))
            or not math.isfinite(actual_duration_seconds)
            or actual_duration_seconds < 0
        ):
            raise ValueError("Die tatsächliche Dauer muss endlich und mindestens null sein.")
        if outcome not in FINISHED_OUTCOMES:
            raise ValueError("Unbekannter Abschlussgrund.")
        with self._connection() as connection:
            connection.execute(
                """UPDATE watering_runs
                   SET ended_at = ?, actual_duration_seconds = ?, outcome = ?
                   WHERE id = ? AND outcome = 'running'""",
                (ended_at.isoformat(), float(actual_duration_seconds), outcome, run_id),
            )

    def recover_interrupted(self) -> None:
        # A power loss gives us no reliable end time or duration to reconstruct.
        with self._connection() as connection:
            connection.execute("UPDATE watering_runs SET outcome = 'interrupted' WHERE outcome = 'running'")

    def list_runs(
        self, limit: int | None = 20, offset: int = 0, source: str = "all",
        days: int | None = None, now: datetime | None = None,
    ) -> dict:
        if limit is not None:
            _positive_integer(limit, "Limit")
        _positive_integer(offset, "Offset", minimum=0)
        if source not in ("all", "manual", "schedule"):
            raise ValueError("Unbekannte Bewässerungsquelle.")
        filters, parameters = [], []
        if source != "all":
            filters.append("source = ?")
            parameters.append(source)
        if days is not None:
            _positive_integer(days, "Tage")
            local_now = _utc(now or datetime.now(LOCAL_TIMEZONE)).astimezone(LOCAL_TIMEZONE)
            first_date = local_now.date() - timedelta(days=days - 1)
            lower = datetime.combine(first_date, time.min, LOCAL_TIMEZONE).timestamp()
            upper = datetime.combine(local_now.date() + timedelta(days=1), time.min, LOCAL_TIMEZONE).timestamp()
            filters.append("started_timestamp >= ? AND started_timestamp < ?")
            parameters.extend((lower, upper))
        where = " WHERE " + " AND ".join(filters) if filters else ""
        with self._connection() as connection:
            # SELECT alone does not start a transaction in sqlite3. Keep the
            # count and entries on one snapshot while the controller writes.
            connection.execute("BEGIN")
            total = connection.execute("SELECT COUNT(*) FROM watering_runs" + where, parameters).fetchone()[0]
            records = connection.execute(
                """SELECT id, started_at, ended_at, planned_duration_seconds,
                          actual_duration_seconds, source, outcome FROM watering_runs"""
                + where + " ORDER BY started_timestamp DESC, id DESC LIMIT ? OFFSET ?",
                (*parameters, limit if limit is not None else -1, offset),
            ).fetchall()
        return {"entries": [dict(row) for row in records], "total": total, "limit": limit, "offset": offset}

    def statistics(self, now: datetime, days: int = 7) -> dict:
        _positive_integer(days, "Tage")
        if days > 90:
            raise ValueError("Statistiken können höchstens 90 Tage umfassen.")
        today = _utc(now).astimezone(LOCAL_TIMEZONE).date()
        first_date = today - timedelta(days=days - 1)
        daily = []
        boundaries = []
        for day_offset in range(days):
            day = first_date + timedelta(days=day_offset)
            daily.append({"date": day.isoformat(), "count": 0, "duration_seconds": 0.0,
                          "manual_seconds": 0.0, "schedule_seconds": 0.0})
            boundaries.append((
                datetime.combine(day, time.min, LOCAL_TIMEZONE).timestamp(),
                datetime.combine(day + timedelta(days=1), time.min, LOCAL_TIMEZONE).timestamp(),
            ))

        finished = ",".join("?" for _ in FINISHED_OUTCOMES)
        with self._connection() as connection:
            connection.execute("BEGIN")
            totals = connection.execute(
                f"""SELECT COUNT(*) AS count, COALESCE(SUM(actual_duration_seconds), 0) AS duration
                    FROM watering_runs WHERE outcome IN ({finished})
                    AND actual_duration_seconds IS NOT NULL""", FINISHED_OUTCOMES,
            ).fetchone()
            records = connection.execute(
                f"""SELECT started_timestamp, actual_duration_seconds, source FROM watering_runs
                    WHERE outcome IN ({finished}) AND actual_duration_seconds IS NOT NULL
                    AND started_timestamp < ?
                    AND (started_timestamp >= ? OR started_timestamp + actual_duration_seconds > ?)""",
                (*FINISHED_OUTCOMES, boundaries[-1][1], boundaries[0][0], boundaries[0][0]),
            ).fetchall()
            unknown_duration_count = connection.execute(
                "SELECT COUNT(*) FROM watering_runs WHERE outcome = 'interrupted'"
            ).fetchone()[0]

        period_run_duration = 0.0
        for record in records:
            started = record["started_timestamp"]
            ended = started + record["actual_duration_seconds"]
            if boundaries[0][0] <= started < boundaries[-1][1]:
                period_run_duration += record["actual_duration_seconds"]
            for bucket, (lower, upper) in zip(daily, boundaries):
                if lower <= started < upper:
                    bucket["count"] += 1
                duration = max(0.0, min(ended, upper) - max(started, lower))
                bucket["duration_seconds"] += duration
                bucket[f"{record['source']}_seconds"] += duration

        period_count = sum(day["count"] for day in daily)
        period_duration = sum(day["duration_seconds"] for day in daily)
        total_duration = float(totals["duration"])
        return {
            "days": days,
            "timezone": "Europe/Zurich",
            "today": {"count": daily[-1]["count"], "duration_seconds": daily[-1]["duration_seconds"]},
            "period": {"count": period_count, "duration_seconds": period_duration,
                       "average_duration_seconds": period_run_duration / period_count if period_count else 0.0},
            "total": {"count": totals["count"], "duration_seconds": total_duration,
                      "average_duration_seconds": total_duration / totals["count"] if totals["count"] else 0.0,
                      "unknown_duration_count": unknown_duration_count},
            "daily": daily,
        }
