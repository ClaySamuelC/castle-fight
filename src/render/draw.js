import { WORLD, TEAM_STYLE } from '../game/rules.js'
import { Phase, activeKeeper, frameAt } from '../game/match.js'
import { traceShot } from '../game/simulate.js'
import { terrainColor, projectileColor } from './palette.js'

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d')
  const buffer = document.createElement('canvas')
  const bufferCtx = buffer.getContext('2d', { willReadFrequently: true })
  let painted = null

  function resize() {
    const bounds = Math.min(window.innerWidth - 20, (window.innerHeight - 20) * (WORLD.width / WORLD.height))
    const cssW = Math.max(320, Math.floor(bounds))
    const cssH = Math.floor(cssW * (WORLD.height / WORLD.width))
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    ctx.setTransform((cssW / WORLD.width) * dpr, 0, 0, (cssH / WORLD.height) * dpr, 0, 0)
  }

  function paintTerrain(cells) {
    const { width, height } = WORLD
    if (buffer.width !== width) buffer.width = width
    if (buffer.height !== height) buffer.height = height
    const image = bufferCtx.createImageData(width, height)
    const data = image.data
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = cells[y * width + x]
        if (!cell) continue
        const [r, g, b] = terrainColor(cell, x, y, cells, width)
        const i = (y * width + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
      }
    }
    bufferCtx.putImageData(image, 0, 0)
    painted = cells
  }

  function draw(state) {
    const sim = state.sim
    const shake = state.reduceMotion ? 0 : state.shake
    const ox = shake ? Math.sin(state.time * 48) * shake : 0
    const oy = shake ? Math.cos(state.time * 37) * shake : 0
    ctx.clearRect(-20, -20, WORLD.width + 40, WORLD.height + 40)
    ctx.save()
    ctx.translate(ox, oy)
    drawSky(ctx, state)
    drawHills(ctx)
    drawWater(ctx, sim?.terrain.waterY ?? 494, state.time)
    const cells = state.visualCells || sim?.terrain.cells
    if (cells && (state.terrainDirty || painted !== cells)) paintTerrain(cells)
    if (painted) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(buffer, 0, 0)
      ctx.imageSmoothingEnabled = true
    }
    if (sim) {
      drawProps(ctx, sim, cells)
      drawKeepers(ctx, state)
      drawAim(ctx, state)
      drawProjectiles(ctx, state)
    }
    drawParticles(ctx, state.particles)
    drawFloaters(ctx, state.floaters)
    if (state.banner && state.bannerTime > 0) drawBanner(ctx, state.banner, state.bannerTime)
    ctx.restore()
  }

  return { resize, draw, world: WORLD }
}

function drawSky(ctx, state) {
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD.height)
  sky.addColorStop(0, '#6ea6d4')
  sky.addColorStop(0.55, '#d7ecf6')
  sky.addColorStop(1, '#f3d7b0')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, WORLD.width, WORLD.height)
  ctx.fillStyle = '#ffe7ad'
  ctx.beginPath()
  ctx.arc(760, 78, 36, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255, 231, 173, 0.35)'
  ctx.beginPath()
  ctx.arc(760, 78, 58, 0, Math.PI * 2)
  ctx.fill()
  for (const cloud of state.clouds) drawCloud(ctx, cloud)
}

function drawCloud(ctx, cloud) {
  ctx.fillStyle = 'rgba(255, 252, 247, 0.82)'
  ctx.beginPath()
  ctx.ellipse(cloud.x, cloud.y, 46 * cloud.s, 16 * cloud.s, 0, 0, Math.PI * 2)
  ctx.ellipse(cloud.x + 28 * cloud.s, cloud.y + 6, 28 * cloud.s, 14 * cloud.s, 0, 0, Math.PI * 2)
  ctx.ellipse(cloud.x - 26 * cloud.s, cloud.y + 8, 24 * cloud.s, 12 * cloud.s, 0, 0, Math.PI * 2)
  ctx.fill()
}

function drawHills(ctx) {
  ctx.fillStyle = '#8eafc4'
  ctx.beginPath()
  ctx.moveTo(0, 250)
  for (let x = 0; x <= WORLD.width; x += 20) {
    ctx.lineTo(x, 246 + Math.sin(x * 0.01) * 18 + Math.sin(x * 0.021) * 8)
  }
  ctx.lineTo(WORLD.width, 320)
  ctx.lineTo(0, 320)
  ctx.fill()
}

function drawWater(ctx, waterY, time) {
  const water = ctx.createLinearGradient(0, waterY - 10, 0, WORLD.height)
  water.addColorStop(0, '#3f8ea3')
  water.addColorStop(1, '#1d4d63')
  ctx.fillStyle = water
  ctx.fillRect(0, waterY, WORLD.width, WORLD.height - waterY)
  ctx.strokeStyle = 'rgba(233, 247, 250, 0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = 0; x <= WORLD.width; x += 8) {
    const y = waterY + Math.sin(x * 0.04 + time * 1.6) * 2.2
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawProps(ctx, sim, cells) {
  for (const prop of sim.terrain.props) {
    if (prop.type !== 'banner') continue
    const ix = Math.round(prop.x)
    const iy = Math.round(prop.y + 20)
    if (cells && iy > 0 && iy < WORLD.height && !cells[iy * WORLD.width + ix]) continue
    const style = TEAM_STYLE[prop.team]
    ctx.fillStyle = '#5c5148'
    ctx.fillRect(prop.x - 1, prop.y, 2, 22)
    ctx.fillStyle = style.ink
    ctx.beginPath()
    ctx.moveTo(prop.x + 1, prop.y + 2)
    ctx.lineTo(prop.x + 16, prop.y + 7)
    ctx.lineTo(prop.x + 1, prop.y + 12)
    ctx.fill()
  }
}

function presentedKeepers(state) {
  if (state.sim.phase === Phase.FLIGHT) {
    const frame = frameAt(state.sim, state.flight)
    if (frame) return frame.keepers
  }
  return state.sim.keepers
}

function drawKeepers(ctx, state) {
  const keepers = presentedKeepers(state)
  const active = activeKeeper(state.sim)
  for (const keeper of keepers) {
    drawKeeper(ctx, keeper, {
      active: active?.id === keeper.id && state.sim.phase === Phase.AIM,
      angle: active?.id === keeper.id ? state.aimAngle : null,
      waterY: state.sim.terrain.waterY,
    })
  }
}

function drawKeeper(ctx, keeper, { active, angle, waterY }) {
  if (keeper.hp <= 0) {
    if (keeper.y >= waterY - 2) return
    ctx.fillStyle = 'rgba(60, 52, 46, 0.8)'
    ctx.beginPath()
    ctx.ellipse(keeper.x, keeper.y, 8, 3, 0, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const style = TEAM_STYLE[keeper.team]
  ctx.save()
  ctx.translate(keeper.x, keeper.y)
  ctx.fillStyle = 'rgba(40, 32, 24, 0.28)'
  ctx.beginPath()
  ctx.ellipse(0, 0, 10, 3.5, 0, 0, Math.PI * 2)
  ctx.fill()
  if (active) {
    ctx.strokeStyle = '#e7c27a'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.ellipse(0, 0, 12, 4, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = style.deep
  ctx.fillRect(-6, -15, 12, 10)
  ctx.fillStyle = '#d9d2c6'
  ctx.beginPath()
  ctx.arc(0, -18, 6.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = style.ink
  ctx.beginPath()
  ctx.ellipse(keeper.facing * 2, -23, 3.2, 4.2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2c2824'
  ctx.fillRect(-3, -19, 6, 2)
  if (angle != null && active) {
    ctx.save()
    ctx.translate(0, -16)
    ctx.rotate(angle)
    ctx.fillStyle = '#3a342e'
    ctx.fillRect(4, -2.2, 15, 4.4)
    ctx.fillStyle = '#1d1a17'
    ctx.beginPath()
    ctx.arc(19, 0, 2.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const hpWidth = 26
  ctx.fillStyle = 'rgba(20, 16, 12, 0.65)'
  ctx.fillRect(-hpWidth / 2, -34, hpWidth, 4)
  const tint = keeper.hp > 55 ? '#7dba5a' : keeper.hp > 25 ? '#e0b15a' : '#d25b4a'
  ctx.fillStyle = tint
  ctx.fillRect(-hpWidth / 2, -34, hpWidth * (keeper.hp / 100), 4)
  ctx.restore()
}

function drawAim(ctx, state) {
  if (state.sim.phase !== Phase.AIM || !state.trace?.length) return
  ctx.fillStyle = 'rgba(48, 36, 24, 0.55)'
  for (const point of state.trace) {
    ctx.beginPath()
    ctx.arc(point.x, point.y, point.hit ? 3.2 : 1.7, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawProjectiles(ctx, state) {
  const frame = state.sim.phase === Phase.FLIGHT ? frameAt(state.sim, state.flight) : null
  if (!frame) return
  for (const shot of frame.projectiles) {
    ctx.fillStyle = projectileColor(shot.weaponId)
    ctx.beginPath()
    ctx.arc(shot.x, shot.y, shot.weaponId === 'scatter' ? 2.4 : 4.2, 0, Math.PI * 2)
    ctx.fill()
    if (shot.weaponId === 'keg') {
      ctx.strokeStyle = '#e6c27a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(shot.x, shot.y, 4.2, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

function drawParticles(ctx, particles) {
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life)
    ctx.fillStyle = particle.color
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size)
  }
  ctx.globalAlpha = 1
}

function drawFloaters(ctx, floaters) {
  ctx.font = '700 15px "Nunito Sans", sans-serif'
  ctx.textAlign = 'center'
  for (const floater of floaters) {
    ctx.globalAlpha = Math.max(0, floater.life)
    ctx.fillStyle = '#2a2118'
    ctx.fillText(floater.text, floater.x + 1, floater.y + 1)
    ctx.fillStyle = '#fff8ea'
    ctx.fillText(floater.text, floater.x, floater.y)
  }
  ctx.globalAlpha = 1
}

function drawBanner(ctx, text, time) {
  ctx.globalAlpha = Math.min(1, time * 2)
  ctx.fillStyle = 'rgba(28, 22, 16, 0.88)'
  const width = Math.min(520, 36 + text.length * 15)
  roundRect(ctx, (WORLD.width - width) / 2, 74, width, 40, 10)
  ctx.fill()
  ctx.fillStyle = '#f6e7c8'
  ctx.font = '620 22px Fraunces, Georgia, serif'
  ctx.textAlign = 'center'
  ctx.fillText(text, WORLD.width / 2, 101)
  ctx.globalAlpha = 1
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
