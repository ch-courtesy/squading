import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  NORMAL_ENEMY_CAP,
  NORMAL_ENEMY_MAX_HP,
  NORMAL_ENEMY_SPAWN_RADIUS,
  UPGRADE_XP,
} from './constants'
import type { GameState, UpgradeId, Vec2 } from './types'

export type SpawnEvent = { readonly tick: number; readonly count: number }

export const SPAWN_TABLE: readonly SpawnEvent[] = [
  ...Array.from({ length: 5 }, (_, index) => ({ tick: index * 30, count: 2 })),
  ...Array.from({ length: 9 }, (_, index) => ({ tick: 150 + index * 24, count: 3 })),
  ...Array.from({ length: 9 }, (_, index) => ({ tick: 360 + index * 20, count: 4 })),
  ...Array.from({ length: 12 }, (_, index) => ({ tick: 540 + index * 30, count: 2 })),
]

const CARD_IDS: readonly UpgradeId[] = ['power', 'march', 'vigor']

function nextStreamFloat(state: GameState['prng'], stream: 'spawn' | 'cards'): number {
  let value = state[stream] >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state[stream] = value >>> 0
  return state[stream] / 0x1_0000_0000
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

function spawnPosition(center: Vec2, angle: number): Vec2 {
  return {
    x: clamp(center.x + Math.cos(angle) * NORMAL_ENEMY_SPAWN_RADIUS, ARENA_WIDTH),
    y: clamp(center.y + Math.sin(angle) * NORMAL_ENEMY_SPAWN_RADIUS, ARENA_HEIGHT),
  }
}

function shuffleOfferedCards(state: GameState): readonly UpgradeId[] {
  const offered = [...CARD_IDS]
  for (let index = offered.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(nextStreamFloat(state.prng, 'cards') * (index + 1))
    ;[offered[index], offered[selected]] = [offered[selected], offered[index]]
  }
  return offered
}

export function spawnForTick(state: GameState, tick: number): void {
  const eventIndex = SPAWN_TABLE.findIndex((event) => event.tick === tick)
  if (eventIndex < 0 || eventIndex < state.wave.cursor) return

  const event = SPAWN_TABLE[eventIndex]
  const center = state.squads[state.activeSquad].lastCenter
  state.wave.cursor = eventIndex + 1
  for (let index = 0; index < event.count; index += 1) {
    const angle = nextStreamFloat(state.prng, 'spawn') * Math.PI * 2
    state.wave.requested += 1
    if (state.normalEnemies.filter((enemy) => enemy.hp > 0).length >= NORMAL_ENEMY_CAP) {
      state.wave.discarded += 1
      continue
    }
    state.normalEnemies.push({
      id: 18 + state.wave.requested - 1,
      hp: NORMAL_ENEMY_MAX_HP,
      position: spawnPosition(center, angle),
      attackCooldown: 0,
      targetId: null,
    })
  }
}

export function recordNormalKill(state: GameState): void {
  state.stats.kills += 1
  state.stats.xp += 1
}

export function enterUpgradeIfEligible(state: GameState): void {
  if (state.stats.xp < UPGRADE_XP || state.upgrade.offered.length > 0 || state.upgrade.choice !== null || state.upgrade.applied) return
  state.upgrade = { offered: shuffleOfferedCards(state), choice: null, applied: false }
  state.mode = 'awaiting-upgrade'
}

export function applyUpgradeChoice(state: GameState, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= state.upgrade.offered.length) {
    throw new TypeError('upgrade index is not offered')
  }
  const choice = state.upgrade.offered[index]
  if (!choice) throw new TypeError('upgrade index is not offered')
  state.upgrade = { ...state.upgrade, choice, applied: false }
}

export function applyPendingUpgrade(state: GameState): void {
  if (state.upgrade.applied || state.upgrade.choice === null) return

  switch (state.upgrade.choice) {
    case 'power':
      state.squads.teal.damageMultiplier *= 1.3
      state.squads.scarlet.damageMultiplier *= 1.3
      break
    case 'march':
      state.squads.teal.movementMultiplier *= 1.15
      state.squads.scarlet.movementMultiplier *= 1.15
      break
    case 'vigor':
      state.squads.teal.hpMultiplier *= 1.25
      state.squads.scarlet.hpMultiplier *= 1.25
      for (const friendly of state.friendlies) {
        friendly.maxHp *= 1.25
        friendly.hp *= 1.25
      }
      break
  }
  state.upgrade = { ...state.upgrade, applied: true }
}
