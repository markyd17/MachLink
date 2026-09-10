"""
Listens on localhost UDP for messages from dcs_export_hook.lua and updates
shared app state with the currently active DCS aircraft - and, since the
hook was extended for the Debrief feature, feeds real height-above-ground/
velocity telemetry to a FlightTracker for landed-and-stopped detection.

Runs as a background thread started by app.py - not meant to be run
standalone.
"""
import json
import socket
import threading
import time
import traceback
from pathlib import Path

# Temporary diagnostic logging for the Debrief "no debrief after a crash"
# investigation - every packet received and any exception get appended
# here so a real flight can be reviewed after the fact without a visible
# console. Safe to delete this file any time; it's recreated as needed.
DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_debug.log"


def _debug_log(line):
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
    except OSError:
        pass  # diagnostic logging is best-effort - never worth crashing over


def start_dcs_listener(state, flight_tracker=None, port=39234):
    def _listen():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", port))
        while True:
            try:
                data, _ = sock.recvfrom(4096)
                payload = json.loads(data.decode("utf-8"))
                if payload.get("game") == "dcs" and payload.get("aircraft"):
                    with state.lock:
                        state.game = "dcs"
                        state.aircraft = payload["aircraft"]
                        state.last_game_signal_at = time.time()
                        # Export callbacks keep firing on DCS's render loop
                        # even while paused (see dcs_export_hook.lua's own
                        # comment on DCS.getPause()) - so this keeps
                        # updating (and last_game_signal_at above keeps
                        # refreshing) right through a pause, unlike the
                        # mission hook's own sim-time-gated snapshot writer.
                        # None (older DCS, no DCS.getPause()) is treated as
                        # "unknown," never as "paused."
                        state.dcs_paused = bool(payload.get("paused")) if "paused" in payload else None
                        mission_name = (state.dcs_mission_briefing or {}).get("sortie")
                    _debug_log(
                        f"RECV aircraft={payload.get('aircraft')!r} "
                        f"agl={payload.get('agl')!r} vel={payload.get('vel')!r} "
                        f"vy={payload.get('vy')!r}"
                    )
                    if flight_tracker is not None:
                        flight_tracker.update(
                            payload["aircraft"],
                            payload.get("agl"),
                            payload.get("vel"),
                            mission_name=mission_name,
                            vy=payload.get("vy"),
                        )
            except Exception:
                # Never let a malformed packet kill the listener thread -
                # but log it now instead of swallowing it silently, so a
                # real bug doesn't look identical to "no packets arrived".
                _debug_log(f"EXCEPTION in listener loop:\n{traceback.format_exc()}")
                continue

    t = threading.Thread(target=_listen, daemon=True)
    t.start()
    return t
