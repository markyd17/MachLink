"""
Real DCS kneeboard pages - the ones that genuinely exist as static images,
not the ones that only exist as rendered-at-runtime cockpit UI.

Verified against the real install and Saved Games folder rather than
assumed (a user-supplied web writeup claimed a few paths that turned out
not to exist on this actual install - e.g. Mods/aircraft/<module>/
Kneeboard/ directly, as opposed to the real Cockpit/Scripts/KNEEBOARD/
pages/ path below - so every path here was checked against real files,
not taken on faith). DCS kneeboard pages come from four different real
places:

1. Aircraft-default pages, e.g.
   Mods/aircraft/A-10C_2/Cockpit/Scripts/KNEEBOARD/pages/1.png - a real
   HOTAS reference chart shipped as a plain PNG for some modules (A-10C_2
   confirmed). Other modules (AH-64D confirmed) render their kneeboard
   entirely in Lua using DCS's cockpit rendering engine (ceStringPoly
   elements, fonts, positions) - there's no static image file to pull out
   for those, and reimplementing DCS's own cockpit renderer to fake one is
   out of scope (and would risk showing wrong/stale info). Modules like
   that are simply reported as having no aircraft-default pages, not
   guessed at.

2. Terrain charts, e.g. Mods/terrains/Caucasus/Kneeboard/*.png - real
   airport/navigation charts DCS ships per map (confirmed: Caucasus alone
   has 53 real charts - general map, aerodrome legends, per-airfield VAD/
   ground diagrams). Matched to the currently loaded mission's theatre
   field (already extracted by dcs_mission_briefing.py). Not every
   terrain ships these (confirmed: several installed maps have none).

3. User custom pages, e.g. Saved Games/DCS/Kneeboard/*.png (global, shown
   for every aircraft) and Saved Games/DCS/Kneeboard/<aircraft>/*.png
   (aircraft-specific) - real per-user images DCS's own in-sim "add to
   kneeboard" feature and manual drops both save here. This machine's
   folder exists but is currently empty (Marky hasn't added any custom
   pages yet), so there's nothing to verify the aircraft-subfolder naming
   convention against directly - implemented per DCS's documented
   behavior instead, using the live-detected aircraft name as-is.

4. Mission-specific pages, e.g. a mission's own KNEEBOARD/IMAGES/*.png
   bundled inside the .miz by the mission designer (confirmed present in
   some stock Instant Action missions, absent in others).

All four are plain image files DCS already ships/bundles or the user
already saved - reading them needs no DCS file edits and no engine
access, same "only read what's already on disk" approach as
dcs_mission_briefing.py.
"""
import re
import zipfile
from pathlib import Path

_DCS_INSTALL_VARIANTS = (
    r"C:\Program Files\Eagle Dynamics\DCS World",
    r"C:\Program Files\Eagle Dynamics\DCS World OpenBeta",
    r"C:\Program Files (x86)\Steam\steamapps\common\DCSWorld",
)

# Saved Games folder variants - same set dcs_hook_guard.py and
# dcs_mission_briefing.py check, since the user Kneeboard folder lives
# under the same per-install Saved Games directory.
_DCS_SAVED_GAMES_VARIANTS = ("DCS", "DCS.openbeta", "DCS.openbeta_server", "DCS.release_server")

# The live-detected export name doesn't always match the module's real
# install folder name (verified: AH-64D_BLK_II's folder is just "AH-64D") -
# same kind of mismatch bindings.py already handles for Joystick Diagrams
# profile names via live_profile_prefix. Extend this as more airframes are
# added; an aircraft not listed here just tries its live name as-is, which
# is correct for modules where the two already match (confirmed: A-10C_2).
_MODULE_FOLDER_OVERRIDES = {
    "AH-64D_BLK_II": "AH-64D",
}

_IMAGE_EXT_RE = re.compile(r"\.(png|jpg|jpeg)$", re.IGNORECASE)
_LEADING_NUMERIC_RE = re.compile(r"^(?:\d+_)+")


def find_dcs_install(explicit_path=None):
    if explicit_path:
        return Path(explicit_path)
    for path in _DCS_INSTALL_VARIANTS:
        p = Path(path)
        if p.is_dir():
            return p
    return None


def find_user_kneeboard_dir(explicit_path=None):
    if explicit_path:
        return Path(explicit_path)
    for variant in _DCS_SAVED_GAMES_VARIANTS:
        p = Path.home() / "Saved Games" / variant / "Kneeboard"
        if p.is_dir():
            return p
    return None


def _module_folder(aircraft):
    return _MODULE_FOLDER_OVERRIDES.get(aircraft, aircraft)


def clean_label(stem):
    """A real filename like "01_VAD_UG5X_Kobuleti" or "Akrotiri_p1" turned
    into a readable label ("VAD UG5X Kobuleti", "Akrotiri p1") - strips
    only the leading zero-padded ordering numbers real DCS terrain charts
    use, not arbitrary digits, so a chart genuinely named e.g. "18" isn't
    mangled."""
    return _LEADING_NUMERIC_RE.sub("", stem).replace("_", " ").strip() or stem


def _sorted_images(directory):
    if not directory or not Path(directory).is_dir():
        return []
    return sorted(
        (p for p in Path(directory).iterdir() if p.is_file() and _IMAGE_EXT_RE.search(p.name)),
        key=lambda p: p.name.lower(),
    )


def aircraft_kneeboard_pages(install_path, aircraft):
    """[Path, ...] - the real static PNG kneeboard pages this aircraft
    module ships, in page order. Empty (not an error) if the module has no
    static pages at all, or renders its kneeboard as Lua/cockpit-engine
    content instead (see module docstring) - that's a real, permanent
    limitation for that airframe, not a detection failure."""
    if not install_path or not aircraft:
        return []
    return _sorted_images(
        Path(install_path) / "Mods" / "aircraft" / _module_folder(aircraft) / "Cockpit" / "Scripts" / "KNEEBOARD" / "pages"
    )


def terrain_kneeboard_pages(install_path, theatre):
    """[Path, ...] - the real navigation/airport charts the currently
    loaded mission's own terrain ships, if any (confirmed present for some
    maps, absent for others - not every terrain has them)."""
    if not install_path or not theatre:
        return []
    terrains_dir = Path(install_path) / "Mods" / "terrains"
    if not terrains_dir.is_dir():
        return []
    # Terrain folder names are case-sensitive on disk but match the
    # mission's theatre field directly for every installed map checked
    # (Caucasus, Syria, MarianaIslands) - a case-insensitive match is a
    # cheap safety net in case a future/other map's casing ever differs.
    terrain_dir = next((d for d in terrains_dir.iterdir() if d.is_dir() and d.name.lower() == theatre.lower()), None)
    if terrain_dir is None:
        return []
    # Casing of the Kneeboard folder itself varies by map (confirmed:
    # Caucasus uses "Kneeboard", Syria/MarianaIslands use "kneeboard").
    kb_dir = next((d for d in terrain_dir.iterdir() if d.is_dir() and d.name.lower() == "kneeboard"), None)
    return _sorted_images(kb_dir)


def user_kneeboard_pages(user_kneeboard_dir, aircraft):
    """[Path, ...] - real custom pages saved under Saved Games/DCS/
    Kneeboard: global ones in the root folder (shown for every aircraft),
    then this aircraft's own subfolder if it has one. Empty if the user
    hasn't added any - a real, normal, empty-by-default state, not a
    detection failure."""
    if not user_kneeboard_dir:
        return []
    pages = _sorted_images(user_kneeboard_dir)
    if aircraft:
        pages += _sorted_images(Path(user_kneeboard_dir) / aircraft)
    return pages


def mission_kneeboard_pages(miz_path):
    """[(entry_name, label), ...] - every real image the mission itself
    bundles under KNEEBOARD/ inside the .miz, in archive order. Empty if
    the mission has none, or the .miz can't be read (e.g. a Quick Mission's
    temp file already cleaned up) - both normal, not errors."""
    if not miz_path:
        return []
    try:
        with zipfile.ZipFile(miz_path) as z:
            names = [n for n in z.namelist() if n.upper().startswith("KNEEBOARD/") and _IMAGE_EXT_RE.search(n)]
    except (OSError, zipfile.BadZipFile):
        return []
    names.sort()
    return [(n, clean_label(Path(n).stem)) for n in names]


def read_mission_kneeboard_image(miz_path, entry_name):
    """Raw bytes of one mission kneeboard image, or None if it can't be
    read (mission file gone, entry missing - e.g. the mission ended
    between listing pages and opening one)."""
    try:
        with zipfile.ZipFile(miz_path) as z:
            return z.read(entry_name)
    except (OSError, KeyError, zipfile.BadZipFile):
        return None
