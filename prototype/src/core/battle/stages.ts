// The stage table (`docs/superpowers/specs/2026-08-21-seven-stage-campaign-design.md` §3, §5).
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS, AND WHAT `constants.ts` STILL IS
// ---------------------------------------------------------------------------
// The campaign runs the same rules seven times with different NUMBERS. §2.2 names the eight axes
// that are allowed to differ between stages, and the constants that make up those axes live here
// instead of in `constants.ts`:
//
//   근접:사수 비율·스폰 밀도 ... `pressurePhases`
//   스폰·교전 반경 ............ `spawnRadius`, `engageRadius`, `absoluteEnemyCap`, `backlog*`
//   적 능력치 ................. `melee*`, `shooter*`
//   사거리 격차 ............... `shooterRange` (and `rangeAdvantage`, derived from it)
//   정예 ...................... `elite*`
//   아레나 .................... `arenaWidth`, `arenaHeight`
//   리쉬 ...................... `leashRadius`
//
// `constants.ts` keeps everything the campaign does NOT vary: §1.2's friendly anchors, the
// commander and soldier numbers, §1.4.2's melee, `FORMATION_SLOTS`, `ARRIVE_EPSILON`, the rescue
// numbers, §1.13's card magnitudes and thresholds, and §1.1's clock. Those are §1's fixed
// structure — a stage is a different fight, not a different game.
//
// ---------------------------------------------------------------------------
// WHY `BattleState` CARRIES AN ID AND NOT THE CONFIGURATION (§3.1)
// ---------------------------------------------------------------------------
// §1.17's digest walks the whole of `BattleState`. If the configuration were OUTSIDE the state,
// one digest could name two runs played under different rules and §1.17's replay guarantee would
// be false. If the whole configuration were INSIDE it, the state and `battle-state.test.ts`'s key
// pins would grow by one field per axis per stage. An id is the smallest thing that closes the
// first hole without opening the second: the key set grows by exactly one, and the rules are
// recoverable from it through `stageConfigOf`.
//
// ---------------------------------------------------------------------------
// THE TABLE IS PURE, AND THE LOOKUP IS A FUNCTION
// ---------------------------------------------------------------------------
// `STAGES` is a frozen literal built once at module load. `stageConfigOf` walks it and returns
// the entry whose `id` matches — no cache, no mutation, no side effect, no fallback. A `stageId`
// with no row is a thrown error rather than a quietly substituted default, because a substituted
// default is a run played under rules nobody asked for.
//
// ---------------------------------------------------------------------------
// SEVEN STAGES, AND STAGE 1 IS THE ONE THAT HAS BEEN TUNED (§5 stage 4)
// ---------------------------------------------------------------------------
// §5 stage 0 MOVED values; it did not choose them. §5 stage 2 added the other six rows and made
// them DIFFER, still without choosing them. §5 stage 4 — tuning batch 1 — is the first batch to
// CHOOSE, and its scope was stage 1 alone: stage 1 is the anchor the other six derive from, and
// its failing I2 was inherited by all seven, so tuning a derived row first would have been getting
// it wrong seven times.
//
// STAGES 2-7 ARE STILL PLACEHOLDERS, character for character as §5 stage 2 wrote them. Stage 1's
// `spawnRadius` and `engageRadius` are the only two numbers in this file that a measurement chose,
// and the batch report (`tuning-1-report.md`) carries the 620 rows it chose them against.
//
// WHAT EACH ROW IS FOR (§2.3's dominant axis). "무엇이 이 판을 어렵게 하는가"에 이름이 붙어야
// 스테이지다 — so each row pushes ONE axis hard and lets the rest rise gently, and the relations
// that make that sentence true are pinned in `tests/battle/battle-stages.test.ts`. The tests pin
// the RELATIONS §2.3 asserts (stage 4's shooter share is above stage 1's) and not the numbers, so
// §5 stage 4 can tune the table without rewriting the fixtures that describe it.
//
//   1 빨강  the baseline. The highest melee share of any stage's opening phase.
//   2 주황  spawn density: the shortest request intervals of stages 1-3, at stage 1's enemy stats.
//   3 노랑  many weak: the highest engaged caps, and the lowest melee/shooter hp of any stage.
//   4 초록  shooters, and the range gap closed: the highest shooter share and the SMALLEST
//           `rangeAdvantage` in the table. §2.3 calls this the design core, and §4 makes I4
//           mandatory here and relaxed elsewhere.
//   5 파랑  the board opens: 2.25x the area, and a leash cut in absolute terms as well as relative.
//   6 남색  the elite: it arrives earlier, telegraphs and cools down in ~60% of the ticks, and its
//           blast covers 2.25x the area of stage 1's.
//   7 보라  everything: the largest absolute cap, the shortest intervals, the toughest elite.
//
// WHAT DID *NOT* MOVE, AND WHY IT IS WRITTEN HERE. `COMMANDER_START` is `{28, 16}`, the exact
// centre of stage 1's 56x32 arena, and stages 5-7 open the arena to 84x48 — so on those three the
// squad no longer starts in the middle. It is NOT moved and NOT made a stage axis: §2.2 lists the
// eight axes a stage may differ on and the friendly anchor is not one of them, and `constants.ts`
// says so at the declaration. The consequence is a fact about those stages rather than a defect,
// and the batch report measures it (the arena clamp and how close a run gets to a wall) instead of
// asserting it is harmless.
//
// THE MUTATION STAGE 0 RECORDED AS MISSED. With one row, a `stageConfigOf` that ignored its
// argument and returned `STAGES[0]` behaved identically and no fixture could tell the difference.
// With seven rows it cannot: the relation fixtures read two ids and compare them, so the mutation
// is CAUGHT. If it ever goes back to MISSED, the rows have stopped being distinct.

import {
  COMMANDER_MELEE_RANGE,
  COMMANDER_MOVE_SPEED,
  SHOOTER_STANDOFF_RATIO,
  SOLDIER_RANGE,
} from './constants'
import { FORMATION_MAX_SLOT_RADIUS } from './formation'

/** §1.10: one row of the pressure curve. The table it makes up is a stage's (§2.2). */
export type PressurePhase = {
  /** First tick of the phase (inclusive). */
  fromTick: number
  /** PLACEHOLDER — live cap inside `engageRadius`. */
  engagedCap: number
  /** PLACEHOLDER — ticks between spawn requests. */
  requestInterval: number
  /** PLACEHOLDER — melee : shooter, as a pair of integer weights. */
  meleeToShooter: readonly [number, number]
}

/**
 * The campaign's stage numbers (§2.3). All seven of them since §5 stage 2.
 *
 * A union of literals rather than `number` so that a `stageId` the table has no row for is a
 * compile error at every call site that can be checked statically, and `stageConfigOf`'s throw
 * is left to cover the ones that cannot (a value parsed from a URL, a save file, a test).
 */
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** The id a campaign and every default entry point starts on. */
export const FIRST_STAGE_ID: StageId = 1

/**
 * Everything §2.2 lets a stage change.
 *
 * FLAT, and named after the constants it replaces, so that `git diff` against `constants.ts` at
 * `b59b14a` reads as a move. Grouping the enemy numbers under a `melee: {...}` would be tidier
 * and would make every reader of this batch's diff check the values by hand.
 */
export type StageConfig = {
  readonly id: StageId

  // §1.1 / §1.7 — the board.
  readonly arenaWidth: number
  readonly arenaHeight: number

  /**
   * §1.4.1: how far from the COMMAND UNIT an enemy may be and still be something a soldier will
   * leave its slot for.
   *
   * §2 boxes it on both sides and the asserts at the bottom of this file hold both edges:
   *   `> FORMATION_MAX_SLOT_RADIUS` (2.460)     — below the formation's own radius the leash
   *                                               cannot be told apart from standing in the slot.
   *   `< SOLDIER_RANGE + engageRadius` (15.0)   — above it the soldiers reach everything the
   *                                               spawner puts on the board and where the player
   *                                               stands stops deciding anything, which is the
   *                                               agency-free auto-battle §1.4.1 exists to escape.
   *
   * WHY 10.0 AT STAGE 1, AND WHERE IT CAME FROM. Batch H opened at 8.0 as an untested starting
   * point. Batch I raised it because a person who played the build asked for the soldiers to roam
   * further and more freely, and it was picked BY MEASUREMENT AGAINST THAT REQUEST — not off any
   * §2 sweep axis. Four candidates, mean live enemies inside the leash averaged over the eight
   * policies x three seeds, and the greatest distance any soldier reached from the command unit on
   * `tactical-no-input`/`seed-a`:
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
   * At stage 1 it sat EQUAL TO `engageRadius` (both 10.0) until tuning batch 1 raised the engage
   * radius to 11.0, and the two were never related by anything: §2 does not relate them and
   * neither does §1.10. The equality was a coincidence of two placeholders, written down here so
   * it would not be mistaken for a rule — and the batch that broke it did so for the eight-seed
   * band's sake without any fixture or assert having to move, which is what that note was for.
   *
   * HOW FAR A BODY CAN BE PULLED, corrected for v11. The engagement goal is `target + bearing x
   * attackRangeOf(unit)`, so with the command unit standing still the bound is
   * `leashRadius + SOLDIER_RANGE` = 15.0 — and above it once §1.13's `marksman` (+1.0, additive)
   * is taken, which is why the measured maximum is 15.99 and not 15.0. §4.4(a)'s framing is what
   * has to survive that; the camera widens to whatever body is furthest out
   * (`core/battle-view/snapshot.ts`), so it does, at the cost of zooming further out than batch H's
   * runs ever asked it to.
   */
  readonly leashRadius: number

  // §1.9 — the melee class.
  readonly meleeHp: number
  /**
   * §1.3/§2 constraint: STRICTLY GREATER than `COMMANDER_MOVE_SPEED` (search range
   * `0.125~0.170`), asserted at the bottom of this file for every stage.
   *
   * This is the number that closes the "keep moving and take no damage" defect. v6~v8 closed
   * it by taxing movement (a unit that moved neither fired nor cooled down); v9 closes it by
   * making the melee faster than the body the player drives, so pure flight does not work and
   * movement can stay free. Every friendly speed is below it: soldier `0.100`, commander
   * `0.115`, follow cap `0.130`.
   *
   * At `0.140` against the commander's `0.115` the gap closes `0.025` per tick, i.e. one
   * second of pure flight costs exactly one `meleeRange` (30 x 0.025 = 0.75) of distance.
   * `tests/battle/battle-combat.test.ts` hand-computes the flight-is-futile fixture off that.
   *
   * KNOWN GAP, reported rather than silently fixed: §1.13's `mobility` card raises the command
   * unit to `0.115 x 1.15 = 0.13225`, and §2's search range starts at `0.125`. Any placeholder
   * in `(0.125, 0.13225]` therefore satisfies §1.3's stated relation while letting one card
   * restore pure flight. §1.3 states the relation against §1.2's ANCHOR, so the assert below
   * checks exactly that and no more; narrowing it here would reject values §2 explicitly
   * permits. `0.140` clears the upgraded speed as well.
   */
  readonly meleeMoveSpeed: number
  /** PLACEHOLDER — contact range. */
  readonly meleeRange: number
  readonly meleeAttackInterval: number
  readonly meleeDamage: number

  // §1.9 — the shooter class, and §1.6's range advantage with it.
  readonly shooterHp: number
  readonly shooterMoveSpeed: number
  /**
   * PLACEHOLDER — §2 searches `3.0 ~ 4.9`, and §1.6 makes the gap the whole mechanism:
   * `SOLDIER_RANGE - shooterRange` IS the band a friendly can stop in and shoot without
   * being shot back. Cover is gone; this number is what replaced it. §2.2 makes it a stage
   * axis of its own ("사거리 격차") because the size of that gap is what a stage teaches.
   */
  readonly shooterRange: number
  readonly shooterAttackInterval: number
  readonly shooterDamage: number
  /** DERIVED — `SHOOTER_STANDOFF_RATIO x shooterRange`. §2 declares the band as a ratio. */
  readonly shooterStandoff: readonly [number, number]
  /** DERIVED — §1.6/§2 sweep axis 1: `SOLDIER_RANGE - shooterRange`. */
  readonly rangeAdvantage: number

  // §1.10 — supply.
  /** PLACEHOLDER — §1.10 constraint: `>= engageRadius + 2.0`. */
  readonly spawnRadius: number
  /** PLACEHOLDER — the live cap applies only inside this radius of the command unit. */
  readonly engageRadius: number
  /** PLACEHOLDER — total live enemies, engaged or not. */
  readonly absoluteEnemyCap: number
  readonly backlogSize: number
  readonly backlogDrainPerTick: number
  /**
   * PLACEHOLDER — the whole pressure curve (§2 "구간별 상한·요청 간격·비율").
   *
   * STILL A PLACEHOLDER, AND §5 STAGE 4 STILL OWNS THE FINAL VALUES. Every number in this table
   * is §5 stage 0's arbitrary starting point, and the edit recorded below does not change that —
   * it moved one axis because the value it had was hiding a core rule, not because it is right.
   *
   * WHAT CHANGED AND WHY (batch I). `requestInterval` went 12/9/7 -> 9/7/5. §1.4.1 v11 gives each
   * soldier its own bearing around its target, and a bearing spreads fifteen bodies only if there
   * is more than one body to spread them around: with the old intervals the number of LIVE enemies
   * inside `leashRadius` averaged 1.7 over a whole `tactical-no-input` run and 1.2 over the first
   * 600 ticks, which is fifteen soldiers queueing at one or two targets whatever the angles are.
   *
   * `engagedCap` is deliberately NOT touched. It is not the binding constraint — the measured live
   * enemy count was 4~6 against a cap of 14, so the kill rate was what limited supply, and raising
   * a cap nothing reaches changes nothing.
   *
   * WHAT IT COST, MEASURED AT `leashRadius` 8.0, which is the value this edit was swept against
   * (the same batch raised the leash afterwards; the combined numbers are two paragraphs down).
   * Three seeds, eight policies:
   *
   *   * mean live enemies inside `leashRadius`, `skilled`: 2.10 -> 3.81; `tactical-no-input`:
   *     1.69 -> 3.80. Roughly doubled, and NOT the "5 or more" the batch aimed at.
   *   * `skilled`, `ignores-range` stay 3/3; `tactical-no-input`, `flees-always`, `camps-in-place`
   *     go 3/3 -> 1/3; `abandons-downed` and both §3 player models go 3/3 -> 2/3.
   *
   * The three that fell are I3, I8 and I10, all of which REQUIRE losing (`0/8`, `0/8`, `<=2/8`)
   * and all of which were failing at 3/3. So this axis moves toward those invariants.
   *
   * 5 IS NOT REACHABLE ON THIS AXIS ALONE at these HP and damage placeholders, and the sweep says
   * so arithmetically rather than by opinion. The standing count inside the leash is the arrival
   * rate times the dwell time; dwell is set by how fast the squad kills, which is another table's
   * numbers and not this one's. So an average of 5 needs an arrival rate well above the kill rate,
   * which is a population that grows without bound. Every curve in the sweep that reached a mean of
   * 5 on any policy at `leashRadius` 8.0 — `8/6/5`, `7/6/5`, `6/5/4`, `4/3/2`, `3/2/2`, `2/2/2` —
   * lost `tactical-no-input` on all three seeds and took `skilled` to 2/3 or worse.
   *
   * WHAT REACHED IT was the OTHER axis moving as well: at `leashRadius` 10.0 with this table, the
   * mean is 4.75~5.81 across all eight policies (`tactical-no-input` 5.64, `skilled` 5.10) with
   * `skilled` still 3/3. Neither half gets there alone — 9/7/5 at leash 8.0 is 3.4~4.2, and leash
   * 10.0 at the old 12/9/7 is 2.9~4.1. The batch report carries both sweeps.
   */
  readonly pressurePhases: readonly PressurePhase[]

  // §1.12 — the elite.
  /** §1.12: the elite arrives on this tick. */
  readonly eliteSpawnTick: number
  readonly eliteHp: number
  readonly eliteMoveSpeed: number
  /** PLACEHOLDER — §1.12 constraint: must stay below `SOLDIER_RANGE`. */
  readonly eliteApproachRange: number
  /** PLACEHOLDER — telegraph duration in ticks. */
  readonly eliteTelegraphTicks: number
  /** PLACEHOLDER — cooldown after impact, in ticks. */
  readonly eliteCooldownTicks: number
  /** PLACEHOLDER — impact radius. */
  readonly eliteBlastRadius: number
  readonly eliteDamage: number
}

/** A row as it is WRITTEN. The two derived fields are computed by `buildStage`, never typed out. */
type StageSpec = Omit<StageConfig, 'shooterStandoff' | 'rangeAdvantage'>

/**
 * The two derived numbers, in one place.
 *
 * `SHOOTER_STANDOFF` used to be a module constant computed from `SHOOTER_RANGE` and the fixed
 * ratio; writing the pair out per stage is how the first draft of `constants.ts` ended up with a
 * band outside its own declared box (see `SHOOTER_STANDOFF_RATIO`). The ratio stays fixed — §2
 * boxes it and no §2.2 axis moves it — and only the metres it multiplies are a stage's.
 */
function buildStage(spec: StageSpec): StageConfig {
  return {
    ...spec,
    shooterStandoff: [
      SHOOTER_STANDOFF_RATIO[0] * spec.shooterRange,
      SHOOTER_STANDOFF_RATIO[1] * spec.shooterRange,
    ],
    rangeAdvantage: SOLDIER_RANGE - spec.shooterRange,
  }
}

/**
 * STILL MOSTLY PLACEHOLDER. §5 stage 0 moved these numbers out of `constants.ts` without choosing
 * them and §5 stage 2 did not touch the row at all; see `constants.ts`'s header for what each one
 * was originally set to and what measurement (if any) stood behind it.
 *
 * TWO OF THEM ARE NOT PLACEHOLDERS ANY MORE. Tuning batch 1 (§5 stage 4) chose `spawnRadius 14.0`
 * and `engageRadius 11.0` off a 620-row search on the fixed eight-seed band, and the note beside
 * them says what they bought. Everything else in this row is the value it has always had.
 *
 * WHAT THE BATCH COULD NOT FIX, recorded here because the next batch will meet it. §3's I2 wants
 * `skilled`'s cumulative damage in `[0.55, 0.80]` of the roster and this row measures **0.843**.
 * It is inside §3's own relaxed ceiling (`80% -> 85%`, the first step of §3's relaxation order) and
 * outside the unrelaxed one. Of 620 rows the search played that stages 2-7 would have allowed, 300
 * held `skilled` 8/8 with I2 at or under 0.80 and NOT ONE of those also held I8 — the lowest I2 of
 * any row where `flees-always` went 0/8 was 0.840. Pure flight losing and a skilled run costing
 * under 80% of the roster were not both reachable from this table.
 */
const STAGE_ONE: StageSpec = {
  id: 1,

  arenaWidth: 56,
  arenaHeight: 32,

  leashRadius: 10.0,

  meleeHp: 1.0,
  meleeMoveSpeed: 0.14,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.045,

  shooterHp: 0.8,
  shooterMoveSpeed: 0.06,
  shooterRange: 4.5,
  shooterAttackInterval: 30,
  shooterDamage: 0.035,

  // TUNED (§5 stage 4, tuning batch 1). `13.0 / 10.0` -> `14.0 / 11.0`, and it is the only pair of
  // numbers this batch moved. On the eight-seed band it takes `skilled` 7/8 -> 8/8 and
  // `flees-always` 1/8 -> 0/8 (I8) while cutting the cumulative damage of I2 from 0.888 to 0.843;
  // `tactical-no-input` and `camps-in-place` stay 0/8. It was chosen over 620 other rows that the
  // search played on the same band, and the batch report carries why the ones that scored better
  // on I2 could not be adopted.
  spawnRadius: 14.0,
  engageRadius: 11.0,
  absoluteEnemyCap: 60,
  backlogSize: 12,
  backlogDrainPerTick: 2,
  pressurePhases: [
    { fromTick: 0, engagedCap: 14, requestInterval: 9, meleeToShooter: [5, 1] },
    { fromTick: 900, engagedCap: 20, requestInterval: 7, meleeToShooter: [3, 1] },
    { fromTick: 1800, engagedCap: 26, requestInterval: 5, meleeToShooter: [2, 1] },
  ],

  eliteSpawnTick: 1800,
  eliteHp: 22.0,
  eliteMoveSpeed: 0.1,
  eliteApproachRange: 4.5,
  eliteTelegraphTicks: 54,
  eliteCooldownTicks: 56,
  eliteBlastRadius: 2.4,
  eliteDamage: 0.4,
}

/**
 * STAGE 2 — 주황. THE DOMINANT AXIS IS SPAWN DENSITY (§2.3: "몰리지 않게 서 있을 수 있나").
 *
 * The enemy stats are stage 1's, character for character, and so are the radii: the ONLY things
 * that moved are how often a request is made, how many bodies may be engaged at once, and how big
 * the absolute population and the backlog are. That is the point of a dominant axis — a stage 2
 * that also changed hp and range would be "harder" without being ABOUT anything, and §5 stage 4
 * could not tell which half of the change did what.
 *
 * `requestInterval` 6/5/4 against stage 1's 9/7/5 is the shortest opening interval of stages 1-3.
 * The melee share drops one notch (5:1 -> 4:1) so that stage 1 keeps the highest melee share in
 * the table, which is the other half of §2.3's row for stage 1.
 */
const STAGE_TWO: StageSpec = {
  id: 2,

  arenaWidth: 56,
  arenaHeight: 32,

  leashRadius: 10.0,

  meleeHp: 1.0,
  meleeMoveSpeed: 0.14,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.045,

  shooterHp: 0.8,
  shooterMoveSpeed: 0.06,
  shooterRange: 4.5,
  shooterAttackInterval: 30,
  shooterDamage: 0.035,

  spawnRadius: 13.0,
  engageRadius: 10.0,
  absoluteEnemyCap: 72,
  backlogSize: 16,
  backlogDrainPerTick: 3,
  pressurePhases: [
    { fromTick: 0, engagedCap: 18, requestInterval: 6, meleeToShooter: [4, 1] },
    { fromTick: 900, engagedCap: 24, requestInterval: 5, meleeToShooter: [3, 1] },
    { fromTick: 1800, engagedCap: 30, requestInterval: 4, meleeToShooter: [2, 1] },
  ],

  eliteSpawnTick: 1800,
  eliteHp: 23.0,
  eliteMoveSpeed: 0.1,
  eliteApproachRange: 4.5,
  eliteTelegraphTicks: 54,
  eliteCooldownTicks: 56,
  eliteBlastRadius: 2.4,
  eliteDamage: 0.4,
}

/**
 * STAGE 3 — 노랑. MANY WEAK BODIES (§2.3: "다수 약체 — 상한 ↑, 개체 HP ↓", 화력 분산 대 집중).
 *
 * TWO numbers move together here and they are the row's whole identity: the engaged caps go to
 * 24/32/40, the highest in the table, and `meleeHp`/`shooterHp` go to 0.6/0.5, the lowest in the
 * table. Everything a soldier shoots dies in fewer shots and there are far more of them, which is
 * the "spread fire or concentrate it" question §2.3 names.
 *
 * The request intervals are LONGER than stage 2's (7/6/5 against 6/5/4) on purpose. Stage 2 is
 * the arrival-rate stage; stage 3 is the standing-population stage, and if it also had the
 * shortest intervals the two rows would be the same stage with different hp.
 */
const STAGE_THREE: StageSpec = {
  id: 3,

  arenaWidth: 56,
  arenaHeight: 32,

  leashRadius: 10.0,

  meleeHp: 0.6,
  meleeMoveSpeed: 0.145,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.04,

  shooterHp: 0.5,
  shooterMoveSpeed: 0.065,
  shooterRange: 4.4,
  shooterAttackInterval: 30,
  shooterDamage: 0.03,

  spawnRadius: 13.0,
  engageRadius: 10.0,
  absoluteEnemyCap: 90,
  backlogSize: 20,
  backlogDrainPerTick: 4,
  pressurePhases: [
    { fromTick: 0, engagedCap: 24, requestInterval: 7, meleeToShooter: [4, 1] },
    { fromTick: 900, engagedCap: 32, requestInterval: 6, meleeToShooter: [3, 1] },
    { fromTick: 1800, engagedCap: 40, requestInterval: 5, meleeToShooter: [2, 1] },
  ],

  eliteSpawnTick: 1800,
  eliteHp: 25.0,
  eliteMoveSpeed: 0.1,
  eliteApproachRange: 4.5,
  eliteTelegraphTicks: 54,
  eliteCooldownTicks: 56,
  eliteBlastRadius: 2.4,
  eliteDamage: 0.4,
}

/**
 * STAGE 4 — 초록. THE DESIGN CORE (§2.3: "4번이 이 캠페인의 설계적 핵심이다").
 *
 * Two axes move and they are the same argument twice. §1.6 made `SOLDIER_RANGE - shooterRange`
 * the band a friendly can stand in and shoot without being shot back; §2.3 says I4 fails on a
 * single stage because "사수 비중이 낮아 사거리 판단이 결과를 거의 안 바꾼다". So:
 *
 *   the shooter share goes 1:1 -> 1:2 -> 1:3, the highest of any stage in EVERY phase, and
 *   `shooterRange` goes to 4.9 — `rangeAdvantage` 0.1, the smallest in the table.
 *
 * A band of 0.1m is a band a player has to aim at rather than stumble into, and it is the top of
 * §2's stated `3.0~4.9` search range: this is the axis at its limit, not part-way along it.
 *
 * The shooters are also individually better here (hp 0.9, interval 26, damage 0.04) because a
 * stage about shooters whose shooters die to one volley asks nothing. Everything else — the melee
 * class, the radii, the arena, the leash — is stage 1's, so that I4 measured on this stage is
 * measuring the two axes above and not five others.
 */
const STAGE_FOUR: StageSpec = {
  id: 4,

  arenaWidth: 56,
  arenaHeight: 32,

  leashRadius: 10.0,

  meleeHp: 1.0,
  meleeMoveSpeed: 0.14,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.045,

  shooterHp: 0.9,
  shooterMoveSpeed: 0.07,
  shooterRange: 4.9,
  shooterAttackInterval: 26,
  shooterDamage: 0.04,

  spawnRadius: 13.0,
  engageRadius: 10.0,
  absoluteEnemyCap: 72,
  backlogSize: 16,
  backlogDrainPerTick: 3,
  pressurePhases: [
    { fromTick: 0, engagedCap: 20, requestInterval: 7, meleeToShooter: [1, 1] },
    { fromTick: 900, engagedCap: 26, requestInterval: 6, meleeToShooter: [1, 2] },
    { fromTick: 1800, engagedCap: 32, requestInterval: 5, meleeToShooter: [1, 3] },
  ],

  eliteSpawnTick: 1800,
  eliteHp: 27.0,
  eliteMoveSpeed: 0.1,
  eliteApproachRange: 4.5,
  eliteTelegraphTicks: 50,
  eliteCooldownTicks: 52,
  eliteBlastRadius: 2.6,
  eliteDamage: 0.42,
}

/**
 * STAGE 5 — 파랑. THE BOARD OPENS AND THE LEASH DOES NOT (§2.3: "아레나 확대 + 리쉬 상대적 축소").
 *
 * 84x48 is 1.5x on each side, 2.25x the area, and `leashRadius` goes DOWN from 10.0 to 8.0 — so
 * the shrink is absolute as well as relative and the ratio of leash to board width falls from
 * 0.179 to 0.095. §1.4.1 anchors the leash to the command unit so that where the player stands
 * decides which fight happens; this row is that question asked on a board with far more places to
 * stand.
 *
 * `COMMANDER_START` STAYS `{28, 16}` AND IS NO LONGER THE CENTRE HERE. §2.2 does not list the
 * friendly anchor among the eight axes and `constants.ts` declares it as §1.2 structure, so this
 * row does not move it and no field is added to carry it. The squad opens 28 from the west wall
 * and 16 from the south — stage 1's distances exactly — with all 2.24x of the new room to the
 * east and north. The header says what the batch measured about that rather than asserting it
 * does not matter.
 *
 * `engageRadius` rises to 11.0 with `spawnRadius` to 15.0 (§1.10 wants >= engage + 2.0): on a
 * board this size, keeping the spawn ring at 13.0 would drop enemies into a smaller fraction of
 * the space the player just gained.
 */
const STAGE_FIVE: StageSpec = {
  id: 5,

  arenaWidth: 84,
  arenaHeight: 48,

  leashRadius: 8.0,

  meleeHp: 1.0,
  meleeMoveSpeed: 0.145,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.045,

  shooterHp: 0.85,
  shooterMoveSpeed: 0.07,
  shooterRange: 4.6,
  shooterAttackInterval: 28,
  shooterDamage: 0.04,

  spawnRadius: 15.0,
  engageRadius: 11.0,
  absoluteEnemyCap: 76,
  backlogSize: 16,
  backlogDrainPerTick: 3,
  pressurePhases: [
    { fromTick: 0, engagedCap: 20, requestInterval: 7, meleeToShooter: [3, 1] },
    { fromTick: 900, engagedCap: 26, requestInterval: 6, meleeToShooter: [2, 1] },
    { fromTick: 1800, engagedCap: 32, requestInterval: 5, meleeToShooter: [3, 2] },
  ],

  eliteSpawnTick: 1800,
  eliteHp: 30.0,
  eliteMoveSpeed: 0.105,
  eliteApproachRange: 4.6,
  eliteTelegraphTicks: 48,
  eliteCooldownTicks: 50,
  eliteBlastRadius: 2.8,
  eliteDamage: 0.45,
}

/**
 * STAGE 6 — 남색. THE ELITE'S CLOCK (§2.3: "정예 주기 단축·범위 확대", 회피와 구조의 시간 예산).
 *
 * Four elite numbers move together and each one spends the same budget: the player's ticks.
 *
 *   `eliteSpawnTick`      1800 -> 1500   it is on the board for a third of the fight, not a fifth
 *   `eliteTelegraphTicks`   54 -> 32     the warning is 1.07s instead of 1.8s
 *   `eliteCooldownTicks`    56 -> 34     a blast every ~2.2s instead of every ~3.7s
 *   `eliteBlastRadius`     2.4 -> 3.6    2.25x the area to be outside of when it lands
 *
 * §4.5's fourth question is whether to go back for a downed body, and the answer is a time budget:
 * running to a body, standing over it and running out again has to fit between two blasts. This
 * row is that budget cut roughly in half.
 *
 * THE EARLIER ARRIVAL CUTS BOTH WAYS AND THAT IS DELIBERATE. §1.12 makes killing the elite the
 * only way to win, so an elite that arrives at 1500 hands the squad 1200 ticks to kill it instead
 * of 900 — on its own, EASIER. `eliteHp` 34.0 is what is set against that, and which way the pair
 * actually lands is a measurement in the batch report, not a claim here.
 */
const STAGE_SIX: StageSpec = {
  id: 6,

  arenaWidth: 84,
  arenaHeight: 48,

  leashRadius: 8.0,

  meleeHp: 1.0,
  meleeMoveSpeed: 0.145,
  meleeRange: 0.75,
  meleeAttackInterval: 15,
  meleeDamage: 0.045,

  shooterHp: 0.9,
  shooterMoveSpeed: 0.07,
  shooterRange: 4.6,
  shooterAttackInterval: 26,
  shooterDamage: 0.04,

  spawnRadius: 14.0,
  engageRadius: 11.0,
  absoluteEnemyCap: 80,
  backlogSize: 18,
  backlogDrainPerTick: 3,
  pressurePhases: [
    { fromTick: 0, engagedCap: 22, requestInterval: 6, meleeToShooter: [2, 1] },
    { fromTick: 900, engagedCap: 28, requestInterval: 5, meleeToShooter: [2, 1] },
    { fromTick: 1800, engagedCap: 34, requestInterval: 4, meleeToShooter: [3, 2] },
  ],

  eliteSpawnTick: 1500,
  eliteHp: 34.0,
  eliteMoveSpeed: 0.11,
  eliteApproachRange: 4.8,
  eliteTelegraphTicks: 32,
  eliteCooldownTicks: 34,
  eliteBlastRadius: 3.6,
  eliteDamage: 0.5,
}

/**
 * STAGE 7 — 보라. EVERY AXIS NEAR ITS MAXIMUM (§2.3: "종합").
 *
 * "근처" and not "at": stage 4 keeps the smallest range gap and stage 3 keeps the weakest bodies,
 * because a last stage that took every axis to its extreme would erase the identity of the six
 * rows leading to it — every stage would just be stage 7 turned down. What stage 7 holds outright
 * is the population and the elite: the largest `absoluteEnemyCap` (96), the shortest request
 * intervals in every phase (5/4/3), the widest blast (4.0) and the toughest elite (40.0 hp).
 *
 * The melee class is finally above stage 1's on all three of hp, speed and damage — the only row
 * where it is.
 */
const STAGE_SEVEN: StageSpec = {
  id: 7,

  arenaWidth: 84,
  arenaHeight: 48,

  leashRadius: 8.0,

  meleeHp: 1.1,
  meleeMoveSpeed: 0.15,
  meleeRange: 0.8,
  meleeAttackInterval: 14,
  meleeDamage: 0.05,

  shooterHp: 0.9,
  shooterMoveSpeed: 0.075,
  shooterRange: 4.8,
  shooterAttackInterval: 24,
  shooterDamage: 0.045,

  spawnRadius: 15.0,
  engageRadius: 11.0,
  absoluteEnemyCap: 96,
  backlogSize: 22,
  backlogDrainPerTick: 4,
  pressurePhases: [
    { fromTick: 0, engagedCap: 26, requestInterval: 5, meleeToShooter: [2, 1] },
    { fromTick: 900, engagedCap: 34, requestInterval: 4, meleeToShooter: [1, 1] },
    { fromTick: 1800, engagedCap: 42, requestInterval: 3, meleeToShooter: [1, 2] },
  ],

  eliteSpawnTick: 1500,
  eliteHp: 40.0,
  eliteMoveSpeed: 0.115,
  eliteApproachRange: 4.8,
  eliteTelegraphTicks: 30,
  eliteCooldownTicks: 32,
  eliteBlastRadius: 4.0,
  eliteDamage: 0.55,
}

/**
 * The whole campaign, in stage order.
 *
 * THE ORDER IS THE CAMPAIGN. `nextStageIdOf` walks this array by position, so a row moved here
 * moves the play order — which is why the ids are written out and ascending rather than implied
 * by the index.
 */
export const STAGES: readonly StageConfig[] = [
  buildStage(STAGE_ONE),
  buildStage(STAGE_TWO),
  buildStage(STAGE_THREE),
  buildStage(STAGE_FOUR),
  buildStage(STAGE_FIVE),
  buildStage(STAGE_SIX),
  buildStage(STAGE_SEVEN),
]

/**
 * §3.1: the configuration, derived from the id on the state.
 *
 * PURE. No cache, no memo, no mutation, no fallback — an unknown id throws, because the
 * alternative is a battle quietly played under some other stage's rules and a digest that says
 * it was this one's.
 */
export function stageConfigOf(stageId: StageId): StageConfig {
  for (const stage of STAGES) {
    if (stage.id === stageId) return stage
  }
  throw new Error(`battle/stages: no stage with id ${stageId}`)
}

/** The same lookup for the common case: a rule module holding the state it is advancing. */
export function stageOf(state: { readonly stageId: StageId }): StageConfig {
  return stageConfigOf(state.stageId)
}

// ---------------------------------------------------------------------------
// Structural invariants — §1 states these as relations, not as search ranges.
// ---------------------------------------------------------------------------
// They are here rather than in `constants.ts` because each one now relates a STAGE number to a
// fixed one, so there is a check to run per row rather than once per module. Every stage is
// checked at module load, which is before any battle object can exist: a table edited past one
// of §1's edges is a loud import-time failure and not a subtly broken run.

function assertStageRule(stage: StageConfig, condition: boolean, message: string): void {
  if (!condition) throw new Error(`battle/stages: stage ${stage.id} — ${message}`)
}

for (const stage of STAGES) {
  // §1.6/§1.9: the range advantage is the mechanism that replaced cover. It is the band
  // `[shooterRange, SOLDIER_RANGE]` a friendly can stand in and shoot without being shot back;
  // a shooter that outranged a soldier would erase the band and with it the only reason "where
  // do I stop" is a question.
  assertStageRule(
    stage,
    stage.shooterRange < SOLDIER_RANGE,
    'shooterRange must be < SOLDIER_RANGE (§1.9)',
  )
  assertStageRule(stage, stage.rangeAdvantage > 0, 'the range advantage must be positive (§1.6)')
  // §1.3: THE relation this version of the design rests on. Units fire while moving, so the only
  // thing stopping pure flight is that the melee is faster than the body the player drives.
  // Invert this and "run in a straight line forever" is an unanswerable strategy again, which is
  // the defect §1.3 records v6~v8 taxing movement in order to close.
  assertStageRule(
    stage,
    stage.meleeMoveSpeed > COMMANDER_MOVE_SPEED,
    'meleeMoveSpeed must be > COMMANDER_MOVE_SPEED (§1.3)',
  )
  // §1.4.2/§2: at or beyond `shooterRange` the command unit could swing from a spot no shooter
  // can answer from, so the melee would be free and §1.6's advantage would not be the thing it
  // costs. "근접 사거리는 SHOOTER_RANGE보다 확실히 짧다." The other two melee relations are
  // between fixed constants and stay in `constants.ts`.
  assertStageRule(
    stage,
    COMMANDER_MELEE_RANGE < stage.shooterRange,
    'COMMANDER_MELEE_RANGE must be < shooterRange (§1.4.2)',
  )
  // §1.4.1/§2: both edges of the leash box, and each one is a different failure. Under the
  // formation radius, "the soldier left its slot to fight" is a statement no observer can
  // distinguish from "the soldier is in its slot" — the rule would exist and show nothing. Over
  // `SOLDIER_RANGE + engageRadius` the squad can answer anything inside the radius §1.10 spawns
  // against, from wherever the command unit happens to be, and §4.5's third question ("어디에
  // 멈출지 고민했는가") has no mechanism behind it any more.
  assertStageRule(
    stage,
    stage.leashRadius > FORMATION_MAX_SLOT_RADIUS,
    'leashRadius must be > FORMATION_MAX_SLOT_RADIUS (§2)',
  )
  assertStageRule(
    stage,
    stage.leashRadius < SOLDIER_RANGE + stage.engageRadius,
    'leashRadius must be < SOLDIER_RANGE + engageRadius (§2)',
  )
  // §1.12: an elite that parked outside soldier range would be unkillable by the 15 bodies that
  // are supposed to kill it.
  assertStageRule(
    stage,
    stage.eliteApproachRange < SOLDIER_RANGE,
    'eliteApproachRange must be < SOLDIER_RANGE (§1.12)',
  )
  // §1.10: overlapping radii fill the cap with enemies still in transit.
  assertStageRule(
    stage,
    stage.spawnRadius >= stage.engageRadius + 2.0,
    'spawnRadius must be >= engageRadius + 2.0 (§1.10)',
  )
  // §1.10: the pressure table is walked by tick and its ratio by a phase-local index, so a gap
  // at tick 0, an out-of-order phase, a zero interval or a 0:0 ratio would each turn a rule into
  // a divide-by-nothing or a silently skipped request rather than a loud failure.
  assertStageRule(
    stage,
    stage.pressurePhases.length > 0,
    'the pressure curve needs at least one phase (§1.10)',
  )
  assertStageRule(
    stage,
    stage.pressurePhases[0].fromTick === 0,
    'the first pressure phase must start at tick 0 (§1.10)',
  )
  for (let index = 0; index < stage.pressurePhases.length; index += 1) {
    const phase = stage.pressurePhases[index]
    assertStageRule(
      stage,
      index === 0 || phase.fromTick > stage.pressurePhases[index - 1].fromTick,
      'pressure phases must start on strictly ascending ticks (§1.10)',
    )
    assertStageRule(
      stage,
      phase.requestInterval >= 1,
      'every pressure phase needs requestInterval >= 1 (§1.10)',
    )
    assertStageRule(stage, phase.engagedCap >= 1, 'every pressure phase needs engagedCap >= 1 (§1.10)')
    assertStageRule(
      stage,
      phase.meleeToShooter[0] >= 0 &&
        phase.meleeToShooter[1] >= 0 &&
        phase.meleeToShooter[0] + phase.meleeToShooter[1] >= 1,
      'every melee:shooter ratio needs a positive total weight (§1.10)',
    )
  }
  assertStageRule(stage, stage.backlogSize >= 1, 'backlogSize must be >= 1 (§1.10)')
  assertStageRule(
    stage,
    stage.backlogDrainPerTick >= 1,
    'backlogDrainPerTick must be >= 1 (§1.10)',
  )
  assertStageRule(stage, stage.arenaWidth > 0 && stage.arenaHeight > 0, 'the arena must have area (§1.1)')
}

// §2.3: THE ARRAY ORDER IS THE CAMPAIGN ORDER, and two functions read it two different ways —
// `stageConfigOf` finds a row by ID, `nextStageIdOf` finds the next one by POSITION. A duplicate
// id makes the second copy unreachable through the first; a row out of order makes a campaign play
// 1, 3, 2 while every screen prints 1, 2, 3. Neither is visible at the call site, so both are
// import-time failures here.
for (let index = 1; index < STAGES.length; index += 1) {
  assertStageRule(
    STAGES[index],
    STAGES[index].id > STAGES[index - 1].id,
    'stage ids must be unique and ascending in play order (§2.3)',
  )
}
