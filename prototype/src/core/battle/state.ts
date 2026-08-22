// The initial authoritative state (§1.1, §1.2, §1.4, §1.14).
//
// Construction order is part of the contract, because it decides how far each
// stream has advanced by tick 0:
//
//   1. derive the three streams from the root seed      (§1.17)
//   2. shuffle names from the `names` stream — 23 draws (§1.14)
//   3. place the commander at (28, 16) and every soldier on its slot
//
// There is no step for terrain any more (§1.6) and no `terrain` stream, so `names` is
// the only stream that has moved at tick 0. `spawn` and `cards` are untouched, and must
// stay that way: the first `spawn` draw has to be the first spawn request's angle, or
// every recorded run diverges.

import { createSlotAssignments, slotPosition } from './formation'
import {
  CARD_POOL,
  COMMANDER_HP,
  COMMANDER_START,
  ROSTER_SIZE,
  SOLDIER_HP,
} from './constants'
import { FIRST_STAGE_ID, stageOf, type StageId } from './stages'
import { assignNameIndices } from './names'
import { createStreamStates, streamPrng } from './streams'
import type { BattleState, EnemyKind, EnemyUnit, FriendlyUnit, Vec2 } from './types'

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

export function findFriendly(state: BattleState, id: number): FriendlyUnit | null {
  for (const unit of state.friendlies) {
    if (unit.id === id) return unit
  }
  return null
}

export function findEnemy(state: BattleState, id: number): EnemyUnit | null {
  for (const enemy of state.enemies) {
    if (enemy.id === id) return enemy
  }
  return null
}

/**
 * §1.5, §1.8, §1.9 all break ties by ascending id, so they must not read
 * `state.friendlies` directly and inherit whatever order the array happens to be in.
 * The array IS kept in id order, but "kept" is a convention and this is the
 * guarantee — one sort of 16 elements, once per rule that needs it.
 */
export function friendliesById(state: BattleState): FriendlyUnit[] {
  return [...state.friendlies].sort((left, right) => left.id - right.id)
}

/** Same guarantee for enemies (§1.8's "정예 우선 → 최근접 → id"). */
export function enemiesById(state: BattleState): EnemyUnit[] {
  return [...state.enemies].sort((left, right) => left.id - right.id)
}

/** §1.12: the elite's body, once it has arrived. */
export function eliteEnemy(state: BattleState): EnemyUnit | null {
  return state.elite.enemyId === null ? null : findEnemy(state, state.elite.enemyId)
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

/**
 * §1.9/§1.12: HP by kind. The elite is an enemy, so its HP lives in the same table.
 *
 * A FUNCTION OF THE STATE rather than a module constant, because all three numbers are §2.2's
 * "적 능력치" / "정예" axes and therefore a stage's. The table is rebuilt on each call and never
 * cached: `stageConfigOf` is a pure lookup and caching it here would be the one place a stale
 * stage could survive a campaign transition.
 */
export function enemyMaxHpOf(state: BattleState, kind: EnemyKind): number {
  const stage = stageOf(state)
  if (kind === 'melee') return stage.meleeHp
  if (kind === 'shooter') return stage.shooterHp
  return stage.eliteHp
}

/**
 * The one place an enemy row is built (§1.9, §1.10, §1.12).
 *
 * Batches C and F both create enemies; without a shared factory they would each
 * initialise `contactSlotOwnerId` by hand, and a row that is missing it is a row the
 * digest sees differently.
 *
 * IT TAKES THE STATE because §1.9's HP is a stage number now, and the state is where the
 * `stageId` is. It reads the state and never writes it — appending the row is the caller's.
 */
export function createEnemy(
  state: BattleState,
  id: number,
  kind: EnemyKind,
  position: Vec2,
): EnemyUnit {
  const maxHp = enemyMaxHpOf(state, kind)
  return {
    id,
    kind,
    hp: maxHp,
    maxHp,
    life: 'standing',
    position: { x: position.x, y: position.y },
    attackCooldown: 0,
    targetId: null,
    deathTick: null,
    lastDisplacement: 0,
    contactSlotOwnerId: null,
  }
}

/**
 * `stageId` DEFAULTS, and the default is the whole campaign today.
 *
 * `STAGES` has one row, so "which stage" has one answer and every existing caller means it. The
 * campaign shell is what will start passing the argument, one stage at a time; until it exists a
 * required parameter would only make ~60 call sites spell out the only value there is. The
 * default is a value, not a lookup that ignores its argument — `stageConfigOf` has no fallback.
 */
export function createInitialBattleState(
  seed: string,
  stageId: StageId = FIRST_STAGE_ID,
): BattleState {
  const prng = createStreamStates(seed)

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
    const slot = slotPosition(start, assignment.slotIndex)
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
    stageId,
    combatTick: 0,
    mode: 'ready',
    result: null,
    failureReason: null,
    prng,
    commandUnitId: COMMANDER_ID,
    originalCommanderId: COMMANDER_ID,
    slotAssignments,
    input: { move: { x: 0, y: 0 }, spaceHeld: false },
    friendlies,
    enemies: [],
    spawn: {
      backlog: [],
      nextEnemyId: FIRST_ENEMY_ID,
      nextRequestSequence: 0,
      // -1 is "no request has ever been made", which is why `pressurePhaseIndexAt` has to
      // answer -1 for a negative tick: it is what makes the first request of the run reset
      // the phase-local melee:shooter index instead of continuing a phase that never ran.
      lastRequestTick: -1,
      requestsInPhase: 0,
      discardedByBacklogOverflow: 0,
      discardedByAbsoluteCap: 0,
    },
    // §1.12: the elite's body is an ordinary row in `enemies` once it arrives at
    // tick 1800, with `kind: 'elite'`. This sidecar is its attack cycle only, so
    // "died mid-telegraph" is representable: the row goes `life: 'dead'` while
    // `attackPhase` is still `'telegraph'`.
    elite: {
      enemyId: null,
      spawnTick: null,
      attackPhase: 'idle',
      telegraphCenter: null,
      telegraphRemaining: 0,
      cooldownRemaining: 0,
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
