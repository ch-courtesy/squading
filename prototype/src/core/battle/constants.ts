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

// ---------------------------------------------------------------------------
// FIXED — §1.1 coordinates and clock
// ---------------------------------------------------------------------------

/**
 * §1.1: the arena is `0..56 x 0..32` and the commander starts at its centre.
 *
 * Declared here rather than imported from `gameplay/terrain.ts` because §1.6 removes
 * terrain from the game entirely. That module — and `gameplay/geometry.ts`,
 * `harness/i9.ts`, `artifacts/i9-sweep.md` — stay in the repository as the evidence
 * that cover was measured and rejected, and `core/battle/` must not import any of
 * them; `tests/battle/battle-boundaries.test.ts` pins that.
 */
export const ARENA_WIDTH = 56
export const ARENA_HEIGHT = 32
export const COMMANDER_START: Readonly<{ x: number; y: number }> = { x: 28, y: 16 }

/** §1.1: 90 seconds at 30Hz. */
export const COMBAT_TICK_LIMIT = 2700
/** §1.1: digest floats are normalized to 6 decimal places. */
export const DIGEST_DECIMALS = 6

/**
 * The hp below which a body is at zero — a consequence of §1.1, not a tuning knob.
 *
 * Binary floating point does not divide the anchors evenly: five commander shots of `0.20`
 * against a `1.0`-HP melee leave `5.55e-17` of hp behind, and `hp > 0` at step 13 reads that
 * as a survivor. The body then needs a sixth shot to die, the kill lands one attack interval
 * late, and §1.13's kill thresholds drift for the whole run — while the digest, which §1.1
 * normalizes to 6 decimals, records the thing as having 0 hp. Any residue smaller than the
 * digest's own resolution is not a state this game distinguishes, so step 12 snaps it away.
 */
export const HP_EPSILON = 1e-9
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
// PLACEHOLDER — epsilons (§2: MOVE 0.001~0.02, ARRIVE <= MOVE)
// ---------------------------------------------------------------------------

/** PLACEHOLDER — §1.3 stop threshold: displacement below this counts as stopped. */
export const MOVE_EPSILON = 0.005
/** PLACEHOLDER — §1.4 slot settle threshold. Must stay <= MOVE_EPSILON. */
export const ARRIVE_EPSILON = 0.004

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
/**
 * PLACEHOLDER — §2 searches `3.0 ~ 4.9`, and §1.6 makes the gap the whole mechanism:
 * `SOLDIER_RANGE - SHOOTER_RANGE` IS the band a friendly can stop in and shoot without
 * being shot back. Cover is gone; this number is what replaced it.
 */
export const SHOOTER_RANGE = 4.5
/** §1.6/§2 sweep axis 1: the size of the range advantage. */
export const RANGE_ADVANTAGE = SOLDIER_RANGE - SHOOTER_RANGE
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
// Structural invariants — §1 states these as relations, not as search ranges.
// ---------------------------------------------------------------------------

function assertRule(condition: boolean, message: string): void {
  if (!condition) throw new Error(`battle/constants: ${message}`)
}

// §1.4: without this the settle dead-band can leave a displacement that §1.3 still
// reads as movement, and the follower is silenced forever.
assertRule(ARRIVE_EPSILON <= MOVE_EPSILON, 'ARRIVE_EPSILON must be <= MOVE_EPSILON (§1.4)')
// §1.6/§1.9: the range advantage is the mechanism that replaced cover. A shooter that
// outranges a soldier deletes it — and §1.3 makes the approach free of return fire, so
// kills collapse as well.
assertRule(SHOOTER_RANGE < SOLDIER_RANGE, 'SHOOTER_RANGE must be < SOLDIER_RANGE (§1.9)')
assertRule(RANGE_ADVANTAGE > 0, 'the range advantage must be positive (§1.6)')
// §1.12: the same argument for the elite.
assertRule(ELITE_APPROACH_RANGE < SOLDIER_RANGE, 'ELITE_APPROACH_RANGE must be < SOLDIER_RANGE (§1.12)')
// §1.10: overlapping radii fill the cap with enemies still in transit.
assertRule(SPAWN_RADIUS >= ENGAGE_RADIUS + 2.0, 'SPAWN_RADIUS must be >= ENGAGE_RADIUS + 2.0 (§1.10)')
// §1.10: the pressure table is walked by tick and its ratio by a phase-local index, so a
// gap at tick 0, an out-of-order phase, a zero interval or a 0:0 ratio would each turn a
// rule into a divide-by-nothing or a silently skipped request rather than a loud failure.
assertRule(PRESSURE_PHASES.length > 0, 'the pressure curve needs at least one phase (§1.10)')
assertRule(PRESSURE_PHASES[0].fromTick === 0, 'the first pressure phase must start at tick 0 (§1.10)')
for (let index = 0; index < PRESSURE_PHASES.length; index += 1) {
  const phase = PRESSURE_PHASES[index]
  assertRule(
    index === 0 || phase.fromTick > PRESSURE_PHASES[index - 1].fromTick,
    'pressure phases must start on strictly ascending ticks (§1.10)',
  )
  assertRule(phase.requestInterval >= 1, 'every pressure phase needs requestInterval >= 1 (§1.10)')
  assertRule(phase.engagedCap >= 1, 'every pressure phase needs engagedCap >= 1 (§1.10)')
  assertRule(
    phase.meleeToShooter[0] >= 0 &&
      phase.meleeToShooter[1] >= 0 &&
      phase.meleeToShooter[0] + phase.meleeToShooter[1] >= 1,
    'every melee:shooter ratio needs a positive total weight (§1.10)',
  )
}
assertRule(BACKLOG_SIZE >= 1, 'BACKLOG_SIZE must be >= 1 (§1.10)')
assertRule(BACKLOG_DRAIN_PER_TICK >= 1, 'BACKLOG_DRAIN_PER_TICK must be >= 1 (§1.10)')
// §1.11: a rescue that completes in 0 ticks is not a judgement, and a revive fraction
// outside (0, 1] is not "최대 HP의 50%".
assertRule(RESCUE_TICKS >= 1, 'RESCUE_TICKS must be >= 1 (§1.11)')
assertRule(RESCUE_RANGE > 0, 'RESCUE_RANGE must be positive (§1.11)')
assertRule(
  RESCUE_REVIVE_FRACTION > 0 && RESCUE_REVIVE_FRACTION <= 1,
  'RESCUE_REVIVE_FRACTION must be in (0, 1] (§1.11)',
)
assertRule(RESCUE_INVULNERABLE_TICKS >= 0, 'RESCUE_INVULNERABLE_TICKS must be >= 0 (§1.11)')
assertRule(DOWNED_TICKS >= 1, 'DOWNED_TICKS must be >= 1 (§1.11)')
// §2: the band is declared as a ratio of SHOOTER_RANGE, so the ratio is what gets
// checked. Comparing the derived metres against SHOOTER_RANGE alone would accept
// anything up to 4.5 and miss exactly the kind of drift it exists to catch.
assertRule(
  SHOOTER_STANDOFF_RATIO[0] >= 0.6 &&
    SHOOTER_STANDOFF_RATIO[0] < SHOOTER_STANDOFF_RATIO[1] &&
    SHOOTER_STANDOFF_RATIO[1] <= 0.95,
  'SHOOTER_STANDOFF_RATIO must be an increasing band inside [0.60, 0.95] (§2)',
)
// §1.1: an hp snap coarser than the digest's own resolution would erase hp the recorded
// state can see; one finer than accumulated float error would not do its job.
assertRule(
  HP_EPSILON > 0 && HP_EPSILON < 10 ** -DIGEST_DECIMALS,
  'HP_EPSILON must be positive and finer than the digest resolution (§1.1)',
)
assertRule(CARD_POOL.length === 8, 'the card pool is exactly 8 cards (§1.13)')
assertRule(UPGRADE_KILL_THRESHOLDS.length === MAX_UPGRADES, 'there are exactly 4 upgrade thresholds (§1.13)')
