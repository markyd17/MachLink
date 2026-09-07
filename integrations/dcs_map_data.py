"""
Watches the map-snapshot file dcs_mission_hook.lua overwrites once per
second (Saved Games\\DCS\\Scripts\\MachLinkMapData.json) - own position,
friendly units, airbases, bullseye, and detected enemy contacts. Unlike
dcs_combat_events.py's file (an append-only event log), this file is
fully REWRITTEN every tick, so this just re-reads it whenever its
mtime changes and keeps the latest parse in memory for /api/map_data to
serve - no line-tailing/offset-tracking needed.

Runs as a background thread started by app.py - not meant to be run
standalone.
"""
import json
import threading
import time
from pathlib import Path

# Same Saved Games variants dcs_hook_guard.py/dcs_kneeboard.py/
# dcs_combat_events.py check, in the same order.
_DCS_SAVED_GAMES_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")

MAP_DATA_FILENAME = "MachLinkMapData.json"

# Keep in sync with MAP_HOOK_VERSION in integrations/dcs_mission_hook.lua -
# bumped there whenever the snapshot's JSON shape changes in a way the
# frontend depends on. That .lua file is a MANUAL, one-time copy per the
# README (Saved Games\DCS\Scripts\MachLinkMissionHook.lua) - pulling a repo
# update alone does nothing in-game until that copy is redone, so a
# deployed hook can silently lag behind this app for a long time. Rather
# than let fields it predates (categoryDetail, myCoalition, ...) just
# quietly go missing with no explanation, MapDataStore.get() below flags
# "hook_outdated" whenever the snapshot's own hookVersion is missing or
# behind this constant, for the frontend to surface as an actionable
# warning instead of a silent gap.
EXPECTED_MAP_HOOK_VERSION = 1


def _candidate_paths():
    home = Path.home()
    for variant in _DCS_SAVED_GAMES_VARIANTS:
        yield home / "Saved Games" / variant / "Scripts" / MAP_DATA_FILENAME


def find_map_data_path(explicit_path=None):
    if explicit_path:
        return Path(explicit_path)
    candidates = list(_candidate_paths())
    for path in candidates:
        if path.parent.is_dir():
            return path
    return candidates[0]


class MapDataStore:
    """Thread-safe holder for the latest parsed map snapshot."""

    def __init__(self):
        self.lock = threading.Lock()
        self._data = None
        self._updated_at = None

    def set(self, data):
        with self.lock:
            self._data = data
            self._updated_at = time.time()

    def get(self):
        with self.lock:
            if self._data is None:
                return {"available": False}
            hook_version = self._data.get("hookVersion")
            return {
                "available": True,
                "updated_at": self._updated_at,
                # Flagged stale if DCS/the mission hook hasn't written a
                # fresh snapshot in a while (e.g. paused, or you're not
                # actually in a controlled unit) - the frontend can grey
                # the map out instead of showing a frozen last-known state
                # as if it were live.
                "stale": (time.time() - self._updated_at) > 5.0,
                # True for a snapshot with no hookVersion at all (any hook
                # older than this check existing) or one reporting a lower
                # number than EXPECTED_MAP_HOOK_VERSION - see that constant.
                "hook_outdated": hook_version is None or hook_version < EXPECTED_MAP_HOOK_VERSION,
                "data": self._data,
            }


def start_map_data_watcher(store, explicit_path=None, poll_interval_seconds=0.5):
    map_path = find_map_data_path(explicit_path)

    def _watch():
        last_mtime = None
        while True:
            time.sleep(poll_interval_seconds)
            try:
                if not map_path.exists():
                    continue
                mtime = map_path.stat().st_mtime
                if mtime == last_mtime:
                    continue
                text = map_path.read_text(encoding="utf-8")
                data = json.loads(text)
                store.set(data)
                last_mtime = mtime
            except (OSError, json.JSONDecodeError):
                # Best-effort - a read racing the Lua hook's own write (it
                # writes "w" mode, not atomic-replace) can occasionally
                # catch a partial file; just wait for the next poll.
                continue

    t = threading.Thread(target=_watch, daemon=True)
    t.start()
    return t
