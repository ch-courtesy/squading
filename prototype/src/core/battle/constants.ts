// Every harness-owned number for the v6 commander battle lives in this file.
//
// The design (§2, §5 stage 0) deliberately defers balance to a later measurement
// stage. So this file is split in two:
//
//   FIXED    — §1.2 anchors and §1.1 geometry. The harness does NOT change these.
//              Enemy numbers are searched as ratios against them; letting both
//              sides move at once produces infinitely many equivalent combos.
//   PLACEHOLDER — everything the tuning stage owns. Each one is marked. The values
//              below are arbitrary starting points chosen only so that stage 0 can
//              run; no measurement backs any of them.
//
// Structural relations that the spec states as invariants (not as search ranges)
// are asserted at module load, so a tuning pass that violates one fails loudly at
// import time instead of producing a subtly broken run.

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COMMANDER_START,
  TERRAIN_CLEAR_RADIUS,
  type TerrainOptions,
} from '../gameplay/terrain'
import { SLOT_PULL_MAX_STEPS, SLOT_PULL_STEP } from '../gameplay/formation'

export { ARENA_HEIGHT, ARENA_WIDTH, COMMANDER_START, TERRAIN_CLEAR_RADIUS }
export { SLOT_PULL_MAX_STEPS, SLOT_PULL_STEP }

// ---------------------------------------------------------------------------
// FIXED — §1.1 coordinates and clock
// ---------------------------------------------------------------------------

/** §1.1: 90 seconds at 30Hz. */
export const COMBAT_TICK_LIMIT = 2700
/** §1.1: digest floats are normalized to 6 decimal places. */
export const DIGEST_DECIMALS = 6
/** §1.4: 1 commander + 15 soldiers. */
export const ROSTER_SIZE = 16

// ---------------------------------------------------------------------------
// FIXED — §1.2 friendly anchors
// ---------------------------------------------------------------------------

export const COMMANDER_MOVE_SPEED = 0.115
export const COMMANDER_RANGE = 6.0
export const COMMANDER_ATTACK_INTERVAL = 10
export const COMMANDER_DAMAGE = 0.2

export const SOLDIER_MOVE_SPEED = 0.1
export const SOLDIER_RANGE = 5.0
export const SOLDIER_ATTACK_INTERVAL = 12
export const SOLDIER_DAMAGE = 0.12

/** §1.2: a follower may close at 1.30x its own move speed, never more. */
export const FOLLOW_SPEED_MULTIPLIER = 1.3
export const FOLLOW_MAX_SPEED = SOLDIER_MOVE_SPEED * FOLLOW_SPEED_MULTIPLIER

// ---------------------------------------------------------------------------
// PLACEHOLDER — friendly HP (§2: commander 3~7, soldier 1.0~2.0)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const COMMANDER_HP = 5.0
/** PLACEHOLDER */
export const SOLDIER_HP = 1.4

// ---------------------------------------------------------------------------
// PLACEHOLDER — epsilons (§2: MOVE 0.001~0.02, ARRIVE <= MOVE, EJECT 0.001~0.01)
// ---------------------------------------------------------------------------

/** PLACEHOLDER — §1.3 stop threshold: displacement below this counts as stopped. */
export const MOVE_EPSILON = 0.005
/** PLACEHOLDER — §1.4 slot settle threshold. Must stay <= MOVE_EPSILON. */
export const ARRIVE_EPSILON = 0.004
/** PLACEHOLDER — §1.6 clearance when pushing a unit out of blocking terrain. */
export const EJECT_EPSILON = 0.002

// ---------------------------------------------------------------------------
// PLACEHOLDER — enemy classes (§1.9)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const MELEE_HP = 1.0
/** PLACEHOLDER */
export const MELEE_MOVE_SPEED = 0.075
/** PLACEHOLDER — contact range. */
export const MELEE_RANGE = 0.75
/** PLACEHOLDER */
export const MELEE_ATTACK_INTERVAL = 15
/** PLACEHOLDER */
export const MELEE_DAMAGE = 0.045

/** PLACEHOLDER */
export const SHOOTER_HP = 0.8
/** PLACEHOLDER */
export const SHOOTER_MOVE_SPEED = 0.06
/** PLACEHOLDER — §1.9 hard constraint: must stay below SOLDIER_RANGE. */
export const SHOOTER_RANGE = 4.5
/**
 * PLACEHOLDER — §2 expresses the stop band as a ratio of `SHOOTER_RANGE`, so it is
 * DERIVED from the ratio rather than written out. Writing the pair as literals is
 * how the first draft ended up at `4.28` against a ceiling of `0.95 x 4.5 = 4.275`:
 * outside its own declared box, and the assert below could not see it because it
 * only compared against `SHOOTER_RANGE`.
 */
export const SHOOTER_STANDOFF_RATIO: readonly [number, number] = [0.6, 0.95]
export const SHOOTER_STANDOFF: readonly [number, number] = [
  SHOOTER_STANDOFF_RATIO[0] * SHOOTER_RANGE,
  SHOOTER_STANDOFF_RATIO[1] * SHOOTER_RANGE,
]
/** PLACEHOLDER */
export const SHOOTER_ATTACK_INTERVAL = 30
/** PLACEHOLDER */
export const SHOOTER_DAMAGE = 0.035

/** §1.9: one contact slot per friendly. */
export const MELEE_CONTACT_SLOTS_PER_FRIENDLY = 1
/** §1.9: two shooter target slots per friendly. */
export const SHOOTER_TARGET_SLOTS_PER_FRIENDLY = 2
/** §1.7: an enemy with 30 consecutive zero-displacement ticks retargets. */
export const ENEMY_STUCK_TICKS = 30

// ---------------------------------------------------------------------------
// PLACEHOLDER — supply geometry (§1.10)
// ---------------------------------------------------------------------------

/** PLACEHOLDER — §1.10 constraint: >= ENGAGE_RADIUS + 2.0. */
export const SPAWN_RADIUS = 13.0
/** PLACEHOLDER — the live cap applies only inside this radius of the command unit. */
export const ENGAGE_RADIUS = 10.0
/** PLACEHOLDER — total live enemies, engaged or not. */
export const ABSOLUTE_ENEMY_CAP = 60
/** PLACEHOLDER */
export const BACKLOG_SIZE = 12
/** PLACEHOLDER */
export const BACKLOG_DRAIN_PER_TICK = 2
/** §1.10: a spawn point inside blocking terrain is redrawn at most 8 times. */
export const SPAWN_MAX_REDRAWS = 8

export type PressurePhase = {
  /** First tick of the phase (inclusive). */
  fromTick: number
  /** PLACEHOLDER — live cap inside ENGAGE_RADIUS. */
  engagedCap: number
  /** PLACEHOLDER — ticks between spawn requests. */
  requestInterval: number
  /** PLACEHOLDER — melee : shooter, as a pair of integer weights. */
  meleeToShooter: readonly [number, number]
}

/** PLACEHOLDER — the whole pressure curve (§2 "구간별 상한·요청 간격·비율"). */
export const PRESSURE_PHASES: readonly PressurePhase[] = [
  { fromTick: 0, engagedCap: 14, requestInterval: 12, meleeToShooter: [5, 1] },
  { fromTick: 900, engagedCap: 20, requestInterval: 9, meleeToShooter: [3, 1] },
  { fromTick: 1800, engagedCap: 26, requestInterval: 7, meleeToShooter: [2, 1] },
]

// ---------------------------------------------------------------------------
// PLACEHOLDER — rescue (§1.11)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const RESCUE_RANGE = 1.5
/** PLACEHOLDER — ticks of held Space required to complete a rescue. */
export const RESCUE_TICKS = 36
/** PLACEHOLDER — invulnerable ticks granted on revival. */
export const RESCUE_INVULNERABLE_TICKS = 45
/** PLACEHOLDER — ticks a downed friendly survives before dying. */
export const DOWNED_TICKS = 300
/** §1.11: revival returns the unit at half its maximum HP. */
export const RESCUE_REVIVE_FRACTION = 0.5

// ---------------------------------------------------------------------------
// PLACEHOLDER — elite (§1.12)
// ---------------------------------------------------------------------------

/** §1.12: the elite arrives on this tick. */
export const ELITE_SPAWN_TICK = 1800
/** PLACEHOLDER */
export const ELITE_HP = 22.0
/** PLACEHOLDER */
export const ELITE_MOVE_SPEED = 0.1
/** PLACEHOLDER — §1.12 constraint: must stay below SOLDIER_RANGE. */
export const ELITE_APPROACH_RANGE = 4.5
/** PLACEHOLDER — telegraph duration in ticks. */
export const ELITE_TELEGRAPH_TICKS = 54
/** PLACEHOLDER — cooldown after impact, in ticks. */
export const ELITE_COOLDOWN_TICKS = 56
/** PLACEHOLDER — impact radius. */
export const ELITE_BLAST_RADIUS = 2.4
/** PLACEHOLDER */
export const ELITE_DAMAGE = 0.4

// ---------------------------------------------------------------------------
// PLACEHOLDER — progression (§1.13)
// ---------------------------------------------------------------------------

export type CardId =
  | 'firepower'
  | 'mobility'
  | 'vitality'
  | 'marksman'
  | 'firstaid'
  | 'cover'
  | 'rapid'
  | 'cohesion'

/** §1.13: the pool is exactly these 8 cards. */
export const CARD_POOL: readonly CardId[] = [
  'firepower',
  'mobility',
  'vitality',
  'marksman',
  'firstaid',
  'cover',
  'rapid',
  'cohesion',
]

/** §1.13: three cards are offered per round. */
export const CARDS_OFFERED_PER_ROUND = 3
/** §1.13: at most four upgrades in a run. */
export const MAX_UPGRADES = 4
/** PLACEHOLDER — kill counts that trigger rounds 1..4 (elite kill excluded). */
export const UPGRADE_KILL_THRESHOLDS: readonly number[] = [15, 45, 90, 145]

/**
 * PLACEHOLDER — the effect MAGNITUDE of each card, one scalar each.
 *
 * §1.13 says "각 카드의 효과 크기는 하네스가 정한다" — the SIZE is the harness's, the
 * SHAPE is §1.13's batch. So this table is flat scalars and nothing else: a nested
 * shape here would be batch A deciding how a card is applied. The comment on each
 * line is the intended reading, not a contract.
 *
 * `cohesion` is a scalar for the follow-speed half only. The starting brief also
 * wanted "슬롯 x0.8", which would scale `FORMATION_SLOTS` at runtime — that collides
 * with §1.4's slot table being fixed and with the digest recording slot geometry as
 * a constant, so whether it is expressible at all is a §1.13 decision, not a number
 * batch A gets to pre-commit.
 */
export const CARD_EFFECTS: Readonly<Record<CardId, number>> = {
  /** +30% damage. */
  firepower: 0.3,
  /** +15% move speed. */
  mobility: 0.15,
  /** x1.25 on both maxHp and hp — there is no HP multiplier field (§1.13). */
  vitality: 1.25,
  /** +1.0 range. */
  marksman: 1.0,
  /** x0.7 rescue duration. */
  firstaid: 0.7,
  /** -35% damage taken. */
  cover: 0.35,
  /** x0.85 attack interval. */
  rapid: 0.85,
  /** x1.2 follow speed. */
  cohesion: 1.2,
}

// ---------------------------------------------------------------------------
// PLACEHOLDER — terrain (§1.6, §2)
// ---------------------------------------------------------------------------

/** PLACEHOLDER — requested counts and side ranges; placement counts are measured. */
export const TERRAIN_OPTIONS: TerrainOptions = {
  highCount: 6,
  lowCount: 30,
  highSide: { min: 3.0, max: 6.0 },
  lowSide: { min: 3.0, max: 5.0 },
}

// ---------------------------------------------------------------------------
// Structural invariants — §1 states these as relations, not as search ranges.
// ---------------------------------------------------------------------------

function assertRule(condition: boolean, message: string): void {
  if (!condition) throw new Error(`battle/constants: ${message}`)
}

// §1.4: without this the settle dead-band can leave a displacement that §1.3 still
// reads as movement, and the follower is silenced forever.
assertRule(ARRIVE_EPSILON <= MOVE_EPSILON, 'ARRIVE_EPSILON must be <= MOVE_EPSILON (§1.4)')
// §1.9: a shooter that outranges a soldier must close, and §1.3 makes the approach
// free of return fire, so kills collapse.
assertRule(SHOOTER_RANGE < SOLDIER_RANGE, 'SHOOTER_RANGE must be < SOLDIER_RANGE (§1.9)')
// §1.12: the same argument for the elite.
assertRule(ELITE_APPROACH_RANGE < SOLDIER_RANGE, 'ELITE_APPROACH_RANGE must be < SOLDIER_RANGE (§1.12)')
// §1.10: overlapping radii fill the cap with enemies still in transit.
assertRule(SPAWN_RADIUS >= ENGAGE_RADIUS + 2.0, 'SPAWN_RADIUS must be >= ENGAGE_RADIUS + 2.0 (§1.10)')
// §2: the band is declared as a ratio of SHOOTER_RANGE, so the ratio is what gets
// checked. Comparing the derived metres against SHOOTER_RANGE alone would accept
// anything up to 4.5 and miss exactly the kind of drift it exists to catch.
assertRule(
  SHOOTER_STANDOFF_RATIO[0] >= 0.6 &&
    SHOOTER_STANDOFF_RATIO[0] < SHOOTER_STANDOFF_RATIO[1] &&
    SHOOTER_STANDOFF_RATIO[1] <= 0.95,
  'SHOOTER_STANDOFF_RATIO must be an increasing band inside [0.60, 0.95] (§2)',
)
assertRule(CARD_POOL.length === 8, 'the card pool is exactly 8 cards (§1.13)')
assertRule(UPGRADE_KILL_THRESHOLDS.length === MAX_UPGRADES, 'there are exactly 4 upgrade thresholds (§1.13)')
