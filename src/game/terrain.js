export const Cell = {
  EMPTY: 0,
  DIRT: 1,
  STONE: 2,
  WOOD: 3,
}

export function createTerrain(width, height) {
  return {
    w: width,
    h: height,
    cells: new Uint8Array(width * height),
    waterY: height - 48,
    spawns: [],
    props: [],
  }
}

export function cellIndex(terrain, x, y) {
  return y * terrain.w + x
}

export function isSolid(terrain, x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  if (ix < 0 || iy < 0 || ix >= terrain.w || iy >= terrain.h) return false
  return terrain.cells[iy * terrain.w + ix] !== Cell.EMPTY
}

export function fillRect(terrain, x, y, w, h, type) {
  const x0 = Math.max(0, x | 0)
  const y0 = Math.max(0, y | 0)
  const x1 = Math.min(terrain.w, (x + w) | 0)
  const y1 = Math.min(terrain.h, (y + h) | 0)
  if (x1 <= x0 || y1 <= y0) return
  for (let yy = y0; yy < y1; yy++) {
    terrain.cells.fill(type, yy * terrain.w + x0, yy * terrain.w + x1)
  }
}

export function carveRect(terrain, x, y, w, h) {
  fillRect(terrain, x, y, w, h, Cell.EMPTY)
}

export function fillColumn(terrain, x, surface, type) {
  const ix = x | 0
  if (ix < 0 || ix >= terrain.w) return
  const y0 = Math.max(0, surface | 0)
  for (let y = y0; y < terrain.h; y++) {
    terrain.cells[y * terrain.w + ix] = type
  }
}

export function hash2(x, y) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

/** Jagged but deterministic crater. */
export function carveCircle(terrain, x, y, radius) {
  const r = radius
  const x0 = Math.max(0, Math.floor(x - r - 1))
  const y0 = Math.max(0, Math.floor(y - r - 1))
  const x1 = Math.min(terrain.w - 1, Math.ceil(x + r + 1))
  const y1 = Math.min(terrain.h - 1, Math.ceil(y + r + 1))
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - x
      const dy = yy + 0.5 - y
      const jitter = 0.84 + (hash2(xx, yy) % 100) / 280
      const limit = r * jitter
      if (dx * dx + dy * dy <= limit * limit) {
        terrain.cells[yy * terrain.w + xx] = Cell.EMPTY
      }
    }
  }
}

export function solidCount(terrain) {
  let count = 0
  const cells = terrain.cells
  for (let i = 0; i < cells.length; i++) if (cells[i] !== Cell.EMPTY) count++
  return count
}

export function supported(terrain, x, feetY) {
  const y = Math.round(feetY) + 1
  const cx = Math.round(x)
  return [cx - 5, cx, cx + 5].some((px) => isSolid(terrain, px, y))
}

export function nearestFloor(terrain, x, feetY, reach = 22) {
  const cx = Math.round(x)
  if (cx < 2 || cx >= terrain.w - 2) return null
  let best = null
  let bestDist = Infinity
  const minY = Math.max(0, Math.round(feetY) - reach)
  const maxY = Math.min(terrain.h - 2, Math.round(feetY) + reach)
  for (let y = minY; y <= maxY; y++) {
    if (!isSolid(terrain, cx, y) && isSolid(terrain, cx, y + 1)) {
      const dist = Math.abs(y - feetY)
      if (dist < bestDist) {
        bestDist = dist
        best = y
      }
    }
  }
  return best
}

/**
 * Walk horizontally, stepping onto nearby floors.
 * Stops at walls and drops so a bad network pose cannot teleport through stone.
 */
export function moveKeeper(terrain, keeper, dx) {
  if (keeper.hp <= 0 || dx === 0) return false
  const nx = keeper.x + dx
  if (nx < 14 || nx > terrain.w - 14) return false
  const ny = nearestFloor(terrain, nx, keeper.y, 18)
  if (ny == null) return false
  if (ny > terrain.waterY - 2) return false
  keeper.x = nx
  keeper.y = ny
  keeper.facing = dx < 0 ? -1 : 1
  return true
}

export function walkToward(terrain, keeper, x, maxSteps = 600) {
  const goal = Math.max(14, Math.min(terrain.w - 14, x))
  let guard = 0
  while (Math.abs(keeper.x - goal) > 1.25 && guard++ < maxSteps) {
    const dir = Math.sign(goal - keeper.x)
    const before = keeper.x
    moveKeeper(terrain, keeper, dir * Math.min(2, Math.abs(goal - keeper.x)))
    if (keeper.x === before) break
  }
}

export function encodeTerrain(cells) {
  const runs = []
  if (!cells.length) return runs
  let type = cells[0]
  let count = 1
  for (let i = 1; i < cells.length; i++) {
    if (cells[i] === type && count < 65535) count++
    else {
      runs.push([type, count])
      type = cells[i]
      count = 1
    }
  }
  runs.push([type, count])
  return runs
}

export function decodeTerrain(runs, length) {
  const cells = new Uint8Array(length)
  let offset = 0
  for (const [type, count] of runs) {
    cells.fill(type, offset, offset + count)
    offset += count
  }
  if (offset !== length) {
    throw new Error('Terrain snapshot does not match the map size')
  }
  return cells
}
