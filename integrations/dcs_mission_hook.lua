-- MACHLINK_MISSION_HOOK
--
-- Phase 2 of the Debrief feature: runs in DCS's Mission Scripting
-- environment (not the Export environment dcs_export_hook.lua uses), which
-- is the only place world.addEventHandler() and combat events exist. Loaded
-- automatically for every mission via a small addition to the DCS install's
-- Scripts/MissionScripting.lua - see dcs_mission_hook_guard.py for how that
-- gets installed/verified.
--
-- Reports events by APPENDING JSON LINES to a plain file (Saved
-- Games\DCS\Scripts\MachLinkCombatEvents.jsonl, next to this script),
-- which app.py's dcs_combat_events.py tails - NOT a UDP socket like
-- Export.lua's hook uses. Confirmed empirically (dcs.log: "load error
-- Scripts/MissionScripting.lua: error loading module 'socket'") that
-- require("socket") does not work inside DCS's Mission Scripting
-- environment even with the sandbox loosened - only Export.lua's separate
-- environment supports it. io.open/write/close are plain built-in Lua,
-- not a loadable C module, so they aren't affected by that limitation -
-- this is the same file-based workaround DCS mission-scripting frameworks
-- generally use to get data out of this specific environment.
--
-- Reports only things concerning the PLAYER'S OWN unit(s) - never AI-vs-AI
-- kills - since that's all the Debrief feature needs:
--   "birth"  - a player took control of a new unit (mission start, or a
--              respawn - even into the same airframe type, this always
--              means a genuinely new life, unlike Export.lua's aircraft-
--              name comparison which can't tell a fast respawn from a
--              continued flight)
--   "hit"    - a player's unit took a hit; recorded internally (not sent)
--              so a subsequent death/crash can report who/what did it
--   "dead"   - a player's unit was destroyed by a weapon
--   "crash"  - a player's unit crashed (terrain/water impact, no weapon)
--   "ejected" - the pilot ejected
--
-- Every DCS API call is wrapped in pcall - a single bad/missing field must
-- never take down the whole event handler for the rest of the mission.

local MachLinkMission = {}
MachLinkMission.eventsPath = lfs.writedir() .. [[Scripts\MachLinkCombatEvents.jsonl]]
MachLinkMission.lastHit = {}  -- unitId -> {shooterName, shooterRelation, shooterCategory, weaponType}

local function safe_call(obj, method, ...)
	if not obj then return nil end
	local ok, result = pcall(obj[method], obj, ...)
	if ok then return result end
	return nil
end

local function json_escape(s)
	s = tostring(s)
	return (s:gsub('[\\"]', '\\%0'))
end

-- fields: ordered list of {key, value} pairs. nil values are omitted so the
-- Python side can use straightforward .get(key) with no special-casing.
local function build_json(fields)
	local parts = {}
	for _, kv in ipairs(fields) do
		local k, v = kv[1], kv[2]
		if v ~= nil then
			if type(v) == "string" then
				parts[#parts + 1] = '"' .. k .. '":"' .. json_escape(v) .. '"'
			else
				parts[#parts + 1] = '"' .. k .. '":' .. tostring(v)
			end
		end
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

local function ml_send(fields)
	pcall(function()
		local f = io.open(MachLinkMission.eventsPath, "a")
		if f then
			f:write(build_json(fields), "\n")
			f:close()
		end
	end)
end

local function category_label(unit)
	local desc = safe_call(unit, "getDesc")
	if not desc then return nil end
	local cat = desc.category
	if cat == Unit.Category.AIRPLANE then return "airplane" end
	if cat == Unit.Category.HELICOPTER then return "helicopter" end
	if cat == Unit.Category.GROUND_UNIT then return "ground_unit" end
	if cat == Unit.Category.SHIP then return "ship" end
	return "other"
end

local function is_player_unit(unit)
	return safe_call(unit, "getPlayerName") ~= nil
end

local eventHandler = {}

function eventHandler:onEvent(event)
	local ok, err = pcall(function()
		if event.id == world.event.S_EVENT_HIT then
			self:onHit(event)
		elseif event.id == world.event.S_EVENT_DEAD then
			self:onLoss(event, "dead")
		elseif event.id == world.event.S_EVENT_CRASH then
			self:onLoss(event, "crash")
		elseif event.id == world.event.S_EVENT_EJECTION then
			-- Fires while the pilot is still aboard (about to eject), so
			-- is_player_unit() below is reliable here - unlike the
			-- eventual DEAD/CRASH of the abandoned airframe afterward,
			-- which may or may not still report a player name once
			-- empty (untested - this is why ejection gets captured as
			-- its own definitive end-of-flight signal rather than
			-- relying on that later event).
			self:onLoss(event, "ejected")
		elseif event.id == world.event.S_EVENT_BIRTH then
			self:onBirth(event)
		end
	end)
	-- swallow errors silently - never let a malformed event break the
	-- mission or spam the DCS log for the rest of the flight
end

function eventHandler:onHit(event)
	if not event.target or not is_player_unit(event.target) then
		return  -- only track hits against the player's own unit(s)
	end
	local targetId = safe_call(event.target, "getID")
	if not targetId then return end

	local info = {}
	if event.initiator then
		info.shooterName = safe_call(event.initiator, "getName")
		local myCoalition = safe_call(event.target, "getCoalition")
		local shooterCoalition = safe_call(event.initiator, "getCoalition")
		if myCoalition ~= nil and shooterCoalition ~= nil then
			info.shooterRelation = (myCoalition == shooterCoalition) and "friendly" or "enemy"
		end
		info.shooterCategory = category_label(event.initiator)
	end
	if event.weapon then
		info.weaponType = safe_call(event.weapon, "getTypeName")
	end
	MachLinkMission.lastHit[targetId] = info
end

function eventHandler:onLoss(event, kind)
	if not event.initiator or not is_player_unit(event.initiator) then
		return  -- only the player's own unit(s) matter for the Debrief
	end
	local unitId = safe_call(event.initiator, "getID")
	local fields = {
		{"type", kind},
		{"unitName", safe_call(event.initiator, "getName")},
		{"time", event.time},
	}
	local hit = unitId and MachLinkMission.lastHit[unitId]
	if hit then
		fields[#fields + 1] = {"shooterName", hit.shooterName}
		fields[#fields + 1] = {"shooterRelation", hit.shooterRelation}
		fields[#fields + 1] = {"shooterCategory", hit.shooterCategory}
		fields[#fields + 1] = {"weaponType", hit.weaponType}
	end
	ml_send(fields)
	if unitId then MachLinkMission.lastHit[unitId] = nil end
end

function eventHandler:onBirth(event)
	if not event.initiator or not is_player_unit(event.initiator) then
		return
	end
	ml_send({
		{"type", "birth"},
		{"unitName", safe_call(event.initiator, "getName")},
		{"time", event.time},
	})
end

world.addEventHandler(eventHandler)
