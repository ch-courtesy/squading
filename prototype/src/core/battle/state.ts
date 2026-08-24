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
//
// THE NAME SHUFFLE ABOVE IS SKIPPED ENTIRELY WHEN A SQUAD IS CARRIED IN (campaign §1.1). The roster, its names
// included, comes from the previous stage, so there is nothing to draw and the `names` stream is
// where the seed put it — ZERO draws, not 23. `tests/battle/battle-state.test.ts` pins both counts
// against the two paths, because "exactly 23 draws" was written as a fact about §1.14 and is a
// fact about the FIRST stage only.

import { createSlotAssignments, isChargerSlot, slotPosition } from './formation'
import {
  CARD_POOL,
  COMMANDER_HP,
  COMMANDER_START,
  ROSTER_SIZE,
  SOLDIER_HP,
  type CardId,
} from './constants'
import { FIRST_STAGE_ID, stageOf, type StageId } from './stages'
import { assignNameIndices } from './names'
import { createStreamStates, streamPrng } from './streams'
import type {
  BattleState,
  CarriedSquad,
  EnemyKind,
  EnemyUnit,
  FriendlyUnit,
  Vec2,
} from './types'

export { ROSTER_SIZE }

/** §1.4: the commander is id 1, the 15 soldiers are ids 2..16. */
export const COMMANDER_ID = 1
export const SOLDIER_IDS: readonly number[] = Array.from(
  { length: ROSTER_SIZE - 1 },
  (_, index) => index + 2,
)
/**
 * §1.2.1's two classes as id lists, derived from §1.4's seating rather than written down.
 *
 * Slots go to soldiers in ascending id, so the front rank is the first five ids — but that is a
 * CONSEQUENCE of two other rules and not a fact of its own, and a hand-written `[2,3,4,5,6]`
 * would survive a lattice change that made it false. Fixtures that mean "a rifleman" should say
 * so with `RIFLEMAN_IDS[0]`; before §1.2.1 every soldier was one and "soldier id 2" meant it by
 * accident.
 */
export const CHARGER_IDS: readonly number[] = createSlotAssignments(SOLDIER_IDS)
  .filter((assignment) => isChargerSlot(assignment.slotIndex))
  .map((assignment) => assignment.unitId)
export const RIFLEMAN_IDS: readonly number[] = SOLDIER_IDS.filter(
  (id) => !CHARGER_IDS.includes(id),
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
  health: { hp: number; maxHp: number } | null = null,
): FriendlyUnit {
  const maxHp = health ? health.maxHp : role === 'commander' ? COMMANDER_HP : SOLDIER_HP
  return {
    id,
    role,
    nameIndex,
    // A carried body opens the stage on the hp it was HANDED, and the battle does not decide what
    // that is. Campaign §1.1 v2 heals the survivors at the boundary (`campaign/transition.ts`), so
    // every squad the relay hands in arrives at `maxHp` and this branch and the fresh-roster one
    // agree in play. It is still a branch rather than an assumption: `CarriedSquad` is an input
    // this function CHECKS rather than trusts (see `createCarriedRoster` below), and a battle that
    // silently refilled whatever it was given would make §1.1's clause unfalsifiable from here.
    hp: health ? health.hp : maxHp,
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
 * §1.13 v2: a full level table at zero — every card in the pool, none of them taken.
 *
 * Written out rather than left sparse for the reason on `UpgradeState.carriedLevels`: a digest
 * that walked a sparse map would depend on which cards happened to be taken.
 */
function emptyCardLevels(): Record<CardId, number> {
  const levels = {} as Record<CardId, number>
  for (const card of CARD_POOL) levels[card] = 0
  return levels
}

/** The fresh 16: §1.14 draws the names, §1.4 seats the soldiers, §1.2 gives everyone full hp. */
function createFreshRoster(
  prng: BattleState['prng'],
  start: Vec2,
): { friendlies: FriendlyUnit[]; slotAssignments: BattleState['slotAssignments'] } {
  const names = assignNameIndices(streamPrng(prng, 'names'), ROSTER_SIZE)
  const slotAssignments = createSlotAssignments(SOLDIER_IDS)

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
  return { friendlies, slotAssignments }
}

/**
 * The carried squad, formed up again (campaign §1.1).
 *
 * The command unit takes `COMMANDER_START` and everyone else takes a slot in ascending id, which
 * is §1.4's assignment over whoever is left. Names, roles, ids and both hit-point numbers come
 * over untouched; everything else about a body is a fact about the finished fight and is rebuilt
 * here at its opening value.
 */
function createCarriedRoster(
  carried: CarriedSquad,
  start: Vec2,
): { friendlies: FriendlyUnit[]; slotAssignments: BattleState['slotAssignments'] } {
  const members = [...carried.members].sort((left, right) => left.id - right.id)
  if (members.length === 0) {
    throw new Error('battle/state: a carried squad with nobody in it cannot open a stage (§1.5)')
  }
  const command = members.find((member) => member.id === carried.commandUnitId)
  if (!command) {
    throw new Error(
      `battle/state: the carried command unit ${carried.commandUnitId} is not in the carried squad`,
    )
  }

  const slotAssignments = createSlotAssignments(
    members.filter((member) => member.id !== command.id).map((member) => member.id),
  )
  const friendlies: FriendlyUnit[] = [
    createFriendly(command.id, command.role, command.nameIndex, { x: start.x, y: start.y }, command),
  ]
  for (const assignment of slotAssignments) {
    const member = members.find((entry) => entry.id === assignment.unitId)!
    const slot = slotPosition(start, assignment.slotIndex)
    friendlies.push(
      createFriendly(member.id, member.role, member.nameIndex, { x: slot.x, y: slot.y }, member),
    )
  }
  return { friendlies, slotAssignments }
}

/**
 * `stageId` DEFAULTS, and the default is the whole campaign today.
 *
 * `STAGES` has one row, so "which stage" has one answer and every existing caller means it. The
 * campaign passes the argument, one stage at a time; a required parameter would only make ~60 call
 * sites spell out the only value there is. The default is a value, not a lookup that ignores its
 * argument — `stageConfigOf` has no fallback.
 *
 * `carried` DEFAULTS TO NULL, which is the campaign's first stage and every existing fixture:
 * a fresh 16 with drawn names and full hit points. Passed, it is campaign §1.1's relay, and the
 * three things it carries are the three §1.1 says must not reset — the roster with its names, each
 * body's hp, and the cards already taken — plus §1.2's cumulative kill count.
 *
 * WHAT IS NOT CARRIED, and every one of these is §1.1's "스테이지마다 초기화되는 것": the enemies,
 * the elite and its cycle, the spawn backlog and its counters, the rescue lock, `combatTick`, and
 * this stage's own kill and rescue counts. They are absent from `CarriedSquad`, so there is no
 * spelling of this call that could carry one by accident.
 */
export function createInitialBattleState(
  seed: string,
  stageId: StageId = FIRST_STAGE_ID,
  carried: CarriedSquad | null = null,
): BattleState {
  const prng = createStreamStates(seed)
  const start: Vec2 = { x: COMMANDER_START.x, y: COMMANDER_START.y }

  const { friendlies, slotAssignments } = carried
    ? createCarriedRoster(carried, start)
    : createFreshRoster(prng, start)
  const commandUnitId = carried ? carried.commandUnitId : COMMANDER_ID
  const carriedLevels = carried ? { ...carried.cardLevels } : emptyCardLevels()
  const owedRounds = carried ? carried.owedUpgradeRounds : 0

  return {
    schemaVersion: 3,
    rootSeed: seed,
    stageId,
    combatTick: 0,
    mode: 'ready',
    result: null,
    failureReason: null,
    prng,
    commandUnitId,
    // §1.5 rule 1 sends command home to the ORIGINAL commander the moment it stands. A carried
    // stage opens with the body that ended the last one in command, and that body IS this stage's
    // original: the one it succeeded is dead (campaign §1.3 kills whoever is still down at the
    // end), so there is nothing left to revert to.
    originalCommanderId: commandUnitId,
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
      rounds: [],
      // §1.13 v2: ZERO in every stage. v1 seeded this from the campaign's kills, and that is
      // precisely what left stages 2-7 with no card screen at all.
      nextThresholdIndex: 0,
      carriedLevels,
      owedRounds,
    },
    rescue: { active: false, targetId: null, progress: 0 },
    stats: { kills: 0, rescues: 0 },
  }
}
