// Every harness-owned number the CAMPAIGN DOES NOT VARY lives in this file.
//
// The eight axes §2.2 lets a stage change — the arena, the leash, the enemy classes' numbers,
// the shooter's range, supply geometry, the pressure curve and the elite — moved to `stages.ts`
// when campaign stage 0 went in. Nothing here is per-stage, and a number that becomes per-stage
// belongs in that file with the rest of its axis rather than in both.
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

import { FORMATION_SLOTS } from './formation'

// ---------------------------------------------------------------------------
// FIXED — §1.1 coordinates and clock
// ---------------------------------------------------------------------------

/**
 * §1.1: the commander starts at the centre of the 56 x 32 arena.
 *
 * THE ARENA ITSELF IS A STAGE AXIS (§2.2 "아레나") and lives in `stages.ts` as `arenaWidth` /
 * `arenaHeight`. This start position is NOT: it is §1.2's friendly anchor, which the campaign
 * does not vary. The two agree at stage 1 — (28, 16) is the centre of 56 x 32 — and nothing
 * asserts that they will keep agreeing, because §1.2 does not say they must. It is written
 * down here so the batch that first gives a stage a different arena reads it.
 *
 * Declared here rather than imported from `gameplay/terrain.ts` because §1.6 removes
 * terrain from the game entirely. That module — and `gameplay/geometry.ts`,
 * `harness/i9.ts`, `artifacts/i9-sweep.md` — stay in the repository as the evidence
 * that cover was measured and rejected, and `core/battle/` must not import any of
 * them; `tests/battle/battle-no-cover.test.ts` pins that.
 */
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
// PLACEHOLDER — §1.4.2 the command unit's melee (§2 `COMMANDER_MELEE_*`)
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER — how close the command unit has to be before it swings instead of shooting.
 *
 * §2 boxes this on one side only, and that one side is the whole rule: `< shooterRange`. The
 * melee is not a better attack the player unlocks, it is a POSITION the player buys — reaching
 * it means standing inside the band every shooter on the board fires from, so §1.6's range
 * advantage is what gets spent to get there. The per-stage assert in `stages.ts` holds that
 * edge — the shooter's range is a stage's number now — and nothing holds the other, because §2
 * gives no lower bound.
 *
 * 1.2 is an arbitrary starting point like every other PLACEHOLDER here, chosen as "close enough
 * that the two bodies are visibly touching, far enough that it is not the melee class's own
 * contact range (0.75 at stage 1) by another name". §5 owns the final number. NOTE what §2 does
 * NOT constrain and this file does not pretend to: the relation between this and the enemy's own
 * `meleeRange` is unstated, so at
 * 1.2 against 0.75 the command unit can open on a closing melee before that melee can answer.
 * That is a consequence of the placeholders, not a rule.
 */
export const COMMANDER_MELEE_RANGE = 1.2
/**
 * PLACEHOLDER — §2: `> COMMANDER_DAMAGE`. "세지 않으면 붙을 이유가 없고, 붙을 이유가 없으면 이
 * 규칙은 없는 것과 같다" (§1.4.2).
 */
export const COMMANDER_MELEE_DAMAGE = 0.5
/**
 * PLACEHOLDER — §2: `<= COMMANDER_ATTACK_INTERVAL`. The equality is allowed on purpose, so a
 * tuning pass may make the melee purely a damage trade with no rate change.
 */
export const COMMANDER_MELEE_INTERVAL = 8

// ---------------------------------------------------------------------------
// PLACEHOLDER — friendly HP (§2: commander 3~7, soldier 1.0~2.0)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const COMMANDER_HP = 5.0
/** PLACEHOLDER */
export const SOLDIER_HP = 1.4

// ---------------------------------------------------------------------------
// PLACEHOLDER — §1.2.1 돌격병 (charger). The front rank of §1.4's lattice.
// ---------------------------------------------------------------------------

/** PLACEHOLDER — melee reach. A charger closes; it does not hold §1.6's band. */
export const CHARGER_RANGE = 1.1
/**
 * PLACEHOLDER — §1.2.1: BELOW `SOLDIER_DAMAGE`. A charger standing still is worse than a rifle,
 * and that is the rule rather than a weakness: v17 measured that any front rank which is simply
 * stronger makes doing NOTHING stronger by the same amount, because §1.3 and §1.4.1 have the
 * squad fighting on its own. The value has to live somewhere a still squad cannot reach.
 */
export const CHARGER_DAMAGE = 0.10
/** PLACEHOLDER — §1.2.1: the blow that lands while CLOSING. This is the whole class. */
export const CHARGE_DAMAGE = 1.0
/** PLACEHOLDER — a swing is faster than a rifle's cycle. */
export const CHARGER_ATTACK_INTERVAL = 9


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
// §1.9 — the enemy classes' SLOT COUNTS, and the shooter band's ratio
// ---------------------------------------------------------------------------
// The class NUMBERS — hp, speed, range, interval, damage — are §2.2's "적 능력치" axis and live
// in `stages.ts`. What stays here is what §1.9 states as structure rather than as a quantity:
// how many enemies may hold one friendly at once, and the SHAPE of the shooter's stop band.

/**
 * §2 expresses the shooter's stop band as a RATIO of its range, so the ratio is what is
 * written down and the metres are derived per stage (`stages.ts`, `shooterStandoff`).
 *
 * Writing the pair as literals is how the first draft ended up at `4.28` against a ceiling of
 * `0.95 x 4.5 = 4.275`: outside its own declared box, and the assert below could not see it
 * because it only compared against `SHOOTER_RANGE`. §2.2 has no axis that moves this ratio, so
 * it is not a stage number.
 */
export const SHOOTER_STANDOFF_RATIO: readonly [number, number] = [0.6, 0.95]

/** §1.9: one contact slot per friendly. */
export const MELEE_CONTACT_SLOTS_PER_FRIENDLY = 1
/** §1.9: two shooter target slots per friendly. */
export const SHOOTER_TARGET_SLOTS_PER_FRIENDLY = 2

// ---------------------------------------------------------------------------
// PLACEHOLDER — §1.10.1's floor (§2: `minPressureFraction` 0.3~0.8)
// ---------------------------------------------------------------------------

/**
 * PLACEHOLDER — the floor under §1.10.1's pressure fraction. §2 searches `0.3 ~ 0.8`.
 *
 * WHAT THE FRACTION IS. §1.10.1 makes the board's size a function of the squad that ENTERED the
 * stage: `effectiveCap = ceil(phaseCap x enteringStanding / ROSTER_SIZE)`, with the request
 * interval divided by the same fraction. `spawn.ts` owns the arithmetic; this file owns the floor.
 *
 * WHY THERE IS A FLOOR AT ALL. §1.10.1 names the failure an unbounded fraction would create:
 * "잃을수록 판이 쉬워지면 사상자가 비용이 아니라 보상이 되고, §1.11의 구조와 §4.5 4번 질문이
 * 무의미해진다." Without a floor the fraction goes to zero with the squad, so a relay leg opened by
 * two bodies would meet a board scaled to two and the campaign would decelerate into a stalemate
 * instead of ending. Since the v14 fix the floor is the SECONDARY guard, and §1.10.1 says so: the
 * primary one is that pressure does not move inside a battle at all.
 *
 * WHY 0.65 — AND THE REASON THAT FIRST CHOSE IT IS VOID. It was picked as the largest floor that
 * kept §2.4's three checks, which broke at 0.7 and above. Under the entering count that argument
 * cannot be made: every run of the per-stage band opens with a fresh sixteen, so the fraction is 1
 * in all 448 of them and the floor multiplies nothing. Measured, not deduced — the stage band was
 * played at all six of `0.3 / 0.5 / 0.65 / 0.7 / 0.75 / 0.8` and all six are identical in every
 * field of all 448 rows, so §2.4, I1, I2, I3, I8, I10 and I13 are the same number across the box.
 *
 * SO THE BOX WAS RE-SWEPT ON WHAT CAN STILL SEE IT, and nothing in it is excluded:
 *
 *   the campaign band (64 campaigns) at `0.3 / 0.5 / 0.65 / 0.7 / 0.75 / 0.8` gives `skilled`
 *   `2 / 1 / 1 / 1 / 1 / 2` of 8 — every point inside §4's `1~6` target, and a spread of one
 *   campaign, which is not a separation;
 *
 *   `entry-cost.sweep.ts`, which plays every stage with squads that walked in at 16 down to 2,
 *   says the clause the floor exists for holds at all six: wins fall and damage per entering body
 *   rises as the entering squad shrinks, everywhere. Arriving short is always a cost.
 *
 * IT STAYS AT 0.65 BECAUSE NOTHING MEASURED MOVES IT. The box's two ends are two clauses trading
 * off monotonically with no kink between them — a smaller floor removes more of the relay's decay
 * (campaigns reaching stage 7: `14 / 13 / 13 / 11 / 10 / 8` of 64), a larger one makes arriving
 * short cost more (wins for a ten-body entry: `28 / 28 / 23 / 18 / 11 / 9` of 56). 0.65 is the
 * interior point the earlier sweep left and this one does not exclude. Moving it toward the
 * campaign band's one-campaign spread would be tuning against noise, so it was not moved. §5 stage
 * 4 owns the balance and this is still a placeholder.
 *
 * WHAT IT MEANS AT `ROSTER_SIZE` 16. The fraction tracks the entering squad exactly from 16 down
 * to 11 (`11/16 = 0.6875`), and from 10 downward the floor holds it at 0.65. Of the 109 relay legs
 * the campaign band played at this value, 37 opened below that knee.
 */
export const MIN_PRESSURE_FRACTION = 0.65

// ---------------------------------------------------------------------------
// PLACEHOLDER — rescue (§1.11)
// ---------------------------------------------------------------------------

/** PLACEHOLDER */
export const RESCUE_RANGE = 1.5
/** PLACEHOLDER — ticks of held Space required to complete a rescue. */
export const RESCUE_TICKS = 45
/** PLACEHOLDER — invulnerable ticks granted on revival. */
export const RESCUE_INVULNERABLE_TICKS = 45
/** PLACEHOLDER — ticks a downed friendly survives before dying. */
export const DOWNED_TICKS = 600
/** §1.11: revival returns the unit at half its maximum HP. */
export const RESCUE_REVIVE_FRACTION = 1.0

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
// FOUR OF §1's RELATIONS ARE NOT HERE, and each is asserted per stage in `stages.ts` instead:
// §1.3's `meleeMoveSpeed > COMMANDER_MOVE_SPEED`, §1.6/§1.9's `shooterRange < SOLDIER_RANGE`,
// §1.4.2's `COMMANDER_MELEE_RANGE < shooterRange`, §1.12's `eliteApproachRange < SOLDIER_RANGE`
// and both edges of §1.4.1's leash box. Each relates a number the campaign varies to one it does
// not, so the check has to run once per stage row rather than once for the module.
// §1.4.2/§2: the two of the melee's three relations that hold between FIXED numbers. The third
// (range, against `shooterRange`) is in `stages.ts` because its right-hand side is a stage's.
//   damage — at or below `COMMANDER_DAMAGE` there is no reason to close, and a rule nobody has
//            a reason to use is not in the game at all.
//   rate   — above `COMMANDER_ATTACK_INTERVAL` the melee would be slower AND require the worse
//            position, which is the same non-rule from the other side.
assertRule(
  COMMANDER_MELEE_DAMAGE > COMMANDER_DAMAGE,
  'COMMANDER_MELEE_DAMAGE must be > COMMANDER_DAMAGE (§1.4.2)',
)
assertRule(
  COMMANDER_MELEE_INTERVAL <= COMMANDER_ATTACK_INTERVAL,
  'COMMANDER_MELEE_INTERVAL must be <= COMMANDER_ATTACK_INTERVAL (§1.4.2)',
)
// An interval of 0 is not "faster", it is a body attacking every tick forever; the same guard
// `RESCUE_TICKS` gets, for the same reason.
assertRule(COMMANDER_MELEE_INTERVAL >= 1, 'COMMANDER_MELEE_INTERVAL must be >= 1 (§1.4.2)')
assertRule(COMMANDER_MELEE_RANGE > 0, 'COMMANDER_MELEE_RANGE must be positive (§1.4.2)')
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
// §2: the band is declared as a ratio of the shooter's range, so the ratio is what gets
// checked. Comparing the derived metres against that range alone would accept anything up to it
// and miss exactly the kind of drift this exists to catch — which is why the metres are derived
// in `stages.ts` from this pair rather than typed out per stage.
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
// §1.10.1/§2: `minPressureFraction` is boxed at `0.3 ~ 0.8`, and BOTH edges are a rule rather
// than a taste. Under 0.3 the board a two-body squad meets has shrunk by more than two thirds and
// §1.10.1's "사상자가 비용이 아니라 보상이 되고" is the state the game is in — the floor has stopped
// being a floor. Over 0.8 the scaling has almost no room to act before it bottoms out (at 16 bodies
// a floor of 0.8 binds from 13 standing downward), so §1.10.1's whole purpose — a smaller squad
// meeting a smaller board — is expressed over three bodies and the coupling it exists to break is
// still there. This is the one assert that stands between the rule and the trap the rule names, so
// it is checked here at module load rather than trusted to a fixture.
assertRule(
  MIN_PRESSURE_FRACTION >= 0.3 && MIN_PRESSURE_FRACTION <= 0.8,
  'MIN_PRESSURE_FRACTION must be within [0.3, 0.8] (§2)',
)

// §1.2.1: the two halves of the charger, and the relation between them IS the class. A charger
// that is not worse standing still would be a rifleman with a shorter reach; one that is not
// much better while closing would be a rifleman that gave up its range for nothing.
assertRule(CHARGER_DAMAGE < SOLDIER_DAMAGE, 'CHARGER_DAMAGE must be < SOLDIER_DAMAGE (§1.2.1)')
assertRule(CHARGE_DAMAGE > SOLDIER_DAMAGE, 'CHARGE_DAMAGE must be > SOLDIER_DAMAGE (§1.2.1)')

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
