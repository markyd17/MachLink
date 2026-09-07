"""
Listens on localhost UDP for the combat/life-cycle events sent by
dcs_mission_hook.lua (the Mission Scripting environment hook, Phase 2 of
Debrief) - a separate stream from dcs_listener.py's continuous Export.lua
telemetry, on its own port, since it's event-driven rather than a steady
tick.

Runs as a background thread started by app.py - not meant to be run
standalone.
"""
import json
import socket
import threading
import time
import traceback
from pathlib import Path

DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_debug.log"


def _debug_log(line):
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} COMBAT {line}\n")
    except OSError:
        pass


def start_combat_event_listener(flight_tracker, port=39235):
    def _listen():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", port))
        while True:
            try:
                data, _ = sock.recvfrom(4096)
                payload = json.loads(data.decode("utf-8"))
                kind = payload.get("type")
                _debug_log(f"RECV {payload}")
                if kind == "birth":
                    flight_tracker.on_birth(payload.get("unitName"))
                elif kind in ("dead", "crash"):
                    flight_tracker.on_combat_loss(
                        kind,
                        shooter_name=payload.get("shooterName"),
                        shooter_relation=payload.get("shooterRelation"),
                        shooter_category=payload.get("shooterCategory"),
                        weapon_type=payload.get("weaponType"),
                    )
                # "hit" is intentionally never sent by the Lua hook - it's
                # tracked there internally only, to attribute a later
                # dead/crash event.
            except Exception:
                _debug_log(f"EXCEPTION in combat event listener loop:\n{traceback.format_exc()}")
                continue

    t = threading.Thread(target=_listen, daemon=True)
    t.start()
    return t
