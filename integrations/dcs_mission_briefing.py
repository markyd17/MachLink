"""
Extracts the real mission briefing (sortie name, overview, coalition task
text) straight from the .miz DCS is actually flying, so the companion app
can show it in place of SimBrief when the detected sim is DCS rather than
MSFS - SimBrief's flight-plan pull has no DCS equivalent, but DCS missions
already carry their own real, authored briefing text, so this surfaces that
instead of leaving the panel empty.

How this works, verified against a real mission file rather than assumed:
DCS logs the exact path of the mission it just loaded to dcs.log (both a
`Dispatcher (Main): loadMission <path>` line and a quoted
`loading mission from: "<path>"` line - we watch for either). That path
points at a real .miz - a zip archive containing a `mission` file (a Lua
table with fields like ["descriptionText"] = "DictKey_descriptionText_1")
and `l10n/DEFAULT/dictionary` (another Lua table resolving those DictKey_*
names to the actual authored text). No DCS/MissionScripting.lua edit, no
Export.lua change, and no `io`/`lfs` sandbox access is needed - this only
ever reads dcs.log and the mission file DCS already wrote to disk itself.

Requires nothing beyond what DCS already does on every mission load, so
it works for single-player, multiplayer (DCS stages a local copy of the
server's mission the same way), and Quick Mission Builder missions alike.
"""
import re
import threading
import time
import zipfile
from pathlib import Path

# Saved Games folder variants to check, in order, when config.yaml doesn't
# pin an explicit path - same set dcs_hook_guard.py checks for Export.lua,
# since dcs.log lives under the same per-install Saved Games folder.
_DCS_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")

# Temporary diagnostic logging for the "Start Time never populates"
# investigation - _lua_number's unscoped re.search over the WHOLE mission
# file (unlike every other _lua_number call here, which is scoped to a
# specific already-extracted sub-table like ["weather"]) risks matching an
# unintended ["start_time"] occurrence, or none at all, in a real mission's
# Lua - and no sample .miz exists in this repo to verify against. This logs
# what the parser actually saw on the next real mission load so a genuine
# fix can be made instead of a guess. Safe to delete this file any time;
# it's recreated as needed. Same best-effort pattern as dcs_listener.py's
# own DEBUG_LOG_PATH.
_DEBUG_LOG_PATH = Path(__file__).parent.parent / "data" / "mission_briefing_debug.log"


def _debug_log(line):
    try:
        _DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
    except OSError:
        pass  # diagnostic logging is best-effort - never worth crashing over

_MISSION_LOAD_RE = re.compile(
    r'loading mission from:\s*"([^"]+\.miz)"|loadMission\s+(\S.*?\.miz)\s*$'
)

_MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _candidate_log_paths():
    home = Path.home()
    for variant in _DCS_VARIANTS:
        yield home / "Saved Games" / variant / "Logs" / "dcs.log"


def find_dcs_log(explicit_path=None):
    """Same pattern as dcs_hook_guard.find_export_lua: the configured path
    if given, otherwise the first candidate that already exists, otherwise
    None (nothing to watch yet - DCS may just never have run here)."""
    if explicit_path:
        return Path(explicit_path)
    for path in _candidate_log_paths():
        if path.exists():
            return path
    return None


def _read_lua_string(text, quote_idx):
    """text[quote_idx] must be the opening quote of a Lua short string.
    Returns (decoded_value, index_just_past_the_closing_quote) - a small
    manual scanner rather than a regex so escaped quotes/backslashes/
    newlines inside a long real briefing paragraph can't break the parse
    the way a naive `"(.*?)"` match would on the first embedded \\"."""
    quote = text[quote_idx]
    i = quote_idx + 1
    out = []
    escapes = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "'": "'", "\\": "\\"}
    while i < len(text):
        c = text[i]
        if c == "\\" and i + 1 < len(text):
            out.append(escapes.get(text[i + 1], text[i + 1]))
            i += 2
            continue
        if c == quote:
            return "".join(out), i + 1
        out.append(c)
        i += 1
    return "".join(out), i  # unterminated - hand back what we scanned


def _lua_table_string(text, key):
    """The string value of `["<key>"] = "..."` in a Lua table dump `text`,
    or None if that key isn't present (or isn't a plain quoted string).
    Used both for a mission field naming a DictKey_* (e.g. descriptionText)
    and for resolving that DictKey_* in the dictionary file - same shape."""
    marker = f'["{key}"]'
    idx = text.find(marker)
    if idx == -1:
        return None
    eq_idx = text.find("=", idx + len(marker))
    if eq_idx == -1:
        return None
    j = eq_idx + 1
    while j < len(text) and text[j] in " \t\r\n":
        j += 1
    if j >= len(text) or text[j] not in "\"'":
        return None
    value, _ = _read_lua_string(text, j)
    return value


def _lua_subtable(text, key):
    """The substring of a nested Lua table value `["<key>"] = { ... }` in
    `text`, between its opening brace and DCS's own closing comment for it
    (`-- end of ["<key>"]`, which DCS's serializer writes for every nested
    table - a reliable boundary marker confirmed against a real mission
    file, far simpler than hand-rolling brace-depth counting). None if the
    key isn't present as a table."""
    marker = f'["{key}"]'
    idx = text.find(marker)
    if idx == -1:
        return None
    brace_idx = text.find("{", idx)
    end_idx = text.find(f'-- end of ["{key}"]', brace_idx) if brace_idx != -1 else -1
    if brace_idx == -1 or end_idx == -1:
        return None
    return text[brace_idx:end_idx]


def _lua_number(text, key):
    # Number pattern widened to accept scientific notation (e.g.
    # "4.32e+04") on top of plain decimals - a strict superset of the old
    # pattern, so this can't newly fail to match anything that used to
    # match; only helps if a real mission's Lua serializer ever emits a
    # value that way.
    m = re.search(r'\["' + re.escape(key) + r'"\]\s*=\s*(-?[\d.]+(?:[eE][+-]?\d+)?)', text)
    return float(m.group(1)) if m else None


_CLOUD_COVERAGE = [(0, "Clear"), (2, "Few"), (4, "Scattered"), (7, "Broken"), (10, "Overcast")]


def _cloud_coverage_word(density):
    if density is None:
        return None
    for max_density, word in _CLOUD_COVERAGE:
        if density <= max_density:
            return word
    return "Overcast"


def _extract_weather(mission_text):
    """Real weather straight off the mission's own ["weather"] table -
    converted to units a pilot briefing would actually use (kt, ft, inHg),
    same "send ready-to-render numbers" pattern as /api/simbrief. None if
    the mission has no weather table at all (shouldn't normally happen,
    but every field here is best-effort rather than assumed present)."""
    weather = _lua_subtable(mission_text, "weather")
    if weather is None:
        return None
    wind = _lua_subtable(weather, "wind") or ""
    clouds = _lua_subtable(weather, "clouds") or ""
    season = _lua_subtable(weather, "season") or ""
    visibility = _lua_subtable(weather, "visibility") or ""

    def wind_band(band_key):
        block = _lua_subtable(wind, band_key)
        if block is None:
            return None, None
        speed_ms, dir_deg = _lua_number(block, "speed"), _lua_number(block, "dir")
        kt = round(speed_ms * 1.94384) if speed_ms is not None else None
        return kt, (round(dir_deg) if dir_deg is not None else None)

    ground_kt, ground_dir = wind_band("atGround")
    high_kt, high_dir = wind_band("at2000")

    temp_c = _lua_number(season, "temperature")
    qnh_mmhg = _lua_number(weather, "qnh")
    cloud_base_m = _lua_number(clouds, "base")
    visibility_m = _lua_number(visibility, "distance")

    return {
        "preset_name": _lua_table_string(weather, "name") or "",
        "temperature_c": round(temp_c) if temp_c is not None else None,
        "temperature_f": round(temp_c * 9 / 5 + 32) if temp_c is not None else None,
        "qnh_inhg": round(qnh_mmhg * 0.0393701, 2) if qnh_mmhg is not None else None,
        "qnh_mmhg": round(qnh_mmhg) if qnh_mmhg is not None else None,
        "wind_ground_kt": ground_kt,
        "wind_ground_dir_deg": ground_dir,
        "wind_high_kt": high_kt,
        "wind_high_dir_deg": high_dir,
        "cloud_base_ft": round(cloud_base_m * 3.28084) if cloud_base_m is not None else None,
        "cloud_coverage": _cloud_coverage_word(_lua_number(clouds, "density")),
        "visibility_nm": round(visibility_m / 1852, 1) if visibility_m is not None else None,
    }


def _resolve(mission_text, dictionary_text, field):
    """A mission field that's authored as a DictKey_* reference (sortie,
    descriptionText, descriptionBlueTask, descriptionRedTask) - looks up
    the reference, then resolves it through the dictionary. Returns ""
    (not None) for a field that's genuinely blank in the mission, same as
    DCS's own Briefing tab shows nothing rather than an error there."""
    dict_key = _lua_table_string(mission_text, field)
    if not dict_key:
        return ""
    return _lua_table_string(dictionary_text, dict_key) or ""


def parse_mission_briefing(miz_path):
    """The real briefing content of the .miz at miz_path: {sortie, theatre,
    date, overview, blue_task, red_task, weather, mission_file}. overview/
    blue_task/red_task are never truncated - a mission that authors its
    Situation text as one long block with its own section headers (e.g.
    "KNOWN THREATS", "TAKEOFF AND DEPARTURE") gets that whole block back
    verbatim, same as DCS's own Briefing screen shows it. weather is real
    structured data (wind/temp/QNH/clouds/visibility) that exists for every
    mission regardless of whether any briefing text was authored at all.
    Returns None if the file can't be read/parsed (e.g. a Quick Mission's
    temp .miz that's already been cleaned up since the mission ended) -
    that's a normal, expected case, not something to invent a fallback for."""
    try:
        with zipfile.ZipFile(miz_path) as z:
            mission_text = z.read("mission").decode("utf-8", errors="replace")
            dictionary_text = z.read("l10n/DEFAULT/dictionary").decode("utf-8", errors="replace")
    except (OSError, KeyError, zipfile.BadZipFile):
        return None

    date_str = None
    date_match = re.search(
        r'\["date"\]\s*=\s*\{\s*\["Day"\]\s*=\s*(\d+),\s*\["Year"\]\s*=\s*(\d+),\s*\["Month"\]\s*=\s*(\d+)',
        mission_text,
    )
    if date_match:
        day, year, month = (int(g) for g in date_match.groups())
        if 1 <= month <= 12:
            date_str = f"{day:02d} {_MONTH_ABBR[month]} {year}"

    # ["start_time"] (seconds since midnight, mission-local time) turned
    # out NOT to be the rarely-reused field this comment used to assume -
    # confirmed live (see _DEBUG_LOG_PATH's own log from a real mission)
    # against a real Quick Mission Builder .miz with 51 occurrences: the
    # SAME key name DCS writes on every unit GROUP for that group's own
    # spawn delay in seconds (almost always 0 - "spawn immediately"), and
    # the OLD unscoped _lua_number() call here was matching the FIRST of
    # those 50 nested group fields (giving a bogus but plausible-looking
    # "00:00") instead of the one real mission-level value, which sat 50
    # matches later in the file - this is exactly what "the start time
    # never kicks off" was actually describing. What distinguishes them:
    # every root-level field in a real DCS mission file (this one's own
    # ["date"]/["theatre"]/etc. included) sits at exactly one tab of Lua
    # table nesting, while a group's own start_time is buried 8 tabs deep
    # - anchoring the match to "exactly one leading tab on its own line"
    # is what actually targets the mission-level field instead of a
    # group's. No fallback to the old unscoped match on a miss - a wrong
    # group's spawn delay presented as the mission's start time is worse
    # than an honest "NA".
    root_start_time_match = re.search(
        r'(?m)^\t\["start_time"\]\s*=\s*(-?[\d.]+(?:[eE][+-]?\d+)?)', mission_text
    )
    start_time_seconds = float(root_start_time_match.group(1)) if root_start_time_match else None
    start_time_of_day = None
    if start_time_seconds is not None:
        total_minutes = int(start_time_seconds // 60) % (24 * 60)
        start_time_of_day = f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"
    # See _DEBUG_LOG_PATH above - logs every real mission load (not just
    # failures) with how many ["start_time"] occurrences the file actually
    # has (nested group fields included) and what the depth-anchored match
    # above actually landed on, so a mission that somehow doesn't follow
    # this same one-tab-of-indentation convention is still visible instead
    # of silently showing "NA" with no trace of why.
    occurrences = len(re.findall(r'\["start_time"\]\s*=', mission_text))
    _debug_log(
        f"start_time: miz={miz_path} occurrences={occurrences} "
        f"parsed_seconds={start_time_seconds!r} parsed_local={start_time_of_day!r}"
    )

    return {
        "sortie": _resolve(mission_text, dictionary_text, "sortie"),
        "theatre": _lua_table_string(mission_text, "theatre") or "",
        "date": date_str,
        "start_time_of_day": start_time_of_day,
        "overview": _resolve(mission_text, dictionary_text, "descriptionText"),
        "blue_task": _resolve(mission_text, dictionary_text, "descriptionBlueTask"),
        "red_task": _resolve(mission_text, dictionary_text, "descriptionRedTask"),
        "weather": _extract_weather(mission_text),
        "mission_file": str(miz_path),
    }


def _find_mission_paths(log_text):
    """Every mission path logged in log_text, in log order."""
    paths = []
    for m in _MISSION_LOAD_RE.finditer(log_text):
        paths.append(m.group(1) or m.group(2))
    return paths


def start_mission_briefing_watcher(state, explicit_log_path=None, poll_interval_seconds=2):
    """Tails dcs.log for mission-load lines and keeps state.dcs_mission_briefing
    (and a monotonic state.dcs_mission_seq, since Quick Mission Builder
    reuses the same tempMission.miz path for every mission - a path-equality
    check alone can't tell two different QMB missions apart) up to date for
    the life of the app. Runs once at startup to pick up a mission that was
    already loaded before MachLink started, then keeps watching for new
    loadMission lines - no DCS file edits of any kind required (see module
    docstring)."""
    log_path = find_dcs_log(explicit_log_path)

    def _apply(miz_path):
        # The .miz can still be mid-copy the instant the log line appears -
        # a couple of short retries covers that without a long stall.
        briefing = None
        for attempt in range(3):
            briefing = parse_mission_briefing(miz_path)
            if briefing is not None:
                break
            time.sleep(0.5)
        with state.lock:
            state.dcs_mission_briefing = briefing
            state.dcs_mission_seq = (state.dcs_mission_seq or 0) + 1

    def _loop():
        nonlocal log_path
        if log_path is None or not log_path.exists():
            return  # DCS has never run here yet - nothing to watch

        try:
            full_text = log_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            full_text = ""
        existing = _find_mission_paths(full_text)
        if existing:
            _apply(existing[-1])
        pos = len(full_text.encode("utf-8", errors="ignore"))

        while True:
            time.sleep(poll_interval_seconds)
            try:
                size = log_path.stat().st_size
                if size < pos:
                    # DCS restarted and rotated the log (dcs.log -> dcs.log.old) -
                    # start over from the top of the new file.
                    pos = 0
                if size == pos:
                    continue
                with open(log_path, "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
                pos += len(chunk)
            except OSError:
                continue

            new_paths = _find_mission_paths(chunk.decode("utf-8", errors="ignore"))
            if new_paths:
                _apply(new_paths[-1])

    t = threading.Thread(target=_loop, daemon=True)
    t.start()
    return t
