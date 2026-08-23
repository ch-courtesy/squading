// §1.7 movement boundary, §1.4 follow and §1.4.1 leash engagement.
//
// §1.6 removed cover, and with it most of what used to be in this file. What is left:
//
//   leash (§1.4.1) — a soldier with a standing enemy inside `leashRadius` OF THE COMMAND
//                      UNIT leaves its slot and moves to ITS OWN POINT on its range band around
//                      that enemy — the band gives the distance and the soldier's own slot
//                      offset gives the bearing (v11), so fifteen soldiers on one target spread
//                      around it instead of stacking on one spot;
//                      one without goes back to the slot by the follow rule below. Through v9
//                      every soldier was pinned to a slot and the sixteen bodies slid as one,
//                      which is what the first person to play it read as "각개전투가 안 됨".
//                      The leash is anchored to the COMMAND UNIT and nothing else: that is
//                      what keeps where the player stands deciding which fight happens.
//   the arena clamp (§1.7) — the ONLY movement boundary. "지형이 없으므로 슬라이딩·
//                      밀어내기·끼임 판정은 존재하지 않는다." x-then-y sliding, the
//                      union-based ejection out of blocking rectangles, and the 30-tick
//                      stuck counter are all deleted, not disabled: with nothing but the
//                      arena edge to push against, an enemy cannot be ground to a halt
//                      forever, so the retarget rule they fed has no trigger either.
//   settle (§1.4)  — a follower within ARRIVE_EPSILON of its slot does not move AT
//                      ALL. §1.4 states the reason and it is now the only one: "점근하며
//                      미세 진동하는 것을 막는다". A slot is `command unit + offset` with no
//                      pull and no latch, so it is a fixed point whenever the command unit
//                      stands still, and the dead-band is what stops the follower creeping
//                      the last micrometre of the way there forever.
//                      Under v6~v8 this rule also decided whether the soldier could shoot —
//                      a residual displacement read as movement silenced it. §1.3 (v9)
//                      deleted that coupling, so the band is about jitter and nothing else.
//
// Enemy movement (§1.9) is NOT here — it belongs to `enemy.ts`. It stays an explicit
// argument of `advanceMovement` so that a tick loop which forgets it is a type
// error rather than a battle where nothing attacks.

import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  FOLLOW_MAX_SPEED,
  SOLDIER_MOVE_SPEED,
} from './constants'
import { stageOf } from './stages'
import { FORMATION_SLOTS, findAssignment, slotPosition } from './formation'
import { enemiesById, findEnemy } from './state'
import { attackRangeOf, selectRankedEnemyId } from './targeting'
import { followSpeedMultiplierOf, moveSpeedMultiplierOf } from './upgrades'
import type { BattleState, EnemyUnit, FriendlyUnit, Vec2 } from './types'

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

/**
 * §1.7's boundary. It takes the state because the arena is §2.2's "아레나" axis and therefore a
 * stage's — `stages.ts` holds the width and the height, and this is where they are read.
 */
export function clampToArena(state: BattleState, x: number, y: number): Vec2 {
  const stage = stageOf(state)
  return { x: clamp(x, stage.arenaWidth), y: clamp(y, stage.arenaHeight) }
}

/**
 * §1.7: apply the displacement and clamp the result to the arena. That is the whole rule.
 *
 * Kept as a named function rather than inlined at the three call sites because it is the
 * single place a position becomes legal, and because the axis-by-axis sliding it replaced
 * was subtle enough to be worth having one obvious successor.
 */
export function stepMove(state: BattleState, from: Vec2, dx: number, dy: number): Vec2 {
  return clampToArena(state, from.x + dx, from.y + dy)
}

function displacementOf(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

export function commandUnitOf(state: BattleState): FriendlyUnit | null {
  for (const unit of state.friendlies) {
    if (unit.id === state.commandUnitId) return unit
  }
  return null
}

/**
 * §1.2's move speed for a body, after §1.13's `mobility` card (+15%).
 *
 * Takes `state` for that card, in the same shape as `attackDamageOf`: the magnitude is read off
 * the chosen cards every time it is asked for, so nothing is stored and no digest field moves.
 * Only the command unit consumes this — followers are capped by `followSpeedOf` — so `mobility`
 * is exactly "the body the player is driving moves faster", whichever body that is (§1.5).
 *
 * `mobility` is also the one card that touches §1.3's speed relation: it takes the commander to
 * `0.115 x 1.15 = 0.13225`, which is still under stage 1's `meleeMoveSpeed 0.140` but would NOT
 * be under the bottom of §2's search range. See the note on `meleeMoveSpeed` in `stages.ts`.
 */
export function moveSpeedOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander' ? COMMANDER_MOVE_SPEED : SOLDIER_MOVE_SPEED
  return base * moveSpeedMultiplierOf(state)
}

/**
 * §1.2's follow-speed cap, after §1.13's `cohesion` card (x1.2).
 *
 * `FOLLOW_SPEED_MULTIPLIER` itself is FIXED by §1.2, so `cohesion` is the only thing that may
 * move this number, and it is deliberately disjoint from `mobility`: a squad whose leader took
 * `mobility` (0.13225) outruns the base cap (0.130) while moving, and `cohesion` is the card
 * that buys the formation back. Both apply to the same tick without touching each other.
 */
export function followSpeedOf(state: BattleState): number {
  return FOLLOW_MAX_SPEED * followSpeedMultiplierOf(state)
}

/**
 * The 지휘 유닛 이동 step: the command unit consumes the held movement vector.
 *
 * The held vector is treated as a DIRECTION, not a displacement — the input layer
 * (§1.15) is what decides whether a pointer drag is long enough to count, and it
 * clamps anything under ARRIVE_EPSILON to zero before the core ever sees it. The core
 * only asks "is it zero".
 *
 * Returns the actual displacement, clamp included. Under v6~v8 that return value was the
 * input to §1.3's stop test and the whole reason it was a return value rather than a flag;
 * §1.3 (v9) deleted the test, so no rule consumes it any more and it is now reported for
 * the fixtures and the digest. It is still the honest number: the arena edge is the one way
 * to hold an input and travel nowhere.
 */
export function advanceCommandUnit(state: BattleState): number {
  const unit = commandUnitOf(state)
  if (!unit || unit.life !== 'standing') return 0

  // §1.11: the rescue lock is decided before movement, so the very first locked tick
  // already produces no movement.
  const magnitude = state.rescue.active ? 0 : Math.hypot(state.input.move.x, state.input.move.y)
  if (magnitude === 0) {
    unit.lastDisplacement = 0
    return 0
  }

  const speed = moveSpeedOf(state, unit)
  const from = unit.position
  const to = stepMove(
    state,
    from,
    (state.input.move.x / magnitude) * speed,
    (state.input.move.y / magnitude) * speed,
  )
  const displacement = displacementOf(from, to)
  unit.position = to
  unit.lastDisplacement = displacement
  return displacement
}

/**
 * §1.4.1: the enemy this soldier is fighting on THIS tick, or `null` if it is off the leash.
 *
 * DERIVED, NEVER STORED. §1.4.1 says so in as many words — "새 상태 필드를 만들지 않는다.
 * '지금 교전 중인가'는 매 tick 유도된다" — and §1.17's no-scratch rule is why: the digest walks
 * the whole of `BattleState`, so an `engagedWith` field would move every recorded digest and
 * every 8-seed band with it. The answer is recomputed here every tick instead, and
 * `slotAssignments` goes on meaning exactly what it meant before: the rest position.
 *
 * THE LEASH IS ANCHORED TO THE COMMAND UNIT. Not to the soldier and not to its slot, and that
 * is the whole design: an enemy is a candidate because of where THE PLAYER'S BODY is standing,
 * so "where do I stop" selects which fight happens (§4.5 question 3). Soldiers that hunted from
 * wherever they happened to be would make the command unit's position stop changing the
 * outcome, which is v1's agency-free auto-battle and the thing v2 exists to escape.
 *
 * Within the admitted set the ORDER is §1.8's, unchanged and shared with the attack — see
 * `selectRankedEnemyId`. §1.16 runs 대상 선택 after this step, so the enemy a soldier walks
 * toward and the enemy it fires at are picked by the same ranking one step apart: it closes on
 * the ranked body here, and §1.8 re-picks from post-movement positions with its own range test.
 */
export function selectEngagementTargetId(state: BattleState, unit: FriendlyUnit): number | null {
  return selectEngagementTargetIn(state, unit, enemiesById(state))
}

function selectEngagementTargetIn(
  state: BattleState,
  unit: FriendlyUnit,
  enemies: readonly EnemyUnit[],
): number | null {
  const command = commandUnitOf(state)
  if (!command) return null
  // The design point, on one line so that changing it is one visible edit.
  const leashCenter = command.position

  return selectRankedEnemyId(unit.position, enemies, (enemy) => {
    const leashDistance = Math.hypot(
      enemy.position.x - leashCenter.x,
      enemy.position.y - leashCenter.y,
    )
    return leashDistance <= stageOf(state).leashRadius
  })
}

/**
 * §1.4.1's "자기 사거리 밴드": `[the stage's shooterRange, this unit's own range]`.
 *
 * It is §1.6's range advantage measured for ONE body instead of for the formation. The far edge
 * is the unit's own attack range, because past it the unit is walking without shooting; the near
 * edge is the SHOOTER's range, because inside it the shooter answers back and the advantage is
 * gone. §1.13's `marksman` widens the band by moving the far edge only — the enemy's reach is
 * not something a friendly card changes.
 */
export function engagementBandOf(state: BattleState, unit: FriendlyUnit): readonly [number, number] {
  const reach = attackRangeOf(state, unit)
  // §1.2.1: THE INVERSION IS THE ANSWER, NOT A BUG TO GUARD AGAINST.
  //
  // The band's near edge is the shooter's range because inside it the shooter answers back and
  // §1.6's advantage is gone. A skirmisher's reach is BELOW that edge, so the band it names is
  // inverted — and read plainly that says the unit has no advantage to hold, which is exactly
  // true of it. What is left is its own reach, so the band collapses to "close to contact".
  //
  // Written as `min` rather than a class branch on purpose. The rule is about the geometry, not
  // about who the unit is: any friendly that stops outranging the shooter closes, whether that
  // happens by class today or by a stage lowering someone's reach tomorrow.
  return [Math.min(stageOf(state).shooterRange, reach), reach]
}

/** §1.4: close on `target`, never overshooting it, and stop dead inside ARRIVE_EPSILON. */
function stepToward(state: BattleState, unit: FriendlyUnit, target: Vec2, speed: number): void {
  const dx = target.x - unit.position.x
  const dy = target.y - unit.position.y
  const distance = Math.hypot(dx, dy)

  // The settle rule. Exactly zero, not approximately zero.
  if (distance <= ARRIVE_EPSILON) {
    unit.lastDisplacement = 0
    return
  }

  const step = Math.min(distance, speed)
  const from = unit.position
  const to = stepMove(state, from, (dx / distance) * step, (dy / distance) * step)
  unit.position = to
  unit.lastDisplacement = displacementOf(from, to)
}

/**
 * §1.4.1 (v11): the unit direction this soldier approaches a target FROM — its own slot's.
 *
 * WHY THE SLOT AND NOT SOMETHING ELSE. v10 gave the band a distance and never gave it an angle,
 * so every soldier that picked the same target walked to the same point of the same ring. It was
 * measured, not guessed: `tactical-no-input` on `seed-a` had all fifteen soldiers engaged against
 * one or two reachable enemies, and the greatest distance from the command unit fell to 0.45 —
 * TIGHTER than the 2.460 slot lattice the leash was supposed to break up. The bearing has to be
 * deterministic, derivable from state that already exists, and free of any agreement between
 * units, because all three are what it takes to add no `BattleState` field (§1.17's no-scratch
 * rule, and the recorded key set). `slotAssignments` is the only table that satisfies all three,
 * and it reads well besides: the soldier on the formation's left flank stands on the target's
 * left.
 *
 * THE ZERO-VECTOR BRANCH IS UNREACHABLE, and this is not an assumption. `FORMATION_SLOTS` has no
 * `(0, 0)` entry — that place in the lattice is where the command unit itself stands — and
 * `constants.ts` asserts exactly that at module load ("no formation slot may be the zero vector"),
 * with `assertRule` throwing before any battle object can exist. This module imports
 * `constants.ts`, so a table edited to contain the origin cannot reach this function at all. The
 * guard stays because a caller with an out-of-range `slotIndex` would otherwise read `undefined`
 * silently, and because "unreachable" is a claim that should still have a defined answer under
 * it: `null` here means the soldier holds position rather than walking onto the body.
 */
export function engagementBearingOf(slotIndex: number): Vec2 | null {
  const slot = FORMATION_SLOTS[slotIndex]
  if (!slot) return null
  const length = Math.hypot(slot.x, slot.y)
  if (length === 0) return null
  return { x: slot.x / length, y: slot.y / length }
}

/**
 * §1.4.1 (v11): the point an engaged soldier walks to — `표적 위치 + normalize(슬롯 오프셋) ×
 * 밴드 far edge`.
 *
 * The far edge is the unit's own attack range, so the goal is the furthest place it can stand and
 * still shoot; §1.6's gap is what makes that place safe, because `shooterRange < SOLDIER_RANGE`
 * is asserted per stage in `stages.ts` and therefore the goal is strictly outside a shooter's
 * reach. The
 * near edge of `engagementBandOf` is no longer a movement input — v10 used it to decide when to
 * back off, and a single goal point has nothing to decide — but it is still the reason the far
 * edge is the right place to stand, which is why the band is still read as a band here.
 *
 * The soldier CROSSES the target if its slot is on the far side of it. §1.6 removed terrain and
 * this game has no unit collision, so passing through is not a special case — it is the same
 * straight walk everything else does.
 */
export function engagementGoalOf(
  state: BattleState,
  unit: FriendlyUnit,
  target: EnemyUnit,
  slotIndex: number,
): Vec2 | null {
  const [, far] = engagementBandOf(state, unit)
  const bearing = engagementBearingOf(slotIndex)
  if (bearing === null) return null
  return { x: target.position.x + bearing.x * far, y: target.position.y + bearing.y * far }
}

/**
 * §1.4.1: an engaged soldier moves to its OWN POINT on the band around its target.
 *
 * Not to the target, and — since v11 — not merely to the ring. Walking onto the enemy would hand
 * the whole squad to the shooters it is supposed to outrange; walking to the ring without an angle
 * was measured to reassemble the squad into a knot tighter than the formation.
 *
 * The approach itself is §1.4's: capped at the follow speed, no overshoot, and exactly zero
 * displacement inside `ARRIVE_EPSILON` of the goal — the same dead-band, for the same reason (a
 * body asymptotically approaching a fixed point vibrates forever).
 */
function advanceEngagement(
  state: BattleState,
  unit: FriendlyUnit,
  target: EnemyUnit,
  slotIndex: number,
  followSpeed: number,
): void {
  const goal = engagementGoalOf(state, unit, target, slotIndex)
  if (goal === null) {
    unit.lastDisplacement = 0
    return
  }
  stepToward(state, unit, goal, followSpeed)
}

/**
 * The 추종·적 이동 step, friendly half — §1.4's follow and §1.4.1's leash, which are the two
 * halves of one question asked per soldier per tick: is there anything to fight?
 *
 * ENGAGED (a standing enemy inside the stage's `leashRadius` of the command unit): the soldier leaves its
 * slot and moves to its own range band around that enemy. NOT ENGAGED: the slot is where it goes,
 * by §1.4's follow rule exactly — capped at `followSpeedOf`, no overshoot, and no movement at all
 * inside the dead-band. The slot is a REST position, not a battle position (§1.4).
 *
 * This is a change INSIDE the movement step, not a new step: §1.16's table is unchanged and
 * `tests/battle/battle-step-numbers.test.ts` is what keeps that true.
 */
export function advanceFormationFollow(state: BattleState): void {
  const command = commandUnitOf(state)
  if (!command) return
  const center = command.position
  const followSpeed = followSpeedOf(state)
  // Sorted once for all fifteen: `selectRankedEnemyId` needs ascending id for §1.8's tie-break
  // and re-sorting per soldier is the same answer at fifteen times the cost (§4.3).
  const enemies = enemiesById(state)

  for (const unit of state.friendlies) {
    if (unit.id === state.commandUnitId) continue
    if (unit.life !== 'standing') continue

    const assignment = findAssignment(state.slotAssignments, unit.id)
    // §1.4: a body without a slot (the original commander while a soldier holds
    // command) has nothing to follow. It is never left standing for more than the
    // tick in which §1.5 rule 1 returns command to it. §1.4.1 speaks of 병사 and every
    // soldier has a slot, so it does not engage either — "그 자리에 머문다" is still whole.
    //
    // v11 SHARPENS THE REASON RATHER THAN CHANGING THE BEHAVIOUR. A slotless body has no
    // rest position AND now no bearing either: the two things a soldier needs to take part
    // in this step are the same one table entry. "그 자리에 머문다" is therefore the whole
    // answer for it, and it is the decision, not a gap — the alternative would be inventing
    // an angle for a body the spec says stands still.
    if (!assignment) {
      unit.lastDisplacement = 0
      continue
    }

    const engagementId = selectEngagementTargetIn(state, unit, enemies)
    const engagement = engagementId === null ? null : findEnemy(state, engagementId)
    if (engagement !== null) {
      advanceEngagement(state, unit, engagement, assignment.slotIndex, followSpeed)
      continue
    }

    stepToward(state, unit, slotPosition(center, assignment.slotIndex), followSpeed)
  }
}

/**
 * Enemy movement written by the enemy rules (§1.9), as the 추종·적 이동 step sees it.
 *
 * It stays an argument rather than an import so that "enemies do not move" can only ever
 * be something a caller typed.
 */
export type EnemyMovementRule = (state: BattleState) => void

/**
 * An explicit "no enemy movement rule is wired yet".
 *
 * Named, exported and ugly on purpose: the tick loop has to name it to get the
 * behaviour.
 */
export const NO_ENEMY_MOVEMENT: EnemyMovementRule = () => {}

/**
 * The whole of the 추종·적 이동 step: "(아레나 클램프)" and nothing else around it.
 *
 * The §1.6 ejection barrier that used to end this step is gone with terrain. The
 * composer stays, because the ORDER inside the step is still a rule — followers, then
 * enemies — and because it is the seam the enemy movers plug into: `advanceEnemyMovement`
 * (§1.9, `enemy.ts`) and `advanceAllEnemyMovement`, which adds §1.12's elite (`elite.ts`).
 */
export function advanceMovement(state: BattleState, moveEnemies: EnemyMovementRule): void {
  advanceFormationFollow(state)
  moveEnemies(state)
}

/**
 * Exposed for §1.9 so enemies move by the same boundary rule.
 *
 * No stuck counter: §1.7's 30-tick retarget is withdrawn along with terrain, because the
 * arena edge is the only thing left that can stop an enemy and it cannot trap one.
 */
export function moveEnemyTowards(
  state: BattleState,
  enemy: EnemyUnit,
  target: Vec2,
  speed: number,
): number {
  const dx = target.x - enemy.position.x
  const dy = target.y - enemy.position.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    enemy.lastDisplacement = 0
    return 0
  }
  const step = Math.min(distance, speed)
  const from = enemy.position
  const to = stepMove(state, from, (dx / distance) * step, (dy / distance) * step)
  enemy.position = to
  enemy.lastDisplacement = displacementOf(from, to)
  return enemy.lastDisplacement
}
