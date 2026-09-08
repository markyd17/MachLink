const simDetectedValue = document.getElementById("sim-detected-value");
const airframeDetectedValue = document.getElementById("airframe-detected-value");
const missionStatusValue = document.getElementById("mission-status-value");
const simbriefStatusValue = document.getElementById("simbrief-status-value");
const datalinkStatusValue = document.getElementById("datalink-status-value");
const settingsBtn = document.getElementById("settings-btn");
const primaryNavBtns = document.querySelectorAll(".primary-nav-btn");
const primarySections = {
  ops: document.getElementById("section-ops"),
  hangar: document.getElementById("section-hangar"),
  flightschool: document.getElementById("section-flightschool"),
  debrief: document.getElementById("section-debrief"),
  kneeboard: document.getElementById("section-kneeboard"),
  settings: document.getElementById("section-settings"),
};
const kneeboardNavBtn = document.getElementById("kneeboard-nav-btn");
const opsTabBtns = document.querySelectorAll(".ops-tab-btn");
const opsTabPanels = {
  mission: document.getElementById("ops-tab-mission"),
  route: document.getElementById("ops-tab-route"),
  threats: document.getElementById("ops-tab-threats"),
  weather: document.getElementById("ops-tab-weather"),
  airfields: document.getElementById("ops-tab-airfields"),
  bullseye: document.getElementById("ops-tab-bullseye"),
  kneeboard: document.getElementById("ops-tab-kneeboard"),
};
const opsThreatsList = document.getElementById("ops-threats-list");
const opsAirfieldsList = document.getElementById("ops-airfields-list");
const opsKneeboardShortcut = document.getElementById("ops-kneeboard-shortcut");
const mfdTabs = document.getElementById("mfd-tabs");
const tabContent = document.getElementById("tab-content");
const citationLine = document.getElementById("citation-line");
const bindingToggle = document.getElementById("binding-toggle");
const cockpitConfigSelect = document.getElementById("cockpit-config-select");
const askForm = document.getElementById("ask-form");
const askInput = document.getElementById("ask-input");
const askBarResult = document.getElementById("ask-bar-result");
const opsBriefingPlaceholder = document.getElementById("ops-briefing-placeholder");
const simbriefPanel = document.getElementById("simbrief-panel");
const simbriefBtn = document.getElementById("simbrief-refresh");
const simbriefContent = document.getElementById("simbrief-content");
const dcsBriefingPanel = document.getElementById("dcs-briefing-panel");
const dcsBriefingContent = document.getElementById("dcs-briefing-content");
const debriefPill = document.getElementById("debrief-pill");
const debriefStatusValue = document.getElementById("debrief-status-value");
const debriefOverlay = document.getElementById("debrief-overlay");
const debriefClose = document.getElementById("debrief-close");
const debriefBody = document.getElementById("debrief-body");
const debriefSectionIdle = document.getElementById("debrief-section-idle");
const debriefSectionBody = document.getElementById("debrief-section-body");
const pilotSummaryStats = document.getElementById("pilot-summary-stats");
const pilotSummaryFlightList = document.getElementById("pilot-summary-flight-list");
const viewFullLogbookBtn = document.getElementById("view-full-logbook-btn");
const logbookOverlay = document.getElementById("logbook-overlay");
const logbookClose = document.getElementById("logbook-close");
const logbookFlightList = document.getElementById("logbook-flight-list");
const opsHookOutdatedWarning = document.getElementById("ops-hook-outdated-warning");
const opsFlightStatus = document.getElementById("ops-flight-status");
const opsSortieTimeValue = document.getElementById("ops-sortie-time-value");
const opsFuelValue = document.getElementById("ops-fuel-value");
const opsAltitudeValue = document.getElementById("ops-altitude-value");
const opsSpeedValue = document.getElementById("ops-speed-value");
const opsHeadingValue = document.getElementById("ops-heading-value");
const opsThreatAlert = document.getElementById("ops-threat-alert");
const opsThreatText = document.getElementById("ops-threat-text");
const opsBullseyeCall = document.getElementById("ops-bullseye-call");
const opsNearestAirbase = document.getElementById("ops-nearest-airbase");
const opsContactSummary = document.getElementById("ops-contact-summary");
const opsNearestSupport = document.getElementById("ops-nearest-support");
const opsLoadoutPanel = document.getElementById("ops-loadout-panel");
const opsLoadoutContent = document.getElementById("ops-loadout-content");
const opsEventsList = document.getElementById("ops-events-list");
const mapLeafletDiv = document.getElementById("map-leaflet");
const mapEmptyState = document.getElementById("map-empty-state");
const mapHookOutdatedWarning = document.getElementById("map-hook-outdated-warning");
const mapRecenterBtn = document.getElementById("map-recenter");
const mapRangeLabel = document.getElementById("map-range-label");
const mapKeyToggle = document.getElementById("map-key-toggle");
const mapLegend = document.getElementById("map-legend");
const kneeboardPageLabel = document.getElementById("kneeboard-page-label");
const kneeboardPageArea = document.getElementById("kneeboard-page-area");
const kneeboardImage = document.getElementById("kneeboard-image");
const kneeboardPrev = document.getElementById("kneeboard-prev");
const kneeboardNext = document.getElementById("kneeboard-next");
const kneeboardPageInput = document.getElementById("kneeboard-page-input");
const kneeboardTotal = document.getElementById("kneeboard-total");
const kneeboardZoomOut = document.getElementById("kneeboard-zoom-out");
const kneeboardZoomIn = document.getElementById("kneeboard-zoom-in");
const kneeboardZoomReset = document.getElementById("kneeboard-zoom-reset");
const deviceModalBackdrop = document.getElementById("device-modal-backdrop");
const deviceModalTitle = document.getElementById("device-modal-title");
const deviceModalBody = document.getElementById("device-modal-body");
const deviceModalClose = document.getElementById("device-modal-close");
const deviceZoomOut = document.getElementById("device-zoom-out");
const deviceZoomIn = document.getElementById("device-zoom-in");
const deviceZoomReset = document.getElementById("device-zoom-reset");

// ----------------------------------------------------------------------
// PRIMARY NAV - Ops / Hangar / Flight School. Only one of the three
// sections is visible at a time; everything else (kneeboard, debrief/
// logbook overlays) lives outside this and stays reachable regardless of
// which section is active. Sections that already poll/render in the
// background (checklist, DCS briefing) keep doing so while hidden, so
// switching to them always shows current data with no extra fetch here -
// Hangar is the one exception, since its data was previously only ever
// fetched on demand (the old Pilot Summary button's click handler).
// ----------------------------------------------------------------------
function switchPrimarySection(id) {
  Object.entries(primarySections).forEach(([sectionId, el]) => {
    el.hidden = sectionId !== id;
  });
  primaryNavBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === id);
  });
  if (id === "hangar") loadPilotSummary();
  if (id === "debrief") loadLatestDebrief();
  if (id === "kneeboard") { setKneeboardZoom(100); renderKneeboardPage(); }
  // The map was sized 0x0 while its #ops-map-home ancestor was hidden
  // (display:none doesn't just hide, Leaflet's cached container size goes
  // stale) - tell it to re-measure now that it's visible again.
  if (id === "ops" && leafletMap) setTimeout(() => leafletMap.invalidateSize(), 0);
}
primaryNavBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchPrimarySection(btn.dataset.section));
});
settingsBtn.addEventListener("click", () => switchPrimarySection("settings"));
debriefPill.addEventListener("click", () => switchPrimarySection("debrief"));

// ----------------------------------------------------------------------
// OPS SUB-TABS - Mission/Route/Threats/Weather/Airfields/Bullseye/
// Kneeboard. Same show-one-hide-the-rest pattern as switchPrimarySection()
// above, just one level down and scoped to #section-ops.
// ----------------------------------------------------------------------
function switchOpsTab(id) {
  Object.entries(opsTabPanels).forEach(([tabId, el]) => {
    el.hidden = tabId !== id;
  });
  opsTabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.opsTab === id);
  });
  // Same hidden-container gotcha as switchPrimarySection('ops') - the map
  // only lives in the Route tab now, so it needs the same re-measure
  // whenever that tab becomes visible again.
  if (id === "route" && leafletMap) setTimeout(() => leafletMap.invalidateSize(), 0);
}
opsTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => switchOpsTab(btn.dataset.opsTab));
});
opsKneeboardShortcut.addEventListener("click", () => switchPrimarySection("kneeboard"));

// One shared zoom level for every diagram currently shown in the modal
// (set as a CSS custom property on the modal body - see style.css) rather
// than separate controls per picture, since usually there's just one or
// two and zooming them together is simpler to use.
const ZOOM_MIN = 50;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
let diagramZoom = 100;

function setDiagramZoom(level) {
  diagramZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, level));
  deviceModalBody.style.setProperty("--diagram-zoom", diagramZoom);
  deviceZoomReset.textContent = `${diagramZoom}%`;
  deviceModalBody.querySelectorAll(".device-diagram-svg svg").forEach((svg) => {
    svg.classList.toggle("zoomed", diagramZoom !== 100);
  });
}

deviceZoomOut.addEventListener("click", () => setDiagramZoom(diagramZoom - ZOOM_STEP));
deviceZoomIn.addEventListener("click", () => setDiagramZoom(diagramZoom + ZOOM_STEP));
deviceZoomReset.addEventListener("click", () => setDiagramZoom(100));

// Clicking a diagram is a quick shortcut for the same shared zoom level -
// zooms in a couple of steps, or back to 100% if already zoomed in.
deviceModalBody.addEventListener("click", (e) => {
  const svg = e.target.closest(".device-diagram-svg svg");
  if (!svg) return;
  setDiagramZoom(diagramZoom === 100 ? 200 : 100);
});

let lastAircraft = null;
let lastChecklistData = null;
let sections = [];       // [{id, label}] - only the ones the loaded aircraft actually has data for
let activeSectionId = null;

// One click handler for every "📷" binding badge, wherever it appears
// (checklist panel or Ask results) - event delegation on the whole
// document means newly-rendered tags work automatically, no re-binding.
document.addEventListener("click", async (e) => {
  const tag = e.target.closest(".has-diagram");
  if (!tag) return;
  const bindingKey = tag.dataset.bindingKey;
  deviceModalTitle.textContent = "Loading...";
  deviceModalBody.innerHTML = "";
  setDiagramZoom(100);
  deviceModalBackdrop.hidden = false;
  try {
    const res = await fetch(`/api/device_diagram/${encodeURIComponent(bindingKey)}`);
    const data = await res.json();
    renderDeviceModal(data);
  } catch (err) {
    deviceModalTitle.textContent = "Error";
    deviceModalBody.innerHTML = `<div class="placeholder-warning">Error reaching server.</div>`;
  }
});

function renderDeviceModal(data) {
  if (!data.available) {
    const reasons = {
      no_svg_dir_configured: "No Joystick Diagrams SVG folder is configured (see config.yaml's joystick_diagrams.svg_export_dir).",
      no_aircraft_detected: "No aircraft currently detected.",
      not_bound: "This isn't currently bound to a physical control, so there's no device picture to show.",
      no_diagram_found: "Found the binding, but no matching Joystick Diagrams export for this device/aircraft was found - try re-running the export.",
    };
    deviceModalTitle.textContent = "No picture available";
    deviceModalBody.innerHTML = `<div class="placeholder-warning">${escapeHtml(reasons[data.reason] || "No picture available.")}</div>`;
    return;
  }
  deviceModalTitle.textContent = data.display_label || "";
  deviceModalBody.innerHTML = data.diagrams
    .map((d) => `
      <div class="device-diagram">
        <div class="device-diagram-label">${escapeHtml(d.device_name)}</div>
        <div class="device-diagram-svg">${d.svg}</div>
      </div>
    `)
    .join("");
}

deviceModalClose.addEventListener("click", () => {
  deviceModalBackdrop.hidden = true;
});
deviceModalBackdrop.addEventListener("click", (e) => {
  if (e.target === deviceModalBackdrop) deviceModalBackdrop.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !deviceModalBackdrop.hidden) deviceModalBackdrop.hidden = true;
});

// Remember the toggle across reloads - a per-browser convenience only,
// never anything the server needs to know about. Reads the old
// Flight-Copilot-era key once so nobody's saved preference gets silently
// reset by the rename.
try {
  const stored = localStorage.getItem("ml_show_bindings") ?? localStorage.getItem("fc_show_bindings");
  bindingToggle.checked = stored === "1";
} catch (e) {
  // private browsing / storage blocked - just default to off, harmless
}

bindingToggle.addEventListener("change", () => {
  try {
    localStorage.setItem("ml_show_bindings", bindingToggle.checked ? "1" : "0");
  } catch (e) {
    // ignore - see above
  }
  renderCurrentChecklist();
});

async function loadCockpitConfigs() {
  try {
    const res = await fetch("/api/cockpit_config");
    const data = await res.json();
    const names = Object.keys(data.configs || {});
    cockpitConfigSelect.innerHTML = names.length
      ? names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")
      : `<option value="">No configurations set up</option>`;
    if (data.active) cockpitConfigSelect.value = data.active;
  } catch (e) {
    cockpitConfigSelect.innerHTML = `<option value="">Error loading</option>`;
  }
}

cockpitConfigSelect.addEventListener("change", async () => {
  try {
    await fetch("/api/cockpit_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: cockpitConfigSelect.value }),
    });
  } catch (e) {
    // ignore - re-render below will just reflect whatever the server has
  }
  renderCurrentChecklist();
});

loadCockpitConfigs();

// Two independent signals, not one combined string: which sim is running
// (or neither) and which airframe it's reporting (or none) - genuinely
// different questions (MSFS can be detected sitting at a menu with no
// airframe loaded yet; DCS's export hook can't currently tell "DCS is
// open but idle" from "DCS isn't running" apart, since it only ever sends
// anything at all once you're actually controlling a unit - an honest gap
// in what that hook can report, not something to paper over here).
// data.game/data.aircraft are already staleness-checked server-side
// (api_status() in app.py) - by the time this runs, null genuinely means
// "nothing detected right now", never a guess.
function updateDetectionIndicators(data) {
  let simText, simCls;
  if (data.game === "dcs") {
    simText = "DCS DETECTED";
    simCls = "status-block dcs mono"; // lime green - see .status-block.dcs
  } else if (data.game === "msfs" || (data.msfs_connection && data.msfs_connection.available)) {
    simText = "MSFS DETECTED";
    simCls = "status-block mono"; // stays the default cyan/blue treatment
  } else {
    simText = "NO SIM DETECTED";
    simCls = "status-block idle mono";
  }
  simDetectedValue.textContent = simText;
  simDetectedValue.className = simCls;
  simDetectedValue.title = statusTooltip(data);

  let airframeText, airframeCls;
  if (data.aircraft && data.aircraft_data_loaded) {
    airframeText = `${data.aircraft.toUpperCase()} ARMED`;
    airframeCls = "status-block mono";
  } else if (data.aircraft) {
    airframeText = `${data.aircraft.toUpperCase()} — NO DATA FILE`;
    airframeCls = "status-block alarm mono";
  } else {
    airframeText = "NO AIRFRAME DETECTED";
    airframeCls = "status-block idle mono";
  }
  airframeDetectedValue.textContent = airframeText;
  airframeDetectedValue.className = airframeCls;
}

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();

    updateDetectionIndicators(data);

    if (data.aircraft !== lastAircraft) {
      lastAircraft = data.aircraft;
      loadChecklist();
    }

    // SimBrief has no DCS-mission equivalent - a real DCS mission already
    // carries its own authored briefing, so that's what fills this slot
    // instead when the detected sim is DCS. The placeholder card takes
    // over whenever NEITHER applies (no sim detected yet, or a sim's
    // detected but you're not in a mission/aircraft) - without it this
    // whole column just goes empty instead of showing anything.
    simbriefPanel.hidden = data.game !== "msfs";
    dcsBriefingPanel.hidden = data.game !== "dcs";
    opsBriefingPlaceholder.hidden = data.game === "msfs" || data.game === "dcs";
    if (data.game !== "msfs") {
      simbriefStatusValue.textContent = "—";
      simbriefStatusValue.className = "status-block idle mono";
    }
    if (data.game === "dcs") {
      pollDcsBriefing();
      loadKneeboard();
      pollDebriefStatus();
      pollLiveEvents();
    } else {
      kneeboardNavBtn.hidden = true;
      if (!primarySections.kneeboard.hidden) switchPrimarySection("ops");
    }
  } catch (e) {
    simDetectedValue.textContent = "CANNOT REACH SERVER";
    simDetectedValue.className = "status-block alarm mono";
    airframeDetectedValue.textContent = "CANNOT REACH SERVER";
    airframeDetectedValue.className = "status-block alarm mono";
  }
}

// Lights up (see .debrief-btn.ready) once dcs_flight_tracker.py detects a
// real flight that landed, stopped, and flew more than 5 minutes - polled
// alongside everything else DCS-specific rather than its own interval.
// Also carries live flight telemetry for Ops's flight-status strip -
// sortie_start_time (airborne-only), plus altitude/speed (available any
// time real telemetry exists, even parked on the ramp). Reusing this
// existing poll instead of a separate endpoint just for a few numbers.
// Overall strip visibility is NOT decided here - updateOpsSituationalAwareness
// gates that on the map snapshot's own own/lat, since that's the more
// reliable "are we actually in a controlled unit" signal.
// Car-dash style: a big digit-only number with a small unit label riding
// beside it, not one uniformly-sized string ("4,921" huge + "FT" small,
// the way a speedometer shows "62" huge next to a small "mph" rather than
// spelling "62 mph" in one size). num/unit are always internally computed
// from trusted numeric data (never raw user/DCS text), so plain
// interpolation into innerHTML is safe here, same as other trusted-numeric
// template strings elsewhere in this file (e.g. the range-ring label).
function setDialValue(el, num, unit) {
  el.innerHTML = unit ? `${num}<span class="ops-value-unit">${unit}</span>` : num;
}

let sortieStartTime = null; // unix seconds, or null while not airborne

async function pollDebriefStatus() {
  try {
    const res = await fetch("/api/debrief_status");
    const data = await res.json();
    debriefPill.classList.toggle("ready", data.ready);
    debriefStatusValue.textContent = data.ready ? "READY" : "NOT READY";
    debriefStatusValue.className = data.ready ? "status-block dcs mono" : "status-block idle mono";
    sortieStartTime = data.sortie_start_time ?? null;
    // MISSION pill - airborne is a genuine "mission in progress" signal,
    // derived from the same sortie_start_time already fetched here for
    // the sortie timer, not a new backend call.
    const missionActive = sortieStartTime != null;
    missionStatusValue.textContent = missionActive ? "IN PROGRESS" : "—";
    missionStatusValue.className = missionActive ? "status-block dcs mono" : "status-block idle mono";
    if (data.altitude_ft != null) setDialValue(opsAltitudeValue, data.altitude_ft.toLocaleString(), "FT");
    else opsAltitudeValue.textContent = "—";
    if (data.speed_kt != null) setDialValue(opsSpeedValue, data.speed_kt, "KT");
    else opsSpeedValue.textContent = "—";
    // DATA LINK pill - real telemetry presence (the same altitude/speed
    // fields above being non-null), standing in for "data link live".
    const dataLinkLive = data.altitude_ft != null || data.speed_kt != null;
    datalinkStatusValue.textContent = dataLinkLive ? "LIVE" : "NO LINK";
    datalinkStatusValue.className = dataLinkLive ? "status-block dcs mono" : "status-block idle mono";
  } catch (e) {
    // Transient - leave the readouts in whatever state they were already in.
  }
}

// Ticks the sortie timer locally every second off the one timestamp above,
// rather than re-fetching every second just to compute an elapsed time.
function tickSortieTimer() {
  if (sortieStartTime == null) {
    opsSortieTimeValue.textContent = "—";
    return;
  }
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - sortieStartTime));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n) => String(n).padStart(2, "0");
  opsSortieTimeValue.textContent = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
setInterval(tickSortieTimer, 1000);

// Called on entering the Debrief section (see switchPrimarySection) -
// replaces the old header button's click handler. Fetching this route
// also acknowledges the debrief server-side (flips ready false), same
// real side effect the button always had, just triggered by navigating
// in instead of a click - re-visiting the section after that just
// re-renders the same still-cached debrief (harmless, idempotent) until
// a genuinely new flight lands and lights the pill up again.
async function loadLatestDebrief() {
  try {
    const res = await fetch("/api/debrief/latest");
    const data = await res.json();
    if (!data.available) {
      debriefSectionIdle.hidden = false;
      debriefSectionBody.hidden = true;
      return;
    }
    renderDebrief(data, debriefSectionBody);
    debriefSectionIdle.hidden = true;
    debriefSectionBody.hidden = false;
    debriefPill.classList.remove("ready");
    debriefStatusValue.textContent = "NOT READY";
    debriefStatusValue.className = "status-block idle mono";
  } catch (e) {
    // Transient - leave whatever was already shown.
  }
}

function formatClockTime(unixSeconds) {
  if (!unixSeconds) return "?";
  return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Category codes come straight from dcs_mission_hook.lua's Unit.Category
// lookup - kept as plain readable words here rather than re-encoding them.
const SHOOTER_CATEGORY_LABELS = {
  airplane: "aircraft",
  helicopter: "helicopter",
  ground_unit: "ground unit",
  ship: "ship",
  other: "unit",
};

function outcomeBadge(d) {
  if (!d.crashed) {
    return { cls: "debrief-outcome-landing", text: "LANDING" };
  }
  if (d.loss_kind === "timeout") {
    // Phase 1's fallback: telemetry just went silent while airborne, long
    // enough to presume the aircraft was destroyed - but with no Phase 2
    // combat event to confirm it, so it's flagged distinctly (amber, not
    // red) rather than asserted as a confirmed cause.
    return { cls: "debrief-outcome-unconfirmed", text: "⚠ CRASH (unconfirmed)" };
  }
  if (d.loss_kind === "dead") {
    return { cls: "debrief-outcome-crash", text: "⚠ SHOT DOWN" };
  }
  if (d.loss_kind === "ejected") {
    return { cls: "debrief-outcome-crash", text: "⚠ EJECTED" };
  }
  return { cls: "debrief-outcome-crash", text: "⚠ CRASH" };
}

// Builds "enemy ground unit (SA-9) — 9M31" from a {relation, category,
// name, weapon} shape - shared by the loss cause line, kill list, and
// hits-taken list so all three describe an actor/weapon the same way.
function describeActor({ relation, category, name, weapon } = {}) {
  const who = [relation, SHOOTER_CATEGORY_LABELS[category]].filter(Boolean).join(" ");
  if (!who) return null;
  return `${who}${name ? ` (${name})` : ""}${weapon ? ` — ${weapon}` : ""}`;
}

// Ops's live event ticker (/api/live_events, LiveEventStore in
// dcs_combat_events.py) - the exact same {relation, category, name,
// weapon} shape the Debrief's kill/hit lists use, reusing describeActor()
// above rather than a second formatting scheme for the same data.
function formatLiveEvent(e) {
  const time = new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (e.kind === "sortie_start") return { time, cls: "", text: "Sortie started" };
  if (e.kind === "shot") return { time, cls: "ops-event-shot", text: `SHOT: ${e.weapon || "weapon"}` };
  if (e.kind === "gun_start") return { time, cls: "ops-event-shot", text: "GUNS" };
  if (e.kind === "kill") {
    const desc = describeActor(e) || "target";
    return { time, cls: "ops-event-kill", text: `KILL: ${desc}` };
  }
  if (e.kind === "hit") {
    const desc = describeActor(e) || "unknown source";
    return { time, cls: "ops-event-hit", text: `HIT TAKEN from ${desc}` };
  }
  if (e.kind === "loss") {
    const desc = describeActor(e);
    const verb = e.loss_kind === "dead" ? "SHOT DOWN" : e.loss_kind === "ejected" ? "EJECTED" : "CRASHED";
    return { time, cls: "ops-event-loss", text: desc ? `${verb} by ${desc}` : verb };
  }
  return { time, cls: "", text: e.kind || "Event" };
}

function renderLiveEvents(events) {
  if (!events.length) {
    opsEventsList.innerHTML = `<div class="ops-events-empty">No events yet this sortie.</div>`;
    return;
  }
  // A wrapping row of compact cards (see .ops-event-card) rather than one
  // full-width line per event - a short entry like "SHOT: AIM-120C" left
  // most of the panel's width empty as a single-column list.
  opsEventsList.innerHTML = events.slice().reverse().map((e) => {
    const { time, cls, text } = formatLiveEvent(e);
    return `<div class="ops-event-card ${cls}">
      <span class="ops-event-time mono">${time}</span>
      <span class="ops-event-text">${escapeHtml(text)}</span>
    </div>`;
  }).join("");
}

async function pollLiveEvents() {
  try {
    const res = await fetch("/api/live_events");
    const data = await res.json();
    renderLiveEvents(data.events || []);
  } catch (e) {
    // Transient - leave whatever the ticker last showed.
  }
}

// A plain-language line describing what actually happened, from the
// Phase 2 combat-event fields (dcs_flight_tracker.py's on_combat_loss).
// Shooter info can accompany ANY of dead/crash/ejected - e.g. hit by
// ground fire, flew on for a while, then crashed from the damage rather
// than being destroyed outright by the hit itself - so this always checks
// for it rather than assuming only a "dead" event carries a cause. Null
// only when there's nothing more specific to say than the badge already
// shows (a clean landing, or a Phase 1 timeout guess with no cause data).
function causeOfLossText(d) {
  if (!d.crashed || d.loss_kind === "timeout") return null;
  const source = describeActor({
    relation: d.shooter_relation, category: d.shooter_category,
    name: d.shooter_name, weapon: d.weapon_type,
  });

  if (d.loss_kind === "dead") {
    return `Shot down by ${source || "an unknown source"}`;
  }
  if (d.loss_kind === "ejected") {
    return source ? `Hit by ${source}, pilot ejected` : "Pilot ejected";
  }
  if (d.loss_kind === "crash") {
    return source ? `Damaged by ${source}, then crashed` : "Crashed into terrain or water";
  }
  return null;
}

function weaponTallyText(weaponsExpended) {
  const entries = Object.entries(weaponsExpended || {});
  if (!entries.length) return null;
  return entries.map(([weapon, count]) => `${count}x ${weapon}`).join(", ");
}

function renderDebrief(d, target = debriefBody) {
  const title = [d.aircraft, d.mission_name].filter(Boolean).join(" — ");
  const badge = outcomeBadge(d);
  const causeText = causeOfLossText(d);
  const outcomeHtml = `<div class="debrief-outcome ${badge.cls} mono">${escapeHtml(badge.text)}</div>`;
  const causeHtml = causeText
    ? `<div class="debrief-cause mono">${escapeHtml(causeText)}</div>`
    : "";

  // Landing rate only exists for a real landing transition (see
  // dcs_flight_tracker.py's update()) - null for a mid-air loss, so it
  // gets its own wide cell only when there's something to show. The rate
  // itself is always taken from the LAST landing transition, so a bounce
  // (brief re-airborne moment right after touchdown, not a real go-around
  // - see BOUNCE_WINDOW_SECONDS) doesn't throw the score off; it's called
  // out here as a note instead, since a bounced landing is worth knowing
  // about even when the final touchdown graded well.
  const landingRateHtml = d.landing_rate_fpm != null
    ? `<div class="data-cell span-2">
         <div class="data-label">Landing Rate</div>
         <div class="data-value">${d.landing_rate_fpm} ft/min — ${escapeHtml(d.landing_grade ?? "?")}${d.bounced ? " (bounced)" : ""}</div>
       </div>`
    : "";

  const killsList = d.kills || [];
  const killsHtml = killsList.length
    ? `<h4 class="checklist-title">KILLS (${killsList.length})</h4>
       <div class="debrief-list">
         ${killsList.map(k => {
           const isFriendly = k.target_relation === "friendly";
           const desc = describeActor({
             relation: k.target_relation, category: k.target_category,
             name: k.target_name, weapon: k.weapon_type,
           }) || "Unknown target";
           return `<div class="debrief-list-item${isFriendly ? " debrief-list-item-warn" : ""}">
             ${isFriendly ? "⚠ FRIENDLY FIRE — " : ""}${escapeHtml(desc)}
           </div>`;
         }).join("")}
       </div>`
    : "";

  const weaponsText = weaponTallyText(d.weapons_expended);
  const weaponsHtml = weaponsText
    ? `<h4 class="checklist-title">WEAPONS EXPENDED</h4>
       <div class="debrief-cause mono">${escapeHtml(weaponsText)}</div>`
    : "";

  const hitsList = d.hits_taken || [];
  const hitsHtml = hitsList.length
    ? `<h4 class="checklist-title">HITS TAKEN (${hitsList.length})</h4>
       <div class="debrief-list">
         ${hitsList.map(h => {
           const desc = describeActor({
             relation: h.shooter_relation, category: h.shooter_category,
             name: h.shooter_name, weapon: h.weapon_type,
           }) || "Unknown source";
           return `<div class="debrief-list-item">${escapeHtml(desc)}</div>`;
         }).join("")}
       </div>`
    : "";

  target.innerHTML = `
    <h3 class="checklist-title">${escapeHtml(title || "Flight")}</h3>
    <div class="checklist-subnote mono">${escapeHtml(formatClockTime(d.start_time))} – ${escapeHtml(formatClockTime(d.end_time))}</div>
    ${outcomeHtml}
    ${causeHtml}
    <div class="data-grid mono" style="margin-top:14px;">
      <div class="data-cell">
        <div class="data-label">Total Duration</div>
        <div class="data-value">${d.duration_minutes ?? "?"} min</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Time Airborne</div>
        <div class="data-value">${d.airborne_minutes ?? "?"} min</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Takeoffs</div>
        <div class="data-value">${d.takeoffs ?? "?"}</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Landings</div>
        <div class="data-value">${d.landings ?? "?"}</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Max Speed</div>
        <div class="data-value">${d.max_speed_kts ?? "?"} kts</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Max Altitude (AGL)</div>
        <div class="data-value">${d.max_altitude_agl_ft ?? "?"} ft</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Distance Flown</div>
        <div class="data-value">${d.distance_flown_nm ?? "?"} nm</div>
      </div>
      ${landingRateHtml}
    </div>
    ${killsHtml}
    ${weaponsHtml}
    ${hitsHtml}`;
}

debriefClose.addEventListener("click", () => {
  debriefOverlay.hidden = true;
});
debriefOverlay.addEventListener("click", (e) => {
  if (e.target === debriefOverlay) debriefOverlay.hidden = true;
});
// Debrief can be open on top of Logbook (reopening a past sortie from
// the Hangar tab) - Escape closes whichever's topmost rather than both.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!debriefOverlay.hidden) { debriefOverlay.hidden = true; return; }
  if (!logbookOverlay.hidden) { logbookOverlay.hidden = true; }
});

function formatFlightDate(unixSeconds) {
  if (!unixSeconds) return "?";
  return new Date(unixSeconds * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
}

function joinCounts(obj) {
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "None yet";
  return entries.map(([key, count]) => `${count}x ${key}`).join(", ");
}

function joinHours(obj) {
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "None yet";
  return entries.map(([key, hours]) => `${hours} hrs ${key}`).join(", ");
}

function renderPilotSummaryStats(s) {
  // Landing rate and its grade share one wide cell - the grade describes
  // the average rate itself (see logbook_stats.compute_stats), not a
  // separate stat, so there's nothing to break out into its own cell.
  const landingRateValue = s.avg_landing_rate_fpm != null
    ? `${s.avg_landing_rate_fpm} ft/min${s.avg_landing_grade ? ` — ${s.avg_landing_grade}` : ""}`
    : "—";
  pilotSummaryStats.innerHTML = `
    <div class="data-grid mono">
      <div class="data-cell"><div class="data-label">Total Sorties</div><div class="data-value">${s.total_sorties}</div></div>
      <div class="data-cell"><div class="data-label">Total Flight Hours</div><div class="data-value">${s.total_flight_hours}</div></div>
      <div class="data-cell"><div class="data-label">Total Kills</div><div class="data-value">${s.total_kills}</div></div>
      <div class="data-cell"><div class="data-label">Avg Kills / Sortie</div><div class="data-value">${s.avg_kills_per_sortie}</div></div>
      <div class="data-cell span-2"><div class="data-label">Avg Landing Rate</div><div class="data-value">${landingRateValue}</div></div>
      <div class="data-cell"><div class="data-label">Longest Sortie</div><div class="data-value">${s.longest_sortie_minutes ?? "—"} min</div></div>
      <div class="data-cell"><div class="data-label">Most Kills (1 Sortie)</div><div class="data-value">${s.most_kills_in_one_sortie}</div></div>
    </div>
    <h4 class="checklist-title">FLIGHT HOURS BY AIRFRAME</h4>
    <div class="debrief-cause mono">${escapeHtml(joinHours(s.flight_hours_by_airframe))}</div>
    <h4 class="checklist-title">KILLS BY TYPE</h4>
    <div class="debrief-cause mono">${escapeHtml(joinCounts(s.kills_by_type))}${s.total_friendly_fire_kills ? ` — ${s.total_friendly_fire_kills} friendly fire` : ""}</div>
    <h4 class="checklist-title">LOSSES BY AIRFRAME</h4>
    <div class="debrief-cause mono">${escapeHtml(joinCounts(s.losses_by_airframe))}</div>`;
}

// Reopens a past sortie's full detail on top of whichever overlay it was
// clicked from, reusing the exact same rendering as a fresh debrief - a
// logged flight record has the identical shape latest_debrief() returns.
function openPastFlight(flight) {
  renderDebrief(flight);
  debriefOverlay.hidden = false;
}

// Shared by Pilot Summary's 5-item preview and the full Logbook list -
// same row markup either way, just a different slice of the same array.
function renderFlightRows(container, flights) {
  if (!flights.length) {
    container.innerHTML = `<div id="logbook-empty">No flights logged yet - fly a sortie past the minimum flight time and it'll show up here.</div>`;
    return;
  }
  container.innerHTML = flights.map((f, i) => {
    const badge = outcomeBadge(f);
    const title = [f.aircraft, f.mission_name].filter(Boolean).join(" — ");
    const killCount = (f.kills || []).length;
    const sub = [
      formatFlightDate(f.start_time),
      `${f.duration_minutes ?? "?"} min`,
      killCount ? `${killCount} kill${killCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join(" · ");
    return `<div class="logbook-flight-row" data-index="${i}">
      <div class="logbook-flight-row-main">
        <div class="logbook-flight-row-title">${escapeHtml(title || "Flight")}</div>
        <div class="logbook-flight-row-sub">${escapeHtml(sub)}</div>
      </div>
      <div class="logbook-flight-row-outcome ${badge.cls}">${escapeHtml(badge.text)}</div>
    </div>`;
  }).join("");

  container.querySelectorAll(".logbook-flight-row").forEach((row) => {
    row.addEventListener("click", () => openPastFlight(flights[Number(row.dataset.index)]));
  });
}

// Fetched every time the Hangar tab is switched into (see
// switchPrimarySection above), reused by the full Logbook so "View Full
// Logbook" doesn't need a second round-trip. Fine to go a little stale if
// a new flight completes while Logbook stays open - an edge case not
// worth a live-refresh for.
let cachedFlights = [];

async function loadPilotSummary() {
  try {
    const res = await fetch("/api/logbook");
    const data = await res.json();
    cachedFlights = data.flights || [];
    renderPilotSummaryStats(data.summary);
    renderFlightRows(pilotSummaryFlightList, cachedFlights.slice(0, 5));
  } catch (e) {
    // transient - Hangar just keeps showing whatever it last had
  }
}

function openLogbook() {
  renderFlightRows(logbookFlightList, cachedFlights);
  logbookOverlay.hidden = false;
}

viewFullLogbookBtn.addEventListener("click", openLogbook);
logbookClose.addEventListener("click", () => {
  logbookOverlay.hidden = true;
});
logbookOverlay.addEventListener("click", (e) => {
  if (e.target === logbookOverlay) logbookOverlay.hidden = true;
});

// ----------------------------------------------------------------------
// LIVE MAP - polls /api/map_data (dcs_mission_hook.lua's own snapshot,
// via dcs_map_data.py) once a second while open and updates markers on a
// real OpenStreetMap background. Every marker placed here comes straight
// from that snapshot: lat/lon come from DCS's own coord.LOtoLL() (DCS's
// terrain maps are modeled on real-world regions, so this is accurate,
// not decorative), and "detected" is only ever what DCS's own
// Controller:isTargetDetected() already confirmed. Nothing is computed,
// estimated, or shown beyond exactly what the snapshot contains - if DCS
// doesn't report it, this map doesn't draw it either.
// ----------------------------------------------------------------------
let leafletMap = null;
let ownMarker = null;
let bullseyeMarker = null;
let dynamicLayer = null; // friendlies + detected + airbases, cleared/rebuilt each poll
let ringsLayer = null; // distance rings, centered on own aircraft
let hasCenteredOnce = false;
let lastOwnLatLng = null; // so zoom/pan (no new data yet) can still redraw rings

const METERS_PER_NM = 1852;
const NICE_RING_NM = [1, 2, 5, 10, 20, 40, 80, 160, 320];

// Standard great-circle destination formula (given a start point, bearing,
// and distance) - plain spherical trig, not a DCS API, so no empirical
// verification needed the way coord.LOtoLL() got. Used to place each
// ring's distance label at its northern edge.
function destinationPoint(lat, lon, bearingDeg, distanceM) {
  const R = 6371000;
  const brng = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lon * Math.PI / 180;
  const angDist = distanceM / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angDist) + Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1), Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

// The inverse of destinationPoint() - initial bearing and great-circle
// distance from point 1 to point 2. Same spherical-trig family (haversine
// distance + standard initial-bearing formula), not a DCS API. Backs
// Ops's bullseye call, nearest-divert-airbase, and radar-scope preview -
// every one of those is "how far/which way from A to B" on two lat/lons
// the map snapshot already provides.
function bearingDistanceBetween(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const dPhi = (lat2 - lat1) * Math.PI / 180;
  const dLambda = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const distanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const bearingDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return { bearingDeg, distanceNm: distanceM / METERS_PER_NM };
}

// "270° / 42 NM" - shared format for every bearing/range readout in Ops.
function formatBearingRange(bearingDeg, distanceNm) {
  const bearing = String(Math.round(bearingDeg) % 360).padStart(3, "0");
  const range = distanceNm < 10 ? distanceNm.toFixed(1) : Math.round(distanceNm);
  return `${bearing}° / ${range} NM`;
}

// Rings are centered on the aircraft's real position (not wherever the
// map's been panned to) - "how far is that from ME" should always answer
// from where you actually are. Picks whichever "nice" NM values actually
// fit the current view rather than a fixed preset, since Leaflet's zoom
// is continuous, not discrete steps like the old canvas map's presets.
function updateRangeRingsAndLabel(lat, lon) {
  if (lat == null || lon == null) return;
  lastOwnLatLng = [lat, lon];
  if (!leafletMap) return;

  const center = leafletMap.getCenter();
  const bounds = leafletMap.getBounds();
  const visibleRadiusM = center.distanceTo(L.latLng(center.lat, bounds.getEast()));
  const visibleRadiusNm = visibleRadiusM / METERS_PER_NM;

  mapRangeLabel.textContent = `${visibleRadiusNm < 1 ? visibleRadiusNm.toFixed(1) : Math.round(visibleRadiusNm)} NM`;

  ringsLayer.clearLayers();
  const candidates = NICE_RING_NM.filter((nm) => nm * METERS_PER_NM <= visibleRadiusM * 1.3);
  const chosen = candidates.slice(-3); // the largest 3 that still fit
  if (!chosen.length) chosen.push(NICE_RING_NM[0]);
  chosen.forEach((nm) => {
    const radiusM = nm * METERS_PER_NM;
    L.circle([lat, lon], {
      radius: radiusM, color: "#7B8794", weight: 1, opacity: 0.5, fill: false, interactive: false,
    }).addTo(ringsLayer);
    const [labelLat, labelLon] = destinationPoint(lat, lon, 0, radiusM);
    L.marker([labelLat, labelLon], {
      icon: L.divIcon({
        // Solid dark chip instead of bare text-shadow-on-terrain - a real
        // topo map's colors vary too much for shadow alone to stay
        // readable, and 10px was just too small to read at a glance.
        html: `<span style="display:inline-block;color:#E8EDEF;font-size:13px;font-weight:bold;font-family:var(--font-mono),monospace;background:rgba(11,15,18,0.8);border:1px solid #00E5FF;padding:2px 7px;border-radius:2px;white-space:nowrap;">${nm} NM</span>`,
        className: "ml-map-marker", iconSize: [64, 24], iconAnchor: [32, 12],
      }),
      interactive: false,
    }).addTo(ringsLayer);
  });
}

// DCS coalition IDs are 0 (neutral), 1 (red), 2 (blue) - NOT "1=enemy,
// 2=friendly". data.myCoalition (dcs_mission_hook.lua's write_map_snapshot)
// is the player's own actual side, so this colors by real friend/foe
// instead of assuming the player is always blue - a real bug an earlier
// version of this map had, that would've shown a red-coalition player's
// own airbases as hostile. Falls back to the old blue-assumption only if
// an older mission hook (predating myCoalition) is still deployed.
function airbaseColor(coalition, myCoalition) {
  if (myCoalition == null) return coalition === 2 ? "#1E88E5" : coalition === 1 ? "#E53935" : "#FF9900";
  if (coalition === 0) return "#FF9900";
  return coalition === myCoalition ? "#1E88E5" : "#E53935";
}

// airbase_category_label() in dcs_mission_hook.lua - DCS's own documented
// Airbase.Category enum (AIRDROME/HELIPAD/SHIP). Ship/helipad reuse the
// SHIP/HELICOPTER unit shapes rather than inventing new ones - a
// ship-category airbase IS a ship, and a helipad IS a helicopter landing
// spot, so the same icon language applies. Airdrome gets its own new
// "pentagon" shape (a real airbase symbology convention) instead of
// reusing "square", which already means VEHICLE - falls back to it only
// for an older deployed hook that predates this field entirely.
function airbaseShape(category) {
  if (category === "ship") return "diamond";
  if (category === "helipad") return "cross";
  if (category === "airdrome") return "pentagon";
  return "square"; // unknown/older-hook data with no category field
}

// category_label()/categoryDetail strings from dcs_mission_hook.lua's
// unit_json() - categoryDetail (sam/vehicle/soft_target) is the same
// DCS-attribute-based breakdown the Logbook's kill stats already use
// (kill_category_detail()), reused here so ground contacts get distinct
// vehicle/SAM/soldier icons instead of one generic square for every
// ground_unit. Falls back to "square" (generic vehicle-ish default) when
// DCS's attribute tags don't match anything known - see MAP_KEY below for
// what each shape means.
function shapeForUnit(u) {
  const category = u.category;
  if (category === "airplane") return "triangle";
  if (category === "helicopter") return "cross";
  if (category === "ship") return "diamond";
  if (category === "ground_unit") {
    if (u.categoryDetail === "sam") return "hexagon";
    if (u.categoryDetail === "soft_target") return "circle"; // soldier/infantry
    return "square"; // vehicle, or no attribute match
  }
  return "circle";
}

// Small CSS-shaped div icon - color follows DCS's own coalition
// convention (blue for your side, red for the opposing one) rather than
// MachLink's own brand colors, so it reads the way a DCS pilot expects.
// Shape meanings are listed in MAP_KEY below and rendered in the map's
// on-screen legend, so a new shape added here needs an entry there too.
// Shape sizes are in `em`, not px, so the exact same markup renders at a
// fixed small size on the live map (.ml-map-marker locks font-size:12px in
// style.css, matching the old hardcoded px values exactly) but grows/shrinks
// with the legend's swatch when reused inside .map-legend-swatch, which sets
// its own clamp()'d font-size - see the CSS comment above .map-legend-swatch.
function makeMapIcon(shape, color, headingDeg) {
  let html;
  if (shape === "triangle") {
    // border-trick triangle points up (north) at heading 0, matching
    // DCS's heading convention (0=north, clockwise) - CSS rotate() is
    // also clockwise-positive, so no sign flip needed.
    html = `<div style="width:0;height:0;border-left:0.5em solid transparent;border-right:0.5em solid transparent;border-bottom:1em solid ${color};transform:rotate(${headingDeg || 0}deg);filter:drop-shadow(0 0 2px rgba(0,0,0,0.8));"></div>`;
  } else if (shape === "cross") {
    // Helicopter: two crossed bars evoking a rotor disc seen from above -
    // distinct from the fixed-wing triangle at a glance. Rotates with
    // heading like the triangle does, though the shape is symmetric
    // enough that it barely shows.
    html = `<div style="position:relative;width:1em;height:1em;transform:rotate(${headingDeg || 0}deg);filter:drop-shadow(0 0 2px rgba(0,0,0,0.8));">
      <div style="position:absolute;top:0.417em;left:0;width:1em;height:0.167em;background:${color};"></div>
      <div style="position:absolute;left:0.417em;top:0;width:0.167em;height:1em;background:${color};"></div>
    </div>`;
  } else if (shape === "square") {
    html = `<div style="width:0.75em;height:0.75em;background:${color};border:1px solid rgba(0,0,0,0.6);"></div>`;
  } else if (shape === "hexagon") {
    // SAM - a hexagon reads as "site/installation" and won't be confused
    // with the plain vehicle square or the soldier circle.
    html = `<div style="width:0.917em;height:0.917em;background:${color};border:1px solid rgba(0,0,0,0.6);clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);"></div>`;
  } else if (shape === "diamond") {
    html = `<div style="width:0.75em;height:0.75em;background:${color};border:1px solid rgba(0,0,0,0.6);transform:rotate(45deg);"></div>`;
  } else if (shape === "pentagon") {
    // Airdrome - the classic "home plate" installation symbol, distinct
    // from the vehicle square and the SAM hexagon.
    html = `<div style="width:0.917em;height:0.917em;background:${color};border:1px solid rgba(0,0,0,0.6);clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%);"></div>`;
  } else {
    html = `<div style="width:0.75em;height:0.75em;border-radius:50%;background:${color};border:1px solid rgba(0,0,0,0.6);"></div>`;
  }
  return L.divIcon({ html, className: "ml-map-marker", iconSize: [16, 16], iconAnchor: [8, 8] });
}

// Drives both the always-in-sync on-screen legend (buildMapLegend()) and
// nothing else - shapeForUnit()/makeMapIcon() above are the actual source
// of truth for what gets drawn; this list just has to keep describing them.
const MAP_KEY = [
  { shape: "triangle", label: "FIXED-WING" },
  { shape: "cross", label: "HELICOPTER" },
  { shape: "square", label: "VEHICLE" },
  { shape: "hexagon", label: "SAM" },
  { shape: "circle", label: "SOLDIER" },
  { shape: "diamond", label: "SHIP" },
  { shape: "pentagon", label: "AIRBASE" },
];
const MAP_KEY_NEUTRAL_COLOR = "#B8C2CC"; // same gray as the range-ring labels - shape is what the key explains, not coalition color

function buildMapLegend() {
  if (!mapLegend || mapLegend.dataset.built) return;
  mapLegend.dataset.built = "1";
  const shapeRows = MAP_KEY.map(({ shape, label }) => {
    const icon = makeMapIcon(shape, MAP_KEY_NEUTRAL_COLOR, 0);
    return `<div class="map-legend-row"><span class="map-legend-swatch">${icon.options.html}</span><span>${label}</span></div>`;
  }).join("");
  mapLegend.innerHTML = `
    <span id="map-legend-title">KEY</span>
    ${shapeRows}
    <div class="map-legend-row map-legend-color-row">
      <span class="map-legend-swatch"><span class="map-legend-color-dot" style="background:#1E88E5;"></span></span><span>FRIENDLY</span>
    </div>
    <div class="map-legend-row map-legend-color-row">
      <span class="map-legend-swatch"><span class="map-legend-color-dot" style="background:#E53935;"></span></span><span>DETECTED</span>
    </div>
  `;
}

// Esri's World Topo Map, not plain OSM tiles - real terrain relief/
// contour shading (DCS's own maps are terrain-heavy, so this reads much
// closer to "a real map" than a flat street layer), and its place names
// are Esri's own standardized English labels rather than raw OSM `name`
// tags, which for a region like the Caucasus are often local-script only.
function ensureLeafletMap() {
  if (leafletMap) return;
  leafletMap = L.map(mapLeafletDiv, { center: [0, 0], zoom: 11 });
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
  }).addTo(leafletMap);
  dynamicLayer = L.layerGroup().addTo(leafletMap);
  ringsLayer = L.layerGroup().addTo(leafletMap);
  // Manual panning breaks the auto-follow-on-first-fix behavior - once
  // you've touched the map, only RECENTER snaps it back, matching how
  // DCS's own F10 map never fights your own panning either.
  leafletMap.on("dragstart zoomstart", () => { hasCenteredOnce = true; });
  // Rings/range label depend on the current view, not just fresh data -
  // redraw them on zoom/pan even between poll ticks so they don't lag.
  leafletMap.on("zoomend moveend", () => {
    if (lastOwnLatLng) updateRangeRingsAndLabel(lastOwnLatLng[0], lastOwnLatLng[1]);
  });
}

// Rebuilding the whole layer group every poll tick (below) would destroy
// an open popup within ~1s of clicking a marker, before you could read
// it - confirmed empirically (clicked a marker, screenshot a moment
// later showed nothing). Each dynamic marker below reports whether its
// own popup is open; while any is, the rebuild is skipped for that tick
// so the popup you're actually looking at survives.
let openDynamicPopupCount = 0;

function addDynamicMarker(latlng, icon, popupHtml) {
  const marker = L.marker(latlng, { icon });
  if (popupHtml) {
    marker.bindPopup(popupHtml);
    marker.on("popupopen", () => { openDynamicPopupCount++; });
    marker.on("popupclose", () => { openDynamicPopupCount = Math.max(0, openDynamicPopupCount - 1); });
  }
  return marker.addTo(dynamicLayer);
}

function updateMapMarkers(snapshot) {
  // dcs_map_data.py already flags a snapshot "stale" once 5s pass with no
  // fresh write from DCS (aircraft exited, mission ended, DCS closed) -
  // this was never actually being checked, so the map kept every marker
  // frozen exactly where it last saw them, looking exactly like a live
  // picture. Treated the same as "no data at all": clear everything
  // rather than leave a stale last-known frame on screen.
  const stale = snapshot && snapshot.available && snapshot.stale;
  if (!snapshot || !snapshot.available || stale) {
    mapHookOutdatedWarning.hidden = true;
    mapEmptyState.hidden = false;
    mapEmptyState.textContent = stale
      ? "NO RECENT DATA — DCS/the mission hook stopped reporting (exited the aircraft, mission ended, or DCS closed)."
      : "NO LIVE MAP DATA — make sure DCS is running, Phase 2's mission hook is installed, and you're in control of a unit.";
    if (ownMarker) { leafletMap.removeLayer(ownMarker); ownMarker = null; }
    if (bullseyeMarker) { leafletMap.removeLayer(bullseyeMarker); bullseyeMarker = null; }
    if (dynamicLayer) dynamicLayer.clearLayers();
    if (ringsLayer) ringsLayer.clearLayers();
    hasCenteredOnce = false; // re-center cleanly whenever data resumes, rather than snapping to wherever it last panned
    return;
  }
  // See the same check in updateOpsSituationalAwareness - a deployed
  // mission hook predating categoryDetail/myCoalition affects the full
  // map's icons/airbase colors too.
  mapHookOutdatedWarning.hidden = !snapshot.hook_outdated;
  const data = snapshot.data || {};
  const own = data.own;
  if (!own || own.lat == null || own.lon == null) {
    mapEmptyState.hidden = false;
    mapEmptyState.textContent = "Waiting for your own aircraft's position...";
    return;
  }
  mapEmptyState.hidden = true;

  // shapeForUnit() so flying a helicopter draws the rotor-cross icon
  // instead of always the fixed-wing triangle.
  if (!ownMarker) {
    ownMarker = L.marker([own.lat, own.lon], { icon: makeMapIcon(shapeForUnit(own), "#1E88E5", own.heading), zIndexOffset: 1000 }).addTo(leafletMap);
  } else {
    ownMarker.setLatLng([own.lat, own.lon]);
    ownMarker.setIcon(makeMapIcon(shapeForUnit(own), "#1E88E5", own.heading));
  }

  if (!hasCenteredOnce) {
    leafletMap.setView([own.lat, own.lon], leafletMap.getZoom());
  }
  updateRangeRingsAndLabel(own.lat, own.lon);

  if (openDynamicPopupCount === 0) {
    dynamicLayer.clearLayers();

    (data.friendlies || []).forEach((u) => {
      if (u.lat == null || u.lon == null) return;
      addDynamicMarker([u.lat, u.lon], makeMapIcon(shapeForUnit(u), "#1E88E5", u.heading),
        `${escapeHtml(u.name || "Friendly")}<br>${escapeHtml(u.type || "")}`);
    });

    // Detected contacts - only ever what DCS's own isTargetDetected() has
    // confirmed for your coalition (see gather_detected() in the mission
    // hook). Never a raw dump of every enemy unit in the mission.
    (data.detected || []).forEach((u) => {
      if (u.lat == null || u.lon == null) return;
      addDynamicMarker([u.lat, u.lon], makeMapIcon(shapeForUnit(u), "#E53935", u.heading),
        escapeHtml(u.type || "Contact"));
    });

    // Airbases - color by actual friend/foe, shape by airdrome/ship/helipad
    // (see airbaseColor()/airbaseShape() above).
    (data.airbases || []).forEach((ab) => {
      if (ab.lat == null || ab.lon == null) return;
      addDynamicMarker([ab.lat, ab.lon], makeMapIcon(airbaseShape(ab.category), airbaseColor(ab.coalition, data.myCoalition), 0), escapeHtml(ab.name || "Airbase"));
    });
  }

  if (data.bullseye && data.bullseye.lat != null) {
    if (!bullseyeMarker) {
      bullseyeMarker = L.marker([data.bullseye.lat, data.bullseye.lon], {
        icon: L.divIcon({
          html: `<div style="width:14px;height:14px;border:2px solid #FF9900;border-radius:50%;box-sizing:border-box;"></div>`,
          className: "ml-map-marker", iconSize: [14, 14], iconAnchor: [7, 7],
        }),
      }).bindPopup("BULLSEYE").addTo(leafletMap);
    } else {
      bullseyeMarker.setLatLng([data.bullseye.lat, data.bullseye.lon]);
    }
  }
}

// Runs continuously from page load (see the bottom of this file) rather
// than only while the Ops tab is active - it's a cheap local read (the
// same 1-second snapshot dcs_mission_hook.lua already writes), so one
// always-on loop is simpler than starting/stopping a timer per tab switch.
async function pollMapData() {
  let snapshot;
  try {
    const res = await fetch("/api/map_data");
    snapshot = await res.json();
  } catch (e) {
    snapshot = null;
  }
  // leafletMap exists from page load now (see ensureLeafletMap() call at
  // the bottom of this file) - the guard here is just defensive in case
  // this ever runs before that.
  if (leafletMap) updateMapMarkers(snapshot);
  updateOpsSituationalAwareness(snapshot);
}

// ----------------------------------------------------------------------
// OPS SITUATIONAL AWARENESS - a bullseye call for your own position, the
// nearest friendly divert airbase, and a contact-type breakdown, next to
// the real map itself (permanently in #ops-map-home - no expand/full-
// screen mode). Every number here comes straight from data.own/
// data.airbases/data.detected/data.bullseye - nothing computed here is a
// guess, just bearing/distance math on real positions.
// ----------------------------------------------------------------------

// Nearest airbase belonging to the player's OWN coalition (data.myCoalition -
// see write_map_snapshot() in dcs_mission_hook.lua) - null if that field
// isn't present yet (an older mission hook still deployed) rather than
// guessing at a "friendly" side.
// A fixed-wing aircraft can never use a HELIPAD-only recovery point - a
// safe exclusion regardless of which specific ship/pad it is, unlike
// trying to guess the REVERSE (which ships support fixed-wing recovery
// isn't something DCS's API exposes - Airbase.Category.SHIP covers a
// real carrier and a frigate's helipad identically - so this never
// asserts a ship IS carrier-capable, only ever rules helipads out for a
// fixed-wing pilot). Helicopters can use anything (airdrome/ship/helipad
// all land a helicopter fine).
function findNearestFriendlyAirbase(own, airbases, myCoalition, ownCategory) {
  if (myCoalition == null) return null;
  let best = null;
  (airbases || []).forEach((ab) => {
    if (ab.lat == null || ab.coalition !== myCoalition) return;
    if (ownCategory === "airplane" && ab.category === "helipad") return;
    const { bearingDeg, distanceNm } = bearingDistanceBetween(own.lat, own.lon, ab.lat, ab.lon);
    if (!best || distanceNm < best.distanceNm) {
      best = { name: ab.name || "Airbase", category: ab.category, bearingDeg, distanceNm };
    }
  });
  return best;
}

// Best-effort keyword match against friendly unit type names - DCS has no
// "this is a tanker/AWACS" flag to query, only a typeName string, so this
// is a curated list of common modules' real DCS typeName substrings, same
// "not exhaustive, matched on real data, never guessed" spirit as
// kill_category_detail()'s attribute list in dcs_mission_hook.lua. A
// support aircraft using a type name not on this list just won't show up
// here - not a false claim, just a known gap.
const SUPPORT_TYPE_KEYWORDS = [
  "kc135", "kc-135", "kc130", "kc-130", "kc_10", "kc-10",
  "il_78", "il-78", "il78",
  "s-3b tanker", "s3b tanker",
  "a-50", "a50",
  "e-3a", "e3a",
  "e-2c", "e2c", "e-2d",
  "kj-2000", "kj2000",
];
function isSupportAircraft(typeName) {
  const t = (typeName || "").toLowerCase();
  return SUPPORT_TYPE_KEYWORDS.some((kw) => t.includes(kw));
}

function findNearestSupport(own, friendlies) {
  let best = null;
  (friendlies || []).forEach((u) => {
    if (u.lat == null || !isSupportAircraft(u.type)) return;
    const { bearingDeg, distanceNm } = bearingDistanceBetween(own.lat, own.lon, u.lat, u.lon);
    if (!best || distanceNm < best.distanceNm) best = { type: u.type, bearingDeg, distanceNm };
  });
  return best;
}

const CONTACT_SUMMARY_LABELS = {
  airplane: "AIRCRAFT", helicopter: "HELICOPTER", ship: "SHIP",
  sam: "SAM", vehicle: "VEHICLE", soft_target: "SOLDIER",
};

// "1 SAM, 2 VEHICLE" from the same category/categoryDetail fields the map's
// icons use - see shapeForUnit() above for what each combination means.
function summarizeContacts(detected) {
  const counts = {};
  (detected || []).forEach((u) => {
    const key = u.category === "ground_unit" ? (u.categoryDetail || "vehicle") : u.category;
    const label = CONTACT_SUMMARY_LABELS[key] || "OTHER";
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, n]) => `${n} ${label}`).join(", ");
}

// Every detected SAM's real distance from you, nearest first - NOT a
// fabricated engagement-range ring. DCS's API has no per-SAM-type
// engagement envelope to read, and this app never asserts a number it
// can't back with real data (see the map/Debrief work) - real distance is
// what's actually knowable, so that's what this shows. No range beyond
// detected[] itself either - DCS already decided what counts as detected
// (Controller:isTargetDetected()), same as everywhere else this map data
// is used.
function findSamThreats(own, detected) {
  return (detected || [])
    .filter((u) => u.category === "ground_unit" && u.categoryDetail === "sam" && u.lat != null)
    .map((u) => ({ type: u.type || "SAM", distanceNm: bearingDistanceBetween(own.lat, own.lon, u.lat, u.lon).distanceNm }))
    .sort((a, b) => a.distanceNm - b.distanceNm);
}

// "2x AIM-120C, 90x 20mm" from Unit:getAmmo() (dcs_mission_hook.lua's
// get_loadout()) - your actual current ordnance, not Flight School's
// static reference data. Hides the whole card rather than showing "no
// loadout" for an unarmed aircraft or one getAmmo() genuinely returns
// nothing for.
function renderLoadout(loadout) {
  if (!loadout || !loadout.length) {
    opsLoadoutPanel.hidden = true;
    return;
  }
  opsLoadoutContent.innerHTML = loadout
    .map((item) => `<div class="checklist-item plain"><span class="step-text">${item.count}x ${escapeHtml(item.name || "Unknown")}</span></div>`)
    .join("");
  opsLoadoutPanel.hidden = false;
}

// Real per-contact list for the Threats tab - reuses findSamThreats()'s
// exact result (same nearest-first distances the banner text already
// showed), just as individual rows instead of one joined string.
function renderThreatsList(threats) {
  if (!threats.length) {
    opsThreatsList.innerHTML = `<div class="ops-empty-note">No threats detected.</div>`;
    return;
  }
  opsThreatsList.innerHTML = threats
    .map((t) => `<div class="ops-readout-row"><span class="ops-readout-label">${escapeHtml(t.type)}</span><span class="ops-readout-value mono">${t.distanceNm < 10 ? t.distanceNm.toFixed(1) : Math.round(t.distanceNm)} NM</span></div>`)
    .join("");
}

// Real full airbase list for the Airfields tab - every entry in
// data.airbases, nearest first, same bearing/distance math
// findNearestFriendlyAirbase() already does for just the single nearest
// one. Coalition shown as FRIENDLY/ENEMY/NEUTRAL from the same
// data.myCoalition comparison the map's own airbase coloring uses
// (airbaseColor()), not a new classification.
function renderAirfieldsList(own, airbases, myCoalition) {
  const withDistance = (airbases || [])
    .filter((ab) => ab.lat != null)
    .map((ab) => {
      const { bearingDeg, distanceNm } = bearingDistanceBetween(own.lat, own.lon, ab.lat, ab.lon);
      let side = "UNKNOWN";
      if (myCoalition != null && ab.coalition != null) side = ab.coalition === myCoalition ? "FRIENDLY" : "ENEMY";
      return { name: ab.name || "Airbase", category: ab.category, side, bearingDeg, distanceNm };
    })
    .sort((a, b) => a.distanceNm - b.distanceNm);
  if (!withDistance.length) {
    opsAirfieldsList.innerHTML = `<div class="ops-empty-note">No airbase data.</div>`;
    return;
  }
  opsAirfieldsList.innerHTML = withDistance
    .map((ab) => {
      const categoryTag = ab.category && ab.category !== "airdrome" ? ` (${ab.category.toUpperCase()})` : "";
      return `<div class="ops-readout-row"><span class="ops-readout-label">${escapeHtml(ab.name)}${categoryTag} — ${ab.side}</span><span class="ops-readout-value mono">${formatBearingRange(ab.bearingDeg, ab.distanceNm)}</span></div>`;
    })
    .join("");
}

function updateOpsSituationalAwareness(snapshot) {
  const available = snapshot && snapshot.available;
  // See MapDataStore.get() in dcs_map_data.py / MAP_HOOK_VERSION in
  // dcs_mission_hook.lua - the deployed mission hook predates a field
  // something here depends on (categoryDetail, myCoalition, fuel,
  // loadout, airbase category, ...), most likely because it's a manual
  // copy that hasn't been redone since a MachLink update. Meaningful any
  // time a snapshot exists at all, not just once your own position is
  // known - and independent of staleness below, since hookVersion doesn't
  // change just because DCS stopped writing fresh ticks.
  opsHookOutdatedWarning.hidden = !(available && snapshot.hook_outdated);
  // dcs_map_data.py flags a snapshot "stale" once 5s pass with no fresh
  // write from DCS - this was never actually being checked here, so
  // exiting the aircraft (or closing DCS entirely) left every one of
  // these readouts frozen at their last real value, looking exactly like
  // live data (a real bug found live: fuel/heading still showing after
  // leaving the aircraft). Treated the same as no data at all.
  const fresh = available && !snapshot.stale;
  const data = fresh ? (snapshot.data || {}) : null;
  const own = data && data.own && data.own.lat != null ? data.own : null;

  // The map snapshot's own own/lat is a more reliable "are we actually in
  // a controlled unit" signal than the separate Export-hook telemetry
  // pipeline (dcs_flight_tracker.py) that feeds the rest of this strip -
  // one gate for the whole thing, from one source.
  opsFlightStatus.hidden = !own;

  if (!own) {
    opsThreatAlert.hidden = true;
    opsBullseyeCall.textContent = "—";
    opsNearestAirbase.textContent = "—";
    opsContactSummary.textContent = "—";
    opsNearestSupport.textContent = "—";
    opsFuelValue.textContent = "—";
    opsHeadingValue.textContent = "—";
    renderLoadout(null);
    renderThreatsList([]);
    opsAirfieldsList.innerHTML = "";
    return;
  }

  if (own.fuel != null) setDialValue(opsFuelValue, Math.round(own.fuel * 100), "%");
  else opsFuelValue.textContent = "—";
  if (own.heading != null) setDialValue(opsHeadingValue, String(Math.round(own.heading) % 360).padStart(3, "0"), "°");
  else opsHeadingValue.textContent = "—";
  renderLoadout(own.loadout);

  const threats = findSamThreats(own, data.detected);
  opsThreatAlert.hidden = threats.length === 0;
  if (threats.length) {
    opsThreatText.textContent = threats
      .map((t) => `${t.type} — ${t.distanceNm < 10 ? t.distanceNm.toFixed(1) : Math.round(t.distanceNm)} NM`)
      .join(", ");
  }
  renderThreatsList(threats);

  if (data.bullseye && data.bullseye.lat != null) {
    const { bearingDeg, distanceNm } = bearingDistanceBetween(data.bullseye.lat, data.bullseye.lon, own.lat, own.lon);
    opsBullseyeCall.textContent = formatBearingRange(bearingDeg, distanceNm);
  } else {
    opsBullseyeCall.textContent = "NO BULLSEYE";
  }

  // Three distinct "nothing to show" reasons, not one generic blank -
  // each points at a different actual cause instead of leaving you to
  // guess whether it's the hook, the mission, or a real absence of data.
  const nearest = findNearestFriendlyAirbase(own, data.airbases, data.myCoalition, own.category);
  let nearestText = "—";
  if (nearest) {
    const categoryTag = nearest.category && nearest.category !== "airdrome" ? ` (${nearest.category.toUpperCase()})` : "";
    nearestText = `${nearest.name}${categoryTag} ${formatBearingRange(nearest.bearingDeg, nearest.distanceNm)}`;
  } else if (data.myCoalition == null) {
    nearestText = "UNAVAILABLE"; // see the hook_outdated warning above
  } else if (!(data.airbases || []).length) {
    nearestText = "NO AIRBASE DATA"; // world.getAirbases() returned nothing at all
  } else {
    nearestText = "NONE OWNED BY YOUR SIDE"; // airbases exist, just not yours in this mission
  }
  opsNearestAirbase.textContent = nearestText;

  opsContactSummary.textContent = summarizeContacts(data.detected) || "NONE DETECTED";

  const support = findNearestSupport(own, data.friendlies);
  opsNearestSupport.textContent = support
    ? `${support.type || "Support"} ${formatBearingRange(support.bearingDeg, support.distanceNm)}`
    : "NONE FOUND";

  renderAirfieldsList(own, data.airbases, data.myCoalition);
}

mapRecenterBtn.addEventListener("click", () => {
  hasCenteredOnce = false;
  pollMapData();
});
mapKeyToggle.addEventListener("click", () => {
  mapLegend.hidden = !mapLegend.hidden;
  mapKeyToggle.classList.toggle("active", !mapLegend.hidden);
});

let lastBriefingSeq = null;

async function pollDcsBriefing() {
  try {
    const res = await fetch("/api/dcs_briefing");
    const data = await res.json();
    // Quick Mission Builder reuses the same tempMission.miz path for every
    // mission, so the server tracks a plain incrementing "seq" instead of
    // relying on the mission file path to tell two missions apart - only
    // re-render (and reset scroll position) when it's actually moved on.
    if (data.seq === lastBriefingSeq) return;
    lastBriefingSeq = data.seq;
    renderDcsBriefing(data);
  } catch (e) {
    // Transient - leave whatever was last shown rather than flash an error
    // on every missed 3s poll.
  }
}

function renderDcsBriefing(data) {
  if (!data.available) {
    dcsBriefingContent.innerHTML = `<div class="placeholder-warning">No mission briefing detected yet — load into a mission in DCS.</div>`;
    return;
  }
  let html = `<h3 class="checklist-title">${escapeHtml(data.sortie || "Untitled sortie")}</h3>`;
  const startTime = data.start_time_of_day ? `Mission start ${data.start_time_of_day} local` : null;
  const meta = [data.theatre, data.date, startTime].filter(Boolean).join(" — ");
  if (meta) html += `<div class="checklist-subnote mono">${escapeHtml(meta)}</div>`;
  if (data.overview) {
    html += `<div class="checklist-item plain"><span class="step-text">${escapeHtml(data.overview)}</span></div>`;
  }
  if (data.blue_task) {
    html += `<h3 class="checklist-title" style="margin-top:14px;">Blue Task</h3>
      <div class="checklist-item plain"><span class="step-text">${escapeHtml(data.blue_task)}</span></div>`;
  }
  if (data.red_task) {
    html += `<h3 class="checklist-title" style="margin-top:14px;">Red Task</h3>
      <div class="checklist-item plain"><span class="step-text">${escapeHtml(data.red_task)}</span></div>`;
  }
  if (!data.overview && !data.blue_task && !data.red_task) {
    html += `<div class="checklist-subnote">This mission doesn't have any briefing text authored.</div>`;
  }
  if (data.weather) html += renderWeather(data.weather);
  dcsBriefingContent.innerHTML = html;
}

// Real weather straight from the mission file - exists for every mission
// regardless of whether any Situation/Task text was authored, so it's
// shown even when the sections above are empty.
function renderWeather(w) {
  const wind = (kt, dir) => (kt == null || dir == null) ? "?" : `${dir}° at ${kt} kt`;
  return `
    <h3 class="checklist-title" style="margin-top:14px;">Weather${w.preset_name ? " — " + escapeHtml(w.preset_name) : ""}</h3>
    <div class="data-grid mono">
      <div class="data-cell">
        <div class="data-label">Temperature</div>
        <div class="data-value">${w.temperature_f ?? "?"}°F / ${w.temperature_c ?? "?"}°C</div>
      </div>
      <div class="data-cell">
        <div class="data-label">QNH</div>
        <div class="data-value">${w.qnh_inhg ?? "?"} inHg</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Wind (ground)</div>
        <div class="data-value">${wind(w.wind_ground_kt, w.wind_ground_dir_deg)}</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Wind (2000m)</div>
        <div class="data-value">${wind(w.wind_high_kt, w.wind_high_dir_deg)}</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Clouds</div>
        <div class="data-value">${escapeHtml(w.cloud_coverage || "?")} ${w.cloud_base_ft ?? "?"} ft</div>
      </div>
      <div class="data-cell">
        <div class="data-label">Visibility</div>
        <div class="data-value">${w.visibility_nm ?? "?"} nm</div>
      </div>
    </div>`;
}

// -----------------------------------------------------------------------
// KNEEBOARD - a physical accessory, so it lives as an edge tab + slide-out
// drawer (see the CSS block) rather than another OSB tab. Combines the
// aircraft's real static reference pages (when the module ships them as
// plain images - not every one does, see dcs_kneeboard.py) with whatever
// custom pages the currently-loaded mission bundles into one flip-through
// sequence, each page labeled by where it actually came from.
let kneeboardPages = [];
let kneeboardIndex = 0;

// Labeled by exactly which of the four real sources each page comes from
// (see dcs_kneeboard.py) - general aircraft/terrain reference first, then
// this specific mission's own pages, then whatever the pilot personally
// added.
const KNEEBOARD_SOURCE_LABELS = {
  aircraft: "Aircraft Reference",
  terrain: "Terrain Chart",
  mission: "Mission Briefing",
  user: "My Kneeboard",
};

async function loadKneeboard() {
  try {
    const res = await fetch("/api/kneeboard");
    const data = await res.json();
    const pages = [
      ...(data.aircraft_pages || []).map((p) => ({ source: "aircraft", index: p.index, label: p.label })),
      ...(data.terrain_pages || []).map((p) => ({ source: "terrain", index: p.index, label: p.label })),
      ...(data.mission_pages || []).map((p) => ({ source: "mission", index: p.index, label: p.label })),
      ...(data.user_pages || []).map((p) => ({ source: "user", index: p.index, label: p.label })),
    ];
    const changed = JSON.stringify(pages) !== JSON.stringify(kneeboardPages);
    kneeboardPages = pages;
    kneeboardNavBtn.hidden = pages.length === 0;
    if (pages.length === 0 && !primarySections.kneeboard.hidden) switchPrimarySection("ops");
    if (changed) {
      kneeboardIndex = 0;
      if (!primarySections.kneeboard.hidden) renderKneeboardPage();
    }
  } catch (e) {
    kneeboardNavBtn.hidden = true;
  }
}

function renderKneeboardPage() {
  if (!kneeboardPages.length) return;
  const p = kneeboardPages[kneeboardIndex];
  const sourceLabel = KNEEBOARD_SOURCE_LABELS[p.source] || p.source;
  kneeboardPageLabel.textContent = `${sourceLabel} — ${p.label}`;
  kneeboardImage.src = `/api/kneeboard/${p.source}/${p.index}`;
  kneeboardPageInput.value = kneeboardIndex + 1;
  kneeboardPageInput.max = kneeboardPages.length;
  kneeboardTotal.textContent = kneeboardPages.length;
  // Wrapping through a carousel of one page doesn't mean anything.
  kneeboardPrev.disabled = kneeboardNext.disabled = kneeboardPages.length <= 1;
}

// 100% always means "the whole page fits in the drawer, no scrolling" -
// computed from the image's real dimensions and the available space
// (see updateKneeboardImageFit), not a fixed percentage of the drawer
// width. A dense chart is a tall portrait image in a wide drawer, so a
// plain width-based zoom (like the device-diagram modal's) changes a
// dimension that's already scrolled out of view and looks like it does
// nothing - this scales relative to the "whole page visible" size instead,
// so every step is a real, visible change.
const KNEEBOARD_ZOOM_MIN = 100;
const KNEEBOARD_ZOOM_MAX = 300;
const KNEEBOARD_ZOOM_STEP = 25;
let kneeboardZoom = 100;

function updateKneeboardImageFit() {
  const nw = kneeboardImage.naturalWidth;
  const nh = kneeboardImage.naturalHeight;
  if (!nw || !nh) return; // image hasn't loaded yet - the "load" listener below re-runs this
  const availW = kneeboardPageArea.clientWidth - 28; // minus the area's own 14px*2 padding
  const availH = kneeboardPageArea.clientHeight - 28;
  if (availW <= 0 || availH <= 0) return;
  const fitScale = Math.min(availW / nw, availH / nh, 1);
  const scale = fitScale * (kneeboardZoom / 100);
  kneeboardImage.style.width = `${Math.round(nw * scale)}px`;
  kneeboardImage.style.height = `${Math.round(nh * scale)}px`;
}

function setKneeboardZoom(level) {
  kneeboardZoom = Math.max(KNEEBOARD_ZOOM_MIN, Math.min(KNEEBOARD_ZOOM_MAX, level));
  kneeboardZoomReset.textContent = `${kneeboardZoom}%`;
  kneeboardImage.classList.toggle("zoomed", kneeboardZoom !== 100);
  updateKneeboardImageFit();
}

kneeboardImage.addEventListener("load", updateKneeboardImageFit);
window.addEventListener("resize", () => {
  if (!primarySections.kneeboard.hidden) updateKneeboardImageFit();
});

kneeboardZoomOut.addEventListener("click", () => setKneeboardZoom(kneeboardZoom - KNEEBOARD_ZOOM_STEP));
kneeboardZoomIn.addEventListener("click", () => setKneeboardZoom(kneeboardZoom + KNEEBOARD_ZOOM_STEP));
kneeboardZoomReset.addEventListener("click", () => setKneeboardZoom(100));
kneeboardImage.addEventListener("click", () => setKneeboardZoom(kneeboardZoom === 100 ? 200 : 100));

// A carousel, not a dead end at either edge - PREV from page 1 wraps to
// the last page and vice versa, so flipping through never just stops.
kneeboardPrev.addEventListener("click", () => {
  kneeboardIndex = (kneeboardIndex - 1 + kneeboardPages.length) % kneeboardPages.length;
  renderKneeboardPage();
});
kneeboardNext.addEventListener("click", () => {
  kneeboardIndex = (kneeboardIndex + 1) % kneeboardPages.length;
  renderKneeboardPage();
});
function goToKneeboardPage() {
  const n = parseInt(kneeboardPageInput.value, 10);
  if (Number.isFinite(n)) {
    kneeboardIndex = Math.max(0, Math.min(kneeboardPages.length - 1, n - 1));
  }
  renderKneeboardPage();
}
kneeboardPageInput.addEventListener("change", goToKneeboardPage);
kneeboardPageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") goToKneeboardPage();
});
// No Escape-to-close anymore - Kneeboard is a normal nav section now, not
// an overlay/drawer with something to close back out of. Arrow-key page
// nav still works while it's the active section.
document.addEventListener("keydown", (e) => {
  if (primarySections.kneeboard.hidden) return;
  if (e.key === "ArrowLeft" && document.activeElement !== kneeboardPageInput) kneeboardPrev.click();
  else if (e.key === "ArrowRight" && document.activeElement !== kneeboardPageInput) kneeboardNext.click();
});

// Extra context on hover only - keeps the bar itself glanceable while still
// surfacing real signals (MSFS connection errors, a DCS Export.lua repair)
// that don't need their own permanent screen real estate.
function statusTooltip(data) {
  const lines = [];
  if (data.game === "msfs" && data.msfs_connection && !data.msfs_connection.available) {
    lines.push(`MSFS SimConnect: ${data.msfs_connection.error || "not connected"}`);
  }
  if (data.dcs_hook && data.dcs_hook.status && data.dcs_hook.status !== "ok") {
    lines.push(`DCS export hook: ${data.dcs_hook.status}${data.dcs_hook.detail ? " - " + data.dcs_hook.detail : ""}`);
  }
  return lines.join("\n");
}

async function loadChecklist() {
  sections = [];
  activeSectionId = null;
  mfdTabs.innerHTML = "";
  citationLine.hidden = true;
  lastChecklistData = null;
  tabContent.innerHTML = "Loading...";
  clearAskBarResult(); // a search result from the previous aircraft is no longer relevant
  try {
    const res = await fetch("/api/checklist");
    if (!res.ok) {
      const err = await res.json();
      renderMissingDataState(err.error || "No data available.");
      return;
    }
    lastChecklistData = await res.json();
    buildSections(lastChecklistData);
    await renderCurrentChecklist();
  } catch (e) {
    renderMissingDataState("Error loading checklist.");
  }
}

function renderMissingDataState(message) {
  sections = [];
  activeSectionId = null;
  renderTabButtons();
  tabContent.innerHTML = `
    <div class="warning-overlay">
      <h3>⚠ Profile Empty</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

// One OSB tab per top-level content group the loaded aircraft actually has
// data for - an MSFS civilian plane with zero weapons simply never gets a
// [WEAPONS] button, rather than showing an empty tab.
function buildSections(data) {
  sections = [];
  if (Object.keys(data.checklists || {}).length) sections.push({ id: "checklists", label: "Checklists" });
  if ((data.weapons || []).length) sections.push({ id: "weapons", label: "Weapons" });
  if ((data.ordnance_jettison || []).length) sections.push({ id: "jettison", label: "Jettison" });
  if ((data.flight_planning_notes || []).length || (data.systems_notes || []).length) {
    sections.push({ id: "notes", label: "Flt Notes" });
  }

  // Keep the same tab active across a binding-toggle/cockpit-config
  // re-render; only reset to the first tab when it's genuinely a new
  // aircraft (the previous active section no longer exists).
  if (!sections.find((s) => s.id === activeSectionId)) {
    activeSectionId = sections[0]?.id || null;
  }
  renderTabButtons();
}

// (Re)draws the OSB tab row from the current `sections` list, marking
// whichever matches activeSectionId - shared by every place that touches
// the tab row so the "which button looks pressed" logic lives in one spot,
// not scattered across the data-loaded/no-data paths separately.
function renderTabButtons() {
  mfdTabs.innerHTML = sections
    .map((s) => `<button type="button" class="mfd-btn${s.id === activeSectionId ? " active" : ""}" data-section="${s.id}">[${escapeHtml(s.label)}]</button>`)
    .join("");
  mfdTabs.querySelectorAll(".mfd-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
  });
}

async function switchSection(id) {
  activeSectionId = id;
  mfdTabs.querySelectorAll(".mfd-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === id);
  });
  await renderCurrentChecklist();
}

// Re-renders whatever checklist is already loaded, re-fetching binding
// resolutions only when the toggle is on - lets flipping the toggle react
// instantly without re-fetching the whole checklist from the server.
async function renderCurrentChecklist() {
  if (!lastChecklistData) return;

  let bindings = null;
  if (bindingToggle.checked) {
    try {
      const res = await fetch("/api/bindings");
      const data = await res.json();
      bindings = data.available ? data.bindings : null;
    } catch (e) {
      bindings = null;
    }
  }

  renderChecklist(lastChecklistData, bindings);
}

// A single resolved binding_key's inline pill badge - "" if bindings are
// off or nothing resolved for this key.
function renderBindingTag(bindingKey, bindings) {
  const b = bindings?.[bindingKey];
  if (!b) return "";
  if (b.state === "bound") {
    const label = b.matches.map((m) => `${m.identifier}, ${m.device_name}`).join(" / ");
    return ` <span class="hotas-badge bound has-diagram mono" data-binding-key="${escapeHtml(bindingKey)}" title="Click to see it on the device">${escapeHtml(label)} 📷</span>`;
  }
  if (b.state === "not_in_config") {
    const devices = [...new Set(b.matches.map((m) => m.device_name))].join(" / ");
    return ` <span class="hotas-badge not-in-config has-diagram mono" data-binding-key="${escapeHtml(bindingKey)}" title="Click to see it on the device">bound to ${escapeHtml(devices)} - not in current config 📷</span>`;
  }
  return ` <span class="hotas-badge unbound mono">not mapped</span>`;
}

// A step's binding_key is usually a single string, but can be a list when
// one line legitimately names more than one physical control (common on
// the A-10's more condensed switchology lines, e.g. "Boat Switch...China
// Hat...TMS FWD SHORT..." all in one sentence) - renders one tag per key.
function renderBindingTags(bindingKey, bindings) {
  if (!bindingKey) return "";
  const keys = Array.isArray(bindingKey) ? bindingKey : [bindingKey];
  return keys.map((k) => renderBindingTag(k, bindings)).join("");
}

// Persisted per-aircraft/section/step so a checked-off startup checklist
// stays checked across tab switches and reloads - client-side only, never
// sent to the server.
function checkKey(sectionKey, idx) {
  return `ml_check::${lastAircraft || ""}::${sectionKey}::${idx}`;
}
function isChecked(sectionKey, idx) {
  try {
    return localStorage.getItem(checkKey(sectionKey, idx)) === "1";
  } catch (e) {
    return false;
  }
}
function setChecked(sectionKey, idx, value) {
  try {
    localStorage.setItem(checkKey(sectionKey, idx), value ? "1" : "0");
  } catch (e) {
    // ignore - private browsing / storage blocked
  }
}

// Renders one actionable step as a tall MFD checklist row: a large square
// checkbox (state persisted client-side, keyed by sectionKey+idx so
// separate checklist blocks don't collide), the step text in monospace,
// and any resolved HOTAS badge.
function renderStepRow(sectionKey, idx, text, bindingKey, bindings) {
  const id = `step-${escapeHtml(sectionKey)}-${idx}`;
  const checked = isChecked(sectionKey, idx) ? "checked" : "";
  const tag = renderBindingTags(bindingKey, bindings);
  return `
    <div class="checklist-item">
      <div class="checklist-left">
        <input type="checkbox" class="mfd-checkbox" id="${id}" data-section-key="${escapeHtml(sectionKey)}" data-idx="${idx}" ${checked}>
        <label class="step-text" for="${id}">${escapeHtml(text)}</label>
      </div>
      ${tag}
    </div>`;
}

tabContent.addEventListener("change", (e) => {
  const box = e.target.closest(".mfd-checkbox");
  if (!box) return;
  setChecked(box.dataset.sectionKey, Number(box.dataset.idx), box.checked);
});

function renderChecklist(data, bindings) {
  let html = "";

  if (data._notes && data._notes.includes("FAKE DEMO DATA")) {
    html += `<div class="placeholder-warning">⚠ Placeholder demo data — not real procedures. Do not use for flying.</div>`;
  }

  if (activeSectionId === "checklists") {
    let stepIdx = 0;
    for (const [key, steps] of Object.entries(data.checklists || {})) {
      html += `<div class="checklist-block"><h3 class="checklist-title">${escapeHtml(key.replace(/_/g, " "))}</h3>`;
      for (const s of steps) {
        html += renderStepRow(key, stepIdx++, s.action, s.binding_key, bindings);
      }
      html += `</div>`;
    }
  } else if (activeSectionId === "weapons") {
    for (const w of data.weapons || []) {
      html += `<div class="checklist-block" data-weapon-name="${escapeHtml(w.name)}"><h3 class="checklist-title">${escapeHtml(w.name)}</h3>`;
      if (w.employment_notes) html += `<div class="checklist-subnote">${escapeHtml(w.employment_notes)}</div>`;
      let stepIdx = 0;
      const sectionKey = `weapon:${w.name}`;
      for (const s of (w.switchology || [])) {
        // A switchology line is normally a plain string, but can also be
        // {text, binding_key} when it has a resolved physical-button annotation.
        const text = typeof s === "string" ? s : s.text;
        const bindingKey = typeof s === "string" ? null : s.binding_key;
        html += renderStepRow(sectionKey, stepIdx++, text, bindingKey, bindings);
      }
      html += `</div>`;
    }
  } else if (activeSectionId === "jettison") {
    for (const j of data.ordnance_jettison || []) {
      html += `<div class="checklist-block" data-jettison-name="${escapeHtml(j.name)}"><h3 class="checklist-title">${escapeHtml(j.name)}</h3>`;
      if (j.notes) html += `<div class="checklist-subnote">${escapeHtml(j.notes)}</div>`;
      let stepIdx = 0;
      const sectionKey = `jettison:${j.name}`;
      for (const s of (j.steps || [])) {
        const text = typeof s === "string" ? s : s.text;
        const bindingKey = typeof s === "string" ? null : s.binding_key;
        html += renderStepRow(sectionKey, stepIdx++, text, bindingKey, bindings);
      }
      html += `</div>`;
    }
  } else if (activeSectionId === "notes") {
    if ((data.flight_planning_notes || []).length) {
      html += `<div class="checklist-block"><h3 class="checklist-title">Flight planning notes</h3>`;
      for (const n of data.flight_planning_notes) {
        html += `<div class="checklist-item plain"><span class="step-text">${escapeHtml(n)}</span></div>`;
      }
      html += `</div>`;
    }
    if ((data.systems_notes || []).length) {
      html += `<div class="checklist-block"><h3 class="checklist-title">Systems notes</h3>`;
      for (const n of data.systems_notes) {
        html += `<div class="checklist-item plain" data-systems-note-topic="${escapeHtml(n.topic || "")}"><span class="step-text"><strong>${escapeHtml(n.topic || "")}:</strong> ${escapeHtml(n.notes || "")}</span></div>`;
      }
      html += `</div>`;
    }
  } else {
    html += `<div class="placeholder-warning">Nothing to show here yet.</div>`;
  }

  tabContent.innerHTML = html || `<div class="placeholder-warning">No entries in this section.</div>`;

  if (data.source?.name) {
    citationLine.textContent = `Source: ${data.source.name}${data.source.version_or_date ? " (" + data.source.version_or_date + ")" : ""}`;
    citationLine.hidden = false;
  } else {
    citationLine.hidden = true;
  }
}

// Search, not a separate Q&A panel: a match that's really part of one of
// the OSB tabs (a weapon, a jettison procedure, a systems note) jumps
// straight to that tab and highlights the real entry there, instead of
// duplicating it in a side box. Only content with no tab of its own -
// free-standing qa_snippet prose, or the AI fallback - renders here below
// the search bar, since there's nowhere else for it to go.
askForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = askInput.value.trim();
  if (!query) return;
  showAskBarResult("Searching...");
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    await handleAskResponse(data);
  } catch (err) {
    showAskBarResult(`<div class="placeholder-warning">Error reaching server.</div>`);
  }
});

function showAskBarResult(html) {
  askBarResult.innerHTML = html;
  askBarResult.hidden = false;
}

function clearAskBarResult() {
  askBarResult.innerHTML = "";
  askBarResult.hidden = true;
}

async function handleAskResponse(data) {
  if (data.source === "sourced_data" && data.matches?.length) {
    if (data.matches.length === 1) {
      if (!(await jumpToMatch(data.matches[0]))) renderInlineMatch(data.matches[0]);
      return;
    }
    // More than one equally-good match (e.g. "loal" matches two Hellfire
    // variants) - let the user pick which one before jumping to it.
    showAskBarResult(`
      <div class="ask-picker">
        <div class="ask-picker-label">Which one?</div>
        ${data.matches.map((m, i) => `<button type="button" class="ask-picker-btn" data-idx="${i}">${escapeHtml(m.name || m.topic || m.answer.slice(0, 40))}</button>`).join("")}
      </div>`);
    askBarResult.querySelectorAll(".ask-picker-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const m = data.matches[Number(btn.dataset.idx)];
        if (!(await jumpToMatch(m))) renderInlineMatch(m);
      });
    });
  } else if (data.answer) {
    showAskBarResult(`
      <div class="response-box unverified">
        <span class="response-tag">⚠ AI Generated Flight Fallback — Unverified Procedure</span>
        <div class="response-body">${escapeHtml(data.answer)}</div>
      </div>`);
  } else {
    showAskBarResult(`<div class="placeholder-warning">${escapeHtml(data.message || data.error || "No answer available.")}</div>`);
  }
}

// Which real OSB tab (and which element within it) a sourced match
// corresponds to. weapons/ordnance_jettison/systems_notes each already
// have a real section they're rendered in - only qa_snippet is
// free-standing prose with no section of its own, so it has no target.
function jumpTargetFor(match) {
  if (match.type === "weapon") return { sectionId: "weapons", selector: `[data-weapon-name="${cssEscapeAttr(match.name)}"]` };
  if (match.type === "ordnance_jettison") return { sectionId: "jettison", selector: `[data-jettison-name="${cssEscapeAttr(match.name)}"]` };
  if (match.type === "systems_note") return { sectionId: "notes", selector: `[data-systems-note-topic="${cssEscapeAttr(match.topic)}"]` };
  return null;
}

function cssEscapeAttr(value) {
  return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
}

// Switches to the match's real tab and highlights the specific entry;
// returns false (having done nothing) for a match with no tab of its own,
// so the caller falls back to rendering it inline instead.
async function jumpToMatch(match) {
  const target = jumpTargetFor(match);
  if (!target) return false;
  clearAskBarResult();
  await switchSection(target.sectionId);
  const el = tabContent.querySelector(target.selector);
  if (el) {
    // Force a reflow so the highlight animation restarts even if the same
    // entry was just jumped to a moment ago.
    el.classList.remove("search-highlight");
    void el.offsetWidth;
    el.classList.add("search-highlight");
    // Not scrollIntoView - computing the scroll position directly is fully
    // deterministic and doesn't depend on a "smooth"/animated scroll
    // actually completing before the user looks. getBoundingClientRect
    // forces the layout flush itself, and setting scrollTop is a plain
    // synchronous write, nothing left to silently not happen.
    const containerRect = tabContent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    tabContent.scrollTop += (elRect.top - containerRect.top) - (containerRect.height - elRect.height) / 2;
  }
  return true;
}

// qa_snippet - real sourced text, but not tied to any OSB section, so this
// is the "show it here instead of jumping" case.
function renderInlineMatch(match) {
  showAskBarResult(`
    <div class="response-box verified">
      <span class="response-tag">★ System Sourced Reference</span>
      <div class="response-body">${escapeHtml(match.answer)}</div>
    </div>`);
}

simbriefBtn.addEventListener("click", async () => {
  simbriefContent.innerHTML = "Fetching...";
  try {
    const res = await fetch("/api/simbrief");
    const data = await res.json();
    if (data.error) {
      simbriefContent.innerHTML = `<div class="placeholder-warning">${escapeHtml(data.error)}</div>`;
      return;
    }
    // SIMBRIEF header pill - real signal, set only once a pull has
    // actually populated real OFP data (not just "the panel exists").
    simbriefStatusValue.textContent = "LOADED";
    simbriefStatusValue.className = "status-block dcs mono";
    const route = `${data.origin || "?"} → ${data.destination || "?"}${data.alternate ? " (alt " + data.alternate + ")" : ""}`;
    simbriefContent.innerHTML = `
      <div class="data-grid mono">
        <div class="data-cell">
          <div class="data-label">Callsign</div>
          <div class="data-value">${escapeHtml(data.callsign || "?")}</div>
        </div>
        <div class="data-cell">
          <div class="data-label">Aircraft</div>
          <div class="data-value">${escapeHtml(data.aircraft || "?")}</div>
        </div>
        <div class="data-cell span-2">
          <div class="data-label">Route</div>
          <div class="data-value">${escapeHtml(route)}</div>
        </div>
        <div class="data-cell span-2">
          <div class="data-label">Route string</div>
          <div class="data-value">${escapeHtml(data.route || "?")}</div>
        </div>
        <div class="data-cell">
          <div class="data-label">Cruise Alt</div>
          <div class="data-value">${escapeHtml(String(data.cruise_altitude_ft || "?"))} ft</div>
        </div>
        <div class="data-cell">
          <div class="data-label">Block Fuel</div>
          <div class="data-value">${escapeHtml(String(data.block_fuel_lbs || "?"))} lbs</div>
        </div>
      </div>`;
  } catch (e) {
    simbriefContent.innerHTML = `<div class="placeholder-warning">Error reaching server.</div>`;
  }
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

pollStatus();
setInterval(pollStatus, 3000);

// The map lives permanently in Ops's #ops-map-home - no expand/full-screen
// mode, just one map, one home - so it's built up front instead of
// waiting for a click, since Ops is the default landing tab.
ensureLeafletMap();
buildMapLegend();

// Always-on, regardless of which primary tab is active.
// See the comment on pollMapData() itself.
pollMapData();
setInterval(pollMapData, 1000);
