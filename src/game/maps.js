import { WORLD } from './rules.js'
import { Cell, carveRect, createTerrain, fillColumn, fillRect, isSolid } from './terrain.js'

/**
 * Map generators take (rng, rules) and return a terrain with spawns and props.
 * Forts are mirrored and do not consume rng, so both sides stay even.
 * A later map can spend rng for variation as long as both peers share the seed.
 */
export function generateForts(rng, rules) {
  void rng
  void rules
  const terrain = createTerrain(WORLD.width, WORLD.height)
  terrain.waterY = 494
  const ground = 408

  for (let x = 0; x < terrain.w; x++) {
    const surface = hillSurface(x, ground, terrain.waterY)
    if (surface == null) continue
    fillColumn(terrain, x, surface, Cell.DIRT)
  }

  buildFort(terrain, 'left', ground)
  buildFort(terrain, 'right', ground)
  return terrain
}

function hillSurface(x, ground, waterY) {
  const flat = 332
  const slopeEnd = 468
  if (x < flat) return ground
  if (x < slopeEnd) {
    const t = (x - flat) / (slopeEnd - flat)
    const surface = Math.floor(ground + t * t * 120)
    return surface >= waterY ? null : surface
  }
  if (x < WORLD.width - slopeEnd) return null
  if (x < WORLD.width - flat) {
    const t = (WORLD.width - flat - x) / (slopeEnd - flat)
    const surface = Math.floor(ground + t * t * 120)
    return surface >= waterY ? null : surface
  }
  return ground
}

function placeX(side, x, width = 0) {
  return side === 'left' ? x : WORLD.width - x - width
}

function buildFort(terrain, side, ground) {
  const rear = { x: 34, w: 86, h: 178 }
  const wall = { x: 120, w: 100, h: 116 }
  const front = { x: 236, w: 96, h: 164 }

  const rearX = placeX(side, rear.x, rear.w)
  const wallX = placeX(side, wall.x, wall.w)
  const frontX = placeX(side, front.x, front.w)

  stampTower(terrain, rearX, ground, rear.w, rear.h)
  stampTower(terrain, wallX, ground, wall.w, wall.h)
  stampTower(terrain, frontX, ground, front.w, front.h)

  const rearGaps = addMerlons(terrain, rearX, ground - rear.h, rear.w)
  const wallGaps = addMerlons(terrain, wallX, ground - wall.h, wall.w)
  const frontGaps = addMerlons(terrain, frontX, ground - front.h, front.w)

  const room = carveInterior(terrain, side, wallX, wall.w, ground, wall.h)
  carveWindows(terrain, rearX, rear.w, ground, rear.h)
  carveWindows(terrain, frontX, front.w, ground, front.h)

  const spawns = [
    feetAt(terrain, rearGaps[0] ?? rearX + rear.w / 2, ground - rear.h),
    feetAt(terrain, room.x, room.floorY),
    feetAt(terrain, frontGaps[0] ?? frontX + 20, ground - front.h),
    feetAt(terrain, wallGaps[0] ?? wallX + wall.w / 2, ground - wall.h),
  ]

  for (const spawn of spawns) {
    terrain.spawns.push({ x: spawn.x, y: spawn.y, team: side })
  }

  terrain.props.push({
    type: 'banner',
    team: side,
    x: rearX + rear.w / 2,
    y: ground - rear.h - 18,
  })
}

function stampTower(terrain, x, ground, width, height) {
  fillRect(terrain, x, ground - height, width, height + (terrain.h - ground), Cell.STONE)
}

function addMerlons(terrain, x, roofY, width) {
  const gaps = []
  let cursor = x + 8
  while (cursor < x + width - 22) {
    fillRect(terrain, cursor, roofY - 16, 14, 16, Cell.STONE)
    gaps.push(cursor + 18)
    cursor += 26
  }
  return gaps
}

function carveInterior(terrain, side, wallX, wallW, ground, wallH) {
  const roofY = ground - wallH
  const floorY = ground - 16
  const inset = 12
  const roomX = wallX + inset
  const roomW = wallW - inset * 2
  carveRect(terrain, roomX, roofY + 22, roomW, floorY - (roofY + 22))
  fillRect(terrain, roomX, floorY, roomW, 5, Cell.WOOD)

  const doorW = 30
  const doorX = side === 'left' ? wallX + wallW - doorW : wallX
  carveRect(terrain, doorX, floorY - 36, doorW, ground - (floorY - 36))

  const standX = side === 'left' ? roomX + 16 : roomX + roomW - 16
  return { x: standX, floorY }
}

function carveWindows(terrain, x, width, ground, height) {
  const top = ground - height + 36
  carveRect(terrain, x + 16, top, 14, 22)
  carveRect(terrain, x + width - 30, top, 14, 22)
  carveRect(terrain, x + width / 2 - 7, top + 48, 14, 22)
}

function feetAt(terrain, x, solidTop) {
  const ix = Math.round(x)
  for (let y = Math.max(0, solidTop - 4); y < solidTop + 24; y++) {
    if (isSolid(terrain, ix, y)) return { x: ix, y: y - 1 }
  }
  return { x: ix, y: solidTop - 1 }
}

export const maps = {
  forts: generateForts,
}

export function createMap(mapId, rng, rules) {
  const generate = maps[mapId] || maps.forts
  return generate(rng, rules)
}
