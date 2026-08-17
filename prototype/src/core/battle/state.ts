// The initial authoritative state (§1.1, §1.2, §1.4, §1.6, §1.14).
//
// Construction order is part of the contract, because it decides how far each
// stream has advanced by tick 0:
//
//   1. derive the four streams from the root seed          (§1.17)
//   2. generate two-class terrain from the `terrain` stream (§1.6)
//   3. shuffle names from the `names` stream — 23 draws     (§1.14)
//   4. place the commander at (28, 16) and every soldier on its slot
//
// `spawn` and `cards` are untouched at tick 0. Nothing in this file consumes them,
// and nothing should: the first `spawn` draw must be the first spawn request's
// angle, or every recorded run diverges.

import { generateTerrainFrom, type TerrainOptions, type TerrainRect } from '../gameplay/terrain'
import { resolveSlotPosition } from '../gameplay/formation'
import { FORMATION_SLOTS, createSlotAssignments } from './formation'
import {
  CARD_POOL,
  COMMANDER_HP,
  COMMANDER_START,
  ELITE_HP,
  ROSTER_SIZE,
  SOLDIER_HP,
  TERRAIN_OPTIONS,
} from './constants'
import { assignNameIndices } from './names'
import { createStreamStates, streamPrng } from './streams'
import type { BattleState, FriendlyUnit, Vec2 } from './types'

export { ROSTER_SIZE }

/** §1.4: the commander is id 1, the 15 soldiers are ids 2..16. */
export const COMMANDER_ID = 1
export const SOLDIER_IDS: readonly number[] = Array.from(
  { length: ROSTER_SIZE - 1 },
  (_, index) => index + 2,
)
/** Enemy ids start well past the roster so no lookup can confuse the two sides. */
export const FIRST_ENEMY_ID = 101
export const ELITE_ID = 1000

export type BattleStateOptions = {
  /** §1.6 terrain request; defaults to the placeholder layout in `constants.ts`. */
  terrain?: TerrainOptions
}

/** §1.6/§1.7: high cover only. Derived so the two views cannot drift. */
export function movementBlockers(state: BattleState): TerrainRect[] {
  return state.terrain.high
}

/** §1.6/§1.8: both classes block sight. */
export function sightBlockers(state: BattleState): TerrainRect[] {
  return [...state.terrain.high, ...state.terrain.low]
}

export function findFriendly(state: BattleState, id: number): FriendlyUnit | null {
  for (const unit of state.friendlies) {
    if (unit.id === id) return unit
  }
  return null
}

function createFriendly(
  id: number,
  role: FriendlyUnit['role'],
  nameIndex: number,
  position: Vec2,
): FriendlyUnit {
  const maxHp = role === 'commander' ? COMMANDER_HP : SOLDIER_HP
  return {
    id,
    role,
    nameIndex,
    hp: maxHp,
    maxHp,
    life: 'standing',
    position,
    attackCooldown: 0,
    targetId: null,
    deathTick: null,
    downedTicks: 0,
    invulnerableTicks: 0,
    rescuedByIds: [],
    lastDisplacement: 0,
  }
}

export function createInitialBattleState(seed: string, options: BattleStateOptions = {}): BattleState {
  const prng = createStreamStates(seed)

  const layout = generateTerrainFrom(streamPrng(prng, 'terrain'), options.terrain ?? TERRAIN_OPTIONS)
  const names = assignNameIndices(streamPrng(prng, 'names'), ROSTER_SIZE)

  const slotAssignments = createSlotAssignments(SOLDIER_IDS)
  const start: Vec2 = { x: COMMANDER_START.x, y: COMMANDER_START.y }

  const friendlies: FriendlyUnit[] = [
    createFriendly(COMMANDER_ID, 'commander', names[0], { x: start.x, y: start.y }),
  ]
  for (const assignment of slotAssignments) {
    // Soldiers start settled on their own slots, so tick 1 begins with displacement
    // 0 for all 15 (§1.4) rather than a formation-wide shuffle that would silence
    // the squad for its first few ticks.
    const slot = resolveSlotPosition(
      start.x,
      start.y,
      FORMATION_SLOTS[assignment.slotIndex],
      layout.movementBlockers,
    )
    friendlies.push(
      createFriendly(assignment.unitId, 'soldier', names[assignment.unitId - 1], {
        x: slot.x,
        y: slot.y,
      }),
    )
  }

  return {
    schemaVersion: 1,
    rootSeed: seed,
    combatTick: 0,
    mode: 'ready',
    result: null,
    failureReason: null,
    prng,
    terrain: { high: layout.high, low: layout.low },
    commandUnitId: COMMANDER_ID,
    originalCommanderId: COMMANDER_ID,
    slotAssignments,
    commandUnitMoved: false,
    input: { move: { x: 0, y: 0 }, spaceHeld: false },
    friendlies,
    enemies: [],
    spawn: {
      backlog: [],
      nextEnemyId: FIRST_ENEMY_ID,
      nextRequestSequence: 0,
      lastRequestTick: -1,
      discardedByBacklogOverflow: 0,
      discardedByAbsoluteCap: 0,
      discardedByTerrain: 0,
    },
    elite: {
      id: ELITE_ID,
      phase: 'absent',
      hp: ELITE_HP,
      maxHp: ELITE_HP,
      position: { x: 0, y: 0 },
      spawnTick: null,
      telegraphCenter: null,
      telegraphRemaining: 0,
      cooldownRemaining: 0,
      deathTick: null,
      lastDisplacement: 0,
    },
    upgrades: {
      remainingPool: [...CARD_POOL],
      rounds: [],
      nextThresholdIndex: 0,
    },
    rescue: { active: false, targetId: null, progress: 0 },
    stats: { kills: 0, rescues: 0 },
  }
}
