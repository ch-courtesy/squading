import { createPrng } from '../prng'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ELITE_MAX_HP,
  FORMATION_JITTER,
  INITIAL_FORMATION_OFFSETS,
  NORMAL_ENEMY_MAX_HP,
  ROSTER_SIZE,
  SCARLET_MAX_HP,
  SCARLET_INITIAL_CENTER,
  SQUAD_SIZE,
  TEAL_INITIAL_CENTER,
  TEAL_MAX_HP,
} from './constants'
import type { FriendlyState, GameState, GameplayFixture, NormalEnemyState, SquadState, Vec2 } from './types'

const ORIGIN: Vec2 = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 }

function createSquadState(center: Vec2): SquadState {
  return {
    fatigue: 0,
    exhausted: false,
    lastCenter: { x: center.x, y: center.y },
    lastDirection: { x: 0, y: 0 },
    damageMultiplier: 1,
    movementMultiplier: 1,
    hpMultiplier: 1,
  }
}

function createFriendly(id: number, squad: 'teal' | 'scarlet', center: Vec2, formationOffset: Vec2): FriendlyState {
  const maxHp = squad === 'teal' ? TEAL_MAX_HP : SCARLET_MAX_HP
  return {
    id,
    squad,
    hp: maxHp,
    maxHp,
    life: 'standing',
    position: { x: center.x + formationOffset.x, y: center.y + formationOffset.y },
    formationOffset: { x: formationOffset.x, y: formationOffset.y },
    attackCooldown: 0,
    targetId: null,
    downedTicks: 0,
    rescueTargetId: null,
    rescueProgress: 0,
  }
}

function createFormationOffsets(seed: string): { offsets: Vec2[]; state: number } {
  const formation = createPrng(`${seed}:formation`)
  const offsets: Vec2[] = []
  for (let index = 0; index < ROSTER_SIZE; index += 1) {
    const offset = INITIAL_FORMATION_OFFSETS[index % SQUAD_SIZE]
    const jitter = { x: formation.range(-FORMATION_JITTER, FORMATION_JITTER), y: formation.range(-FORMATION_JITTER, FORMATION_JITTER) }
    offsets.push({ x: offset.x + jitter.x, y: offset.y + jitter.y })
  }
  return { offsets, state: formation.getState() }
}

export function createInitialGameState(seed: string, _fixture?: GameplayFixture): GameState {
  const { offsets, state: formationState } = createFormationOffsets(seed)
  const spawn = createPrng(`${seed}:spawn`)
  const cards = createPrng(`${seed}:cards`)
  const friendlies: FriendlyState[] = []
  for (let index = 0; index < SQUAD_SIZE; index += 1) {
    friendlies.push(createFriendly(index + 1, 'teal', TEAL_INITIAL_CENTER, offsets[index]))
  }
  for (let index = 0; index < SQUAD_SIZE; index += 1) {
    friendlies.push(createFriendly(index + SQUAD_SIZE + 1, 'scarlet', SCARLET_INITIAL_CENTER, offsets[index]))
  }

  const normalEnemies: NormalEnemyState[] = []
  return {
    schemaVersion: 1,
    rootSeed: seed,
    combatTick: 0,
    mode: 'ready',
    failureReason: null,
    activeSquad: 'scarlet',
    switchCooldown: 0,
    prng: { cards: cards.getState(), formation: formationState, spawn: spawn.getState() },
    wave: { cursor: 0, requested: 0, discarded: 0 },
    input: { move: { x: 0, y: 0 }, rescueHeld: false },
    inputCursor: 0,
    pendingEvents: [],
    squads: { teal: createSquadState(TEAL_INITIAL_CENTER), scarlet: createSquadState(SCARLET_INITIAL_CENTER) },
    friendlies,
    normalEnemies,
    elite: {
      id: ROSTER_SIZE + 1,
      spawned: false,
      hp: ELITE_MAX_HP,
      position: ORIGIN,
      targetId: null,
      telegraphCenter: null,
      telegraphRemaining: 0,
      cycleIndex: 0,
      warningTicks: [],
      damageTicks: [],
    },
    damageEvents: [],
    stats: { kills: 0, xp: 0, rescues: 0 },
    upgrade: { offered: [], choice: null, applied: false },
  }
}
