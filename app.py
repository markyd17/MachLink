import json
import sys
import threading
import webbrowser
from pathlib import Path

import yaml
from flask import Flask, Response, jsonify, render_template, request

# Optional: gives MachLink a real app window (its own icon/taskbar entry,
# no address bar or tabs) via the OS's own WebView2 engine, instead of
# opening a tab in whatever browser is default. Genuinely optional - if
# it's not installed (or its native runtime isn't available), MachLink
# falls straight back to the plain browser-tab behavior it always had,
# rather than failing to start.
try:
    import webview
    HAS_WEBVIEW = True
except ImportError:
    HAS_WEBVIEW = False

from integrations.dcs_listener import start_dcs_listener
from integrations.dcs_hook_guard import start_hook_guard
from integrations.dcs_mission_briefing import start_mission_briefing_watcher
from integrations.dcs_flight_tracker import (
    FlightTracker, FLIGHT_LOG_PATH, start_crash_watchdog, DEBRIEF_MIN_FLIGHT_SECONDS,
)
from integrations.dcs_combat_events import LiveEventStore, start_combat_event_listener
from integrations.dcs_map_data import MapDataStore, start_map_data_watcher
from integrations.logbook_stats import compute_stats as compute_logbook_stats
from integrations.dcs_kneeboard import (
    find_dcs_install,
    find_user_kneeboard_dir,
    aircraft_kneeboard_pages,
    terrain_kneeboard_pages,
    user_kneeboard_pages,
    mission_kneeboard_pages,
    read_mission_kneeboard_image,
    clean_label,
)
from integrations.msfs_watcher import start_msfs_watcher
from integrations.simbrief import fetch_latest_ofp
from retrieval import search_aircraft_data, ask_llm_fallback
from bindings import resolve_aircraft_bindings, load_cockpit_configs, set_active_cockpit_config
from device_diagrams import diagrams_for_matches

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data" / "aircraft"


class AppState:
    def __init__(self):
        self.lock = threading.Lock()
        self.game = None
        self.aircraft = None
        self.msfs_available = False
        self.msfs_error = None
        self.dcs_hook = None
        self.dcs_mission_briefing = None
        # Bumped every time a new mission-load is detected, even if the
        # resolved .miz path is unchanged - Quick Mission Builder reuses the
        # same tempMission.miz path for every mission, so path equality
        # alone can't tell the frontend a new one actually loaded.
        self.dcs_mission_seq = 0


state = AppState()
app = Flask(__name__)
# Flask's jsonify() alphabetizes object keys by default. Checklist sections
# (and their steps) must render in the guide's real authored order, not
# alphabetical - "after_start_up" sorting before "before_start_up" would
# silently scramble a real startup sequence, which matters for a safety
# checklist. Preserve dict insertion order (= file order) instead.
app.json.sort_keys = False


def load_config():
    cfg_path = BASE_DIR / "config.yaml"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


CONFIG = load_config()
# Falls back to the real 5-minute spec unless config.yaml overrides it -
# see dcs.debrief_min_flight_seconds there (currently set to 30 for fast
# testing; put it back to 300, or just delete the line, once you're done).
flight_tracker = FlightTracker(
    min_flight_seconds=(CONFIG.get("dcs") or {}).get("debrief_min_flight_seconds", DEBRIEF_MIN_FLIGHT_SECONDS)
)
map_data_store = MapDataStore()
live_event_store = LiveEventStore()


def load_aircraft_file(name, game=None):
    """Looks up an aircraft's data file by the exact name the game reports.
    Tries, in order: an unprefixed exact match, a game-prefixed match
    (dcs_<name>.json / msfs_<name>.json - supports the dcs_/msfs_ filename
    convention), then falls back to a normalized display_name comparison
    across all files."""
    if not name:
        return None

    candidates = [f"{name}.json"]
    if game:
        candidates.insert(0, f"{game}_{name}.json")
    else:
        candidates += [f"dcs_{name}.json", f"msfs_{name}.json"]

    for candidate in candidates:
        direct = DATA_DIR / candidate
        if direct.exists():
            with open(direct, "r", encoding="utf-8") as f:
                return json.load(f)

    normalized_target = name.strip().lower()
    for path in DATA_DIR.glob("*.json"):
        if path.stem.startswith("_"):
            continue
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("display_name", "").strip().lower() == normalized_target:
            return data
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    with state.lock:
        game, aircraft = state.game, state.aircraft
        msfs_available, msfs_error = state.msfs_available, state.msfs_error
        dcs_hook = state.dcs_hook

    aircraft_data = load_aircraft_file(aircraft, game) if aircraft else None
    return jsonify({
        "game": game,
        "aircraft": aircraft,
        "aircraft_data_loaded": aircraft_data is not None,
        "msfs_connection": {"available": msfs_available, "error": msfs_error},
        "dcs_hook": dcs_hook,
    })


@app.route("/api/checklist")
def api_checklist():
    with state.lock:
        game, aircraft = state.game, state.aircraft
    aircraft_data = load_aircraft_file(aircraft, game)
    if not aircraft_data:
        return jsonify({"error": f"No data file loaded for '{aircraft}'. "
                                  f"Build one with tools/pdf_import.py and _TEMPLATE.json."}), 404
    return jsonify(aircraft_data)


@app.route("/api/ask", methods=["POST"])
def api_ask():
    body = request.get_json(force=True)
    query = (body or {}).get("query", "").strip()
    if not query:
        return jsonify({"error": "Empty question"}), 400

    with state.lock:
        game, aircraft = state.game, state.aircraft
    aircraft_data = load_aircraft_file(aircraft, game)

    matches = search_aircraft_data(aircraft_data, query) if aircraft_data else []
    if matches:
        return jsonify({"source": "sourced_data", "aircraft": aircraft, "matches": matches})

    # Nothing found in sourced data - offer the clearly-labeled AI fallback
    api_key = (CONFIG.get("anthropic") or {}).get("api_key")
    model = (CONFIG.get("anthropic") or {}).get("model", "claude-sonnet-5")
    if not api_key:
        return jsonify({
            "source": "none",
            "message": "No match in your loaded aircraft data, and no Anthropic "
                       "API key is configured for the AI fallback. Add one to "
                       "config.yaml if you want unverified best-effort answers "
                       "for questions your data doesn't cover.",
        })

    result = ask_llm_fallback(query, aircraft or "unknown aircraft", api_key, model)
    return jsonify(result)


@app.route("/api/bindings")
def api_bindings():
    with state.lock:
        aircraft = state.aircraft
    if not aircraft:
        return jsonify({"available": False, "bindings": {}})
    return jsonify(resolve_aircraft_bindings(aircraft))


@app.route("/api/device_diagram/<binding_key>")
def api_device_diagram(binding_key):
    svg_dir = (CONFIG.get("joystick_diagrams") or {}).get("svg_export_dir")
    if not svg_dir:
        return jsonify({"available": False, "reason": "no_svg_dir_configured"})

    with state.lock:
        aircraft = state.aircraft
    if not aircraft:
        return jsonify({"available": False, "reason": "no_aircraft_detected"})

    resolved = resolve_aircraft_bindings(aircraft)
    entry = resolved.get("bindings", {}).get(binding_key)
    if not entry or entry["state"] not in ("bound", "not_in_config"):
        return jsonify({"available": False, "reason": "not_bound"})

    diagrams = diagrams_for_matches(svg_dir, entry["matches"])
    if not diagrams:
        return jsonify({"available": False, "reason": "no_diagram_found"})
    return jsonify({"available": True, "display_label": entry["display_label"], "diagrams": diagrams})


@app.route("/api/cockpit_config", methods=["GET", "POST"])
def api_cockpit_config():
    if request.method == "POST":
        body = request.get_json(force=True) or {}
        name = (body.get("active") or "").strip()
        if not name or not set_active_cockpit_config(name):
            return jsonify({"error": f"No cockpit configuration named '{name}'."}), 400
    return jsonify(load_cockpit_configs())


@app.route("/api/dcs_briefing")
def api_dcs_briefing():
    with state.lock:
        briefing, seq = state.dcs_mission_briefing, state.dcs_mission_seq
    if not briefing:
        return jsonify({"available": False, "seq": seq})
    return jsonify({"available": True, "seq": seq, **briefing})


@app.route("/api/debrief_status")
def api_debrief_status():
    """Lightweight, meant to be polled often - just enough for the Generate
    Debrief button to know whether to light up, without shipping the full
    report on every poll."""
    return jsonify(flight_tracker.status())


@app.route("/api/debrief/latest")
def api_debrief_latest():
    """The full most-recently-completed flight's report. Fetching this is
    what the lit-up button does when clicked - viewing it also dims the
    button (acknowledges it) without discarding the data, so it can still
    be re-fetched afterward if needed."""
    record = flight_tracker.latest_debrief()
    if not record:
        return jsonify({"available": False})
    flight_tracker.acknowledge_debrief()
    return jsonify({"available": True, **record})


@app.route("/api/flight_log")
def api_flight_log():
    """Every completed flight logged so far - data/flight_log.json isn't
    created until the first one completes, so a missing file just means
    "nothing logged yet", not an error."""
    if not FLIGHT_LOG_PATH.exists():
        return jsonify([])
    try:
        return jsonify(json.loads(FLIGHT_LOG_PATH.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return jsonify([])


@app.route("/api/logbook")
def api_logbook():
    """Career-wide Logbook view: aggregate stats (logbook_stats.py) plus
    the full flight history, newest first (nicest order for a scrollable
    list - flight_log.json itself is oldest-first, since it's an append
    log)."""
    flights = []
    if FLIGHT_LOG_PATH.exists():
        try:
            flights = json.loads(FLIGHT_LOG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            flights = []
    return jsonify({
        "summary": compute_logbook_stats(flights),
        "flights": list(reversed(flights)),
    })


@app.route("/api/map_data")
def api_map_data():
    """Live F10-style map snapshot (own position, friendlies, airbases,
    bullseye, detected contacts) - see dcs_map_data.py/dcs_mission_hook.lua.
    {"available": false} until the mission hook's first snapshot arrives
    (needs Phase 2 installed and a unit under control)."""
    return jsonify(map_data_store.get())


@app.route("/api/live_events")
def api_live_events():
    """Ops's live combat-event ticker - the same hit/shot/kill/loss events
    dcs_combat_events.py already tails for the eventual Debrief report,
    just the last few surfaced as they happen instead of only after
    landing. See LiveEventStore in dcs_combat_events.py."""
    return jsonify({"events": live_event_store.recent()})


def _kneeboard_context():
    """The live values every kneeboard source is resolved against, read
    once per request so /api/kneeboard and the page-serving route below
    always agree on what "the current aircraft/mission/theatre" means."""
    with state.lock:
        aircraft = state.aircraft
        briefing = state.dcs_mission_briefing or {}
    dcs_cfg = CONFIG.get("dcs") or {}
    return {
        "aircraft": aircraft,
        "mission_file": briefing.get("mission_file"),
        "theatre": briefing.get("theatre"),
        "install": find_dcs_install(dcs_cfg.get("install_path") or None),
        "user_kneeboard_dir": find_user_kneeboard_dir(dcs_cfg.get("kneeboard_path") or None),
    }


def _kneeboard_pages_by_source(ctx):
    """{"aircraft"|"terrain"|"user": [Path, ...], "mission": [(entry, label), ...]} -
    the real pages available right now for each of the four sources (see
    dcs_kneeboard.py's module docstring)."""
    return {
        "aircraft": aircraft_kneeboard_pages(ctx["install"], ctx["aircraft"]),
        "terrain": terrain_kneeboard_pages(ctx["install"], ctx["theatre"]),
        "user": user_kneeboard_pages(ctx["user_kneeboard_dir"], ctx["aircraft"]),
        "mission": mission_kneeboard_pages(ctx["mission_file"]),
    }


@app.route("/api/kneeboard")
def api_kneeboard():
    pages = _kneeboard_pages_by_source(_kneeboard_context())
    return jsonify({
        "aircraft_pages": [{"index": i, "label": f"Page {i + 1}"} for i in range(len(pages["aircraft"]))],
        "terrain_pages": [{"index": i, "label": clean_label(p.stem)} for i, p in enumerate(pages["terrain"])],
        "user_pages": [{"index": i, "label": clean_label(p.stem)} for i, p in enumerate(pages["user"])],
        "mission_pages": [{"index": i, "label": label} for i, (_entry, label) in enumerate(pages["mission"])],
    })


@app.route("/api/kneeboard/<source>/<int:index>")
def api_kneeboard_page(source, index):
    ctx = _kneeboard_context()
    pages = _kneeboard_pages_by_source(ctx).get(source)
    if pages is None or index < 0 or index >= len(pages):
        return jsonify({"error": "No such page."}), 404

    if source == "mission":
        entry_name, _label = pages[index]
        data = read_mission_kneeboard_image(ctx["mission_file"], entry_name)
        if data is None:
            return jsonify({"error": "Could not read that page."}), 404
        name = entry_name
    else:
        path = pages[index]
        data = path.read_bytes()
        name = path.name

    mimetype = "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "image/png"
    return Response(data, mimetype=mimetype)


@app.route("/api/simbrief")
def api_simbrief():
    sb_cfg = CONFIG.get("simbrief") or {}
    result = fetch_latest_ofp(
        username=sb_cfg.get("username") or None,
        pilot_id=sb_cfg.get("pilot_id") or None,
    )
    return jsonify(result)


@app.route("/api/aircraft_list")
def api_aircraft_list():
    out = []
    for path in DATA_DIR.glob("*.json"):
        if path.stem.startswith("_"):
            continue
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        out.append({"file": path.stem, "display_name": data.get("display_name"), "game": data.get("game")})
    return jsonify(out)


if __name__ == "__main__":
    # pythonw.exe (used by run_silent.vbs for the no-console launch) has no
    # console at all, so print() output would otherwise just vanish -
    # redirected to a log file instead so the diagnostic messages below
    # (hook-guard status, the "MachLink running at..." line, any traceback)
    # are still there to check if something goes wrong. Overwritten fresh
    # each launch - only the most recent session matters for this.
    if sys.executable.lower().endswith("pythonw.exe"):
        log_file = open(BASE_DIR / "machlink.log", "w", encoding="utf-8", buffering=1)
        sys.stdout = log_file
        sys.stderr = log_file

    dcs_cfg = CONFIG.get("dcs") or {}
    msfs_cfg = CONFIG.get("msfs") or {}

    start_hook_guard(
        explicit_path=dcs_cfg.get("export_lua_path") or None,
        interval_seconds=dcs_cfg.get("hook_check_interval_seconds", 60),
        state=state,
    )
    start_dcs_listener(state, flight_tracker, port=dcs_cfg.get("udp_listen_port", 39234))
    start_crash_watchdog(flight_tracker)
    start_combat_event_listener(flight_tracker, live_event_store, explicit_path=dcs_cfg.get("mission_events_path") or None)
    start_map_data_watcher(map_data_store, explicit_path=dcs_cfg.get("map_data_path") or None)
    start_mission_briefing_watcher(state, explicit_log_path=dcs_cfg.get("log_path") or None)
    start_msfs_watcher(state, poll_interval_seconds=msfs_cfg.get("poll_interval_seconds", 5))

    server_cfg = CONFIG.get("server") or {}
    port = server_cfg.get("port", 5000)
    url = f"http://localhost:{port}"
    print(f"MachLink running at {url}")

    if HAS_WEBVIEW and server_cfg.get("native_window", True):
        # Without this, Windows treats the running window as just another
        # pythonw.exe instance - shared with every other Python GUI app on
        # the machine - which is why "pin to taskbar" either refuses or
        # produces a confusing, unstable pin. An explicit AppUserModelID
        # gives MachLink its own distinct identity to pin, independent of
        # the interpreter that happens to be running it. Windows-only API;
        # harmless no-op attempt elsewhere, but guarded anyway.
        if sys.platform == "win32":
            try:
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("MachLink.App")
            except Exception:
                pass

        # Flask has to run somewhere that isn't the main thread here, since
        # webview.start() below takes over the main thread for the native
        # window's own event loop (same reason a GUI toolkit's mainloop()
        # has to run on the main thread) - it's still the same Flask app,
        # same routes, same background integration threads, just not
        # blocking in-place the way app.run() normally would.
        threading.Thread(
            target=lambda: app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False),
            daemon=True,
        ).start()
        webview.create_window("MachLink", url, width=1360, height=860, min_size=(900, 600))
        # Without an explicit icon, pywebview's Windows backend falls back
        # to extracting one from sys.executable - pythonw.exe itself - which
        # is exactly the generic Python icon on the taskbar. This is the
        # same logo already used for the desktop shortcut and the in-page
        # header (see static/machlink_icon_512.png for how it was built).
        icon_path = BASE_DIR / "static" / "machlink.ico"
        webview.start(icon=str(icon_path) if icon_path.exists() else None)
    else:
        if server_cfg.get("open_browser", True):
            # Flask hasn't started listening yet at this point - give it a
            # beat so the browser doesn't hit "connection refused" on the
            # first try.
            threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        app.run(host="127.0.0.1", port=port, debug=False)
