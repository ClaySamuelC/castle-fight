import { getWeapon } from './weapons.js'
import { carveCircle, isSolid, supported } from './terrain.js'

function quantize(value) {
  return Math.round(value * 1000) / 1000
}

function spawnPellets(keeper, weapon, angle, power) {
  const pellets = []
  const speed = weapon.speed * (0.42 + 0.58 * (power / 100))
  const originY = keeper.y - 16
  for (let i = 0; i < weapon.pellets; i++) {
    const sign = i % 2 === 0 ? -1 : 1
    const offset = weapon.pellets === 1 ? 0 : sign * weapon.spread * Math.ceil((i + 1) / 2)
    const aim = angle + offset
    const cos = Math.cos(aim)
    const sin = Math.sin(aim)
    pellets.push({
      x: keeper.x + cos * 14,
      y: originY + sin * 14,
      vx: cos * speed,
      vy: sin * speed,
      fuse: weapon.fuseTicks,
      alive: true,
    })
  }
  return pellets
}

function surfaceNormal(terrain, x, y) {
  let nx = 0
  let ny = 0
  for (let yy = -3; yy <= 3; yy++) {
    for (let xx = -3; xx <= 3; xx++) {
      if (isSolid(terrain, x + xx, y + yy)) {
        nx -= xx
        ny -= yy
      }
    }
  }
  const mag = Math.hypot(nx, ny) || 1
  return { x: nx / mag, y: ny / mag }
}

/**
 * @returns {'fly' | 'bounce' | 'explode' | 'gone'}
 */
export function stepProjectile(pellet, terrain, wind, weapon, rules) {
  pellet.vx = quantize(pellet.vx + wind * rules.windForce * weapon.windScale)
  pellet.vy = quantize(pellet.vy + rules.gravity * weapon.gravityScale)

  const distance = Math.hypot(pellet.vx, pellet.vy)
  const substeps = Math.max(1, Math.ceil(distance / 2.5))
  const dx = pellet.vx / substeps
  const dy = pellet.vy / substeps

  for (let i = 0; i < substeps; i++) {
    const nx = pellet.x + dx
    const ny = pellet.y + dy
    if (ny > terrain.h + 30 || nx < -40 || nx > terrain.w + 40) return 'gone'
    if (isSolid(terrain, nx, ny)) {
      if (weapon.bounce > 0 && pellet.fuse > 1) {
        const normal = surfaceNormal(terrain, pellet.x, pellet.y)
        const dot = pellet.vx * normal.x + pellet.vy * normal.y
        pellet.vx = quantize((pellet.vx - 2 * dot * normal.x) * weapon.bounce)
        pellet.vy = quantize((pellet.vy - 2 * dot * normal.y) * weapon.bounce)
        pellet.x = quantize(pellet.x + normal.x * 2.5)
        pellet.y = quantize(pellet.y + normal.y * 2.5)
        if (Math.hypot(pellet.vx, pellet.vy) < 0.45 || isSolid(terrain, pellet.x, pellet.y)) {
          return 'explode'
        }
        return 'bounce'
      }
      pellet.x = quantize(nx)
      pellet.y = quantize(ny)
      return 'explode'
    }
    pellet.x = nx
    pellet.y = ny
  }

  pellet.x = quantize(pellet.x)
  pellet.y = quantize(pellet.y)
  return 'fly'
}

export function explode(sim, x, y, weapon) {
  carveCircle(sim.terrain, x, y, weapon.radius)
  const hits = []
  const reach = weapon.radius + 10
  for (const keeper of sim.keepers) {
    if (keeper.hp <= 0) continue
    const dx = keeper.x - x
    const dy = keeper.y - 14 - y
    const dist = Math.hypot(dx, dy)
    if (dist > reach) continue
    const falloff = 1 - dist / reach
    const damage = Math.max(1, Math.round(weapon.damage * falloff))
    keeper.hp = Math.max(0, keeper.hp - damage)
    hits.push({ keeperId: keeper.id, damage, team: keeper.team })
  }
  return { hits }
}

/** One pixel of falling, then landing damage. Returns true while anyone is still in the air. */
export function settleStep(sim, events, tick) {
  let moved = false
  for (const keeper of sim.keepers) {
    if (keeper.hp <= 0) continue
    if (keeper.y >= sim.terrain.waterY) {
      keeper.hp = 0
      keeper.air = 0
      events?.push({ tick, type: 'drown', keeperId: keeper.id })
      continue
    }
    if (!supported(sim.terrain, keeper.x, keeper.y)) {
      keeper.y += 1
      keeper.air = (keeper.air || 0) + 1
      moved = true
    } else if (keeper.air) {
      const extra = keeper.air - sim.rules.fallSafePx
      if (extra > 0) {
        const damage = Math.max(1, Math.round(extra * sim.rules.fallDamagePerPx))
        keeper.hp = Math.max(0, keeper.hp - damage)
        events?.push({
          tick,
          type: 'fall',
          keeperId: keeper.id,
          damage,
          distance: keeper.air,
        })
      }
      keeper.air = 0
    }
  }
  return moved
}

function snapshotKeeper(keeper) {
  return {
    id: keeper.id,
    team: keeper.team,
    name: keeper.name,
    x: quantize(keeper.x),
    y: keeper.y,
    hp: keeper.hp,
    facing: keeper.facing,
  }
}

/**
 * Resolves a shot on a draft match. When record is true, frames drive the
 * animation. AI search sets record false and only reads the final bodies.
 */
export function resolveShot(draft, shot, { record = true } = {}) {
  const weapon = getWeapon(shot.weaponId)
  const keeper = draft.keepers.find((item) => item.id === shot.keeperId)
  const pellets = spawnPellets(keeper, weapon, shot.angle, shot.power)
  const frames = []
  const events = []
  let tick = 0
  const maxTicks = 60 * 9

  const pushFrame = (projectiles) => {
    if (!record) return
    frames.push({
      projectiles,
      keepers: draft.keepers.map(snapshotKeeper),
    })
  }

  while (tick < maxTicks && pellets.some((pellet) => pellet.alive)) {
    const projectiles = []
    const impacts = []
    for (const pellet of pellets) {
      if (!pellet.alive) continue
      if (pellet.fuse > 0) {
        pellet.fuse -= 1
        if (pellet.fuse <= 0) {
          impacts.push({ x: pellet.x, y: pellet.y })
          pellet.alive = false
          continue
        }
      }
      const result = stepProjectile(pellet, draft.terrain, draft.turn.wind, weapon, draft.rules)
      if (result === 'fly' || result === 'bounce') {
        projectiles.push({ x: pellet.x, y: pellet.y, weaponId: weapon.id })
      } else if (result === 'explode') {
        pellet.alive = false
        impacts.push({ x: pellet.x, y: pellet.y })
      } else {
        pellet.alive = false
      }
    }
    for (const impact of impacts) {
      const { hits } = explode(draft, impact.x, impact.y, weapon)
      events.push({
        tick,
        type: 'boom',
        x: impact.x,
        y: impact.y,
        radius: weapon.radius,
        hits,
      })
    }
    pushFrame(projectiles)
    tick++
  }

  let fell = 0
  while (fell++ < 700 && settleStep(draft, events, tick)) {
    if (record && fell % 2 === 0) pushFrame([])
    tick++
  }
  const tail = record ? Math.round(draft.rules.afterShotSeconds * 60) : 0
  for (let i = 0; i < tail; i++) pushFrame([])

  return {
    frames,
    events,
    finalKeepers: draft.keepers.map(snapshotKeeper),
    finalCells: new Uint8Array(draft.terrain.cells),
  }
}

/** Ghost path for the aiming guide. Does not mutate the match. */
export function traceShot(sim, shot) {
  const weapon = getWeapon(shot.weaponId)
  const keeper = sim.keepers.find((item) => item.id === shot.keeperId)
  if (!weapon || !keeper) return []
  const pellet = spawnPellets(keeper, weapon, shot.angle, shot.power)[0]
  const points = []
  for (let tick = 0; tick < 170 && pellet.alive; tick++) {
    if (pellet.fuse > 0) {
      pellet.fuse -= 1
      if (pellet.fuse <= 0) {
        points.push({ x: pellet.x, y: pellet.y, hit: true })
        break
      }
    }
    const result = stepProjectile(pellet, sim.terrain, sim.turn.wind, weapon, sim.rules)
    if (tick % 3 === 0) points.push({ x: pellet.x, y: pellet.y, hit: result === 'explode' })
    if (result === 'explode' || result === 'gone') break
  }
  return points
}
