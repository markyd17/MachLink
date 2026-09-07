"""
Watches the plain JSON-lines file dcs_mission_hook.lua appends combat/life-
cycle events to (Saved Games\\DCS\\Scripts\\MachLinkCombatEvents.jsonl) -
NOT a UDP socket, unlike dcs_listener.py's Export.lua channel. Confirmed
empirically (dcs.log: "load error ... error loading module 'socket'") that
require("socket") does not work inside DCS's Mission Scripting environment
even with the sandbox loosened - only Export.lua's separate environment
supports it - so this Phase 2 channel uses plain file I/O instead (io.open/
write/close, unaffected by that limitation since it isn't a loadable C
module), tailed here on a short poll interval rather than received as
socket packets.

Runs as a background thread started by app.py - not meant to be run
standalone.
"""
import json
import threading
import time
import traceback
from pathlib import Path

DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_debug.log"

# Same Saved Games variants dcs_hook_guard.py/dcs_kneeboard.py check, in the
# same order - DCS almost always keeps Saved Games directly under the
# Windows user profile folder (not redirected the way Desktop/Documents
# sometimes are), so Path.home() is a reliable anchor here.
_DCS_SAVED_GAMES_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")

EVENTS_FILENAME = "MachLinkCombatEvents.jsonl"


def _debug_log(line):
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} COMBAT {line}\n")
    except OSError:
        pass


def _candidate_paths():
    home = Path.home()
    for variant in _DCS_SAVED_GAMES_VARIANTS:
        yield home / "Saved Games" / variant / "Scripts" / EVENTS_FILENAME


def find_combat_events_path(explicit_path=None):
    """The events file to watch: the configured path if given, otherwise
    the first Saved Games variant whose Scripts folder already exists
    (same detection order as dcs_hook_guard.find_export_lua), otherwise
    the first candidate."""
    if explicit_path:
        return Path(explicit_path)
    candidates = list(_candidate_paths())
    for path in candidates:
        if path.parent.is_dir():
            return path
    return candidates[0]


def _dispatch(payload, flight_tracker):
    kind = payload.get("type")
    _debug_log(f"RECV {payload}")
    if kind == "birth":
        flight_tracker.on_birth(payload.get("unitName"))
    elif kind in ("dead", "crash", "ejected"):
        flight_tracker.on_combat_loss(
            kind,
            shooter_name=payload.get("shooterName"),
            shooter_relation=payload.get("shooterRelation"),
            shooter_category=payload.get("shooterCategory"),
            weapon_type=payload.get("weaponType"),
        )
    elif kind == "hit":
        flight_tracker.on_hit(
            shooter_name=payload.get("shooterName"),
            shooter_relation=payload.get("shooterRelation"),
            shooter_category=payload.get("shooterCategory"),
            weapon_type=payload.get("weaponType"),
        )
    elif kind == "kill":
        flight_tracker.on_kill(
            target_name=payload.get("targetName"),
            target_relation=payload.get("targetRelation"),
            target_category=payload.get("targetCategory"),
            weapon_type=payload.get("weaponType"),
        )
    elif kind == "shot":
        flight_tracker.on_shot(weapon_type=payload.get("weaponType"))
    elif kind == "gun_start":
        flight_tracker.on_gun_start(weapon_type=payload.get("weaponType"))


def start_combat_event_listener(flight_tracker, explicit_path=None, poll_interval_seconds=0.5):
    events_path = find_combat_events_path(explicit_path)
    _debug_log(f"watching {events_path}")

    def _watch():
        # Clear any events left over from a previous session on every
        # MachLink launch - otherwise the moment this file is first
        # noticed, all its old lines would look brand new and get
        # replayed into whatever flight happens to be in progress now.
        try:
            if events_path.exists():
                events_path.write_text("", encoding="utf-8")
        except OSError:
            pass

        offset = 0
        buffer = ""
        while True:
            time.sleep(poll_interval_seconds)
            try:
                if not events_path.exists():
                    continue
                size = events_path.stat().st_size
                if size < offset:
                    # Recreated/truncated since we last read it (e.g. a
                    # fresh DCS session) - start over from its beginning.
                    offset = 0
                    buffer = ""
                if size == offset:
                    continue
                with open(events_path, "r", encoding="utf-8") as f:
                    f.seek(offset)
                    chunk = f.read()
                    offset = f.tell()
                buffer += chunk
                *complete_lines, buffer = buffer.split("\n")
                for line in complete_lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        _debug_log(f"EXCEPTION: bad JSON line: {line!r}")
                        continue
                    _dispatch(payload, flight_tracker)
            except Exception:
                _debug_log(f"EXCEPTION in combat event watcher loop:\n{traceback.format_exc()}")
                continue

    t = threading.Thread(target=_watch, daemon=True)
    t.start()
    return t
