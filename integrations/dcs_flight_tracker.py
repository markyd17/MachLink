"""
Tracks DCS flights for the Debrief feature - Phase 1 (no MissionScripting.lua
edit, no combat events): flight duration, aircraft, mission name, and
takeoff/landing count, all driven by the same Export.lua hook MachLink
already relies on for aircraft detection.

Landing/takeoff detection uses two real values verified against a live
session (a parked AH-64D): LoGetAltitudeAboveGroundLevel() (settles at
~2.3m when parked - the aircraft's own reference-point height, not 0 -
airborne easily clears the AIRBORNE_AGL_METERS threshold below) and the
magnitude of LoGetVectorVelocity() (settles to ~0 m/s at rest). Both are
real, documented DCS export functions (see Scripts/Export.lua in the DCS
install) - not the "weight-on-wheels" flag that turned out not to exist in
the documented API.

"Debrief ready" - the user's own requirement - fires when: landed, then
stopped (near-zero velocity, sustained for STOPPED_HOLD_SECONDS so a
momentary pause mid-rollout doesn't count), and the flight was airborne for
more than DEBRIEF_MIN_FLIGHT_SECONDS in total. The completed flight is
logged to data/flight_log.json at that point and tracking resets, so a
later takeoff (e.g. touch-and-go, repositioning) starts a fresh flight
rather than merging into the finished one.

Crash detection: confirmed via a live flight_debug.log capture that DCS's
export functions simply stop returning data the instant the aircraft is
destroyed - the Lua hook's pcall around LoGetSelfData() starts failing, so
no more UDP packets ever arrive for that flight. There is no AGL/velocity
value to detect "landed" from; the signal is the *absence* of telemetry
while still airborne. check_timeout() (called periodically by
start_crash_watchdog(), not from a telemetry tick) treats
CRASH_TIMEOUT_SECONDS of silence while airborne as a destroyed aircraft,
counts it as a landing, and completes the debrief with crashed=True - same
5-minute minimum applies. Known tradeoff: pausing DCS mid-flight can also
stop telemetry (LuaExportActivityNextEvent's internal rate-limit is driven
by LoGetModelTime(), which freezes when the sim is paused), so a long pause
while airborne would currently be misread as a crash too.
"""
import json
import threading
import time
from pathlib import Path

AIRBORNE_AGL_METERS = 5.0
STOPPED_VELOCITY_MPS = 0.5
STOPPED_HOLD_SECONDS = 5.0
DEBRIEF_MIN_FLIGHT_SECONDS = 5 * 60
CRASH_TIMEOUT_SECONDS = 10.0

FLIGHT_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_log.json"

# Temporary diagnostic logging for the "no debrief after a crash"
# investigation - see dcs_listener.py's DEBUG_LOG_PATH (same file, so the
# raw packets and the tracker's interpretation of them line up in one
# timeline). Safe to delete any time.
DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "flight_debug.log"


def _debug_log(line):
    try:
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} TRACKER {line}\n")
    except OSError:
        pass


def _append_flight_log(record):
    try:
        existing = []
        if FLIGHT_LOG_PATH.exists():
            existing = json.loads(FLIGHT_LOG_PATH.read_text(encoding="utf-8"))
        existing.append(record)
        FLIGHT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        FLIGHT_LOG_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    except OSError:
        pass  # logging a flight is best-effort - never crash tracking over a disk error


class FlightTracker:
    def __init__(self, now_fn=time.time):
        self._now = now_fn
        self.lock = threading.Lock()
        self._reset_in_progress()
        self.debrief_ready = False
        self.pending_debrief = None  # the most recently completed flight's record, until acknowledged

    def _reset_in_progress(self):
        self.aircraft = None
        self.mission_name = None
        self.start_time = None
        self.airborne_seconds = 0.0
        self.is_airborne = None
        self.takeoffs = 0
        self.landings = 0
        self._last_update_time = None
        self._stopped_since = None
        self.crashed = False
        # Populated only via a Phase 2 combat event (dcs_mission_hook.lua) -
        # left None for a clean landing, or for a Phase 1 timeout-inferred
        # crash where no cause was ever confirmed.
        self.loss_kind = None
        self.shooter_name = None
        self.shooter_relation = None
        self.shooter_category = None
        self.weapon_type = None

    def update(self, aircraft, agl, vel, mission_name=None):
        """Called on every export tick carrying flight-state telemetry."""
        with self.lock:
            now = self._now()

            if aircraft != self.aircraft:
                # A genuinely new flight - first detection, or the aircraft
                # changed. Anything still in progress (never landed+stopped
                # long enough) is simply dropped, not logged - there's no
                # clean "flight ended abnormally" signal available here
                # (see module docstring's Phase 1 scope).
                if self.aircraft is not None:
                    _debug_log(
                        f"RESET (aircraft change) old={self.aircraft!r} new={aircraft!r} "
                        f"discarded airborne_seconds={self.airborne_seconds:.1f} "
                        f"is_airborne={self.is_airborne} takeoffs={self.takeoffs} "
                        f"landings={self.landings}"
                    )
                self._reset_in_progress()
                self.aircraft = aircraft
                self.mission_name = mission_name
                self.start_time = now
                self._last_update_time = now
                return

            if mission_name and not self.mission_name:
                self.mission_name = mission_name

            dt = now - (self._last_update_time or now)
            self._last_update_time = now

            if agl is None or vel is None or self.start_time is None:
                _debug_log(f"SKIP missing telemetry agl={agl!r} vel={vel!r}")
                return

            airborne = agl > AIRBORNE_AGL_METERS

            if self.is_airborne is None:
                self.is_airborne = airborne
                _debug_log(f"INIT is_airborne={airborne} (agl={agl:.1f} vel={vel:.1f})")
            elif airborne and not self.is_airborne:
                self.takeoffs += 1
                self.is_airborne = True
                self._stopped_since = None
                _debug_log(f"TAKEOFF #{self.takeoffs} (agl={agl:.1f} vel={vel:.1f})")
            elif not airborne and self.is_airborne:
                self.landings += 1
                self.is_airborne = False
                self._stopped_since = None
                _debug_log(
                    f"LANDING #{self.landings} (agl={agl:.1f} vel={vel:.1f}) "
                    f"airborne_seconds so far={self.airborne_seconds:.1f}"
                )

            if self.is_airborne:
                self.airborne_seconds += dt
                self._stopped_since = None
            elif vel < STOPPED_VELOCITY_MPS:
                if self._stopped_since is None:
                    self._stopped_since = now
                    _debug_log(f"STOPPED-SINCE start (vel={vel:.2f})")
            else:
                if self._stopped_since is not None:
                    _debug_log(f"STOPPED-SINCE reset - moving again (vel={vel:.2f})")
                self._stopped_since = None

            self._maybe_complete(now)

    def _maybe_complete(self, now):
        if (
            self.is_airborne
            or self.landings < 1
            or self.airborne_seconds < DEBRIEF_MIN_FLIGHT_SECONDS
            or self._stopped_since is None
            or (now - self._stopped_since) < STOPPED_HOLD_SECONDS
        ):
            return
        self._complete(now)

    def _complete(self, now):
        record = {
            "aircraft": self.aircraft,
            "mission_name": self.mission_name,
            "start_time": self.start_time,
            "end_time": now,
            "duration_minutes": round((now - self.start_time) / 60, 1),
            "airborne_minutes": round(self.airborne_seconds / 60, 1),
            "takeoffs": self.takeoffs,
            "landings": self.landings,
            "crashed": self.crashed,
            "loss_kind": self.loss_kind,
            "shooter_name": self.shooter_name,
            "shooter_relation": self.shooter_relation,
            "shooter_category": self.shooter_category,
            "weapon_type": self.weapon_type,
        }
        _debug_log(f"DEBRIEF READY {record}")
        _append_flight_log(record)
        self.pending_debrief = record
        self.debrief_ready = True

        # Ready for a fresh flight (e.g. a later takeoff/repositioning)
        # without losing the debrief that just completed. start_time has
        # to become `now`, not None - update() treats "same aircraft" as
        # "already tracking, just accumulate", and start_time is what it
        # checks to know tracking is actually active; left at None here,
        # every later update for this same aircraft would be silently
        # ignored forever instead of starting a new flight.
        aircraft = self.aircraft
        self._reset_in_progress()
        self.aircraft = aircraft
        self.start_time = now
        self._last_update_time = now

    def check_timeout(self):
        """Called periodically (see start_crash_watchdog below) rather than
        from a telemetry tick - a destroyed aircraft stops sending
        telemetry entirely (see module docstring), so there is no tick left
        to detect the crash from. If we've been airborne and heard nothing
        for CRASH_TIMEOUT_SECONDS, treat that silence itself as the
        landing: count it, mark the flight crashed, and complete the
        debrief (still subject to the same 5-minute minimum)."""
        with self.lock:
            if (
                not self.is_airborne
                or self.start_time is None
                or self._last_update_time is None
            ):
                return
            now = self._now()
            gap = now - self._last_update_time
            if gap < CRASH_TIMEOUT_SECONDS:
                return

            # Credit the airborne time up to "now" (same as a normal tick's
            # dt would) so a crash right around the 5-minute mark isn't
            # missed by the width of the timeout window.
            self.airborne_seconds += gap
            self._last_update_time = now

            if self.airborne_seconds < DEBRIEF_MIN_FLIGHT_SECONDS:
                _debug_log(
                    f"CRASH TIMEOUT ({gap:.1f}s silent) but only "
                    f"{self.airborne_seconds:.1f}s airborne - under the 5 "
                    f"minute minimum, discarding without a debrief"
                )
                self._reset_in_progress()
                return

            _debug_log(
                f"CRASH TIMEOUT - no telemetry for {gap:.1f}s while "
                f"airborne, presumed destroyed - airborne_seconds="
                f"{self.airborne_seconds:.1f}"
            )
            self.landings += 1
            self.is_airborne = False
            self.crashed = True
            self.loss_kind = "timeout"  # no confirmed cause - see on_combat_loss for that
            self._complete(now)

    def on_birth(self, unit_name):
        """Called from the Phase 2 combat-event hook (dcs_mission_hook.lua)
        when the player takes control of a new unit - mission start, or any
        respawn, even into the same airframe type. This is an unambiguous
        new-life boundary regardless of respawn speed, unlike update()'s
        aircraft-name comparison (Phase 1's only identity signal, which
        can't tell a fast respawn into the same airframe from a continued
        flight - see the Phase 2 planning discussion)."""
        with self.lock:
            if self.start_time is not None and self.is_airborne:
                # A birth arrived while still marked airborne with no prior
                # dead/crash/timeout completion - almost certainly a loss
                # that slipped past both signals (e.g. a dropped UDP
                # packet). Nothing solid to build a debrief from, so just
                # note it rather than fabricate one.
                _debug_log(
                    f"BIRTH (unitName={unit_name!r}) while still airborne - "
                    f"previous life ended without a clean loss signal, discarding"
                )
            else:
                _debug_log(f"BIRTH (unitName={unit_name!r}) - starting a new life")
            now = self._now()
            self._reset_in_progress()
            self.start_time = now
            self._last_update_time = now
            # self.aircraft is intentionally left None here rather than set
            # from unit_name - that's DCS's internal object name, a
            # different namespace than the aircraft *type* Export.lua's
            # telemetry reports (self.aircraft elsewhere in this class).
            # The next telemetry tick fills it in via its own "aircraft
            # changed" path - which will also reset, harmlessly, a moment
            # after this one.

    def on_combat_loss(self, kind, shooter_name=None, shooter_relation=None,
                        shooter_category=None, weapon_type=None):
        """Called from the Phase 2 combat-event hook when the player's own
        unit was destroyed (kind="dead", by a weapon), crashed
        (kind="crash", terrain/water, no weapon), or the pilot ejected
        (kind="ejected" - captured at the moment of ejection itself, while
        the aircraft is still confirmed player-controlled, rather than
        waiting on whatever the now-empty airframe does afterward) - an
        authoritative, immediate signal that check_timeout() previously had
        to wait up to CRASH_TIMEOUT_SECONDS of telemetry silence to infer.
        Still subject to the same 5-minute minimum. shooter_* fields may be
        present on any of these three kinds - e.g. hit by ground fire,
        limped along for a while, then crashed from the damage - not just
        "dead"."""
        with self.lock:
            if self.start_time is None:
                return  # nothing being tracked - ignore
            now = self._now()
            if self.is_airborne and self._last_update_time is not None:
                # Credit airborne time up to now, same as check_timeout()
                # does - telemetry may already be a little stale by the
                # time this event arrives.
                self.airborne_seconds += now - self._last_update_time
            self._last_update_time = now

            if self.airborne_seconds < DEBRIEF_MIN_FLIGHT_SECONDS:
                _debug_log(
                    f"COMBAT LOSS ({kind}) but only "
                    f"{self.airborne_seconds:.1f}s airborne - under the 5 "
                    f"minute minimum, discarding without a debrief"
                )
                self._reset_in_progress()
                return

            self.landings += 1
            self.is_airborne = False
            self.crashed = True
            self.loss_kind = kind
            self.shooter_name = shooter_name
            self.shooter_relation = shooter_relation
            self.shooter_category = shooter_category
            self.weapon_type = weapon_type
            _debug_log(
                f"COMBAT LOSS ({kind}) shooter={shooter_name!r} "
                f"relation={shooter_relation!r} category={shooter_category!r} "
                f"weapon={weapon_type!r}"
            )
            self._complete(now)

    def acknowledge_debrief(self):
        """Called once the user has opened the debrief - dims the
        Generate Debrief button again without discarding the data, so it
        can still be re-fetched if needed."""
        with self.lock:
            self.debrief_ready = False

    def status(self):
        with self.lock:
            return {
                "ready": self.debrief_ready,
                "aircraft": self.pending_debrief["aircraft"] if self.pending_debrief else None,
            }

    def latest_debrief(self):
        with self.lock:
            return self.pending_debrief


def start_crash_watchdog(tracker, interval_seconds=2.0):
    """Background thread that calls check_timeout() on a plain wall-clock
    cadence - separate from update(), which only ever runs when a
    telemetry packet actually arrives and so can never notice packets
    have stopped arriving. Daemon thread, same pattern as the other
    integrations/*.py watchers app.py starts."""
    def _loop():
        while True:
            time.sleep(interval_seconds)
            tracker.check_timeout()

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t
