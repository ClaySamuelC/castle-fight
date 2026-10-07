/** Seeded RNG with a serializable state, so matches can be resumed later. */
export function createRng(seed) {
  return { state: seed >>> 0 }
}

export function rngNext(rng) {
  let a = rng.state | 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  rng.state = (t ^ (t >>> 14)) >>> 0
  return rng.state / 4294967296
}

export function rngInt(rng, min, max) {
  return min + Math.floor(rngNext(rng) * (max - min + 1))
}
