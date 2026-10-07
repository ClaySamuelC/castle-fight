import { WORLD } from '../game/rules.js'

let captureGameKeys = false

export function setGameCapture(next) {
  captureGameKeys = next
}

export function createInput(canvas) {
  const state = {
    keys: new Set(),
    justDown: new Set(),
    justUp: new Set(),
    pointer: { down: false, justDown: false, justUp: false, over: false },
    world: { x: WORLD.width / 2, y: WORLD.height / 2 },
    wheel: 0,
  }

  function place(event) {
    const rect = canvas.getBoundingClientRect()
    state.world.x = ((event.clientX - rect.left) / rect.width) * WORLD.width
    state.world.y = ((event.clientY - rect.top) / rect.height) * WORLD.height
  }

  function typingTarget(event) {
    const tag = event.target?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA'
  }

  window.addEventListener('keydown', (event) => {
    if (typingTarget(event)) return
    if (
      captureGameKeys &&
      ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code)
    ) {
      event.preventDefault()
    }
    if (event.repeat || state.keys.has(event.code)) return
    state.keys.add(event.code)
    state.justDown.add(event.code)
  })

  window.addEventListener('keyup', (event) => {
    if (!state.keys.has(event.code)) return
    state.keys.delete(event.code)
    state.justUp.add(event.code)
  })

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    canvas.setPointerCapture?.(event.pointerId)
    place(event)
    state.pointer.down = true
    state.pointer.justDown = true
    state.pointer.over = true
  })

  canvas.addEventListener('pointermove', (event) => {
    place(event)
    state.pointer.over = true
  })

  window.addEventListener('pointerup', (event) => {
    if (!state.pointer.down) return
    place(event)
    state.pointer.down = false
    state.pointer.justUp = true
  })

  canvas.addEventListener('pointerleave', () => {
    state.pointer.over = false
  })

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      state.wheel += Math.sign(event.deltaY)
    },
    { passive: false },
  )

  window.addEventListener('blur', () => {
    state.keys.clear()
    state.pointer.down = false
  })

  return {
    state,
    endFrame() {
      state.justDown.clear()
      state.justUp.clear()
      state.pointer.justDown = false
      state.pointer.justUp = false
      state.wheel = 0
    },
  }
}
