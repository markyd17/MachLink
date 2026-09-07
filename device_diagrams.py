"""
Serves the real per-device SVG diagrams Joystick Diagrams already generates
(its general Export page - not our machlink_export output plugin),
with the specific button for a resolved binding highlighted on the actual
device photo, so "where's the real button" gets a real picture instead of
an invented one - same "find the real source, don't draw it from scratch"
rule as everything else in this app.

How this works: these SVGs are draw.io exports - a big embedded photo of
the device, with one text callout per bound command, each drawn as a
<rect> immediately followed by its <text> label, both with real pixel
coordinates. We find the pair whose label matches the exact DCS command
string bindings.py already resolved, and draw a bright highlight box
around that callout before serving the file - not around the tiny
physical button on the photo itself, since the callout is what's actually
readable at a glance.
"""
import re
from pathlib import Path

# Every label callout Joystick Diagrams draws follows this exact shape in
# the *rendered* part of the SVG (after its draw.io metadata blob, which we
# skip - see _RENDERED_MARKER): a plain rect (the callout's background box)
# immediately followed, a little further on, by a <text ...>label</text>
# fallback element. Confirmed against real exports for two different
# device types (throttle, stick) before relying on it.
_RENDERED_MARKER = "&lt;/mxfile&gt;"
_RECT_RE = re.compile(r'<rect x="([\d.\-]+)" y="([\d.\-]+)" width="([\d.\-]+)" height="([\d.\-]+)"')

_HIGHLIGHT_COLOR = "#00FF66"  # var(--mfd-green) in style.css - keep in sync


def _normalize(name):
    return str(name).lower().replace(" ", "_")


def find_svg_path(svg_dir, device_name, profile_name):
    """The real Joystick Diagrams export SVG for this exact device+profile,
    or None if the configured folder doesn't exist or hasn't been
    (re-)exported for this device/profile yet - not an error, just means
    no picture is available for this particular match."""
    if not svg_dir:
        return None
    directory = Path(svg_dir)
    if not directory.is_dir():
        return None
    norm_profile = _normalize(profile_name or "")
    for path in directory.glob("*.svg"):
        stem = path.stem
        if device_name and device_name in stem and _normalize(stem).endswith(norm_profile):
            return path
    return None


def _find_label_boxes(rendered_svg, label):
    """[{x, y, width, height}, ...] - the callout box(es) for every
    occurrence of `label` as a rendered <text> element. Normally one match;
    a label could in principle appear more than once on a busy device."""
    boxes = []
    text_pattern = re.compile(r"<text\b[^>]*>" + re.escape(label) + r"</text>")
    for text_match in text_pattern.finditer(rendered_svg):
        preceding = rendered_svg[: text_match.start()]
        last_rect = None
        for last_rect in _RECT_RE.finditer(preceding):
            pass  # keep iterating - the LAST (nearest) one is this label's own box
        if last_rect:
            x, y, w, h = (float(v) for v in last_rect.groups())
            boxes.append({"x": x, "y": y, "width": w, "height": h})
    return boxes


def render_highlighted_svg(svg_path, label):
    """The full SVG (str) at svg_path, with a bright highlight drawn around
    the real callout box for `label` if one was found - or the plain SVG
    unchanged if not (still useful context even without a specific
    highlight, so this never fails outright). None if the file can't be
    read at all."""
    try:
        svg_text = Path(svg_path).read_text(encoding="utf-8")
    except OSError:
        return None

    marker_idx = svg_text.find(_RENDERED_MARKER)
    rendered = svg_text[marker_idx:] if marker_idx != -1 else svg_text
    boxes = _find_label_boxes(rendered, label) if label else []

    if not boxes:
        return svg_text

    # A plain static border rather than a pulsing one - just as clear at a
    # glance, and sidesteps SVG's native <animate> not being covered by the
    # site's existing prefers-reduced-motion CSS rule (that rule only
    # catches CSS animations, not SMIL).
    highlight_markup = "".join(
        f'<rect x="{b["x"] - 5}" y="{b["y"] - 5}" width="{b["width"] + 10}" height="{b["height"] + 10}" '
        f'rx="6" fill="none" stroke="{_HIGHLIGHT_COLOR}" stroke-width="4"/>'
        for b in boxes
    )
    insert_at = svg_text.rfind("</svg>")
    if insert_at == -1:
        return svg_text
    return svg_text[:insert_at] + highlight_markup + svg_text[insert_at:]


def diagrams_for_matches(svg_dir, matches):
    """[{"device_name": ..., "svg": "<svg...>...</svg>"}, ...] - one entry
    per real device in `matches` (a resolved binding's match list, from
    bindings.py) that we could actually find and label-highlight a diagram
    for. Matches we can't find a diagram for are silently skipped rather
    than erroring - the checklist's text annotation still stands on its
    own without a picture."""
    diagrams = []
    for m in matches:
        svg_path = find_svg_path(svg_dir, m.get("device_name"), m.get("profile_name"))
        if not svg_path:
            continue
        svg_text = render_highlighted_svg(svg_path, m.get("command"))
        if svg_text:
            diagrams.append({"device_name": m["device_name"], "svg": svg_text})
    return diagrams
