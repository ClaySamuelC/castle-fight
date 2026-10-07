/**
 * Weapons are data. The simulator does not special-case ids.
 * To add a weapon, append a definition. Give it a tint in render/palette.js
 * if the default color is not enough. Unusual impact behavior can later key
 * off an optional `impact` string without changing callers.
 *
 * ammo: -1 is unlimited.
 * fuseTicks: 0 explodes on impact. Above 0, a bouncing weapon waits out the fuse.
 * bounce: 0 sticks and explodes. Above 0 reflects until the fuse ends.
 * spread: radians, mirrored across pellets.
 */
export const weaponList = [
  {
    id: 'shell',
    name: 'Shell',
    blurb: 'Arcing shot that follows the wind.',
    ammo: -1,
    damage: 46,
    radius: 32,
    speed: 9.4,
    windScale: 1,
    gravityScale: 1,
    fuseTicks: 0,
    bounce: 0,
    pellets: 1,
    spread: 0,
    impact: 'blast',
  },
  {
    id: 'keg',
    name: 'Powder Keg',
    blurb: 'Bounces, then opens a wide hole.',
    ammo: 3,
    damage: 40,
    radius: 44,
    speed: 7.2,
    windScale: 0.3,
    gravityScale: 1,
    fuseTicks: 135,
    bounce: 0.58,
    pellets: 1,
    spread: 0,
    impact: 'blast',
  },
  {
    id: 'scatter',
    name: 'Scattershot',
    blurb: 'Two fast pellets. The wind ignores them.',
    ammo: 4,
    damage: 20,
    radius: 15,
    speed: 13.5,
    windScale: 0,
    gravityScale: 0.32,
    fuseTicks: 0,
    bounce: 0,
    pellets: 2,
    spread: 0.085,
    impact: 'blast',
  },
]

const byId = new Map(weaponList.map((weapon) => [weapon.id, weapon]))

export function getWeapon(id) {
  const weapon = byId.get(id)
  if (!weapon) return null
  return weapon
}

export function defaultWeaponId() {
  return weaponList[0].id
}
