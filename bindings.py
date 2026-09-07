"""
Resolves a checklist step's `binding_key` against real Joystick Diagrams
export data, producing either a real physical device+button or an honest
"not currently mapped" note - never a guess.

Cockpit Configuration (data/cockpit_configs.json) now covers one of the
two simplifications this module used to have: a match is only reported as
"bound" if the device is part of today's active configuration; a real
binding that exists only on a device outside today's config comes back as
"not_in_config" instead, per the spec's 5-state design. If the config file
is missing or the active name doesn't match any config, every device is
treated as present (same as before this existed), so nothing breaks for
an aircraft/session that hasn't set one up.

Still simplified vs. the full spec:
- No keyboard/mouse binding check yet - Joystick Diagrams only exports
  joystick-class devices in the first place, so right now we simply can't
  tell "bound to keyboard only" apart from "not bound to anything" - both
  currently render as the same "not currently mapped to a physical
  control" state. The spec's fix for this (a narrow existence-only check
  against DCS's own keyboard .diff.lua file) hasn't been built yet.

So this gives 4 states today, not the full 5:
  "bound"         - matched a real physical device/button in today's active
                    cockpit configuration
  "not_in_config" - matched a real device, but it isn't part of today's
                    active cockpit configuration
  "unbound"       - no physical device match found at all (keyboard-only or
                    genuinely unmapped - can't yet tell which)
  (no binding_key on the step at all - caller just doesn't call this,
   step renders exactly as it does today)
"""
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent
BINDINGS_DIR = BASE_DIR / "data" / "bindings"
BINDINGS_LIVE_DIR = BASE_DIR / "data" / "bindings_live"
TRANSLATIONS_PATH = BASE_DIR / "data" / "dcs_command_translations.json"
COCKPIT_CONFIGS_PATH = BASE_DIR / "data" / "cockpit_configs.json"


def _load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _load_translations():
    data = _load_json(TRANSLATIONS_PATH)
    return (data or {}).get("translations", {})


def _load_bindings_file(aircraft_module):
    return _load_json(BINDINGS_DIR / f"{aircraft_module}.json")


def _normalize_module_name(name):
    """Joystick Diagrams' profile names are DCS's own module name, lowercased
    (except the first letter) with spaces turned into underscores - e.g. DCS
    reports 'A-10C II' (real module name, confirmed from its Saved Games\\DCS\\
    Config\\Input folder - that space is genuinely part of the name, not a
    typo) but Joystick Diagrams' export calls it 'A-10c_ii'. Normalizing both
    sides the same way (lowercase, spaces->underscores) before comparing
    avoids depending on either one's exact casing/separator choice."""
    return str(name).lower().replace(" ", "_")


def _load_live_devices(aircraft_module, live_profile_prefix=None):
    """Every parsed device from data/bindings_live/ whose exported profile
    belongs to this aircraft (matched by normalized prefix, so one
    aircraft's separate per-seat profiles like _plt/_cpg/_ai_menu all
    count).

    Matching Joystick Diagrams' own profile name against DCS's real module
    name only works automatically when the two happen to agree (true for
    the AH-64D) - it broke for the A-10C II, where DCS reports 'A-10C_2'
    live but Joystick Diagrams (deriving from the Input folder name,
    'A-10C II') calls the exported profile 'A-10c_ii' - unrelated strings,
    no shared prefix. live_profile_prefix lets a command_map file state the
    real exported prefix explicitly instead of relying on that derivation;
    omit it when aircraft_module already matches Joystick Diagrams' naming."""
    if not BINDINGS_LIVE_DIR.is_dir():
        return []
    prefix = _normalize_module_name(live_profile_prefix or aircraft_module)
    devices = []
    for path in BINDINGS_LIVE_DIR.glob("*.json"):
        data = _load_json(path)
        if data and _normalize_module_name(data.get("profile_name", "")).startswith(prefix):
            devices.append(data)
    return devices


def load_cockpit_configs():
    """{"active": str|None, "configs": {name: [device_name, ...]}}. A
    missing or unreadable file returns an empty shell - callers treat that
    as 'no active config, don't filter by device presence at all', not an
    error, so binding resolution works the same as before this file existed
    until someone actually sets one up."""
    data = _load_json(COCKPIT_CONFIGS_PATH)
    if not data:
        return {"active": None, "configs": {}}
    return {"active": data.get("active"), "configs": data.get("configs", {})}


def set_active_cockpit_config(name):
    """Switches the active named configuration. Returns True on success,
    False if that name doesn't exist or the file can't be written."""
    data = _load_json(COCKPIT_CONFIGS_PATH) or {"configs": {}}
    if name not in data.get("configs", {}):
        return False
    data["active"] = name
    try:
        with open(COCKPIT_CONFIGS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except OSError:
        return False


def _active_config_devices():
    """The active config's device-name set, or None if there's no usable
    active config (missing file, or the active name isn't a real config) -
    None means 'don't filter by config, every device counts as present'."""
    cfg = load_cockpit_configs()
    active = cfg["active"]
    if not active or active not in cfg["configs"]:
        return None
    return set(cfg["configs"][active])


def _format_identifier(raw):
    """'BUTTON_93' -> 'Button 93', 'AXIS_SLIDER_1' -> 'Axis Slider 1',
    'AXIS_RY' -> 'Axis RY' (short 1-2 letter axis codes like RY/RX/RZ stay
    upper-case rather than becoming 'Ry' - they're abbreviations, not words)."""
    if not raw:
        return raw
    return " ".join(word if len(word) <= 2 else word.capitalize() for word in raw.split("_"))


def resolve_aircraft_bindings(aircraft_module):
    """{"available": bool, "bindings": {binding_key: {...}}} for every
    binding_key curated for this aircraft. "available" is False when no
    data/bindings/<aircraft_module>.json exists yet - meaning this
    airframe just hasn't had any binding_keys curated, not an error."""
    bindings_file = _load_bindings_file(aircraft_module)
    command_map = (bindings_file or {}).get("command_map")
    if command_map is None:
        return {"available": False, "bindings": {}}

    translations = _load_translations()
    live_devices = _load_live_devices(aircraft_module, bindings_file.get("live_profile_prefix"))
    active_devices = _active_config_devices()  # None = don't filter by config

    resolved = {}
    for binding_key, entry in command_map.items():
        dcs_command = entry.get("dcs_command")
        # A single binding_key sometimes has to match more than one real DCS
        # command string - e.g. the pilot and CPG seats each have their own
        # "A/S Pushbutton" command, or the same page-select button exists
        # separately on each MFD - so this accepts either one string or a
        # list of equivalent ones.
        dcs_commands = dcs_command if isinstance(dcs_command, list) else [dcs_command]
        display_label = entry.get("display_label") or translations.get(dcs_commands[0], dcs_commands[0])

        in_config, out_of_config = [], []
        seen = set()
        for device in live_devices:
            device_name = device.get("device_name")
            for b in device.get("bindings", []):
                if b.get("command") not in dcs_commands:
                    continue
                identifier = _format_identifier(b.get("identifier"))
                key = (device_name, identifier)
                if key in seen:
                    continue
                seen.add(key)
                # profile_name + the exact command string are carried along
                # so the device-diagram feature can find the one real
                # Joystick Diagrams SVG (and the one real label on it) that
                # this specific match came from - not just which device.
                match = {
                    "device_name": device_name,
                    "identifier": identifier,
                    "profile_name": device.get("profile_name"),
                    "command": b.get("command"),
                }
                if active_devices is None or device_name in active_devices:
                    in_config.append(match)
                else:
                    out_of_config.append(match)

        if in_config:
            resolved[binding_key] = {"state": "bound", "display_label": display_label, "matches": in_config}
        elif out_of_config:
            resolved[binding_key] = {"state": "not_in_config", "display_label": display_label, "matches": out_of_config}
        else:
            resolved[binding_key] = {"state": "unbound", "display_label": display_label}

    return {"available": True, "bindings": resolved}
