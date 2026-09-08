"""
Keeps MachLinkMissionHook.lua (Phase 2 of Debrief - the mission-scripting
hook integrations/dcs_mission_hook.lua defines) in sync with the repo's
own copy, at Saved Games\\DCS\\Scripts\\MachLinkMissionHook.lua.

Why this exists: unlike Export.lua (dcs_hook_guard.py), which other tools
(HOTAS/panel configurators) also write to, this file is wholly MachLink's
own - nothing else touches it. But it's still just a plain file copy per
the README's one-time setup step, not something git/pip keeps in sync on
its own: pulling a MachLink update changes integrations/dcs_mission_hook.lua
in the repo, but DCS keeps running whatever was last copied to Saved Games
until that copy is redone by hand. A stale deployed copy doesn't error -
it just silently sends an older-shaped snapshot, missing whatever fields
newer app code depends on (categoryDetail, myCoalition, fuel, loadout,
airbase category, ...) - exactly the gap MAP_HOOK_VERSION and
dcs_map_data.py's hook_outdated check exist to flag, and exactly what
prompted this module: a hand-copy was needed mid-session to fix it.

Compares the two files byte-for-byte and overwrites the deployed copy
whenever it differs from the repo's version (missing entirely counts as
differing) - once when MachLink starts, and periodically (every
interval_seconds) while it keeps running, same pattern as
dcs_hook_guard.py. Unlike that one, there's no marker/append logic
needed - MachLink owns this whole file, so a full overwrite is always
safe and correct; a one-deep backup (path + ".machlink_backup") is kept
anyway, in case something else ever does touch it.

This does NOT touch the DCS INSTALL's Scripts\\MissionScripting.lua (the
"comment out sanitizeModule/require/loadlib/package, add a dofile()"
edit from the README). That's a genuinely different, one-time, higher-
privilege change - it usually needs an elevated terminal, since
Program Files is write-protected - and unlike this file, a MachLink
update never needs to change it again once it's in place.
"""
import threading
import time
from pathlib import Path

HOOK_SOURCE_PATH = Path(__file__).parent / "dcs_mission_hook.lua"
DEPLOYED_FILENAME = "MachLinkMissionHook.lua"

# Same Saved Games variants dcs_hook_guard.py/dcs_kneeboard.py/
# dcs_combat_events.py check, in the same order.
_DCS_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")


def _candidate_paths():
    home = Path.home()
    for variant in _DCS_VARIANTS:
        yield home / "Saved Games" / variant / "Scripts" / DEPLOYED_FILENAME


def find_deployed_mission_hook(explicit_path=None):
    """Returns the deployed MachLinkMissionHook.lua path to manage: the
    configured path if given, otherwise the first candidate whose Scripts
    folder already exists, otherwise the first candidate (DCS stable) so a
    fresh copy can be created there."""
    if explicit_path:
        return Path(explicit_path)
    candidates = list(_candidate_paths())
    for path in candidates:
        if path.parent.is_dir():
            return path
    return candidates[0]


def ensure_mission_hook_installed(explicit_path=None):
    """Checks the deployed mission hook against the repo's copy and
    overwrites it if missing or different.

    Returns a dict: {"status": "ok" | "created" | "repaired" | "error",
    "path": str, "detail": str (only set for "error")}.
    """
    try:
        path = find_deployed_mission_hook(explicit_path)
        hook_src = HOOK_SOURCE_PATH.read_text(encoding="utf-8")

        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(hook_src, encoding="utf-8")
            return {"status": "created", "path": str(path)}

        deployed = path.read_text(encoding="utf-8", errors="ignore")
        if deployed == hook_src:
            return {"status": "ok", "path": str(path)}

        # Deployed copy is stale (or was hand-edited) - keep a one-deep
        # backup of what was there, then overwrite it wholesale. Unlike
        # Export.lua, nothing else writes to this file, so there's nothing
        # to preserve/merge around - a full replace is always correct.
        backup_path = path.with_name(path.name + ".machlink_backup")
        try:
            backup_path.write_text(deployed, encoding="utf-8")
        except OSError:
            pass  # backup is best-effort, never block the repair on it

        path.write_text(hook_src, encoding="utf-8")
        return {"status": "repaired", "path": str(path)}

    except OSError as e:
        return {"status": "error", "path": str(explicit_path or ""), "detail": str(e)}


def _describe(result):
    path = result["path"]
    if result["status"] == "ok":
        return f"DCS mission hook OK ({path})"
    if result["status"] == "created":
        return (f"DCS mission hook: not deployed yet - copied it in ({path}). Still needs the one-time "
                f"MissionScripting.lua edit from the README before DCS will actually load it.")
    if result["status"] == "repaired":
        return (f"DCS mission hook at {path} was out of date (or hand-edited) - updated it to match the "
                f"current app. If DCS is already running, reload the mission (or restart DCS) to pick it "
                f"up. A copy of what was there is saved at {path}.machlink_backup.")
    return f"DCS mission hook check failed for {path}: {result.get('detail')}"


def start_mission_hook_guard(explicit_path=None, interval_seconds=60, state=None):
    """Runs an immediate check, prints the result, then keeps re-checking
    in a background thread every interval_seconds for the life of the app.
    If `state` (the shared AppState) is given, the latest result is stored
    on it as state.dcs_mission_hook for /api/status to report."""

    def _check_once():
        result = ensure_mission_hook_installed(explicit_path)
        if state is not None:
            with state.lock:
                state.dcs_mission_hook = result
        return result

    initial = _check_once()
    print(_describe(initial))

    def _loop():
        while True:
            time.sleep(interval_seconds)
            result = _check_once()
            # Only print on repairs/errors - a steady stream of "OK" every
            # interval would just be noise in the console.
            if result["status"] in ("repaired", "created", "error"):
                print(_describe(result))

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t
