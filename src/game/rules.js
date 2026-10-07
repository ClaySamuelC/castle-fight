/** Logical resolution. Renderers scale this to the window. */
export const WORLD = { width: 960, height: 540 }

export const SIM_VERSION = 1
export const PROTOCOL = 1
export const APP_ID = 'castle-fight.fort.v1'

/**
 * Match rules are plain data. A new mode should spread this and override
 * fields, or add fields that the sim reads with a default, instead of
 * branching on mode name in the hot path.
 */
export const DEFAULT_RULES = {
  id: 'fort',
  mapId: 'forts',
  turnSeconds: 35,
  keepersPerTeam: 3,
  startingHp: 100,
  fallSafePx: 52,
  fallDamagePerPx: 0.5,
  windMin: -5,
  windMax: 5,
  afterShotSeconds: 0.85,
  gravity: 0.155,
  windForce: 0.0115,
}

export const TEAM_ORDER = ['left', 'right']

export const TEAM_STYLE = {
  left: { id: 'left', label: 'Crimson', ink: '#c4453c', deep: '#7e261f' },
  right: { id: 'right', label: 'Teal', ink: '#2c7c76', deep: '#184743' },
}

export const KEEPER_NAMES = {
  left: ['Ash', 'Bram', 'Nell', 'Ivo'],
  right: ['Dove', 'Ember', 'Flint', 'Gale'],
}

export function mergeRules(overrides = {}) {
  return { ...DEFAULT_RULES, ...overrides }
}
