"""
Computes career-wide aggregate statistics from data/flight_log.json for
the Pilot Summary / Logbook features. dcs_flight_tracker.py already
appends every completed flight there in full detail (kills, hits, weapons,
landing rate, etc.) - this module just summarizes across all of them.
Read-only and stateless - takes the already-loaded list of flight records
and returns a summary dict, so it's easy to unit-test without any DCS/
network dependency.
"""
from integrations.dcs_flight_tracker import grade_landing_rate

CATEGORY_LABELS = {
    "airplane": "Aircraft",
    "helicopter": "Helicopter",
    "ground_unit": "Ground Unit",
    "ship": "Ship",
    "other": "Other",
}
DETAIL_LABELS = {
    "sam": "SAM",
    "vehicle": "Vehicle",
    "soft_target": "Soft Target",
}


def _kill_bucket(kill):
    """The kills-by-type bucket for one kill record: the finer
    sam/vehicle/soft_target detail where DCS's attribute tags matched one
    (ground kills only, best-effort - see dcs_mission_hook.lua's
    kill_category_detail, not exhaustively verified against every unit
    type yet), else the specific airframe type for an aircraft/helicopter
    kill (target_type, e.g. "Su-27"), else the coarse category label."""
    detail = kill.get("target_category_detail")
    if detail:
        return DETAIL_LABELS.get(detail, detail)
    category = kill.get("target_category")
    if category in ("airplane", "helicopter") and kill.get("target_type"):
        return kill["target_type"]
    return CATEGORY_LABELS.get(category, category or "Unknown")


def _empty_summary():
    return {
        "total_sorties": 0,
        "total_flight_hours": 0.0,
        "flight_hours_by_airframe": {},
        "total_kills": 0,
        "total_friendly_fire_kills": 0,
        "kills_by_type": {},
        "losses_by_airframe": {},
        "avg_kills_per_sortie": 0.0,
        "avg_landing_rate_fpm": None,
        "avg_landing_grade": None,
        "longest_sortie_minutes": None,
        "most_kills_in_one_sortie": 0,
    }


def compute_stats(flights):
    """flights: the full list from flight_log.json (any order). Returns a
    summary dict - safe to call with an empty list."""
    total_sorties = len(flights)
    if total_sorties == 0:
        return _empty_summary()

    total_flight_minutes = sum(f.get("duration_minutes") or 0 for f in flights)

    flight_minutes_by_airframe = {}
    for f in flights:
        aircraft = f.get("aircraft") or "Unknown"
        flight_minutes_by_airframe[aircraft] = flight_minutes_by_airframe.get(aircraft, 0) + (f.get("duration_minutes") or 0)
    flight_hours_by_airframe = {k: round(v / 60, 1) for k, v in flight_minutes_by_airframe.items()}

    all_kills = [k for f in flights for k in (f.get("kills") or [])]
    total_kills = len(all_kills)
    friendly_fire_kills = sum(1 for k in all_kills if k.get("target_relation") == "friendly")

    kills_by_type = {}
    for k in all_kills:
        bucket = _kill_bucket(k)
        kills_by_type[bucket] = kills_by_type.get(bucket, 0) + 1

    # A count per airframe of sorties lost - shot down, crashed, ejected,
    # or an unconfirmed timeout-inferred crash all count the same here
    # (the specific cause still shows in that flight's own debrief); this
    # is "how many of each plane did I lose", not a cause breakdown.
    losses_by_airframe = {}
    for f in flights:
        if f.get("crashed"):
            aircraft = f.get("aircraft") or "Unknown"
            losses_by_airframe[aircraft] = losses_by_airframe.get(aircraft, 0) + 1

    landing_rates = [f["landing_rate_fpm"] for f in flights if f.get("landing_rate_fpm") is not None]
    avg_landing_rate_fpm = round(sum(landing_rates) / len(landing_rates), 0) if landing_rates else None

    kills_per_sortie = [len(f.get("kills") or []) for f in flights]

    return {
        "total_sorties": total_sorties,
        "total_flight_hours": round(total_flight_minutes / 60, 1),
        "flight_hours_by_airframe": flight_hours_by_airframe,
        "total_kills": total_kills,
        "total_friendly_fire_kills": friendly_fire_kills,
        "kills_by_type": kills_by_type,
        "losses_by_airframe": losses_by_airframe,
        "avg_kills_per_sortie": round(total_kills / total_sorties, 2),
        "avg_landing_rate_fpm": avg_landing_rate_fpm,
        "avg_landing_grade": grade_landing_rate(avg_landing_rate_fpm) if avg_landing_rate_fpm is not None else None,
        "longest_sortie_minutes": max((f.get("duration_minutes") or 0) for f in flights),
        "most_kills_in_one_sortie": max(kills_per_sortie) if kills_per_sortie else 0,
    }
