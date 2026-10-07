import { hash2 } from '../game/terrain.js'
import { Cell } from '../game/terrain.js'

export function terrainColor(cell, x, y, cells, width) {
  const above = y > 0 ? cells[(y - 1) * width + x] : Cell.DIRT
  if (cell === Cell.DIRT) {
    if (above === Cell.EMPTY) return [86, 132, 58]
    if (y > 1 && cells[(y - 2) * width + x] === Cell.EMPTY) return [70, 108, 46]
    const n = hash2(x, y) % 14
    return [118 + (n % 5), 76 + (n % 6), 46]
  }
  if (cell === Cell.WOOD) {
    return Math.floor(y / 2) % 2 ? [128, 82, 44] : [102, 62, 32]
  }
  const row = Math.floor(y / 7)
  const mortar = y % 7 === 0 || (x + (row % 2) * 8) % 15 === 0
  if (mortar) return [96, 92, 86]
  const n = hash2(x >> 2, y >> 2) % 18
  return [158 + (n % 7) - 8, 152 + (n % 5) - 8, 140 + (n % 4) - 6]
}

export function projectileColor(weaponId) {
  if (weaponId === 'keg') return '#8d4e2a'
  if (weaponId === 'scatter') return '#f0d78a'
  return '#2b3238'
}
