from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from bewaesserer.history import WateringHistory


ZURICH = ZoneInfo("Europe/Zurich")


def completed(history, started_at, duration, source="manual", outcome="completed"):
    run_id = history.start(started_at, max(1, int(duration)), source)
    ended_at = datetime.fromtimestamp(started_at.timestamp() + duration, timezone.utc)
    history.finish(run_id, ended_at, duration, outcome)
    return run_id


def test_persisted_runs_survive_reopening_and_finish_is_idempotent(tmp_path):
    path = tmp_path / "nested" / "watering.sqlite3"
    history = WateringHistory(path)
    started = datetime(2026, 10, 14, 10, 0, tzinfo=ZURICH)
    run_id = completed(history, started, 12.5, outcome="stopped")
    history.finish(run_id, started + timedelta(seconds=100), 100, "completed")
    reopened = WateringHistory(path)
    entry = reopened.list_runs()["entries"][0]
    assert entry["id"] == run_id
    assert entry["source"] == "manual"
    assert entry["outcome"] == "stopped"
    assert entry["actual_duration_seconds"] == 12.5
    assert datetime.fromisoformat(entry["started_at"]) == started
    assert datetime.fromisoformat(entry["ended_at"]).timestamp() == started.timestamp() + 12.5


def test_default_history_path_follows_settings_and_can_be_overridden(tmp_path, monkeypatch):
    monkeypatch.delenv("BEWAESSERER_HISTORY", raising=False)
    monkeypatch.setenv("BEWAESSERER_CONFIG", str(tmp_path / "custom" / "settings.json"))
    assert WateringHistory().path == tmp_path / "custom" / "watering.sqlite3"
    monkeypatch.setenv("BEWAESSERER_HISTORY", str(tmp_path / "override.sqlite3"))
    assert WateringHistory().path == tmp_path / "override.sqlite3"


def test_recovery_keeps_unknown_end_and_duration_out_of_statistics(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, 0, tzinfo=ZURICH)
    known_id = completed(history, now - timedelta(hours=1), 20)
    interrupted_id = history.start(now, 3600, "schedule")
    history.recover_interrupted()
    history.recover_interrupted()
    entries = {entry["id"]: entry for entry in history.list_runs()["entries"]}
    assert entries[known_id]["outcome"] == "completed"
    assert entries[interrupted_id]["outcome"] == "interrupted"
    assert entries[interrupted_id]["ended_at"] is None
    assert entries[interrupted_id]["actual_duration_seconds"] is None
    history.start(now + timedelta(minutes=1), 3600, "manual")
    stats = history.statistics(now)
    assert stats["total"] == {"count": 1, "duration_seconds": 20, "average_duration_seconds": 20,
                              "unknown_duration_count": 1}
    assert stats["today"] == {"count": 1, "duration_seconds": 20}


def test_history_pagination_source_and_calendar_date_filter(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, 0, tzinfo=ZURICH)
    old_id = completed(history, now - timedelta(days=7), 30)
    yesterday_id = completed(history, now - timedelta(days=1), 20, "schedule")
    first_id = completed(history, now, 10)
    second_id = completed(history, now, 15, "schedule")
    result = history.list_runs(limit=2, offset=1)
    assert result["total"] == 4
    assert result["limit"] == 2
    assert result["offset"] == 1
    assert [entry["id"] for entry in result["entries"]] == [first_id, yesterday_id]
    assert [entry["id"] for entry in history.list_runs(source="schedule")["entries"]] == [second_id, yesterday_id]
    recent = history.list_runs(source="manual", days=7, now=now)
    assert recent["total"] == 1
    assert recent["entries"][0]["id"] == first_id
    assert old_id not in [entry["id"] for entry in recent["entries"]]
    assert history.list_runs(offset=10)["entries"] == []
    all_records = history.list_runs(limit=None)
    assert all_records["limit"] is None
    assert all_records["total"] == len(all_records["entries"]) == 4
    assert [entry["id"] for entry in all_records["entries"]] == [second_id, first_id, yesterday_id, old_id]


def test_calendar_filter_uses_zurich_midnight_not_utc_or_elapsed_days(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    before_midnight = datetime(2026, 10, 13, 21, 59, tzinfo=timezone.utc)
    after_midnight = datetime(2026, 10, 13, 22, 0, tzinfo=timezone.utc)
    completed(history, before_midnight, 1)
    included_id = completed(history, after_midnight, 1)
    result = history.list_runs(days=1, now=datetime(2026, 10, 14, 10, tzinfo=ZURICH))
    assert result["total"] == 1
    assert result["entries"][0]["id"] == included_id


def test_midnight_duration_is_split_and_continuation_day_has_no_new_run(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    started = datetime(2026, 10, 13, 23, 59, 30, tzinfo=ZURICH)
    completed(history, started, 120, "schedule")
    stats = history.statistics(datetime(2026, 10, 14, 12, tzinfo=ZURICH), days=2)
    assert stats["daily"] == [
        {"date": "2026-10-13", "count": 1, "duration_seconds": 30, "manual_seconds": 0, "schedule_seconds": 30},
        {"date": "2026-10-14", "count": 0, "duration_seconds": 90, "manual_seconds": 0, "schedule_seconds": 90},
    ]
    assert stats["today"] == {"count": 0, "duration_seconds": 90}
    assert stats["period"]["duration_seconds"] == 120
    assert stats["total"]["count"] == 1
    assert history.statistics(datetime(2026, 10, 14, 12, tzinfo=ZURICH), days=1)["period"]["duration_seconds"] == 90


def test_period_average_uses_started_runs_without_carry_in_duration(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 12, tzinfo=ZURICH)
    completed(history, datetime(2026, 10, 7, 23, 59, 30, tzinfo=ZURICH), 120)
    completed(history, now - timedelta(minutes=10), 10, "schedule")

    stats = history.statistics(now, days=7)

    assert stats["period"] == {"count": 1, "duration_seconds": 100, "average_duration_seconds": 10}
    assert stats["total"]["duration_seconds"] == 130
    assert stats["total"]["average_duration_seconds"] == 65


@pytest.mark.parametrize("started,duration,expected", [
    (datetime(2026, 3, 28, 23, 59, 30, tzinfo=ZURICH), 23 * 3600 + 60, [30, 23 * 3600, 30]),
    (datetime(2026, 10, 24, 23, 59, 30, tzinfo=ZURICH), 25 * 3600 + 60, [30, 25 * 3600, 30]),
])
def test_dst_days_use_elapsed_seconds_instead_of_a_fixed_24_hours(tmp_path, started, duration, expected):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    completed(history, started, duration)
    last_day = datetime.combine(started.date() + timedelta(days=2), datetime.min.time(), ZURICH)
    stats = history.statistics(last_day + timedelta(hours=12), days=3)
    assert [day["duration_seconds"] for day in stats["daily"]] == expected
    assert stats["period"]["duration_seconds"] == duration
    assert stats["total"]["duration_seconds"] == duration


def test_all_known_outcomes_count_and_stats_cover_requested_calendar_days(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, tzinfo=ZURICH)
    for index, outcome in enumerate(("completed", "stopped", "restarted", "shutdown")):
        completed(history, now - timedelta(minutes=index), 10, "manual", outcome)
    completed(history, now - timedelta(days=40), 60, "schedule")
    stats = history.statistics(now, days=30)
    assert stats["days"] == len(stats["daily"]) == 30
    assert stats["timezone"] == "Europe/Zurich"
    assert stats["daily"][0]["date"] == "2026-09-15"
    assert stats["daily"][-1]["date"] == "2026-10-14"
    assert stats["period"] == {"count": 4, "duration_seconds": 40, "average_duration_seconds": 10}
    assert stats["total"] == {"count": 5, "duration_seconds": 100, "average_duration_seconds": 20,
                              "unknown_duration_count": 0}


def test_connections_support_parallel_scheduler_and_request_threads(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, tzinfo=ZURICH)
    with ThreadPoolExecutor(max_workers=4) as executor:
        ids = list(executor.map(lambda index: completed(history, now, index + 1), range(20)))
    assert len(set(ids)) == 20
    assert history.list_runs()["total"] == 20
    assert history.statistics(now)["total"]["duration_seconds"] == 210


@pytest.mark.parametrize("duration", [-1, float("inf"), float("nan"), True])
def test_invalid_actual_duration_cannot_corrupt_statistics(tmp_path, duration):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, tzinfo=ZURICH)
    run_id = history.start(now, 10, "manual")
    with pytest.raises(ValueError):
        history.finish(run_id, now, duration, "completed")
    assert history.list_runs()["entries"][0]["outcome"] == "running"


def test_zero_duration_stop_is_recorded_without_inventing_runtime(tmp_path):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 10, tzinfo=ZURICH)
    completed(history, now, 0, outcome="stopped")
    assert history.statistics(now)["total"] == {"count": 1, "duration_seconds": 0, "average_duration_seconds": 0,
                                                "unknown_duration_count": 0}


@pytest.mark.parametrize("operation", ["list_runs", "statistics"])
def test_multi_query_reads_keep_one_snapshot_during_concurrent_write(tmp_path, monkeypatch, operation):
    history = WateringHistory(tmp_path / "watering.sqlite3")
    now = datetime(2026, 10, 14, 12, tzinfo=ZURICH)
    if operation == "statistics":
        run_id = history.start(now, 10, "manual")
        write = lambda: history.finish(run_id, now + timedelta(seconds=10), 10, "completed")
        second_query = "SELECT started_timestamp"
    else:
        write = lambda: history.start(now, 10, "manual")
        second_query = "SELECT id, started_at"

    original_connection = history._connection
    written = False

    class ConnectionProxy:
        def execute(self, query, *parameters):
            nonlocal written
            if second_query in query and not written:
                written = True
                assert self.connection.in_transaction
                write()
            return self.connection.execute(query, *parameters)

    @contextmanager
    def interleaved_connection():
        with original_connection() as connection:
            proxy = ConnectionProxy()
            proxy.connection = connection
            yield proxy

    monkeypatch.setattr(history, "_connection", interleaved_connection)
    if operation == "statistics":
        result = history.statistics(now)
        assert result["total"]["count"] == result["period"]["count"] == 0
        assert history.statistics(now)["total"]["count"] == 1
    else:
        result = history.list_runs()
        assert result["total"] == len(result["entries"]) == 0
        assert history.list_runs()["total"] == 1
    assert written
