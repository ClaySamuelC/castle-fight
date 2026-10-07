import { createRenderer } from './render/draw.js'
import { createAudio } from './audio/sfx.js'
import { createInput, setGameCapture } from './input/input.js'
import { createUi } from './ui/overlay.js'
import { openRoom } from './net/lobby.js'
import { cleanName, normalizeCode, randomCode } from './net/codes.js'
import { SIM_VERSION, WORLD, mergeRules } from './game/rules.js'
import { weaponList, defaultWeaponId } from './game/weapons.js'
import {
  Phase,
  activeKeeper,
  beginShot,
  createMatch,
  cycleKeeper,
  finishShot,
  frameAt,
  hydrateSim,
  keeperAt,
  keeperById,
  selectKeeper,
  serializeSim,
  simChecksum,
  skipTurn,
} from './game/match.js'
import { carveCircle, moveKeeper, walkToward } from './game/terrain.js'
import { traceShot } from './game/simulate.js'
import { planAiShot } from './game/ai.js'

const NAME_KEY = 'castle-fight-name'
const MUTE_KEY = 'castle-fight-mute'

/**
 * Session owns screens, input, and the network.
 * Online matches are host-authoritative: the guest sends intents, the host
 * checks the turn, and both clients resolve the committed shot locally.
 * Practice and same-device games commit locally because there is no host.
 */
export function startApp(canvas, overlay) {
  const renderer = createRenderer(canvas)
  const audio = createAudio()
  const input = createInput(canvas)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const known = new Map()

  const view = {
    screen: 'home',
    name: localStorage.getItem(NAME_KEY) || '',
    code: '',
    status: '',
    error: '',
    role: null,
    players: [],
    busy: false,
    selfId: '',
    nonce: 0,
    retakes: 0,
    joinDeadline: 0,
    rosterTimer: 0,
    linked: false,
    weaponId: defaultWeaponId(),
    aimAngle: -0.7,
    power: 0,
    charging: false,
    mouseAim: false,
    waiting: false,
    waitTimer: 0,
    skipSent: false,
    firePress: false,
    fireRelease: false,
    fireHeld: false,
    aiPlan: null,
    aiTime: 0,
    flight: 0,
    eventCursor: 0,
    visual: null,
    terrainDirty: true,
    shake: 0,
    banner: '',
    bannerTime: 0,
    frozen: false,
    needSnapshot: false,
    muted: localStorage.getItem(MUTE_KEY) === '1',
    particles: [],
    floaters: [],
    clouds: [
      { x: 80, y: 64, s: 1, v: 8 },
      { x: 340, y: 40, s: 0.72, v: 12 },
      { x: 620, y: 86, s: 1.15, v: 6 },
      { x: 860, y: 48, s: 0.55, v: 10 },
    ],
    time: 0,
    debug: new URLSearchParams(location.search).has('debug'),
  }

  let sim = null
  let net = null
  let netToken = 0
  let controls = { left: 'human', right: 'human' }
  let localTeam = 'both'
  let poseTimer = 0
  let turnClock = 35
  const backdrop = createMatch({
    seed: 1234,
    teams: [
      { id: 'left', name: 'Crimson' },
      { id: 'right', name: 'Teal' },
    ],
  })

  audio.setMuted(view.muted)
  const ui = createUi(overlay, {
    setName,
    create: () => void hostMatch(),
    join: (code) => void joinMatch(code),
    practice: startPractice,
    hotseat: startHotseat,
    copy: () => void copyCode(),
    start: startOnline,
    leave: () => void leave(),
    rematch,
    mute: toggleMute,
    selectWeapon,
    selectKeeper: selectKeeperAction,
    fireDown,
    fireUp,
  })

  window.addEventListener('resize', () => renderer.resize())
  window.addEventListener('pointerdown', () => audio.unlock(), { once: false })
  renderer.resize()

  let last = performance.now()
  requestAnimationFrame(function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000)
    last = now
    try {
      update(dt)
      const drawing = drawModel()
      renderer.draw(drawing)
      view.terrainDirty = false
      ui.sync(uiModel())
      input.endFrame()
      view.firePress = false
      view.fireRelease = false
    } catch (error) {
      console.error(error)
    }
    requestAnimationFrame(frame)
  })

  function setName(value) {
    view.name = value
  }

  function playerName() {
    const name = cleanName(view.name)
    localStorage.setItem(NAME_KEY, name)
    view.name = name
    return name
  }

  function toggleMute() {
    view.muted = !view.muted
    localStorage.setItem(MUTE_KEY, view.muted ? '1' : '0')
    audio.setMuted(view.muted)
  }

  function selectWeapon(id) {
    if (!sim || !canHuman()) return
    if (sim.ammo[sim.turn.team][id] === 0) return
    view.weaponId = id
    audio.ui()
  }

  function selectKeeperAction(id) {
    if (!sim || !canHuman()) return
    if (selectKeeper(sim, id)) audio.ui()
  }

  function fireDown() {
    if (view.fireHeld) return
    view.fireHeld = true
    view.firePress = true
    audio.unlock()
  }

  function fireUp() {
    if (!view.fireHeld) return
    view.fireHeld = false
    view.fireRelease = true
  }

  function canHuman() {
    if (!sim || sim.phase !== Phase.AIM || view.frozen || view.waiting) return false
    if (controls[sim.turn.team] !== 'human') return false
    return localTeam === 'both' || localTeam === sim.turn.team
  }

  function update(dt) {
    view.time += dt
    if (!reduceMotion) {
      for (const cloud of view.clouds) {
        cloud.x += cloud.v * dt
        if (cloud.x > WORLD.width + 90) cloud.x = -90
      }
    }
    stepDecor(dt)
    setGameCapture(view.screen === 'play')
    if (view.screen === 'lobby' && view.role === 'guest' && !view.linked && view.joinDeadline) {
      if (performance.now() > view.joinDeadline) {
        view.error = 'No match is using that code.'
        view.status = 'Check the code and try again.'
      }
    }
    if (view.screen === 'lobby' && view.role === 'host' && net) {
      view.rosterTimer -= dt
      if (view.rosterTimer <= 0) {
        view.rosterTimer = 2
        broadcastRoster()
      }
    }
    if (!sim || (view.screen !== 'play' && view.screen !== 'over')) return
    if (view.frozen) return
    if (sim.phase === Phase.FLIGHT) {
      advanceFlight(dt)
      return
    }
    if (sim.phase === Phase.OVER) {
      view.screen = 'over'
      return
    }
    updateAim(dt)
  }

  function stepDecor(dt) {
    for (const particle of view.particles) {
      particle.life -= dt
      particle.vy += 220 * dt
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
    }
    view.particles = view.particles.filter((particle) => particle.life > 0)
    for (const floater of view.floaters) {
      floater.life -= dt
      floater.y -= 16 * dt
    }
    view.floaters = view.floaters.filter((floater) => floater.life > 0)
    view.shake = Math.max(0, view.shake - dt * 26)
    view.bannerTime = Math.max(0, view.bannerTime - dt)
  }

  function advanceFlight(dt) {
    if (!sim.playback) return
    view.flight += dt * 60
    const events = sim.playback.events
    while (view.eventCursor < events.length && events[view.eventCursor].tick <= view.flight) {
      playEvent(events[view.eventCursor])
      view.eventCursor += 1
    }
    if (view.flight < sim.playback.frames.length) return
    finishShot(sim)
    onTurnBegan()
  }

  function playEvent(event) {
    if (event.type === 'boom' && view.visual) {
      carveCircle(view.visual, event.x, event.y, event.radius)
      view.terrainDirty = true
      view.shake = Math.min(14, event.radius / 3)
      audio.boom(event.radius)
      burst(event.x, event.y, event.radius)
      const frame = frameAt(sim, event.tick)
      for (const hit of event.hits || []) {
        const body = frame?.keepers.find((keeper) => keeper.id === hit.keeperId)
        view.floaters.push({
          text: `-${hit.damage}`,
          x: body?.x ?? event.x,
          y: (body?.y ?? event.y) - 42,
          life: 0.9,
        })
      }
    }
    if (event.type === 'drown') audio.splash()
  }

  function burst(x, y, radius) {
    const count = Math.min(36, 10 + Math.floor(radius / 3))
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 30 + Math.random() * radius * 4
      view.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.45 + Math.random() * 0.45,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.4 ? '#e7c27a' : '#8d5a3a',
      })
    }
  }

  function updateAim(dt) {
    turnClock = Math.max(-12, turnClock - dt)
    sim.turn.timeLeft = Math.max(0, turnClock)
    const actor = controls[sim.turn.team]
    if (actor === 'ai') handleAi(dt)
    else if (canHuman()) handleHuman(dt)

    if (canHuman() && turnClock <= 0 && !view.skipSent) {
      view.skipSent = true
      requestSkip()
    }
    if (view.role === 'host' && actor === 'remote' && turnClock <= -8 && !view.skipSent) {
      view.skipSent = true
      requestSkip()
    }
    if (view.waiting) {
      view.waitTimer -= dt
      if (view.waitTimer <= 0) view.waiting = false
    }
    poseTimer -= dt
    if (poseTimer <= 0 && net && canHuman()) {
      poseTimer = 0.09
      sendPose()
    }
    maybeSendSnapshot()
  }

  function handleHuman(dt) {
    const keeper = activeKeeper(sim)
    if (!keeper) return
    const pad = input.state
    if (pad.pointer.justDown) {
      const hit = keeperAt(sim.keepers, pad.world.x, pad.world.y, 34)
      if (hit && hit.team === sim.turn.team) selectKeeper(sim, hit.id)
    }
    const selecting = pad.pointer.justDown && keeperAt(sim.keepers, pad.world.x, pad.world.y, 34)?.team === sim.turn.team
    let move = 0
    if (pad.keys.has('KeyA') || pad.keys.has('ArrowLeft')) move -= 1
    if (pad.keys.has('KeyD') || pad.keys.has('ArrowRight')) move += 1
    if (move && !view.charging) moveKeeper(sim.terrain, keeper, move * 115 * dt)

    if (pad.keys.has('KeyW') || pad.keys.has('ArrowUp')) {
      view.aimAngle -= dt * 1.15
      view.mouseAim = false
    }
    if (pad.keys.has('KeyS') || pad.keys.has('ArrowDown')) {
      view.aimAngle += dt * 1.15
      view.mouseAim = false
    }
    if (pad.wheel) {
      view.aimAngle += pad.wheel * 0.055
      view.mouseAim = false
    }
    if (!view.pointerSample) view.pointerSample = { x: pad.world.x, y: pad.world.y }
    const pointerDelta = Math.hypot(pad.world.x - view.pointerSample.x, pad.world.y - view.pointerSample.y)
    if (pointerDelta > 2) {
      view.mouseAim = true
      view.pointerSample.x = pad.world.x
      view.pointerSample.y = pad.world.y
    }
    if (view.mouseAim && pad.pointer.over) {
      const originY = keeper.y - 16
      view.aimAngle = Math.atan2(pad.world.y - originY, pad.world.x - keeper.x)
    }
    if (pad.justDown.has('Digit1')) selectWeapon(weaponList[0].id)
    if (pad.justDown.has('Digit2')) selectWeapon(weaponList[1].id)
    if (pad.justDown.has('Digit3')) selectWeapon(weaponList[2].id)
    if (pad.justDown.has('KeyQ')) stepWeapon(-1)
    if (pad.justDown.has('KeyE')) stepWeapon(1)
    if (pad.justDown.has('Tab')) cycleKeeper(sim, pad.keys.has('ShiftLeft') || pad.keys.has('ShiftRight') ? -1 : 1)

    const press = (pad.pointer.justDown && !selecting) || pad.justDown.has('Space') || view.firePress
    if (press && !view.charging) {
      view.charging = true
      view.power = 0
    }
    if (view.charging) {
      view.power = Math.min(100, view.power + dt * (100 / 1.15))
      if (view.power >= 100) releaseFire()
    }
    const release = view.charging && (pad.pointer.justUp || pad.justUp.has('Space') || view.fireRelease)
    if (release) releaseFire()
  }

  function stepWeapon(direction) {
    const index = Math.max(0, weaponList.findIndex((weapon) => weapon.id === view.weaponId))
    const next = weaponList[(index + direction + weaponList.length) % weaponList.length]
    selectWeapon(next.id)
  }

  function releaseFire() {
    if (!view.charging || !canHuman()) {
      view.charging = false
      return
    }
    const keeper = activeKeeper(sim)
    const power = Math.max(8, view.power)
    view.charging = false
    view.power = 0
    requestFire({
      keeperId: keeper.id,
      weaponId: view.weaponId,
      angle: view.aimAngle,
      power,
      x: keeper.x,
    })
  }

  function handleAi(dt) {
    if (!view.aiPlan) {
      view.aiPlan = planAiShot(sim)
      view.aiTime = 0
    }
    const plan = view.aiPlan
    if (!plan) {
      requestSkip()
      return
    }
    view.aiTime += dt
    view.aimAngle = plan.angle
    view.weaponId = plan.weaponId
    if (view.aiTime > 0.3) {
      view.charging = true
      view.power = Math.min(plan.power, ((view.aiTime - 0.3) / 0.65) * plan.power)
    }
    if (view.aiTime >= 1.05) {
      view.charging = false
      view.power = 0
      requestFire(plan)
    }
  }

  function requestFire(command) {
    if (!sim || sim.phase !== Phase.AIM) return
    if (view.role === 'guest') {
      view.waiting = true
      view.waitTimer = 2.5
      net?.send({ type: 'intent', intent: 'fire', turnId: sim.turn.id, ...command })
      return
    }
    const turnId = sim.turn.id
    const result = beginShot(sim, command)
    if (!result.ok) return
    startPlayback()
    if (view.role === 'host') {
      net?.send({ type: 'commit', intent: 'fire', turnId, ...result.command })
    }
  }

  function requestSkip() {
    if (!sim || sim.phase !== Phase.AIM) return
    if (view.role === 'guest') {
      view.waiting = true
      view.waitTimer = 2.5
      net?.send({ type: 'intent', intent: 'skip', turnId: sim.turn.id })
      return
    }
    const turnId = sim.turn.id
    skipTurn(sim)
    if (view.role === 'host') net?.send({ type: 'commit', intent: 'skip', turnId })
    onTurnBegan()
  }

  function sendPose() {
    const keeper = activeKeeper(sim)
    if (!keeper) return
    net.send({
      type: 'pose',
      turnId: sim.turn.id,
      keeperId: keeper.id,
      x: keeper.x,
      angle: view.aimAngle,
      weaponId: view.weaponId,
      power: view.power,
    })
  }

  function startPlayback() {
    view.flight = 0
    view.eventCursor = 0
    view.waiting = false
    view.charging = false
    view.visual = {
      w: sim.terrain.w,
      h: sim.terrain.h,
      cells: sim.terrain.cells.slice(),
    }
    view.terrainDirty = true
    audio.shot()
  }

  function onTurnBegan() {
    view.visual = null
    view.terrainDirty = true
    view.waiting = false
    view.charging = false
    view.power = 0
    view.aiPlan = null
    view.aiTime = 0
    view.skipSent = false
    view.mouseAim = false
    if (!sim || sim.phase === Phase.OVER) {
      view.screen = 'over'
      view.banner = winnerText()
      view.bannerTime = 2.4
      audio.win()
      return
    }
    view.screen = 'play'
    const keeper = activeKeeper(sim)
    const foes = sim.keepers.filter((item) => item.team !== keeper.team && item.hp > 0)
    const foe = foes.sort((a, b) => Math.abs(a.x - keeper.x) - Math.abs(b.x - keeper.x))[0]
    if (foe) view.aimAngle = foe.x >= keeper.x ? -0.62 : -Math.PI + 0.62
    const ammo = sim.ammo[sim.turn.team]
    if (ammo[view.weaponId] === 0) {
      view.weaponId = weaponList.find((weapon) => ammo[weapon.id] !== 0)?.id || defaultWeaponId()
    }
    turnClock = sim.rules.turnSeconds
    sim.turn.timeLeft = turnClock
    view.banner = `${keeper.name}'s turn`
    view.bannerTime = 1.15
    audio.turn()
    maybeSendSnapshot()
  }

  function winnerText() {
    if (!sim?.winner) return 'Both castles fell'
    const team = sim.teams.find((item) => item.id === sim.winner)
    return `${team?.name || 'The field'} holds the field`
  }

  function startLocal(teams, nextControls, team) {
    void closeNet()
    sim = createMatch({
      seed: Math.floor(Math.random() * 0x7fffffff) || 1,
      teams,
    })
    controls = nextControls
    localTeam = team
    view.role = null
    view.frozen = false
    view.error = ''
    view.screen = 'play'
    onTurnBegan()
  }

  function startPractice() {
    const name = playerName()
    startLocal(
      [
        { id: 'left', name },
        { id: 'right', name: 'Castle Bot' },
      ],
      { left: 'human', right: 'ai' },
      'left',
    )
  }

  function startHotseat() {
    const name = playerName()
    startLocal(
      [
        { id: 'left', name },
        { id: 'right', name: 'Rival' },
      ],
      { left: 'human', right: 'human' },
      'both',
    )
  }

  async function hostMatch() {
    view.error = ''
    view.busy = true
    view.role = 'host'
    view.nonce = Date.now()
    view.retakes = 0
    view.players = []
    view.linked = false
    known.clear()
    const code = randomCode()
    view.code = code
    view.screen = 'lobby'
    view.status = 'Opening a room…'
    try {
      await connect(code)
      view.status = 'Waiting for an opponent…'
    } catch (error) {
      view.screen = 'home'
      view.error = 'Could not open a room. Check your connection and try again.'
      console.warn(error)
    } finally {
      view.busy = false
    }
  }

  async function joinMatch(raw) {
    const code = normalizeCode(raw)
    if (!code) {
      view.error = 'Enter a 4-digit code.'
      return
    }
    view.error = ''
    view.busy = true
    view.role = 'guest'
    view.nonce = Date.now()
    view.code = code
    view.players = []
    view.linked = false
    known.clear()
    view.screen = 'lobby'
    view.status = 'Looking for that match…'
    view.joinDeadline = performance.now() + 12000
    try {
      await connect(code)
    } catch (error) {
      view.screen = 'home'
      view.error = 'Could not join that code.'
      console.warn(error)
    } finally {
      view.busy = false
    }
  }

  async function connect(code) {
    const token = ++netToken
    await closeNet()
    if (token !== netToken) return
    const room = await openRoom(code, {
      onMessage: (data, peerId) => onNet(data, peerId, token),
      onPeer: (kind, peerId) => onPeer(kind, peerId, token),
      onStatus: (text) => {
        if (token === netToken) view.status = text
      },
    })
    if (token !== netToken) {
      await room.leave()
      return
    }
    net = room
    view.selfId = room.selfId
    remember(room.selfId, { name: playerName(), role: view.role, nonce: view.nonce })
    if (view.role === 'host') broadcastRoster()
    room.send({
      type: 'hello',
      name: playerName(),
      role: view.role,
      nonce: view.nonce,
    })
  }

  async function closeNet() {
    const current = net
    net = null
    if (current) await current.leave()
  }

  function remember(id, info) {
    known.set(id, { ...known.get(id), ...info })
  }

  function broadcastRoster() {
    if (!net || view.role !== 'host') return
    const players = [
      { id: view.selfId, name: playerName(), seat: 'left' },
    ]
    const guest = [...known.entries()].find(([id, info]) => id !== view.selfId && info.role !== 'host')
    if (guest) players.push({ id: guest[0], name: cleanName(guest[1].name), seat: 'right' })
    view.players = players
    net.send({ type: 'roster', players })
  }

  function onPeer(kind, peerId, token) {
    if (token !== netToken) return
    if (kind === 'join') {
      net?.send({
        type: 'hello',
        name: playerName(),
        role: view.role,
        nonce: view.nonce,
      })
      return
    }
    known.delete(peerId)
    if (view.role === 'host' && !sim) broadcastRoster()
    if (!sim) return
    const opponent = view.players.find((player) => player.id === peerId)
    if (!opponent) return
    view.frozen = true
    view.status =
      view.role === 'host'
        ? `Opponent disconnected. They can rejoin with ${view.code}.`
        : 'The host left the match.'
  }

  function onNet(msg, peerId, token) {
    if (token !== netToken || !msg || typeof msg !== 'object') return
    if (msg.sim && msg.sim !== SIM_VERSION) {
      view.error = 'This match needs both players on the same version. Refresh and try again.'
      return
    }
    if (msg.type === 'hello') return onHello(peerId, msg)
    if (msg.type === 'roster' && view.role === 'guest') {
      view.players = Array.isArray(msg.players) ? msg.players : []
      view.linked = view.players.some((player) => player.seat === 'left')
      view.status = view.players.length > 1 ? 'Waiting for the host to start.' : 'Waiting for an opponent…'
      view.error = ''
      return
    }
    if (msg.type === 'full') {
      view.error = 'That match is full.'
      void leave({ keepError: true })
      return
    }
    if (msg.type === 'start') {
      beginOnline(msg, 'right')
      return
    }
    if (msg.type === 'snapshot') {
      applySnapshot(msg.snap)
      return
    }
    if (!sim) return
    if (msg.type === 'pose') return onPose(msg)
    if (msg.type === 'intent' && view.role === 'host') return onIntent(msg, peerId)
    if (msg.type === 'commit') return onCommit(msg)
    if (msg.type === 'reject' && msg.turnId === sim.turn?.id) view.waiting = false
  }

  function onHello(peerId, msg) {
    if (msg.role !== 'host' && msg.role !== 'guest') return
    remember(peerId, { name: cleanName(msg.name), role: msg.role, nonce: msg.nonce })
    if (view.role === 'host' && msg.role === 'host' && Number(msg.nonce) < view.nonce) {
      void retakeCode()
      return
    }
    if (view.role !== 'host') {
      view.linked = true
      view.error = ''
      return
    }
    const others = net?.peers() || []
    const seated = view.players.find((player) => player.seat === 'right')
    if (seated && seated.id !== peerId && others.includes(seated.id)) {
      net.sendTo(peerId, { type: 'full' })
      return
    }
    broadcastRoster()
    if (sim) {
      view.needSnapshot = true
      view.frozen = false
      maybeSendSnapshot()
    }
  }

  async function retakeCode() {
    if (view.retakes >= 5) {
      view.error = 'Could not find an open code. Try again in a moment.'
      await leave({ keepError: true })
      return
    }
    view.retakes += 1
    view.code = randomCode()
    view.status = 'That code was taken. Here is a new one.'
    view.players = []
    known.clear()
    await connect(view.code)
  }

  function startOnline() {
    if (view.role !== 'host' || view.players.length < 2 || sim?.phase === Phase.FLIGHT) return
    const rules = mergeRules()
    const teams = [
      { id: 'left', name: view.players.find((player) => player.seat === 'left')?.name || 'Crimson' },
      { id: 'right', name: view.players.find((player) => player.seat === 'right')?.name || 'Teal' },
    ]
    const payload = {
      type: 'start',
      seed: Math.floor(Math.random() * 0x7fffffff) || 1,
      rules,
      teams,
    }
    net?.send(payload)
    beginOnline(payload, 'left')
  }

  function beginOnline(payload, seat) {
    if (!payload?.teams || !Number.isFinite(payload.seed)) return
    const rules = mergeRules(payload.rules || {})
    rules.keepersPerTeam = Math.min(4, Math.max(1, rules.keepersPerTeam | 0))
    rules.turnSeconds = Math.min(120, Math.max(5, Number(rules.turnSeconds) || 35))
    try {
      sim = createMatch({ seed: payload.seed, rules, teams: payload.teams })
    } catch (error) {
      view.error = 'Could not start the match.'
      console.warn(error)
      return
    }
    localTeam = seat
    controls = seat === 'left' ? { left: 'human', right: 'remote' } : { left: 'remote', right: 'human' }
    view.frozen = false
    view.error = ''
    view.screen = 'play'
    onTurnBegan()
  }

  function onIntent(msg, peerId) {
    if (!sim || msg.turnId !== sim.turn.id || sim.phase !== Phase.AIM) {
      net?.sendTo(peerId, { type: 'reject', turnId: msg.turnId })
      return
    }
    if (msg.intent === 'skip') {
      const turnId = sim.turn.id
      skipTurn(sim)
      net?.send({ type: 'commit', intent: 'skip', turnId })
      onTurnBegan()
      return
    }
    if (msg.intent !== 'fire') return
    const turnId = sim.turn.id
    const result = beginShot(sim, msg)
    if (!result.ok) {
      net?.sendTo(peerId, { type: 'reject', turnId })
      return
    }
    net?.send({ type: 'commit', intent: 'fire', turnId, ...result.command })
    startPlayback()
  }

  function onCommit(msg) {
    if (!sim || msg.turnId !== sim.turn.id || sim.phase !== Phase.AIM) return
    view.waiting = false
    if (msg.intent === 'skip') {
      skipTurn(sim)
      onTurnBegan()
      return
    }
    if (msg.intent !== 'fire') return
    const result = beginShot(sim, msg)
    if (!result.ok) return
    startPlayback()
  }

  function onPose(msg) {
    if (!sim || sim.phase !== Phase.AIM || msg.turnId !== sim.turn.id || canHuman()) return
    selectKeeper(sim, msg.keeperId)
    const keeper = keeperById(sim, msg.keeperId)
    if (!keeper || keeper.team !== sim.turn.team) return
    walkToward(sim.terrain, keeper, Number(msg.x), 80)
    if (Number.isFinite(msg.angle)) view.aimAngle = msg.angle
    if (typeof msg.weaponId === 'string') view.weaponId = msg.weaponId
    if (Number.isFinite(msg.power)) view.power = msg.power
  }

  function maybeSendSnapshot() {
    if (view.role !== 'host' || !view.needSnapshot || !net || !sim) return
    if (sim.phase === Phase.FLIGHT) return
    net.send({ type: 'snapshot', snap: serializeSim(sim) })
    view.needSnapshot = false
  }

  function applySnapshot(snap) {
    try {
      sim = hydrateSim(snap)
    } catch (error) {
      view.error = 'Could not restore the match.'
      console.warn(error)
      return
    }
    view.frozen = false
    view.visual = null
    view.terrainDirty = true
    view.screen = sim.phase === Phase.OVER ? 'over' : 'play'
    if (sim.phase === Phase.AIM) {
      turnClock = sim.turn.timeLeft
      view.banner = `${activeKeeper(sim)?.name || 'Keeper'}'s turn`
      view.bannerTime = 1
    }
  }

  function rematch() {
    if (view.role === 'guest') return
    if (view.role === 'host') {
      startOnline()
      return
    }
    if (!sim) return
    startLocal(sim.setup.teams, controls, localTeam)
  }

  async function leave({ keepError = false } = {}) {
    const error = keepError ? view.error : ''
    await closeNet()
    sim = null
    view.screen = 'home'
    view.role = null
    view.players = []
    view.frozen = false
    view.status = ''
    view.error = error
    view.busy = false
    known.clear()
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(view.code)
      view.status = 'Code copied.'
    } catch {
      view.status = `Code ${view.code}`
    }
  }

  function drawModel() {
    const showing = view.screen === 'play' || view.screen === 'over' ? sim : backdrop
    const keeper = showing && showing.phase === Phase.AIM ? activeKeeper(showing) : null
    let trace = []
    if (keeper && (view.screen === 'play' || view.screen === 'home' || view.screen === 'lobby')) {
      const weaponId = view.screen === 'play' ? view.weaponId : 'shell'
      const power = view.screen === 'play' && view.power > 0 ? view.power : 68
      const angle = view.screen === 'play' ? view.aimAngle : -0.7
      if (view.screen === 'play') {
        trace = traceShot(showing, { keeperId: keeper.id, weaponId, angle, power })
      }
    }
    return {
      sim: showing,
      flight: view.flight,
      visualCells: view.screen === 'play' ? view.visual?.cells : null,
      terrainDirty: view.terrainDirty,
      aimAngle: view.screen === 'play' ? view.aimAngle : -0.7,
      trace,
      particles: view.particles,
      floaters: view.floaters,
      shake: view.shake,
      clouds: view.clouds,
      banner: view.screen === 'play' || view.screen === 'over' ? view.banner : '',
      bannerTime: view.bannerTime,
      time: view.time,
      reduceMotion,
    }
  }

  function uiModel() {
    const keeper = sim ? activeKeeper(sim) : null
    const presented = presentedKeepers()
    let hint = 'Aim with the mouse. Hold Fire or Space. A and D move. 1–3 change weapons.'
    if (sim?.phase === Phase.FLIGHT) hint = 'Shot in the air.'
    else if (sim && controls[sim.turn.team] === 'ai') hint = 'The castle bot is lining up a shot.'
    else if (sim && !canHuman() && sim.phase === Phase.AIM) hint = `Waiting for ${teamName(sim.turn.team)}.`
    else if (localTeam === 'both' && sim?.phase === Phase.AIM) hint = `${keeper?.name || 'Keeper'}'s turn. Pass the keyboard, then aim and fire.`
    return {
      screen: view.screen,
      name: view.name,
      code: view.code,
      status: view.status,
      error: view.error,
      role: view.role,
      players: view.players,
      busy: view.busy,
      sim,
      keepers: presented,
      weaponId: view.weaponId,
      power: view.power,
      canControl: canHuman(),
      waiting: view.waiting,
      controlTeam: sim?.turn?.team || 'left',
      muted: view.muted,
      hint,
      frozen: view.frozen && view.screen === 'play',
      banner: view.screen === 'over' ? winnerText() : view.banner,
      debug: view.debug,
      debugText: sim ? `${sim.phase} #${simChecksum(sim).toString(16)}` : '',
    }
  }

  function presentedKeepers() {
    if (!sim) return []
    if (sim.phase === Phase.FLIGHT) {
      const frame = frameAt(sim, view.flight)
      if (frame) {
        return frame.keepers.map((keeper) => ({
          ...keeper,
          name: keeperById(sim, keeper.id)?.name || keeper.name,
        }))
      }
    }
    return sim.keepers
  }

  function teamName(teamId) {
    return sim?.teams.find((team) => team.id === teamId)?.name || 'the other castle'
  }
}
