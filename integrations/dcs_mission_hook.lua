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
--   "hit"    - a player's unit took a hit - sent immediately (damage-taken
--              history, even for a hit that doesn't end the flight) AND
--              cached, so a subsequent dead/crash/ejected can report
--              who/what actually ended it
--   "dead"   - a player's unit was destroyed by a weapon
--   "crash"  - a player's unit crashed (terrain/water impact, no weapon)
--   "ejected" - the pilot ejected
--   "kill"   - the player destroyed another unit (the inverse of "dead" -
--              S_EVENT_KILL, not the same event that produces "dead")
--   "shot"   - the player released a guided/unguided ordnance (missile,
--              bomb, rocket) - confirmed via a real flight that gun/cannon
--              fire does NOT generate this event at all
--   "gun_start" - the player pulled the trigger on a gun/cannon
--              (S_EVENT_SHOOTING_START) - the only signal available for
--              gun usage, since "shot" doesn't cover it. One event per
--              burst/trigger-pull, not per round.
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

-- Best-effort finer classification for the Logbook's "kills by type"
-- breakdown, layered on top of category_label()'s coarse Unit.Category
-- bucket. Uses DCS's own attribute tag system - the same one the Mission
-- Editor's own unit filters use (hasAttribute()) - which two real unit
-- database entries confirmed uses exactly these strings (Vehicles/SAM/
-- 9P31 STRELA-1.lua: "SR SAM"/"IR Guided SAM"; Vehicles/IFV/BTR-60.lua:
-- "APC"). NOT exhaustively verified against every unit type yet - expect
-- this list to need adjusting once real kills across more unit types come
-- in. Returns nil (falls back to the coarse category) when nothing matches.
local SAM_ATTRIBUTES = {"SAM", "SR SAM", "MR SAM", "LR SAM", "IR Guided SAM", "AAA"}
local VEHICLE_ATTRIBUTES = {"Armor", "Tanks", "APC", "IFV", "Artillery", "MLRS"}
local SOFT_TARGET_ATTRIBUTES = {"Trucks", "Infantry", "Fortification"}

local function has_any_attribute(unit, names)
	for _, name in ipairs(names) do
		local ok, result = pcall(function() return unit:hasAttribute(name) end)
		if ok and result then return true end
	end
	return false
end

local function kill_category_detail(unit)
	if not unit then return nil end
	if has_any_attribute(unit, SAM_ATTRIBUTES) then return "sam" end
	if has_any_attribute(unit, VEHICLE_ATTRIBUTES) then return "vehicle" end
	if has_any_attribute(unit, SOFT_TARGET_ATTRIBUTES) then return "soft_target" end
	return nil
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
		elseif event.id == world.event.S_EVENT_KILL then
			self:onKill(event)
		elseif event.id == world.event.S_EVENT_SHOT then
			self:onShot(event)
		elseif event.id == world.event.S_EVENT_SHOOTING_START then
			-- Confirmed via a real flight that S_EVENT_SHOT does NOT fire
			-- for gun/cannon fire (a gun kill produced zero "shot" events)
			-- - this is the only signal for gun usage. One event per
			-- trigger pull/burst, not per round.
			self:onGunStart(event)
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

	-- Cached for a later dead/crash/ejected to attribute to...
	if targetId then
		MachLinkMission.lastHit[targetId] = info
	end
	-- ...and sent immediately too, so a hit that doesn't end the flight
	-- still counts as damage taken in the debrief.
	ml_send({
		{"type", "hit"},
		{"shooterName", info.shooterName},
		{"shooterRelation", info.shooterRelation},
		{"shooterCategory", info.shooterCategory},
		{"weaponType", info.weaponType},
	})
end

function eventHandler:onKill(event)
	if not event.initiator or not is_player_unit(event.initiator) then
		return  -- only the player's own kills matter for the Debrief
	end
	local fields = {
		{"type", "kill"},
		{"targetName", safe_call(event.target, "getName")},
		{"targetType", safe_call(event.target, "getTypeName")},
		{"targetCategory", category_label(event.target)},
		{"targetCategoryDetail", kill_category_detail(event.target)},
	}
	local myCoalition = safe_call(event.initiator, "getCoalition")
	local targetCoalition = safe_call(event.target, "getCoalition")
	if myCoalition ~= nil and targetCoalition ~= nil then
		fields[#fields + 1] = {"targetRelation", (myCoalition == targetCoalition) and "friendly" or "enemy"}
	end
	-- S_EVENT_KILL's weapon field shape isn't confirmed - try both a
	-- weapon object (getTypeName()) and a plain string field, so
	-- whichever one DCS actually provides still comes through.
	if event.weapon then
		fields[#fields + 1] = {"weaponType", safe_call(event.weapon, "getTypeName")}
	elseif event.weapon_name then
		fields[#fields + 1] = {"weaponType", event.weapon_name}
	end
	ml_send(fields)
end

function eventHandler:onShot(event)
	if not event.initiator or not is_player_unit(event.initiator) then
		return  -- only the player's own shots matter for the Debrief
	end
	local weaponType = nil
	if event.weapon then
		weaponType = safe_call(event.weapon, "getTypeName")
	end
	ml_send({
		{"type", "shot"},
		{"weaponType", weaponType},
	})
end

function eventHandler:onGunStart(event)
	if not event.initiator or not is_player_unit(event.initiator) then
		return  -- only the player's own gun usage matters for the Debrief
	end
	-- Gun fire doesn't produce a trackable weapon object the way ordnance
	-- does (see onShot) - DCS instead documents a plain weapon_name string
	-- field here; try both that and a weapon object just in case, same
	-- defensive pattern as onKill's uncertain weapon field.
	local weaponType = event.weapon_name
	if not weaponType and event.weapon then
		weaponType = safe_call(event.weapon, "getTypeName")
	end
	ml_send({
		{"type", "gun_start"},
		{"weaponType", weaponType},
	})
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
