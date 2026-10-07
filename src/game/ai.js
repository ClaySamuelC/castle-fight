import { weaponList } from './weapons.js'
import { resolveShot } from './simulate.js'

function draftOf(sim) {
  return {
    rules: sim.rules,
    terrain: {
      w: sim.terrain.w,
      h: sim.terrain.h,
      waterY: sim.terrain.waterY,
      cells: sim.terrain.cells.slice(),
    },
    keepers: sim.keepers.map((keeper) => ({ ...keeper })),
    turn: { ...sim.turn },
  }
}

function scoreResult(before, after, myTeam) {
  let score = 0
  for (const keeper of after) {
    const prev = before.find((item) => item.id === keeper.id)
    const damage = prev.hp - keeper.hp
    if (damage <= 0) continue
    if (keeper.team === myTeam) score -= damage * 1.7
    else score += damage
    if (prev.hp > 0 && keeper.hp <= 0) score += keeper.team === myTeam ? -120 : 90
  }
  return score
}

function searchWeapon(sim, me, weaponId, angles, powers) {
  let best = null
  for (const angle of angles) {
    for (const power of powers) {
      const draft = draftOf(sim)
      const result = resolveShot(
        draft,
        { keeperId: me.id, weaponId, angle, power },
        { record: false },
      )
      const score = scoreResult(sim.keepers, result.finalKeepers, me.team)
      if (!best || score > best.score) {
        best = {
          score,
          keeperId: me.id,
          weaponId,
          angle,
          power,
          x: me.x,
        }
      }
    }
  }
  return best
}

/**
 * Picks a shot by searching the same resolver the match uses.
 * Add a new weapon to the list and the bot will try it when it has ammo.
 */
export function planAiShot(sim) {
  const me = sim.keepers.find((keeper) => keeper.id === sim.turn.keeperId && keeper.hp > 0)
  const enemies = sim.keepers.filter((keeper) => keeper.team !== me?.team && keeper.hp > 0)
  if (!me || !enemies.length) return null
  const target = enemies.reduce((closest, keeper) => {
    const distance = Math.hypot(keeper.x - me.x, keeper.y - me.y)
    return !closest || distance < closest.distance ? { keeper, distance } : closest
  }, null)

  const facingRight = target.keeper.x >= me.x
  const angles = []
  for (let deg = -76; deg <= 24; deg += 12) {
    const rad = (deg * Math.PI) / 180
    angles.push(facingRight ? rad : Math.PI - rad)
  }
  const powers = [48, 70, 92]
  const available = weaponList.filter((weapon) => sim.ammo[me.team][weapon.id] !== 0)
  const shell = available.find((weapon) => weapon.id === 'shell')
  let best = shell ? searchWeapon(sim, me, shell.id, angles, powers) : null

  const distance = target.distance
  for (const weapon of available) {
    if (weapon.id === 'shell') continue
    if (weapon.id === 'scatter' && distance > 240) continue
    if (best && best.score >= 22 && weapon.id !== 'keg') continue
    const attempt = searchWeapon(sim, me, weapon.id, angles, powers)
    if (attempt && (!best || attempt.score > best.score)) best = attempt
  }

  if (!best || best.score <= 0) {
    const angle = Math.atan2(target.keeper.y - me.y, target.keeper.x - me.x)
    return {
      keeperId: me.id,
      weaponId: shell?.id || available[0].id,
      angle,
      power: 74,
      x: me.x,
    }
  }
  return best
}
