-- === MACHLINK_HOOK v1 START ===
-- MachLink DCS export hook.
-- Append this to the END of your Export.lua, found in:
--   Saved Games\DCS\Scripts\Export.lua   (or DCS.openbeta for the beta branch)
-- If Export.lua doesn't exist yet, just create it with this content.
--
-- This does NOT modify DCS gameplay in any way (not a scripted-input mod,
-- not touching flight model or sim internals) - it only reads the mission
-- environment (which module you're in, real height-above-ground and
-- velocity from DCS's own documented Export API) and sends that over
-- localhost UDP to the MachLink app running on your own machine. Nothing
-- leaves your PC.
--
-- This block is auto-managed by MachLink: every time the app starts
-- (and periodically while it runs), it checks Export.lua for the
-- MACHLINK_HOOK markers below and re-adds this block if some other
-- tool (e.g. a HOTAS/panel configurator like SimApp Pro) has overwritten
-- Export.lua without it. Safe to delete the whole block - it'll come back
-- on its own; edit integrations/dcs_export_hook.lua instead if you want to
-- change what it does.

local MachLink = {}
MachLink.socket = require("socket")
MachLink.udp = MachLink.socket.udp()
MachLink.port = 39234 -- must match dcs.udp_listen_port in config.yaml
MachLink.lastAircraft = nil
MachLink.lastSentModelTime = 0
-- LuaExportActivityNextEvent fires far more often than the ~5s interval it
-- requests back (confirmed against a real session: 30+ times/sec) - this
-- gates how often flight-state telemetry (height/velocity, for the
-- Debrief feature's landed-and-stopped detection) actually gets sent, so
-- a whole flight doesn't mean 30+ UDP packets/sec to localhost. Aircraft-
-- change announcements below are NOT gated by this - those always fire
-- immediately, same as before this feature existed.
MachLink.telemetryIntervalSeconds = 2.0

local function ml_send(aircraftName, agl, vel, vy)
    local ok, err = pcall(function()
        local msg = '{"game":"dcs","aircraft":"' .. tostring(aircraftName) .. '"'
        if agl ~= nil then msg = msg .. ',"agl":' .. tostring(agl) end
        if vel ~= nil then msg = msg .. ',"vel":' .. tostring(vel) end
        if vy ~= nil then msg = msg .. ',"vy":' .. tostring(vy) end
        msg = msg .. '}'
        MachLink.udp:sendto(msg, "127.0.0.1", MachLink.port)
    end)
end

-- Real height-above-ground and world-frame speed for the Debrief feature's
-- landed-and-stopped detection - both confirmed against a real live
-- session (a parked AH-64D: AGL settles at ~2.3m - the aircraft's own
-- reference-point height off the ground, not 0 - and velocity settles to
-- ~0 m/s at rest). Real, documented DCS Export API functions (see
-- Scripts/Export.lua in the DCS install) - not an invented signal.
-- vy is the vertical component of the velocity vector (added for the
-- landing-rate/fpm score) - its sign convention (which direction is
-- "descending") isn't empirically confirmed yet, so the Python side takes
-- its absolute value rather than assuming a sign.
local function ml_flight_state()
    local ok1, agl = pcall(LoGetAltitudeAboveGroundLevel)
    local ok2, vel = pcall(LoGetVectorVelocity)
    local velMag, vy = nil, nil
    if ok2 and vel then
        velMag = math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)
        vy = vel.y
    end
    return (ok1 and agl or nil), velMag, vy
end

local ml_prev_LuaExportStart = LuaExportStart
LuaExportStart = function()
    if ml_prev_LuaExportStart then ml_prev_LuaExportStart() end
    local ok, selfData = pcall(LoGetSelfData)
    if ok and selfData and selfData.Name then
        MachLink.lastAircraft = selfData.Name
        local agl, vel, vy = ml_flight_state()
        ml_send(selfData.Name, agl, vel, vy)
        local okTime, t = pcall(LoGetModelTime)
        MachLink.lastSentModelTime = (okTime and t) or 0
    end
end

local ml_prev_LuaExportActivityNextEvent = LuaExportActivityNextEvent
LuaExportActivityNextEvent = function(t)
    local ok, selfData = pcall(LoGetSelfData)
    if ok and selfData and selfData.Name then
        local nameChanged = selfData.Name ~= MachLink.lastAircraft
        local okTime, modelTime = pcall(LoGetModelTime)
        modelTime = okTime and modelTime or 0
        local dueForTelemetry = (modelTime - MachLink.lastSentModelTime) >= MachLink.telemetryIntervalSeconds

        if nameChanged or dueForTelemetry then
            MachLink.lastAircraft = selfData.Name
            local agl, vel, vy = ml_flight_state()
            ml_send(selfData.Name, agl, vel, vy)
            MachLink.lastSentModelTime = modelTime
        end
    end
    if ml_prev_LuaExportActivityNextEvent then
        return ml_prev_LuaExportActivityNextEvent(t)
    end
    return t + 5.0
end
-- === MACHLINK_HOOK v1 END ===
