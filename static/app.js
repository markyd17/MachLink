const statusBar = document.getElementById("status-bar");
const mfdTabs = document.getElementById("mfd-tabs");
const tabContent = document.getElementById("tab-content");
const citationLine = document.getElementById("citation-line");
const bindingToggle = document.getElementById("binding-toggle");
const cockpitConfigSelect = document.getElementById("cockpit-config-select");
const askForm = document.getElementById("ask-form");
const askInput = document.getElementById("ask-input");
const askBarResult = document.getElementById("ask-bar-result");
const simbriefPanel = document.getElementById("simbrief-panel");
const simbriefBtn = document.getElementById("simbrief-refresh");
const simbriefContent = document.getElementById("simbrief-content");
const dcsBriefingPanel = document.getElementById("dcs-briefing-panel");
const dcsBriefingContent = document.getElementById("dcs-briefing-content");
const debriefBtn = document.getElementById("debrief-btn");
const debriefOverlay = document.getElementById("debrief-overlay");
const debriefClose = document.getElementById("debrief-close");
const debriefBody = document.getElementById("debrief-body");
const kneeboardTab = document.getElementById("kneeboard-tab");
const kneeboardDrawer = document.getElementById("kneeboard-drawer");
const kneeboardClose = document.getElementById("kneeboard-close");
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

async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();

    if (data.aircraft && data.aircraft_data_loaded) {
      statusBar.textContent = `[ ${(data.game || "?").toUpperCase()} // ${data.aircraft.toUpperCase()} // ARMED ]`;
      statusBar.className = "status-block mono";
    } else if (data.aircraft) {
      statusBar.textContent = "[ NO AIRFRAME DATA ]";
      statusBar.className = "status-block alarm mono";
    } else {
      statusBar.textContent = "[ NO SIM DETECTED ]";
      statusBar.className = "status-block idle mono";
    }
    statusBar.title = statusTooltip(data);

    if (data.aircraft !== lastAircraft) {
      lastAircraft = data.aircraft;
      loadChecklist();
    }

    // SimBrief has no DCS-mission equivalent - a real DCS mission already
    // carries its own authored briefing, so that's what fills this slot
    // instead when the detected sim is DCS. Neither shows if nothing's
    // detected yet.
    simbriefPanel.hidden = data.game !== "msfs";
    dcsBriefingPanel.hidden = data.game !== "dcs";
    if (data.game === "dcs") {
      pollDcsBriefing();
      loadKneeboard();
      pollDebriefStatus();
    } else {
      kneeboardTab.hidden = true;
      kneeboardDrawer.hidden = true;
    }
  } catch (e) {
    statusBar.textContent = "[ CANNOT REACH MACHLINK SERVER ]";
    statusBar.className = "status-block alarm mono";
  }
}

// Lights up (see .debrief-btn.ready) once dcs_flight_tracker.py detects a
// real flight that landed, stopped, and flew more than 5 minutes - polled
// alongside everything else DCS-specific rather than its own interval.
async function pollDebriefStatus() {
  try {
    const res = await fetch("/api/debrief_status");
    const data = await res.json();
    debriefBtn.classList.toggle("ready", data.ready);
    debriefBtn.disabled = !data.ready;
  } catch (e) {
    // Transient - leave the button in whatever state it was already in.
  }
}

debriefBtn.addEventListener("click", async () => {
  if (debriefBtn.disabled) return;
  try {
    const res = await fetch("/api/debrief/latest");
    const data = await res.json();
    if (!data.available) return; // shouldn't happen while lit, but don't show an empty overlay if it does
    renderDebrief(data);
    debriefOverlay.hidden = false;
    debriefBtn.classList.remove("ready");
    debriefBtn.disabled = true;
  } catch (e) {
    // leave the button as-is - they can just click it again
  }
});

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

function renderDebrief(d) {
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

  debriefBody.innerHTML = `
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !debriefOverlay.hidden) debriefOverlay.hidden = true;
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
  const meta = [data.theatre, data.date].filter(Boolean).join(" — ");
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
    kneeboardTab.hidden = pages.length === 0;
    if (pages.length === 0) kneeboardDrawer.hidden = true;
    if (changed) {
      kneeboardIndex = 0;
      if (!kneeboardDrawer.hidden) renderKneeboardPage();
    }
  } catch (e) {
    kneeboardTab.hidden = true;
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
  if (!kneeboardDrawer.hidden) updateKneeboardImageFit();
});

kneeboardZoomOut.addEventListener("click", () => setKneeboardZoom(kneeboardZoom - KNEEBOARD_ZOOM_STEP));
kneeboardZoomIn.addEventListener("click", () => setKneeboardZoom(kneeboardZoom + KNEEBOARD_ZOOM_STEP));
kneeboardZoomReset.addEventListener("click", () => setKneeboardZoom(100));
kneeboardImage.addEventListener("click", () => setKneeboardZoom(kneeboardZoom === 100 ? 200 : 100));

kneeboardTab.addEventListener("click", () => {
  kneeboardDrawer.hidden = false;
  setKneeboardZoom(100);
  renderKneeboardPage();
});
kneeboardClose.addEventListener("click", () => {
  kneeboardDrawer.hidden = true;
});
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
document.addEventListener("keydown", (e) => {
  if (kneeboardDrawer.hidden) return;
  if (e.key === "Escape") kneeboardDrawer.hidden = true;
  else if (e.key === "ArrowLeft" && document.activeElement !== kneeboardPageInput) kneeboardPrev.click();
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
