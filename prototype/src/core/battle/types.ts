// The authoritative state of a v6 commander battle (§1).
//
// Shape rules, so that the later batches can add behaviour without reshaping it:
//
//   * Every field named by §1.17's digest list exists here, and nothing that the
//     digest must not see (derived caches, renderer state) does. `digest.ts` walks
//     the whole object, so "in the state" and "in the digest" are the same thing
//     and a new rule cannot silently escape replay.
//   * Fields owned by a later batch are present and inert, not absent. Adding a
//     field later would change every recorded digest; adding behaviour to a field
//     that was already there does not.
//   * Terrain is stored as the two authored classes only. `movementBlockers` and
//     `sightBlockers` are derived on read (state.ts) so the two views can never
//     drift apart from the source lists.

import type { TerrainRect } from '../gameplay/terrain'
import type { CardId } from './constants'
import type { BattlePrngStates } from './streams'

export type Vec2 = { x: number; y: number }

/** §1.1: `paused` / `awaiting-upgrade` / hidden do not advance `combatTick`. */
export type BattleMode = 'ready' | 'running' | 'paused' | 'awaiting-upgrade' | 'won' | 'lost'
export type BattleResult = 'won' | 'lost' | null
/** §1.16: `all-units-lost` outranks `elite-survived`. */
export type FailureReason = 'all-units-lost' | 'elite-survived' | null

export type LifeState = 'standing' | 'downed' | 'dead'
export type FriendlyRole = 'commander' | 'soldier'
/** §1.9. */
export type EnemyClass = 'melee' | 'shooter'

export type FriendlyUnit = {
  id: number
  /** Fixed for the whole run — succession moves command, never the body's role. */
  role: FriendlyRole
  /** §1.14: index into `NAME_POOL`, preserved through death. */
  nameIndex: number
  hp: number
  maxHp: number
  life: LifeState
  position: Vec2
  attackCooldown: number
  targetId: number | null
  /** §1.14: the tick this unit died, or null while it is standing or downed. */
  deathTick: number | null
  /** §1.11 — owned by the rescue batch. */
  downedTicks: number
  /** §1.11 — owned by the rescue batch. */
  invulnerableTicks: number
  /** §1.14: ids of everyone who has ever rescued this unit, in rescue order. */
  rescuedByIds: number[]
  /** §1.3: this tick's actual displacement. Set by every movement rule. */
  lastDisplacement: number
}

export type EnemyUnit = {
  id: number
  enemyClass: EnemyClass
  hp: number
  maxHp: number
  /** Enemies never go `downed`; the field is shared so the digest shape is uniform. */
  life: LifeState
  position: Vec2
  attackCooldown: number
  targetId: number | null
  deathTick: number | null
  lastDisplacement: number
  /** §1.7 — owned by the enemy-movement batch. */
  zeroDisplacementTicks: number
  /** §1.7 — the target excluded on the retarget after 30 stuck ticks. */
  excludedTargetId: number | null
  /** §1.9 — the friendly whose contact/target slot this enemy holds. */
  contactSlotOwnerId: number | null
}

/** §1.4: fixed id-ascending slot assignment, never recomputed. */
export type SlotAssignment = {
  unitId: number
  /** Index into `FORMATION_SLOTS`. */
  slotIndex: number
  /**
   * §1.4 pull latch. Non-null once the slot has been pulled out of movement-blocking
   * terrain; released only when the command unit moves again.
   */
  latchedPosition: Vec2 | null
}

/** §1.10: a spawn request keeps the coordinate fixed at the tick it was made. */
export type SpawnRequest = {
  id: number
  enemyClass: EnemyClass
  position: Vec2
  requestedTick: number
  /** Monotonic; defines backlog order and the oldest-first discard. */
  sequence: number
}

export type SpawnState = {
  backlog: SpawnRequest[]
  /** Next id handed to an enemy. Reserved at request time so backlog ids are stable. */
  nextEnemyId: number
  nextRequestSequence: number
  lastRequestTick: number
  /** §1.10: discarded because the backlog was already full. */
  discardedByBacklogOverflow: number
  /** §1.10: discarded because the absolute live cap was reached. */
  discardedByAbsoluteCap: number
  /** §1.10: discarded because 8 redraws all landed inside blocking terrain. */
  discardedByTerrain: number
}

export type ElitePhase = 'absent' | 'idle' | 'telegraph' | 'cooldown' | 'dead'

export type EliteState = {
  id: number
  phase: ElitePhase
  hp: number
  maxHp: number
  position: Vec2
  spawnTick: number | null
  /** §1.12: frozen at the tick the telegraph started. */
  telegraphCenter: Vec2 | null
  telegraphRemaining: number
  cooldownRemaining: number
  deathTick: number | null
  lastDisplacement: number
}

/** §1.13: one entry per upgrade round, offered and chosen both recorded. */
export type UpgradeRound = {
  round: number
  tick: number
  offered: CardId[]
  chosen: CardId | null
}

export type UpgradeState = {
  /** §1.13: only the chosen card leaves the pool. */
  remainingPool: CardId[]
  rounds: UpgradeRound[]
  /** Index into `UPGRADE_KILL_THRESHOLDS`; at most 4 rounds ever fire. */
  nextThresholdIndex: number
}

/** §1.11: at most one rescue at a time. */
export type RescueLock = {
  active: boolean
  targetId: number | null
  progress: number
}

/** §1.15: the held movement vector and Space state, both part of the digest. */
export type BattleInput = {
  move: Vec2
  spaceHeld: boolean
}

export type BattleTerrain = {
  high: TerrainRect[]
  low: TerrainRect[]
}

export type BattleState = {
  schemaVersion: 1
  rootSeed: string
  combatTick: number
  mode: BattleMode
  result: BattleResult
  failureReason: FailureReason
  /** §1.17: the internal state of all four named streams. */
  prng: BattlePrngStates
  terrain: BattleTerrain
  commandUnitId: number
  /** §1.5: the body that unconditionally reclaims command when it stands again. */
  originalCommanderId: number
  slotAssignments: SlotAssignment[]
  /** §1.4: set by command-unit movement; releases the slot pull latch. */
  commandUnitMoved: boolean
  input: BattleInput
  friendlies: FriendlyUnit[]
  enemies: EnemyUnit[]
  spawn: SpawnState
  elite: EliteState
  upgrades: UpgradeState
  rescue: RescueLock
  /** §1.13: elite kills are excluded from `kills` on purpose. */
  stats: { kills: number; rescues: number }
}
