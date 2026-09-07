"""
Keeps the MachLink export hook installed in DCS's Export.lua.

Why this exists: other tools that also write to Export.lua (HOTAS/panel
configurators like WinWing's SimApp Pro, in Marky's case) can overwrite the
whole file - wiping out our hook - when they update, when their own
"repair"/sync feature runs, or in some cases just on their own startup.
When that happens, DCS never sends MachLink the active-aircraft UDP
message, and the app looks like detection silently stopped working.

This module can't intercept another program writing to the file, so instead
it checks Export.lua for our hook (by looking for the MACHLINK_HOOK
marker in integrations/dcs_export_hook.lua) and re-adds it if missing:
  - once when MachLink starts, and
  - periodically (every hook_check_interval_seconds) while it keeps running,
    so the hook gets restored even if something clobbers Export.lua mid-session.

It only ever appends its own marked block - it never touches or removes
whatever else is already in the file (e.g. SimApp Pro's own wwt loader
lines) - and it keeps a one-deep backup of Export.lua from just before the
last time it had to repair it, at Export.lua.machlink_backup.
"""
import threading
import time
from pathlib import Path

MARKER = "MACHLINK_HOOK"
HOOK_SOURCE_PATH = Path(__file__).parent / "dcs_export_hook.lua"

# Saved Games folder variants to check, in order, when config.yaml doesn't
# pin an explicit path. DCS almost always keeps Saved Games directly under
# the Windows user profile folder (not redirected the way Desktop/Documents
# sometimes are), so Path.home() is a reliable anchor here.
_DCS_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")


def _candidate_paths():
    home = Path.home()
    for variant in _DCS_VARIANTS:
        yield home / "Saved Games" / variant / "Scripts" / "Export.lua"


def find_export_lua(explicit_path=None):
    """Returns the Export.lua path to manage: the configured path if given,
    otherwise the first candidate that already exists, otherwise the first
    candidate (DCS stable) so a fresh one can be created there."""
    if explicit_path:
        return Path(explicit_path)
    candidates = list(_candidate_paths())
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def ensure_hook_installed(explicit_path=None):
    """Checks the target Export.lua for our hook and repairs it if missing.

    Returns a dict: {"status": "ok" | "repaired" | "created" | "error",
    "path": str, "detail": str (only set for "error")}.
    """
    try:
        path = find_export_lua(explicit_path)
        hook_src = HOOK_SOURCE_PATH.read_text(encoding="utf-8")

        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(hook_src, encoding="utf-8")
            return {"status": "created", "path": str(path)}

        content = path.read_text(encoding="utf-8", errors="ignore")
        if MARKER in content:
            return {"status": "ok", "path": str(path)}

        # Hook is missing - some other tool rewrote the file. Keep a
        # one-deep backup of what we found, then append our block without
        # touching anything already there.
        backup_path = path.with_name(path.name + ".machlink_backup")
        try:
            backup_path.write_text(content, encoding="utf-8")
        except OSError:
            pass  # backup is best-effort, never block the repair on it

        separator = "" if content.endswith("\n") else "\n"
        new_content = content + separator + "\n" + hook_src
        path.write_text(new_content, encoding="utf-8")
        return {"status": "repaired", "path": str(path)}

    except OSError as e:
        return {"status": "error", "path": str(explicit_path or ""), "detail": str(e)}


def _describe(result):
    path = result["path"]
    if result["status"] == "ok":
        return f"DCS export hook OK ({path})"
    if result["status"] == "created":
        return f"DCS export hook: Export.lua didn't exist yet - created it with our hook ({path})"
    if result["status"] == "repaired":
        return (f"DCS export hook was MISSING from {path} (something else rewrote it - a HOTAS/panel "
                f"tool like SimApp Pro is a common cause) - reinstalled it automatically. If DCS is "
                f"already running, reload the mission (or restart DCS) for detection to pick back up. "
                f"A copy of what was there is saved at {path}.machlink_backup.")
    return f"DCS export hook check failed for {path}: {result.get('detail')}"


def start_hook_guard(explicit_path=None, interval_seconds=60, state=None):
    """Runs an immediate check, prints the result, then keeps re-checking
    in a background thread every interval_seconds for the life of the app.
    If `state` (the shared AppState) is given, the latest result is stored
    on it as state.dcs_hook for /api/status to report."""

    def _check_once():
        result = ensure_hook_installed(explicit_path)
        if state is not None:
            with state.lock:
                state.dcs_hook = result
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
