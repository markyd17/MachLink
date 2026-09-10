"""
Optional: surfaces DCS "Pretense" dynamic-campaign zone captures on Ops's
live event carousel, as "zone_capture" events - explicit user request
("[the ticker] should only report major events like waypoints captured,
mission events completed" - a follow-up question established this means
zone-capture-style events from community multiplayer campaign missions
like Pretense/Inferno, not a generic DCS feature).

Pretense (https://github.com/GoldJohnKing/pretense) is a popular
community-made persistent multiplayer campaign mission, not a DCS engine
feature - there is no generic DCS scripting API for "a zone was captured"
the way there is for S_EVENT_HIT/S_EVENT_KILL/etc., since capturable
zones are entirely Pretense's own mission-Lua concept, invisible to
anything outside that specific mission's own scripts. Pretense writes its
own running state to a plain JSON file specifically for this kind of
external consumption - straight from its own docs: "the mission also
writes to a file called player_stats.json... You can use the information
in this file to export a mission status to a discord server or to a
website, or whatever other use you can come up with." The community
Discord bot "DCSServerBot" already has a plugin that reads this exact
file for its own Pretense integration - same file, different consumer.

UNVERIFIED against a real running Pretense mission - built from Pretense's
own public documentation and (via web research, not a live sample of the
actual file) that Discord-bot plugin's reporting code, not a real copy of
player_stats.json. The exact shape of data["zones"] is defensive/best-
effort here (tries the most likely shape - a flat dict keyed by zone name,
each carrying a "side" string - and skips anything that doesn't match
rather than crashing). _debug_log() below records the file's real
top-level keys the first time it's ever found, specifically so a real
mismatch can be diagnosed and fixed from that log instead of guessed at a
second time. "Inferno" (the other framework named in the same request) has
no similarly-documented external file/API found during research - not
supported here; flag if that changes.

No mission uses Pretense unless the mission author specifically chose it -
the stats file simply never existing is the normal, expected case for
every other mission (including a completely offline single-player one),
not an error condition.
"""
import json
import threading
import time
import traceback
from pathlib import Path

# Reuses dcs_listener.py's own diagnostic log file rather than adding yet
# another one - same best-effort, never-worth-crashing-over pattern.
DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_debug.log"

# Same Saved Games variants every other DCS integration in this repo
# checks, in the same order.
_DCS_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")
# Pretense has shipped under both names across versions (per DCSServerBot's
# own plugin, which checks both) - v2.0 missions write the newer name.
_STATS_FILENAMES = ("player_stats.json", "player_stats_v2.0.json")

# DCS's own coalition-id convention (1 = red, 2 = blue, 0 = neutral) -
# already used the same way throughout this codebase (e.g. the mission
# hook's own write_map_snapshot()). Pretense's own docs describe zone
# ownership in lowercase "blue"/"red"/"neutral" side names.
_COALITION_TO_SIDE = {1: "red", 2: "blue"}


def _debug_log(line):
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} PRETENSE {line}\n")
    except OSError:
        pass  # diagnostic logging is best-effort - never worth crashing over


def _candidate_paths():
    home = Path.home()
    for variant in _DCS_VARIANTS:
        for filename in _STATS_FILENAMES:
            yield home / "Saved Games" / variant / "Missions" / "Saves" / filename


def find_pretense_stats_path(explicit_path=None):
    """The stats file to watch: the configured path if given, otherwise
    the first candidate that actually exists, otherwise None - meaning no
    Pretense mission has ever saved here, the normal case for anyone not
    running one."""
    if explicit_path:
        return Path(explicit_path)
    for path in _candidate_paths():
        if path.exists():
            return path
    return None


def _extract_zone_sides(data):
    """{zone_name: side} from the parsed player_stats.json - see this
    module's own docstring on why this is a best-effort, unverified
    shape. Returns {} (no zones = no events, not an error) for anything
    that doesn't match a flat {name: {"side": "blue"|"red"|"neutral"}}
    dict."""
    zones = data.get("zones")
    if not isinstance(zones, dict):
        return {}
    result = {}
    for name, zone in zones.items():
        if isinstance(zone, dict) and isinstance(zone.get("side"), str):
            result[name] = zone["side"].lower()
    return result


class PretenseZoneWatcher:
    """Polls player_stats.json and diffs zone ownership against the
    previous poll to synthesize discrete "zone_capture" events - the file
    itself is only ever a snapshot of CURRENT state (Pretense's own docs
    say it's rewritten once a minute), not a log of what changed, so this
    is what turns "zone X is now red" into "zone X was JUST captured by
    red" the one time that's actually a change, not a red zone staying
    red poll after poll."""

    def __init__(self, map_data_store, live_events, explicit_path=None, poll_interval_seconds=10):
        self.map_data_store = map_data_store
        self.live_events = live_events
        self.explicit_path = explicit_path
        self.poll_interval_seconds = poll_interval_seconds
        # None means "not seen yet" - deliberately distinct from {} (seen,
        # but no zones matched), so the very first real read never reports
        # every zone as "just captured" just because there was nothing to
        # diff against before it.
        self.last_sides = None
        self.logged_shape_once = False

    def _poll(self):
        path = find_pretense_stats_path(self.explicit_path)
        if not path:
            return  # no Pretense mission running - normal, not an error
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return

        if not self.logged_shape_once:
            self.logged_shape_once = True
            _debug_log(f"found {path}, top-level keys={list(data.keys()) if isinstance(data, dict) else type(data)}")

        sides = _extract_zone_sides(data)
        if not sides:
            return

        # Player's own coalition, read from the SAME live map snapshot the
        # Mission tab's own map already trusts for this (data.myCoalition,
        # written by dcs_mission_hook.lua) - not a second guess at it.
        snapshot = self.map_data_store.get()
        my_coalition = (snapshot.get("data") or {}).get("myCoalition")
        my_side = _COALITION_TO_SIDE.get(my_coalition)

        if self.last_sides is not None:
            for zone_name, new_side in sides.items():
                old_side = self.last_sides.get(zone_name)
                if old_side is not None and old_side != new_side:
                    relation = None
                    if my_side and new_side in ("blue", "red"):
                        relation = "friendly" if new_side == my_side else "enemy"
                    self.live_events.add(
                        "zone_capture", name=zone_name, relation=relation, new_side=new_side,
                    )
        self.last_sides = sides

    def run_forever(self):
        while True:
            try:
                self._poll()
            except Exception:
                _debug_log(f"EXCEPTION in poll loop:\n{traceback.format_exc()}")
            time.sleep(self.poll_interval_seconds)


def start_pretense_zone_watcher(map_data_store, live_events, explicit_path=None, poll_interval_seconds=10):
    watcher = PretenseZoneWatcher(map_data_store, live_events, explicit_path, poll_interval_seconds)
    t = threading.Thread(target=watcher.run_forever, daemon=True)
    t.start()
    return t
