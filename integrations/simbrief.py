"""
Fetches your latest generated flight plan from SimBrief's public fetch
endpoint. No OAuth/login needed - just your SimBrief username or Pilot ID,
both found on the SimBrief Account Settings page.

Docs: https://developers.navigraph.com/docs/simbrief/fetching-ofp-data
"""
import requests

SIMBRIEF_URL = "https://www.simbrief.com/api/xml.fetcher.php"


def fetch_latest_ofp(username=None, pilot_id=None, timeout=8):
    if not username and not pilot_id:
        return {"error": "No SimBrief username or pilot_id configured in config.yaml"}

    params = {"json": 1}
    if pilot_id:
        params["userid"] = pilot_id
    else:
        params["username"] = username

    try:
        resp = requests.get(SIMBRIEF_URL, params=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": f"Could not reach SimBrief: {e}"}

    # Pull out the fields most relevant to a sim pilot's briefing
    try:
        general = data.get("general", {})
        origin = data.get("origin", {})
        dest = data.get("destination", {})
        alt = data.get("alternate", {})
        fuel = data.get("fuel", {})
        atc = data.get("atc", {})
        summary = {
            "aircraft": data.get("aircraft", {}).get("icaocode"),
            "origin": origin.get("icao_code"),
            "destination": dest.get("icao_code"),
            "alternate": alt.get("icao_code"),
            "route": general.get("route"),
            "initial_altitude_ft": general.get("initial_altitude"),
            "cruise_altitude_ft": general.get("cruise_altitude"),
            "block_fuel_lbs": fuel.get("plan_ramp"),
            "flight_time": general.get("icao_airline") and general.get("sched_time_enroute"),
            "callsign": atc.get("callsign"),
            "raw": data,  # keep full payload available for the UI if needed
        }
        return summary
    except Exception as e:
        return {"error": f"Got a response but couldn't parse it: {e}", "raw": data}
