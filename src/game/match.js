import { createRng, rngInt } from '../rng.js'
import { KEEPER_NAMES, mergeRules } from './rules.js'
import { createMap } from './maps.js'
import { weaponList, getWeapon } from './weapons.js'
import { decodeTerrain, encodeTerrain, nearestFloor, supported, walkToward } from './terrain.js'
import { resolveShot } from './simulate.js'

export const Phase = {
  AIM: 'aim',
  FLIGHT: 'flight',
  OVER: 'over',
}

export function createMatch({ seed, rules, teams }) {
  const merged = mergeRules(rules)
  const rng = createRng(seed >>> 0)
  const terrain = createMap(merged.mapId, rng, merged)
  const roster = teams.map((team) => ({ id: team.id, name: team.name }))
  const sim = {
    setup: { seed: seed >>> 0, rules: merged, teams: roster },
    rules: merged,
    rng,
    terrain,
    keepers: placeKeepers(terrain, merged, roster),
    ammo: startingAmmo(roster),
    teams: roster,
    cursors: Object.fromEntries(roster.map((team) => [team.id, 0])),
    turn: {
      id: 0,
      team: roster[roster.length - 1].id,
      keeperId: null,
      wind: 0,
      timeLeft: merged.turnSeconds,
    },
    phase: Phase.AIM,
    winner: null,
    playback: null,
    log: [],
  }
  beginNextTurn(sim)
  return sim
}

function startingAmmo(teams) {
  const ammo = {}
  for (const team of teams) {
    ammo[team.id] = {}
    for (const weapon of weaponList) ammo[team.id][weapon.id] = weapon.ammo
  }
  return ammo
}

function placeKeepers(terrain, rules, teams) {
  const keepers = []
  for (const team of teams) {
    const spots = terrain.spawns.filter((spawn) => spawn.team === team.id)
    if (spots.length < rules.keepersPerTeam) {
      throw new Error(`Map "${rules.mapId}" is missing spawns for ${team.id}`)
    }
    for (let i = 0; i < rules.keepersPerTeam; i++) {
      const spot = spots[i]
      const keeper = {
        id: `${team.id}-${i + 1}`,
        team: team.id,
        name: KEEPER_NAMES[team.id]?.[i] || `Keeper ${i + 1}`,
        x: spot.x,
        y: spot.y,
        hp: rules.startingHp,
        facing: team.id === 'left' ? 1 : -1,
        air: 0,
      }
      const floor = nearestFloor(terrain, keeper.x, keeper.y, 36)
      if (floor != null) keeper.y = floor
      if (!supported(terrain, keeper.x, keeper.y) || keeper.y >= terrain.waterY) {
        throw new Error(`Spawn ${keeper.id} is not standing on solid ground`)
      }
      keepers.push(keeper)
    }
  }
  return keepers
}

export function livingKeepers(sim, teamId) {
  return sim.keepers.filter((keeper) => keeper.team === teamId && keeper.hp > 0)
}

export function livingTeams(sim) {
  return sim.teams.filter((team) => livingKeepers(sim, team.id).length > 0)
}

export function beginNextTurn(sim) {
  const alive = livingTeams(sim)
  if (alive.length <= 1) {
    sim.phase = Phase.OVER
    sim.winner = alive[0]?.id ?? null
    sim.playback = null
    return
  }
  const order = sim.teams.map((team) => team.id)
  const start = Math.max(0, order.indexOf(sim.turn.team))
  for (let step = 1; step <= order.length; step++) {
    const teamId = order[(start + step) % order.length]
    const roster = sim.keepers.filter((keeper) => keeper.team === teamId)
    const cursor = sim.cursors[teamId] % roster.length
    for (let n = 0; n < roster.length; n++) {
      const keeper = roster[(cursor + n) % roster.length]
      if (keeper.hp <= 0) continue
      sim.cursors[teamId] = (cursor + n + 1) % roster.length
      sim.turn = {
        id: sim.turn.id + 1,
        team: teamId,
        keeperId: keeper.id,
        wind: rngInt(sim.rng, sim.rules.windMin, sim.rules.windMax),
        timeLeft: sim.rules.turnSeconds,
      }
      sim.phase = Phase.AIM
      sim.playback = null
      return
    }
  }
  sim.phase = Phase.OVER
  sim.winner = null
}

export function keeperById(sim, id) {
  return sim.keepers.find((keeper) => keeper.id === id) || null
}

export function activeKeeper(sim) {
  return keeperById(sim, sim.turn?.keeperId)
}

export function cycleKeeper(sim, direction = 1) {
  const roster = livingKeepers(sim, sim.turn.team)
  if (!roster.length) return null
  const index = Math.max(0, roster.findIndex((keeper) => keeper.id === sim.turn.keeperId))
  const next = roster[(index + direction + roster.length) % roster.length]
  sim.turn.keeperId = next.id
  return next
}

export function selectKeeper(sim, id) {
  const keeper = keeperById(sim, id)
  if (!keeper || keeper.hp <= 0 || keeper.team !== sim.turn.team || sim.phase !== Phase.AIM) return null
  sim.turn.keeperId = keeper.id
  return keeper
}

export function keeperAt(keepers, x, y, maxDist = 30) {
  let best = null
  let bestDist = maxDist
  for (const keeper of keepers) {
    if (keeper.hp <= 0) continue
    const dist = Math.hypot(keeper.x - x, keeper.y - 16 - y)
    if (dist <= bestDist) {
      best = keeper
      bestDist = dist
    }
  }
  return best
}

export function sanitizeCommand(sim, raw) {
  if (!raw || sim.phase !== Phase.AIM) return null
  const weapon = getWeapon(raw.weaponId)
  const keeper = keeperById(sim, raw.keeperId)
  if (!weapon || !keeper || keeper.hp <= 0 || keeper.team !== sim.turn.team) return null
  const ammo = sim.ammo[keeper.team][weapon.id]
  if (ammo === 0) return null
  let angle = Number(raw.angle)
  const power = Number(raw.power)
  const x = Number(raw.x)
  if (!Number.isFinite(angle) || !Number.isFinite(power) || !Number.isFinite(x)) return null
  while (angle > Math.PI) angle -= Math.PI * 2
  while (angle < -Math.PI) angle += Math.PI * 2
  return {
    keeperId: keeper.id,
    weaponId: weapon.id,
    angle,
    power: Math.max(1, Math.min(100, power)),
    x: Math.max(14, Math.min(sim.terrain.w - 14, x)),
  }
}

function cloneSim(sim) {
  return {
    rules: sim.rules,
    terrain: {
      w: sim.terrain.w,
      h: sim.terrain.h,
      waterY: sim.terrain.waterY,
      cells: sim.terrain.cells.slice(),
      spawns: sim.terrain.spawns,
      props: sim.terrain.props,
    },
    keepers: sim.keepers.map((keeper) => ({ ...keeper })),
    turn: { ...sim.turn },
    ammo: structuredClone(sim.ammo),
  }
}

/** Validates, spends ammo, and stores a playback. Both peers call this with the same command. */
export function beginShot(sim, command) {
  const clean = sanitizeCommand(sim, command)
  if (!clean) return { ok: false, reason: 'rejected' }
  const keeper = keeperById(sim, clean.keeperId)
  const ammo = sim.ammo[keeper.team][clean.weaponId]
  if (ammo > 0) sim.ammo[keeper.team][clean.weaponId] -= 1
  walkToward(sim.terrain, keeper, clean.x)
  keeper.facing = Math.cos(clean.angle) < 0 ? -1 : 1
  const playback = resolveShot(cloneSim(sim), {
    keeperId: keeper.id,
    weaponId: clean.weaponId,
    angle: clean.angle,
    power: clean.power,
  })
  sim.phase = Phase.FLIGHT
  sim.playback = playback
  sim.log.push({ type: 'shot', turnId: sim.turn.id, ...clean, x: keeper.x })
  if (sim.log.length > 400) sim.log.shift()
  return { ok: true, command: { ...clean, x: keeper.x } }
}

export function finishShot(sim) {
  if (sim.phase !== Phase.FLIGHT || !sim.playback) return false
  sim.terrain.cells.set(sim.playback.finalCells)
  for (const snap of sim.playback.finalKeepers) {
    const keeper = keeperById(sim, snap.id)
    if (!keeper) continue
    keeper.x = snap.x
    keeper.y = snap.y
    keeper.hp = snap.hp
    keeper.facing = snap.facing
    keeper.air = 0
  }
  sim.playback = null
  beginNextTurn(sim)
  return true
}

export function skipTurn(sim) {
  if (sim.phase !== Phase.AIM) return false
  sim.log.push({ type: 'skip', turnId: sim.turn.id })
  beginNextTurn(sim)
  return true
}

export function frameAt(sim, index) {
  const frames = sim.playback?.frames
  if (sim.phase !== Phase.FLIGHT || !frames?.length) return null
  const clamped = Math.max(0, Math.min(frames.length - 1, index | 0))
  return frames[clamped]
}

export function simChecksum(sim) {
  let hash = 2166136261
  const cells = sim.terrain.cells
  for (let i = 0; i < cells.length; i += 13) {
    hash ^= cells[i]
    hash = Math.imul(hash, 16777619)
  }
  for (const keeper of sim.keepers) {
    hash ^= keeper.hp + 1
    hash ^= Math.round(keeper.x)
    hash ^= keeper.y
    hash = Math.imul(hash, 16777619)
  }
  hash ^= sim.rng.state
  hash ^= (sim.turn?.wind ?? 0) + 32
  hash ^= sim.turn?.id ?? 0
  return hash >>> 0
}

export function serializeSim(sim) {
  return {
    setup: sim.setup,
    keepers: sim.keepers.map((keeper) => ({
      id: keeper.id,
      team: keeper.team,
      name: keeper.name,
      x: keeper.x,
      y: keeper.y,
      hp: keeper.hp,
      facing: keeper.facing,
    })),
    ammo: sim.ammo,
    cursors: sim.cursors,
    turn: sim.turn,
    phase: sim.phase === Phase.FLIGHT ? Phase.AIM : sim.phase,
    winner: sim.winner,
    rng: sim.rng.state,
    terrain: encodeTerrain(sim.terrain.cells),
  }
}

export function hydrateSim(payload) {
  const sim = createMatch(payload.setup)
  const cells = decodeTerrain(payload.terrain, sim.terrain.w * sim.terrain.h)
  sim.terrain.cells.set(cells)
  for (const snap of payload.keepers) {
    const keeper = keeperById(sim, snap.id)
    if (!keeper) continue
    keeper.x = snap.x
    keeper.y = snap.y
    keeper.hp = snap.hp
    keeper.facing = snap.facing
    keeper.air = 0
  }
  sim.ammo = payload.ammo
  sim.cursors = { ...payload.cursors }
  sim.turn = { ...payload.turn }
  sim.phase = payload.phase
  sim.winner = payload.winner
  sim.rng.state = payload.rng
  sim.playback = null
  return sim
}
