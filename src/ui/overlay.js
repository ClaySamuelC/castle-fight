import { TEAM_STYLE } from '../game/rules.js'
import { weaponList } from '../game/weapons.js'
import { Phase } from '../game/match.js'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function button(className, text, onClick) {
  const node = el('button', className, text)
  node.type = 'button'
  node.addEventListener('click', onClick)
  return node
}

export function createUi(overlay, actions) {
  let screen = ''
  const refs = {}

  function show(next, build) {
    if (screen === next) return false
    screen = next
    overlay.classList.toggle('menu-open', next === 'home' || next === 'lobby' || next === 'over')
    overlay.replaceChildren(build())
    return true
  }

  function sync(model) {
    if (model.screen === 'home') {
      const fresh = show('home', () => home(model, actions, refs))
      if (!fresh) refs.homeError.textContent = model.error || ''
      return
    }
    if (model.screen === 'lobby') {
      const fresh = show('lobby', () => lobby(model, actions, refs))
      if (!fresh) fillLobby(model, refs)
      return
    }
    const mode = model.screen === 'over' ? 'over' : 'play'
    const fresh = show(mode, () => matchHud(actions, refs))
    fillHud(model, refs, actions)
    if (fresh && mode === 'over') fillResult(model, actions, refs)
  }

  return { sync }
}

function home(model, actions, refs) {
  const card = el('section', 'card')
  card.append(
    el('p', 'eyebrow', 'Fort artillery'),
    el('h1', 'title', 'Castle Fight'),
    el(
      'p',
      'lede',
      'Two castles face each other across open ground. Take turns, mind the wind, and bring the other wall down.',
    ),
  )

  const nameLabel = el('label', 'field', 'Your name')
  const name = document.createElement('input')
  name.maxLength = 16
  name.value = model.name
  name.autocomplete = 'nickname'
  name.addEventListener('input', () => actions.setName(name.value))
  nameLabel.append(name)

  const row = el('div', 'row')
  row.append(
    button('primary', 'Create match', () => actions.create()),
    button('ghost', 'Practice', () => actions.practice()),
  )

  const join = document.createElement('form')
  join.className = 'join'
  const code = document.createElement('input')
  code.inputMode = 'numeric'
  code.maxLength = 4
  code.placeholder = '0000'
  code.autocomplete = 'off'
  code.setAttribute('aria-label', 'Four digit match code')
  const joinButton = el('button', 'primary', 'Join')
  joinButton.type = 'submit'
  join.append(code, joinButton)
  join.addEventListener('submit', (event) => {
    event.preventDefault()
    actions.join(code.value)
  })

  refs.homeError = el('p', 'error', model.error || '')
  card.append(nameLabel, row, join, button('texty', 'Same device', () => actions.hotseat()), refs.homeError)
  return card
}

function lobby(model, actions, refs) {
  const card = el('section', 'card')
  refs.code = el('p', 'code', model.code)
  refs.status = el('p', 'status', model.status)
  refs.roster = el('ul', 'roster')
  refs.error = el('p', 'error', '')
  refs.start = button('primary', 'Start match', () => actions.start())
  card.append(
    el('p', 'eyebrow', 'Match code'),
    refs.code,
    button('ghost', 'Copy code', () => actions.copy()),
    refs.roster,
    refs.start,
    refs.status,
    refs.error,
    button('texty', 'Leave', () => actions.leave()),
  )
  fillLobby(model, refs)
  return card
}

function fillLobby(model, refs) {
  refs.code.textContent = model.code || '····'
  refs.status.textContent = model.status || ''
  refs.error.textContent = model.error || ''
  const ready = model.role === 'host' && model.players.length > 1 && !model.busy
  refs.start.disabled = !ready
  refs.start.textContent = model.role === 'host' ? 'Start match' : 'Waiting for the host'
  refs.roster.replaceChildren()
  const seats = model.players.length ? model.players : [{ name: 'Waiting for an opponent', seat: 'left' }]
  for (const player of seats) {
    const item = el('li')
    const style = TEAM_STYLE[player.seat] || TEAM_STYLE.left
    const swatch = el('span', 'swatch')
    swatch.style.background = style.ink
    item.append(swatch, el('span', 'who', player.name || 'Keeper'), el('em', null, style.label))
    refs.roster.append(item)
  }
}

function matchHud(actions, refs) {
  const hud = el('div', 'hud')
  refs.leftTeam = teamBlock()
  refs.rightTeam = teamBlock()
  refs.wind = el('div', 'wind')
  refs.timer = el('div', 'timer', '0:35')
  const teams = el('div', 'teambar')
  teams.append(refs.leftTeam.root, refs.wind, refs.timer, refs.rightTeam.root)

  refs.weapons = el('div', 'weapons')
  for (const weapon of weaponList) {
    const node = button('weapon', weapon.name, () => actions.selectWeapon(weapon.id))
    node.title = weapon.blurb
    node.dataset.weapon = weapon.id
    node.append(el('small', null, ''))
    refs.weapons.append(node)
  }

  refs.fire = button('fire', 'Hold to fire', () => {})
  refs.fire.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    actions.fireDown()
  })
  refs.fire.addEventListener('pointerup', (event) => {
    event.preventDefault()
    actions.fireUp()
  })
  refs.fire.addEventListener('pointerleave', () => actions.fireUp())
  refs.power = el('div', 'power')
  refs.powerBar = el('span')
  refs.power.append(refs.powerBar)
  refs.mute = button('ghost tiny', 'Sound on', () => actions.mute())
  refs.leave = button('ghost tiny', 'Leave', () => actions.leave())
  const dock = el('div', 'dock')
  dock.append(refs.weapons, refs.fire, refs.power, refs.mute, refs.leave)

  refs.hint = el('p', 'hint')
  refs.freeze = el('div', 'freeze')
  refs.freeze.hidden = true
  refs.result = el('section', 'card result')
  refs.result.hidden = true
  hud.append(teams, dock, refs.hint, refs.freeze, refs.result)
  return hud
}

function teamBlock() {
  const root = el('section', 'team')
  const heading = el('h2')
  const pips = el('div', 'pips')
  root.append(heading, pips)
  return { root, heading, pips }
}

function fillHud(model, refs, actions) {
  const sim = model.sim
  if (!sim || !refs.leftTeam) return
  fillTeam(refs.leftTeam, sim, 'left', model, actions)
  fillTeam(refs.rightTeam, sim, 'right', model, actions)
  const wind = sim.turn?.wind ?? 0
  const arrow = wind === 0 ? '·' : wind > 0 ? '→' : '←'
  refs.wind.textContent = wind === 0 ? 'Wind still' : `Wind ${Math.abs(wind)} ${arrow}`
  const seconds = Math.max(0, Math.ceil(sim.turn?.timeLeft ?? 0))
  refs.timer.textContent = sim.phase === Phase.AIM
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : '—'
  for (const node of refs.weapons.children) {
    const id = node.dataset.weapon
    const ammo = sim.ammo?.[model.controlTeam]?.[id]
    node.querySelector('small').textContent = ammo < 0 ? '∞' : String(ammo ?? 0)
    node.classList.toggle('selected', id === model.weaponId)
    node.disabled = !model.canControl || ammo === 0
  }
  refs.fire.disabled = !model.canControl
  refs.fire.textContent = model.waiting ? 'Firing…' : 'Hold to fire'
  refs.powerBar.style.width = `${model.power}%`
  refs.mute.textContent = model.muted ? 'Sound off' : 'Sound on'
  refs.hint.textContent = model.debug ? `${model.hint}  ·  ${model.debugText}` : model.hint
  refs.freeze.hidden = !model.frozen
  refs.freeze.textContent = model.frozen ? model.status : ''
}

function fillTeam(block, sim, teamId, model, actions) {
  const team = sim.teams.find((item) => item.id === teamId)
  const style = TEAM_STYLE[teamId]
  block.heading.textContent = team?.name || style.label
  block.heading.style.color = style.ink
  const keepers = model.keepers.filter((item) => item.team === teamId)
  const signature = keepers.map((keeper) => keeper.id).join(',')
  if (block.signature !== signature) {
    block.signature = signature
    block.pips.replaceChildren()
    for (const keeper of keepers) {
      const pip = button('pip', '', () => actions.selectKeeper(keeper.id))
      pip.dataset.id = keeper.id
      pip.append(el('b'), el('span'), el('i'))
      block.pips.append(pip)
    }
  }
  for (const keeper of keepers) {
    const pip = block.pips.querySelector(`[data-id="${keeper.id}"]`)
    if (!pip) continue
    pip.classList.toggle('active', keeper.id === sim.turn?.keeperId && sim.phase === Phase.AIM)
    pip.classList.toggle('down', keeper.hp <= 0)
    pip.querySelector('b').textContent = keeper.name
    pip.querySelector('span').textContent = String(Math.max(0, keeper.hp))
    pip.querySelector('i').style.width = `${Math.max(0, Math.min(100, keeper.hp))}%`
  }
}

function fillResult(model, actions, refs) {
  refs.result.hidden = false
  refs.result.replaceChildren(
    el('p', 'eyebrow', 'Match over'),
    el('h2', null, model.banner || 'The field is quiet'),
  )
  if (model.role === 'guest') {
    refs.result.append(el('p', 'status', 'Waiting for the host to start another match.'))
  } else {
    refs.result.append(button('primary', 'Rematch', () => actions.rematch()))
  }
  refs.result.append(button('texty', 'Leave', () => actions.leave()))
}
