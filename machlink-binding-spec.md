# Feature Spec: Physical Control Binding Detection

## Goal

When a checklist step says "Press the APU Start Button," MachLink
should be able to show the pilot which physical button that actually is on
their hardware - e.g. "Press the APU Start Button (Button 3, VPC
MongoosT-50CM3 throttle)" - by reading their real DCS control bindings,
regardless of whether those bindings were set manually in DCS or through a
third-party tool (SimAppPro, Thrustmaster TARGET, etc.).

**Scope note:** this feature is for physical HOTAS/stick/pedal devices
only. Keyboard and mouse bindings are explicitly out of scope - if a
command is only bound to keyboard or mouse (no physical device), the app
should say so plainly rather than pretend the command has a HOTAS binding
or silently show nothing. Likewise, a command that isn't bound to anything
at all should be called out as unmapped, not just left blank.

**Core design principle:** DCS itself is the single source of truth. No
matter how a binding was created, DCS ultimately writes it to its own
config files in its own format. MachLink only needs to understand
DCS's format - it never needs to integrate with any specific third-party
mapping tool.

## How DCS Stores Bindings (background for implementation)

DCS writes per-aircraft, per-device binding files here:

```
Saved Games\DCS\Config\Input\<aircraft_module>\joystick\<device>.diff.lua
```

(or `Saved Games\DCS.openbeta\...` on the open beta branch)

- One `.diff.lua` file per physical device that has *any* binding for that
  aircraft.
- Each file is real Lua, structured as a table. It contains the device's
  internal name/GUID and a list of DCS command IDs mapped to physical
  button/axis identifiers.
- `<aircraft_module>` matches the same module name DCS already reports to
  MachLink via the existing Export.lua hook (e.g. `AH-64D_BLK_II`),
  so no new aircraft-identification logic is needed here.
- DCS's own install directory (not Saved Games) additionally ships default
  keybinding references per module, listing every available command ID in
  human-readable form (e.g. "APU Start Button - Press"). This is useful as
  a reference list when building the command-name mapping (see below) but
  is not itself something we parse for the user's actual bindings.

Third-party tools (SimAppPro, TARGET scripts, etc.) either (a) write
directly into these same DCS files, or (b) present themselves to Windows/
DCS as a virtual controller, which DCS then binds normally and records in
these same files. Either way, by the time DCS is running, the same
`.diff.lua` files exist and mean the same thing. **No separate code path
is needed per third-party tool.**

## Recommended Approach: Use Joystick Diagrams Instead of Building From Scratch

**Update after research:** a free, open-source tool called
[Joystick Diagrams](https://github.com/Rexeh/joystick-diagrams) already does
most of what sections 1, 2, and 2b above set out to build - and it
explicitly ships built-in templates for WinCtrl/WinWing's Orion2 (F-16/F-18/
F-15EX), MFD, UFC, and other panels, along with native DCS World support.

**Why lean on it instead of building our own parser + label database:**
- It already reads DCS's binding files and knows the real, physical button
  layout of your exact hardware (down to labeled buttons like TMS/DMS on
  the Orion 2 grip) - this is precisely the "find the real source, don't
  invent it" data we'd otherwise have to build by hand from manufacturer
  manuals.
- It has an official **Output Plugin** system designed exactly for this use
  case: a small Python plugin that receives the fully parsed binding data
  after every export and can do whatever it wants with it - including
  writing it out as JSON for another application (that's MachLink)
  to read.

**Licensing note:** Joystick Diagrams is GPL-2.0 licensed. That's not a
concern for running it as a separate tool and consuming its exported data -
which is the approach below - only for copying its source code directly
into MachLink's own codebase. Since MachLink is for personal
use and not being distributed, this is a non-issue either way, but it's
worth knowing if that ever changes.

### Revised architecture: an Output Plugin instead of `dcs_bindings.py` + `device_profiles/`

Sections 1 and 2b above (`integrations/dcs_bindings.py` and the
`data/device_profiles/` manufacturer database) are **no longer needed to be
built from scratch**. Replace them with a small Joystick Diagrams Output
Plugin:

```
machlink_export/          <- a Joystick Diagrams output plugin
  __init__.py                   <- required, can be empty
  main.py                       <- defines OutputPlugin, writes JSON per device
```

Based on Joystick Diagrams' own documented example, `main.py` loops over
each `ExportResult` (one per device per DCS aircraft profile), reads
`result.device.get_combined_inputs()` for the real button/axis -> command
mapping, and writes it to a JSON file - e.g. into
`MachLink/data/bindings_live/<device_guid>-<aircraft_profile>.json` -
which MachLink then reads directly. No custom Lua parsing, no
hand-built manufacturer profile database.

This plugin gets installed into Joystick Diagrams itself (via its Settings
> Output Plugins screen, or by dropping the folder into
`%APPDATA%\Roaming\Joystick Diagrams\output_plugins\`), not into Flight
Copilot. The workflow becomes:

1. You bind your controls in DCS as normal (or via SimAppPro/TARGET/etc -
   doesn't matter, same as before).
2. Open Joystick Diagrams, let it read your DCS profiles (it already knows
   how - built-in DCS support).
3. Run an export. Our plugin fires automatically and writes the real,
   physical-button-labeled JSON that MachLink reads.
4. MachLink picks up that JSON the same way it would have read its
   own `dcs_bindings.py` output - the rest of the spec (sections 2c, 2d, 3,
   4, 5, 6 below) is unchanged, since they only care about the *shape* of
   the binding data, not how it was produced.

**What stays exactly the same:** Cockpit Configuration presets (2d), the
per-airframe `binding_key` -> command mapping (section 3/4), and the
five-state runtime resolution (section 5) are all independent of *how* the
raw device data was obtained, so none of that work is wasted or needs to
change.

**What this removes from your plate:** no need to reverse-engineer DCS's
`.diff.lua` Lua format yourself, and no need to hand-build a button-label
database for your WinCtrl gear from PDF manuals - Joystick Diagrams'
existing, community-maintained templates already have this for your exact
devices.



```
integrations/dcs_bindings.py       <- new: locates + parses .diff.lua files
integrations/device_presence.py    <- new: live-detects currently connected controllers via Windows/SDL
data/bindings/<aircraft>.json      <- new: maps DCS command IDs to plain-English actions
data/device_labels.json            <- new: user's manual device labels (stick/throttle/pedals)
data/device_profiles/<mfr>_<model>.json  <- new: real button labels per specific hardware model
data/cockpit_configs.json          <- new: named presets of which devices are active (e.g. 2-MFD vs 3-MFD)
data/aircraft/<aircraft>.json      <- existing: add optional "dcs_command_id" per checklist step
app.py                             <- new endpoints: /api/bindings, /api/device_labels
static/app.js + templates          <- UI: "Aircraft bound" toggle, device label dropdown, inline button display
```

### 1. `integrations/dcs_bindings.py` (superseded - see "Recommended Approach" above; kept as a fallback reference)

If Joystick Diagrams turns out not to cover some future aircraft or edge
case, this is the fallback plan: build our own parser instead of relying on
theirs.

Responsibilities:
- Locate the Saved Games DCS folder (handle both `DCS` and `DCS.openbeta`;
  consider letting the user override the path in `config.yaml` in case of
  a non-default Saved Games location).
- Given an aircraft module name, list and parse all `.diff.lua` files under
  `Config\Input\<module>\joystick\` **only**. This covers every physical
  stick, throttle, pedal set, or other HOTAS device - keyboard and mouse
  bindings live in separate `keyboard\` and `mouse\` subfolders that this
  parser does not read for their content (per your requirement - button
  annotations are for physical controllers only, not keyboard/mouse keys).
- The one narrow exception: to tell "not bound to anything" apart from
  "bound to keyboard/mouse only" (see runtime resolution below), do a
  lightweight existence check against the `keyboard\*.diff.lua` file for
  whether a given command ID appears in it at all - this only needs a
  yes/no answer, never the actual key that's bound, so it's a much smaller
  parsing job than the joystick files.
- Since these are real Lua tables, use a small Lua-table parser (a minimal
  one is fine - we don't need a full Lua interpreter, just table literal
  parsing) rather than regex, since regex against Lua syntax is fragile.
- Output a normalized structure per device, e.g.:
  ```json
  {
    "device_raw_name": "VPC MongoosT-50CM3 Throttle",
    "device_guid": "...",
    "bindings": {
      "APU Start Button - Press": { "type": "button", "id": "BTN3" },
      "Collective - Axis": { "type": "axis", "id": "JOY_RZ" }
    }
  }
  ```
- Handle the case where a command has no binding (not every command is
  necessarily mapped) and where a command is bound on more than one device
  (rare but possible) - surface both, don't silently pick one.

### 2. `data/device_labels.json` (new, user-maintained via UI)

Since raw device names from Windows/DCS are sometimes unhelpful (e.g.
"HID-compliant game controller" when going through some emulation layers),
the user manually labels their own hardware once:

```json
{
  "VPC MongoosT-50CM3 Throttle": "main throttle",
  "VPC Rhino FCS": "main stick",
  "VKB Pedals": "rudder pedals"
}
```

This is set through a simple dropdown/text UI once devices are detected
from a parsed binding file - not something the user edits as raw JSON,
though it's stored that way for simplicity. Editable per-device at any time
if hardware changes.

### 2b. `data/device_profiles/<manufacturer>_<model>.json` (superseded - see "Recommended Approach" above; kept as a fallback reference)

If Joystick Diagrams doesn't have a template for some future device you
add to your rig, this is the fallback: build a profile by hand from the
manufacturer's manual, same as originally planned.

This is an upgrade on top of the plain "main throttle" style label above,
and worth doing given the hardware you're running: a lot of HOTAS gear
(including your Winwing/WinCtrl setup - note the manufacturer rebranded
from WINWING to WINCTRL in 2026, so the UI's manufacturer list should show
both, or WINCTRL with "formerly WINWING" noted, so older community guides
and your own muscle memory both still make sense) physically replicates a
real aircraft's grip, with buttons that are already labeled in real life -
TMS, DMS, CMS, pinky switch, coolie hat, etc. on something like the Orion 2
F-16 stick. Reporting "Button 5" instead of "TMS Aft" throws away
information the hardware itself already has printed on it.

Instead of (or in addition to) the free-text label above, let the user
pick their exact hardware from a manufacturer + model dropdown:

```
Manufacturer: [ WinCtrl (formerly Winwing) v ]
Model:        [ Orion 2 F-16 Stick          v ]
```

Each supported device gets a profile file mapping DCS/Windows' raw
button/axis index to that device's real, physical, silkscreened label:

```json
{
  "manufacturer": "WinCtrl (formerly Winwing)",
  "model": "Orion 2 F-16 Stick",
  "button_labels": {
    "BTN1": "Trigger (1st detent)",
    "BTN2": "Trigger (2nd detent)",
    "BTN3": "TMS Forward",
    "BTN4": "TMS Aft",
    "BTN5": "TMS Left",
    "BTN6": "TMS Right",
    "BTN7": "DMS Forward",
    "...": "..."
  }
}
```

When resolving a binding for display, if the bound device has a matching
profile, show the real label ("TMS Aft") instead of the generic index
("Button 5"). If no profile exists for that device/model, fall back to the
plain "Button N, main throttle" style from the section above - never block
on a missing profile.

**Building the profiles themselves:** for your specific gear (Block 60
Throttle, Orion 2 F-16 stick, 3x MFDs with button panels, Skywalker/renamed
rudder pedals), these would need to be built once each - most
manufacturers publish a button-labeled diagram/manual for their devices,
which is the right source to build a profile from (same "find the real
source, don't invent it" principle as the checklists). This is a good
candidate to build alongside the AH-64D pilot pass, since your Winwing/
WinCtrl gear is what you'll actually be testing with.

### 2c. Live device presence detection (new - solves "I only have 2 of 3 MFDs plugged in today")

The manufacturer/model profiles above assume a fixed hardware setup, but
your actual rig varies session to session (e.g. sometimes 2 MFDs instead
of 3). Rather than the app blindly assuming everything you've ever
profiled is currently connected, it should check what's actually plugged
in right now.

**Recommended approach: read Windows' own connected-controller list
directly, not through any specific vendor's software.** This works
regardless of manufacturer and doesn't depend on SimAppPro/WinCtrl's app
being installed or running at all - important since (per a check on this)
WinCtrl doesn't appear to publish a public API for third-party apps to
query connected devices through their software specifically. Reading
Windows' own device list sidesteps that entirely and is the more durable,
brand-agnostic solution.

In practice: a small Python library (e.g. `pygame`'s joystick module, which
uses SDL under the hood) can list every game-controller-class device
Windows currently sees as connected, along with each one's name/GUID -
this is a live, real-time check, independent of whether DCS is even
running. MachLink can run this check either on a manual "detect
devices" button press, or periodically while the app is running, and cross-
reference the result against:
- The device GUIDs referenced in DCS's `.diff.lua` binding files (2/3
  above), to know which of your *bound* devices are live right now.
- Your manufacturer/model profile assignments (2b), so a profile you
  configured for "MFD #3" simply doesn't get used for button-label lookups
  when that MFD isn't currently connected.

**What this changes for the checklist display:** if a checklist step's
binding key resolves to a device that isn't currently detected as
connected, that's a fifth possible state alongside the four in the Runtime
Resolution section below - something like `"(bound to MFD #3 - not
currently connected)"` - rather than either silently showing a label for
hardware that isn't there, or lumping it in with "not mapped at all."

**One nuance worth deciding on early:** Windows may assign a slightly
different internal identifier to the same physical device depending on
which USB port it's plugged into, or, for multiple identical MFD units,
may not distinguish between them reliably by name alone (three "WinCtrl
MFD" units can report the same device name). If your 3 MFDs are otherwise
identical, distinguishing "which MFD is which" for profile purposes may
need to lean on DCS's own per-device GUID (which is typically stable per
physical unit position) rather than the device name string. Worth
confirming with your actual hardware early in the build rather than
assuming it'll just work.

### 2d. Cockpit Configuration presets (new - the reliable, primary answer to "I only have 2 of 3 MFDs today")

Live detection (2c) has a real weakness: if your 3 MFDs are identical
hardware, Windows may report all three with the same generic name, making
"which specific one is missing" genuinely hard to determine automatically
- this was flagged as an open risk in 2c. A manually-selected **Cockpit
Configuration** sidesteps that problem entirely and should be the primary
mechanism, with live detection (2c) demoted to an optional convenience on
top of it rather than something the feature depends on.

The idea: instead of asking the app to figure out your hardware
automatically every session, you define named configurations once, then
just pick which one applies today.

```
Configurations:
  - "Full setup"     -> Block 60 Throttle, Orion 2 Stick, MFD #1, MFD #2, MFD #3, Rudder Pedals
  - "2-MFD setup"     -> Block 60 Throttle, Orion 2 Stick, MFD #1, MFD #2, Rudder Pedals
  - "Travel setup"    -> Orion 2 Stick only
```

Stored simply, e.g. `data/cockpit_configs.json`:

```json
{
  "active": "2-MFD setup",
  "configs": {
    "Full setup": ["block60_throttle", "orion2_stick", "mfd_1", "mfd_2", "mfd_3", "rudder_pedals"],
    "2-MFD setup": ["block60_throttle", "orion2_stick", "mfd_1", "mfd_2", "rudder_pedals"],
    "Travel setup": ["orion2_stick"]
  }
}
```

A simple dropdown in the UI ("Cockpit Configuration: [ 2-MFD setup v ]")
lets you switch which one is active for the current session. Runtime
resolution (section 5) then only treats devices in the *active*
configuration as present - a binding step for MFD #3 under "2-MFD setup"
resolves to "not in current cockpit configuration" rather than trying to
guess from live USB state whether it's plugged in.

**How this relates to live detection (2c):** keep 2c as an optional
enhancement - e.g. suggesting a likely configuration match, or flagging
when live-detected devices don't match the currently selected
configuration ("heads up - your active config expects MFD #3 but it looks
like something matching that device just disconnected") - but the manual
configuration selection remains the reliable, primary source of truth, not
something the user has to fight with if auto-detection guesses wrong.

### 3. `data/bindings/<aircraft>.json` (new, one per airframe, hand-curated)

This is the connective layer between Chuck's Guide's plain-English steps
and DCS's internal command IDs - it must be built manually per airframe,
the same way the checklists themselves are, since getting this wrong means
telling the pilot to press the wrong button.

```json
{
  "game": "dcs",
  "aircraft_module": "AH-64D_BLK_II",
  "command_map": {
    "apu_start_press": "APU Start Button - Press",
    "collective_axis": "Collective - Axis",
    "rotor_brake_switch": "Rotor Brake Switch - FWD (Off)"
  }
}
```

The keys on the left (`apu_start_press`) are stable internal IDs Flight
Copilot uses; the values on the right are the exact DCS command ID strings
found in the parsed binding files / DCS's default keybinding reference.

### 4. Extend `data/aircraft/<aircraft>.json` checklist steps

Add an optional field to any checklist step that has a known DCS command
mapping:

```json
{ "step": 1, "action": "[P] Flip the APU Start Button Guard.",
  "binding_key": "apu_start_guard" },
{ "step": 2, "action": "[P] Press the APU Start Button for 1-2 seconds, then release.",
  "binding_key": "apu_start_press" }
```

`binding_key` is optional - steps without it just render as they do today.
This lets binding support be added incrementally, one step at a time, per
airframe, rather than all-or-nothing.

### 5. Runtime resolution (in `app.py` / a new small module)

When rendering a checklist for the active aircraft, for each step that has
a `binding_key`:
1. Look up `binding_key` in that aircraft's `data/bindings/<aircraft>.json`
   `command_map` to get the DCS command ID string.
2. Look up that command ID in the live-parsed `.diff.lua` data for the
   active aircraft to get the physical device + button/axis.
3. Determine the display label for that device/button, in this order of
   preference:
   a. If the user has selected a manufacturer/model for this device (2b
      above) and that model's profile has a label for this exact
      button/axis, use it (e.g. `"TMS Aft"`).
   b. Otherwise, look up the device's raw name in `device_labels.json` for
      a friendly device name and show the generic button index
      (e.g. `"Button 5, main throttle"`).
   c. Otherwise, show the raw device name and index as reported by DCS.
4. Render the result based on what was actually found - there are five
   distinct outcomes, and the user should be able to tell them apart at a
   glance rather than the annotation silently disappearing:
   - **Bound to a joystick/HOTAS device that's currently connected:** show
     the friendly device name (or real button label from a device profile,
     see 2b/2c) + button/axis, e.g. `"(TMS Aft, main stick)"`.
   - **Bound to a device that isn't part of the currently active Cockpit
     Configuration** (per 2d - the primary check; live detection from 2c
     can supplement this but manual configuration selection is the source
     of truth): show `"(bound to MFD #3 - not in current cockpit
     configuration)"` so the user knows why the annotation isn't showing a
     real button, without confusing it for "never configured."
   - **Bound only to keyboard or mouse:** DCS's `.diff.lua` files are
     organized per input device, so a command bound only to keyboard/mouse
     simply won't appear in any joystick device's file. We don't parse
     keyboard/mouse binding files at all (out of scope per your request -
     you only care about physical HOTAS/stick/pedal buttons). Since we
     can't tell "not bound anywhere" apart from "bound to keyboard/mouse
     only" just from an absence in the joystick files, also check DCS's
     keyboard `.diff.lua` file (same folder structure, `keyboard\` instead
     of `joystick\`) *only* to distinguish these two cases - not to report
     which specific key. If found there, show `"(keyboard/mouse only - not
     mapped to a physical device)"`.
   - **Not bound anywhere at all:** show `"(not currently mapped to any
     control)"` so the user knows to go bind it in DCS if they want a
     physical button for it.
   - **binding_key not yet curated for this step:** (i.e. the checklist
     step has no `binding_key` at all) - render with no annotation, same
     as today. This is different from "not currently mapped" - one means
     "we haven't built the link yet," the other means "we checked and you
     genuinely haven't bound it."
5. These five states should be visually distinct in the UI (e.g. a
   greyed-out note for unmapped/keyboard-only/not-connected vs. a
   normal-styled inline button label for a real, currently-connected
   physical binding), so the user can scan a checklist and immediately see
   which steps still need attention (either a binding to set up in DCS, or
   a device to plug in).

### 6. UI additions

- A per-aircraft **"This aircraft bound"** toggle (matches the phrasing you
  used) - when on, the app attempts binding resolution as above; when off,
  checklists show as they do today with no button annotations.
- A **device labeling screen**, shown the first time bindings are detected
  for a new device: lists raw device names found in the parsed files, lets
  the user assign a friendly label to each (or skip / label later).
- A **Cockpit Configuration dropdown** (2d) - lets the user switch which
  named preset ("Full setup," "2-MFD setup," etc.) is active for the
  current session, independent of the aircraft-bound toggle above.
- Inline button annotations appear next to any checklist step, weapon
  switchology line, or defensive-systems step that has a resolved binding -
  same treatment across all of those, not just startup.

## Known limitations / things to decide before building

- **Curation effort is real and ongoing.** Every checklist step you want
  button-annotated needs a `binding_key` added by hand, and every airframe
  needs its own `command_map` built against DCS's actual command list. This
  doesn't scale automatically across your 20+ planned airframes - it's the
  same kind of one-time-per-airframe work as the checklists themselves.
  Recommend piloting on one airframe (AH-64D, since it's already built)
  before deciding how far to take this.
- **Axis-based controls** (collective, cyclic, pedals) don't have a single
  "button" to report - the annotation for these should probably say which
  physical axis/device rather than implying a discrete press.
- **Multi-device or modifier-key bindings** (e.g. a binding that requires
  holding a modifier button plus pressing another) need a slightly richer
  binding_key -> command_id relationship than the simple 1:1 shown above -
  worth confirming with a couple of real examples from your own bindings
  before finalizing the schema.
- **Live device detection still has its own edge cases if you lean on it.**
  Identical MFD units may be indistinguishable by name alone (see 2c) -
  this is exactly why Cockpit Configuration presets (2d) are the primary
  mechanism and live detection is optional on top, not the other way
  around. If you skip 2c/2d's live-detection layer entirely at first and
  just build manual configuration switching, that's a perfectly reasonable
  simpler starting point.
- **Saved Games path assumptions** - confirm whether this needs to support
  a non-default DCS Saved Games location (e.g. moved via `saved games`
  symlink or custom install), and add a config override if so.
- **Stale bindings** - if the user changes their in-game bindings while
  MachLink is running, decide whether to re-read on each checklist
  view (simplest, slight performance cost, but files are small) or only on
  the "aircraft bound" toggle being switched on.

## Suggested build order

1. ~~Install Joystick Diagrams and confirm it correctly reads your AH-64D DCS
   profile and recognizes your WinCtrl gear via its built-in templates.~~
   **DONE** - Joystick Diagrams is installed, the DCS plugin is added and
   pointed at `Saved Games\DCS\Config\Input`, and a test export to
   `C:\MachLink\Joystick Diagrams\` confirmed correct, real button
   labels for the WinCtrl hardware. Note: this only reads a snapshot at
   export time - re-running the export in Joystick Diagrams is required
   any time bindings change in DCS; nothing here watches for changes live.
2. Write the small `machlink_export` Output Plugin (see "Recommended
   Approach" above) and confirm it produces sensible JSON for one device
   when you run an export - printed/inspected manually before building
   anything in MachLink to consume it.
3. Cockpit Configuration presets (2d) - a simple "which devices are active
   today" dropdown, defined manually. This alone solves the "2 MFDs
   instead of 3" problem you raised, and doesn't depend on live detection.
4. `data/bindings/AH-64D_BLK_II.json` - hand-build a *small* first pass
   (5-10 commands, e.g. just the APU/engine start sequence) to prove the
   full chain end to end, using the plugin's exported JSON as the binding
   source.
5. Runtime resolution + inline UI rendering for that small set.
6. Only after confirming the full loop feels right in practice, decide
   whether to expand `binding_key` coverage across the rest of the AH-64D
   checklist, add live device detection (2c) as a convenience layer, and
   then move to additional airframes.
   whether to expand `binding_key` coverage across the rest of the AH-64D
   checklist, add live device detection (2c) as a convenience layer, and
   then move to additional airframes.
