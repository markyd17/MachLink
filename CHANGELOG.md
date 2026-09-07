# Changelog

A plain-language history of what's changed in MachLink, version by version.
Newest first. Each version is also tagged in git, so you can always check
out exactly what the app looked like at that point.

## v0.2.0 - Live Map

- New **LIVE MAP** button: a real, F10-style map that shows your position,
  friendlies, airbases, and the bullseye in real time while you fly -
  no more alt-tabbing to check DCS's own map.
- Runs on an actual real-world topographic map (real coastlines, roads,
  terrain shading, English labels) - not a fake or decorative background.
  DCS's own maps are modeled on real-world regions, so this lines up with
  where you actually are.
- Enemy contacts only ever show up if DCS itself says they're detected -
  confirmed against a real test flight against DCS's own F10 map with Fog
  of War on, so this never shows you more than the game itself would.
- Distance rings and a live "how far to the edge of what I'm looking at"
  readout, centered on your aircraft - zoom and pan freely (scroll wheel
  or the +/- buttons), and a RECENTER button snaps back to your position.

## v0.1.0 - Baseline through this morning

Everything built before today's Live Map work:

- **Debrief**: automatic after-flight report - landing vs. crash vs.
  ejection, who/what shot you down, kills, weapons fired, hits taken,
  landing rate (fpm) with a Butter/Good/Firm/Hard/Very Hard grade, and
  bounce detection.
- **Pilot Summary**: career stats overview - total sorties, flight hours
  by airframe, kills by type, losses by airframe, average landing rate,
  and your 5 most recent flights, with a link to the full **Logbook**.
- App icon and taskbar pinning fixed - MachLink now shows its own icon
  everywhere instead of a generic Python icon, and pins to the taskbar
  properly.
- The Live Map's backend groundwork (no visible map yet at this point).
