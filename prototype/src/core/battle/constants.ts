// Every harness-owned number for the commander battle lives in this file.
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

import { FORMATION_MAX_SLOT_RADIUS, FORMATION_SLOTS } from './formation'

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
 * them; `tests/battle/battle-no-cover.test.ts` pins that.
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
 * against a `1.0`-HP melee leave `5.55e-17` of hp behind, and the transition step's `hp > 0`
 * reads that as a survivor. The body then needs a sixth shot to die, the kill lands one attack
 * interval late, and §1.13's kill thresholds drift for the whole run — while the digest, which §1.1
 * normalizes to 6 decimals, records the thing as having 0 hp. Any residue smaller than the
 * digest's own resolution is not a state this game distinguishes, so `applyDamage` snaps it
 * away before `resolveTransitions` reads the body's hp.
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
// PLACEHOLDER — the settle epsilon (§2: `ARRIVE_EPSILON` 0.001~0.02)
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER — the ONE epsilon left, and it is about jitter, not about firepower.
 *
 * Two rules use it, both of them "this displacement is too small to be worth making":
 *   §1.4  a follower within this distance of its slot does not move at all, so it cannot
 *         approach asymptotically and vibrate.
 *   §1.15 a pointer drag shorter than this clamps the movement input to zero.
 *
 * v6~v8 also had a `MOVE_EPSILON` — the threshold above which a tick counted as movement
 * and cost the unit its shot. §1.3 (v9) deleted that rule, so the constant is gone rather
 * than left inert: an unused threshold is one a later batch re-gates something on.
 */
export const ARRIVE_EPSILON = 0.004

// ---------------------------------------------------------------------------
// PLACEHOLDER — the leash (§1.4.1, §2 `LEASH_RADIUS`)
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER — §1.4.1: how far from the COMMAND UNIT an enemy may be and still be
 * something a soldier will leave its slot for.
 *
 * §2 boxes it on both sides and the asserts at the bottom of this file hold both edges:
 *   `> FORMATION_MAX_SLOT_RADIUS` (2.460)     — below the formation's own radius the leash
 *                                               cannot be told apart from standing in the slot.
 *   `< SOLDIER_RANGE + ENGAGE_RADIUS` (15.0)  — above it the soldiers reach everything the
 *                                               spawner puts on the board and where the player
 *                                               stands stops deciding anything, which is the
 *                                               agency-free auto-battle §1.4.1 exists to escape.
 *
 * WHY 10.0, AND WHERE IT CAME FROM. Batch H opened at 8.0 as an untested starting point. Batch I
 * raised it because a person who played the build asked for the soldiers to roam further and more
 * freely, and it was picked BY MEASUREMENT AGAINST THAT REQUEST — not off any §2 sweep axis, and
 * §5 stage 3 still owns the final number. Four candidates, mean live enemies inside the leash
 * averaged over the eight policies x three seeds, and the greatest distance any soldier reached
 * from the command unit on `tactical-no-input`/`seed-a`:
 *
 *     8.0   mean 3.4~4.2    max 13.95   skilled 3/3   position probe: two stands, HALF the
 *                                                     engaged set in common
 *    10.0   mean 4.8~5.8    max 15.99   skilled 3/3   same probe: HALF in common
 *    12.0   mean 6.9~7.7    max 17.96   skilled 1/3   same probe: ALL in common
 *    14.0   mean 8.5~10.2   max 19.98   skilled 1/3   same probe: ALL in common
 *
 * 10.0 is the largest of the four that keeps both of the things the leash is for. §4.1 wants
 * `skilled >= 6/8` and 12.0 takes it to 1/3. And §1.4.1 anchors the leash to the command unit so
 * that WHERE THE PLAYER STANDS decides which fight happens (§4.5 question 3): the probe above
 * puts 24 enemies on a fixed board, stands the command unit at two points 12.0 apart, and asks
 * which enemies the fifteen engage. At 8.0 and 10.0 the two stands share half their engaged set;
 * at 12.0 and 14.0 they share ALL of it — the position has stopped selecting anything, which is
 * the free-roam behaviour the leash exists instead of.
 *
 * SO IT IS A STEP TOWARD FREE ROAM AND THE STEP IS DELIBERATE. At 10.0 the fraction of live
 * enemies inside the leash rises from ~0.33 to ~0.46: the player's position still chooses, but it
 * chooses among more of the board than it did.
 *
 * It is now EQUAL TO `ENGAGE_RADIUS` (10.0) rather than below it, so the set a soldier may chase
 * is exactly the set §1.10 counts against the live cap around the command unit — the two radii
 * name the same disc. §2 does not relate them and neither does §1.10; this is a coincidence of
 * two placeholders and is written down so it is not mistaken for a rule.
 *
 * HOW FAR A BODY CAN BE PULLED, corrected for v11. The engagement goal is `target + bearing x
 * attackRangeOf(unit)`, so with the command unit standing still the bound is
 * `LEASH_RADIUS + SOLDIER_RANGE` = 15.0 — and above it once §1.13's `marksman` (+1.0, additive)
 * is taken, which is why the measured maximum is 15.99 and not 15.0. §4.4(a)'s framing is what
 * has to survive that; the camera widens to whatever body is furthest out
 * (`core/battle-view/snapshot.ts`), so it does, at the cost of zooming further out than batch H's
 * runs ever asked it to.
 */
export const LEASH_RADIUS = 10.0

// ---------------------------------------------------------------------------
// PLACEHOLDER — enemy classes (§1.9)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const MELEE_HP = 1.0
/**
 * PLACEHOLDER — §1.3/§2 constraint: STRICTLY GREATER than `COMMANDER_MOVE_SPEED` (search
 * range `0.125~0.170`), asserted at the bottom of this file.
 *
 * This is the number that closes the "keep moving and take no damage" defect. v6~v8 closed
 * it by taxing movement (a unit that moved neither fired nor cooled down); v9 closes it by
 * making the melee faster than the body the player drives, so pure flight does not work and
 * movement can stay free. Every friendly speed is below it: soldier `0.100`, commander
 * `0.115`, follow cap `0.130`.
 *
 * At `0.140` against the commander's `0.115` the gap closes `0.025` per tick, i.e. one
 * second of pure flight costs exactly one `MELEE_RANGE` (30 x 0.025 = 0.75) of distance.
 * `tests/battle/battle-combat.test.ts` hand-computes the flight-is-futile fixture off that.
 *
 * KNOWN GAP, reported rather than silently fixed: §1.13's `mobility` card raises the command
 * unit to `0.115 x 1.15 = 0.13225`, and §2's search range starts at `0.125`. Any placeholder
 * in `(0.125, 0.13225]` therefore satisfies §1.3's stated relation while letting one card
 * restore pure flight. §1.3 states the relation against §1.2's ANCHOR, so the assert below
 * checks exactly that and no more; narrowing it here would reject values §2 explicitly
 * permits. `0.140` clears the upgraded speed as well.
 */
export const MELEE_MOVE_SPEED = 0.14
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

/**
 * PLACEHOLDER — the whole pressure curve (§2 "구간별 상한·요청 간격·비율").
 *
 * STILL A PLACEHOLDER, AND §5 STAGE 3 STILL OWNS THE FINAL VALUES. Every number in this table
 * is §5 stage 0's arbitrary starting point, and the edit recorded below does not change that —
 * it moves one axis because the value it had was hiding a core rule, not because it is right.
 *
 * WHAT CHANGED AND WHY (batch I). `requestInterval` went 12/9/7 -> 9/7/5. §1.4.1 v11 gives each
 * soldier its own bearing around its target, and a bearing spreads fifteen bodies only if there
 * is more than one body to spread them around: with the old intervals the number of LIVE enemies
 * inside `LEASH_RADIUS` averaged 1.7 over a whole `tactical-no-input` run and 1.2 over the first
 * 600 ticks, which is fifteen soldiers queueing at one or two targets whatever the angles are.
 *
 * `engagedCap` is deliberately NOT touched. It is not the binding constraint — the measured live
 * enemy count was 4~6 against a cap of 14, so the kill rate was what limited supply, and raising
 * a cap nothing reaches changes nothing.
 *
 * WHAT IT COST, MEASURED AT `LEASH_RADIUS` 8.0, which is the value this edit was swept against
 * (the same batch raised the leash afterwards; the combined numbers are two paragraphs down).
 * Three seeds, eight policies:
 *
 *   * mean live enemies inside `LEASH_RADIUS`, `skilled`: 2.10 -> 3.81; `tactical-no-input`:
 *     1.69 -> 3.80. Roughly doubled, and NOT the "5 or more" the batch aimed at.
 *   * `skilled`, `ignores-range` stay 3/3; `tactical-no-input`, `flees-always`, `camps-in-place`
 *     go 3/3 -> 1/3; `abandons-downed` and both §3 player models go 3/3 -> 2/3.
 *
 * The three that fell are I3, I8 and I10, all of which REQUIRE losing (`0/8`, `0/8`, `<=2/8`)
 * and all of which were failing at 3/3. So this axis moves toward those invariants.
 *
 * 5 IS NOT REACHABLE ON THIS AXIS ALONE at these HP and damage placeholders, and the sweep says
 * so arithmetically rather than by opinion. The standing count inside the leash is the arrival
 * rate times the dwell time; dwell is set by how fast the squad kills, which is §5 stage 2's
 * numbers and not this table's. So an average of 5 needs an arrival rate well above the kill rate,
 * which is a population that grows without bound. Every curve in the sweep that reached a mean of
 * 5 on any policy at `LEASH_RADIUS` 8.0 — `8/6/5`, `7/6/5`, `6/5/4`, `4/3/2`, `3/2/2`, `2/2/2` —
 * lost `tactical-no-input` on all three seeds and took `skilled` to 2/3 or worse.
 *
 * WHAT REACHED IT was the OTHER axis moving as well: at `LEASH_RADIUS` 10.0 with this table, the
 * mean is 4.8~5.8 across all eight policies (`tactical-no-input` 5.64, `skilled` 5.10) with
 * `skilled` still 3/3. Neither half gets there alone — 9/7/5 at leash 8.0 is 3.4~4.2, and leash
 * 10.0 at the old 12/9/7 is 2.9~4.1. The batch report carries both sweeps, and §5 stage 3 is
 * where all of it gets set properly.
 */
export const PRESSURE_PHASES: readonly PressurePhase[] = [
  { fromTick: 0, engagedCap: 14, requestInterval: 9, meleeToShooter: [5, 1] },
  { fromTick: 900, engagedCap: 20, requestInterval: 7, meleeToShooter: [3, 1] },
  { fromTick: 1800, engagedCap: 26, requestInterval: 5, meleeToShooter: [2, 1] },
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

// §1.4/§1.15: a non-positive settle band is no band at all — the follower approaches its
// slot asymptotically and vibrates forever, and the pointer-drag clamp stops clamping.
assertRule(ARRIVE_EPSILON > 0, 'ARRIVE_EPSILON must be positive (§1.4)')
// §1.3: THE relation this version of the design rests on. Units fire while moving, so the
// only thing stopping pure flight is that the melee is faster than the body the player
// drives. Invert this and "run in a straight line forever" is an unanswerable strategy
// again, which is the defect §1.3 records v6~v8 taxing movement in order to close.
assertRule(
  MELEE_MOVE_SPEED > COMMANDER_MOVE_SPEED,
  'MELEE_MOVE_SPEED must be > COMMANDER_MOVE_SPEED (§1.3)',
)
// §1.6/§1.9: the range advantage is the mechanism that replaced cover. It is the band
// `[SHOOTER_RANGE, SOLDIER_RANGE]` a friendly can stand in and shoot without being shot
// back; a shooter that outranged a soldier would erase the band and with it the only reason
// "where do I stop" is a question. §1.3 (v9) makes the relation matter MORE, not less: the
// squad is no longer paid for standing still, so the band has to be worth standing in.
assertRule(SHOOTER_RANGE < SOLDIER_RANGE, 'SHOOTER_RANGE must be < SOLDIER_RANGE (§1.9)')
assertRule(RANGE_ADVANTAGE > 0, 'the range advantage must be positive (§1.6)')
// §1.12: the same shape of argument for the elite — an elite that parked outside soldier
// range would be unkillable by the 15 bodies that are supposed to kill it.
assertRule(ELITE_APPROACH_RANGE < SOLDIER_RANGE, 'ELITE_APPROACH_RANGE must be < SOLDIER_RANGE (§1.12)')
// §1.4.1/§2: both edges of the leash box, and each one is a different failure.
// Under the formation radius, "the soldier left its slot to fight" is a statement no observer
// can distinguish from "the soldier is in its slot" — the rule would exist and show nothing.
assertRule(
  LEASH_RADIUS > FORMATION_MAX_SLOT_RADIUS,
  'LEASH_RADIUS must be > FORMATION_MAX_SLOT_RADIUS (§2)',
)
// §1.4.1 (v11): every engaged soldier's BEARING is `normalize(슬롯 오프셋)`, so a slot at the
// origin would have no direction and `engagementBearingOf` would have to invent one. The lattice
// has no such slot — the origin is where the command unit stands — and this is the assertion that
// makes "the zero-vector branch in `movement.ts` is unreachable" a checked fact rather than a
// reading of the table. It is here rather than in `formation.ts` because this module is the one
// every rule module imports, so the check runs before any battle object can be built.
for (const slot of FORMATION_SLOTS) {
  assertRule(
    Math.hypot(slot.x, slot.y) > 0,
    'no formation slot may be the zero vector — §1.4.1 derives each bearing from it (§1.4)',
  )
}
// Over `SOLDIER_RANGE + ENGAGE_RADIUS` the squad can answer anything inside the radius §1.10
// spawns against, from wherever the command unit happens to be, and §4.5's third question
// ("어디에 멈출지 고민했는가") has no mechanism behind it any more.
assertRule(
  LEASH_RADIUS < SOLDIER_RANGE + ENGAGE_RADIUS,
  'LEASH_RADIUS must be < SOLDIER_RANGE + ENGAGE_RADIUS (§2)',
)
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
// §1.13: the thresholds are walked by an index that advances when a round OPENS, exactly like
// the pressure curve above is walked by tick — and they need the same guard for the same
// reason. A non-ascending pair fires two rounds off ONE kill (the second threshold is already
// satisfied the moment the first is), which §1.13's "매 회차" does not describe, and no other
// test would fail: the round count would still be <= 4 and the digest would still replay.
for (let index = 0; index < UPGRADE_KILL_THRESHOLDS.length; index += 1) {
  assertRule(
    UPGRADE_KILL_THRESHOLDS[index] >= 1,
    'every upgrade kill threshold must be >= 1 (§1.13)',
  )
  assertRule(
    index === 0 || UPGRADE_KILL_THRESHOLDS[index] > UPGRADE_KILL_THRESHOLDS[index - 1],
    'upgrade kill thresholds must be strictly ascending (§1.13)',
  )
}
