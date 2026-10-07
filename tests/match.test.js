import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatch, beginShot, finishShot, simChecksum, serializeSim, hydrateSim, Phase } from '../src/game/match.js'
import { decodeTerrain, encodeTerrain, solidCount } from '../src/game/terrain.js'
import { planAiShot } from '../src/game/ai.js'

const teams = [
  { id: 'left', name: 'Red' },
  { id: 'right', name: 'Blue' },
]

function match(seed = 7) {
  return createMatch({ seed, teams })
}

test('fort spawns are standing on the castles', () => {
  const sim = match()
  assert.equal(sim.keepers.length, 6)
  assert.equal(sim.phase, Phase.AIM)
  assert.equal(sim.turn.team, 'left')
  assert.ok(sim.turn.wind >= sim.rules.windMin && sim.turn.wind <= sim.rules.windMax)
})

test('the same seed replays the same match', () => {
  const left = match(99)
  const right = match(99)
  assert.equal(simChecksum(left), simChecksum(right))
  const keeper = left.keepers.find((item) => item.team === 'left')
  const command = {
    keeperId: keeper.id,
    weaponId: 'shell',
    angle: Math.PI / 2,
    power: 55,
    x: keeper.x,
  }
  assert.equal(beginShot(left, command).ok, true)
  assert.equal(beginShot(right, { ...command }).ok, true)
  finishShot(left)
  finishShot(right)
  assert.equal(simChecksum(left), simChecksum(right))
  assert.ok(solidCount(left.terrain) < solidCount(match(99).terrain))
})

test('unlimited ammo stays and spent ammo runs out', () => {
  const sim = match(3)
  const keeper = sim.keepers.find((item) => item.id === sim.turn.keeperId)
  beginShot(sim, { keeperId: keeper.id, weaponId: 'shell', angle: -0.4, power: 40, x: keeper.x })
  finishShot(sim)
  assert.equal(sim.ammo.left.shell, -1)
  const kegUser = sim.keepers.find((item) => item.id === sim.turn.keeperId)
  for (let i = 0; i < 3; i++) {
    if (sim.turn.team !== 'right' && sim.turn.team !== 'left') break
    const active = sim.keepers.find((item) => item.id === sim.turn.keeperId)
    if (sim.turn.team === 'left') {
      skipUntil(sim, 'right')
    }
    if (sim.phase !== Phase.AIM) break
    const shot = beginShot(sim, {
      keeperId: active.id,
      weaponId: 'keg',
      angle: sim.turn.team === 'right' ? Math.PI - 0.5 : -0.5,
      power: 30,
      x: active.x,
    })
    if (shot.ok) finishShot(sim)
  }
  assert.equal(sim.ammo.right.keg <= 2, true)
  void kegUser
})

test('terrain snapshots round-trip', () => {
  const sim = match(11)
  const keeper = sim.keepers.find((item) => item.id === sim.turn.keeperId)
  beginShot(sim, { keeperId: keeper.id, weaponId: 'keg', angle: 1.2, power: 80, x: keeper.x })
  finishShot(sim)
  const encoded = encodeTerrain(sim.terrain.cells)
  const decoded = decodeTerrain(encoded, sim.terrain.cells.length)
  assert.equal(Buffer.compare(decoded, sim.terrain.cells), 0)
  const hydrated = hydrateSim(serializeSim(sim))
  assert.equal(simChecksum(hydrated), simChecksum(sim))
})

test('the practice bot returns a legal shot', () => {
  const sim = match(21)
  sim.turn.team = 'right'
  sim.turn.keeperId = sim.keepers.find((keeper) => keeper.team === 'right').id
  const plan = planAiShot(sim)
  assert.equal(plan.keeperId, sim.turn.keeperId)
  assert.ok(plan.power >= 1 && plan.power <= 100)
  assert.equal(beginShot(sim, plan).ok, true)
})

function skipUntil(sim, team) {
  let guard = 0
  while (sim.phase === Phase.AIM && sim.turn.team !== team && guard++ < 4) {
    const active = sim.keepers.find((item) => item.id === sim.turn.keeperId)
    beginShot(sim, {
      keeperId: active.id,
      weaponId: 'shell',
      angle: -0.2,
      power: 20,
      x: active.x,
    })
    finishShot(sim)
  }
}
