from __future__ import annotations

import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    times: tuple[str, str] = ("07:00", "19:00")
    duration_seconds: int = 150


def config_path() -> Path:
    return Path(os.getenv("BEWAESSERER_CONFIG", "data/settings.json"))


def load_settings() -> Settings:
    path = config_path()
    if not path.exists():
        return Settings()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return Settings(tuple(data["times"]), int(data["duration_seconds"]))
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return Settings()


def save_settings(settings: Settings) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(dir=path.parent, prefix="settings-", text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temporary:
            json.dump(asdict(settings), temporary, indent=2)
            temporary.write("\n")
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
