export function createAudio() {
  let ctx = null
  let master = null
  let muted = false

  function ensure() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return null
      ctx = new AudioCtx()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 0.22
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  function tone(freq, duration, type, gain, slide = 0) {
    const audio = ensure()
    if (!audio || muted) return
    const osc = audio.createOscillator()
    const amp = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, audio.currentTime)
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), audio.currentTime + duration)
    amp.gain.setValueAtTime(gain, audio.currentTime)
    amp.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration)
    osc.connect(amp)
    amp.connect(master)
    osc.start()
    osc.stop(audio.currentTime + duration + 0.02)
  }

  function noise(duration, gain) {
    const audio = ensure()
    if (!audio || muted) return
    const length = Math.floor(audio.sampleRate * duration)
    const buffer = audio.createBuffer(1, length, audio.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)
    const source = audio.createBufferSource()
    source.buffer = buffer
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    const amp = audio.createGain()
    amp.gain.value = gain
    source.connect(filter)
    filter.connect(amp)
    amp.connect(master)
    source.start()
  }

  return {
    unlock: ensure,
    setMuted(next) {
      muted = next
      if (master) master.gain.value = next ? 0 : 0.22
    },
    shot() {
      tone(220, 0.12, 'triangle', 0.2, -80)
      noise(0.08, 0.15)
    },
    boom(radius) {
      noise(0.28, 0.35)
      tone(90 + Math.min(40, radius), 0.3, 'sine', 0.3, -50)
    },
    splash() {
      tone(180, 0.2, 'sine', 0.12, -100)
    },
    turn() {
      tone(520, 0.07, 'sine', 0.08)
    },
    win() {
      tone(440, 0.12, 'triangle', 0.12)
      setTimeout(() => tone(660, 0.18, 'triangle', 0.12), 90)
    },
    ui() {
      tone(640, 0.05, 'square', 0.04)
    },
  }
}
