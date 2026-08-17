// §1.7 movement boundary and §1.4 follow.
//
// §1.6 removed cover, and with it most of what used to be in this file. What is left:
//
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

import { ARENA_HEIGHT, ARENA_WIDTH, ARRIVE_EPSILON, COMMANDER_MOVE_SPEED, FOLLOW_MAX_SPEED, SOLDIER_MOVE_SPEED } from './constants'
import { findAssignment, slotPosition } from './formation'
import { followSpeedMultiplierOf, moveSpeedMultiplierOf } from './upgrades'
import type { BattleState, EnemyUnit, FriendlyUnit, Vec2 } from './types'

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

export function clampToArena(x: number, y: number): Vec2 {
  return { x: clamp(x, ARENA_WIDTH), y: clamp(y, ARENA_HEIGHT) }
}

/**
 * §1.7: apply the displacement and clamp the result to the arena. That is the whole rule.
 *
 * Kept as a named function rather than inlined at the three call sites because it is the
 * single place a position becomes legal, and because the axis-by-axis sliding it replaced
 * was subtle enough to be worth having one obvious successor.
 */
export function stepMove(from: Vec2, dx: number, dy: number): Vec2 {
  return clampToArena(from.x + dx, from.y + dy)
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
 * `0.115 x 1.15 = 0.13225`, which is still under `MELEE_MOVE_SPEED 0.140` but would NOT be under
 * the bottom of §2's search range. See the note on `MELEE_MOVE_SPEED` in `constants.ts`.
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
 * The 추종·적 이동 step, friendly half: every standing follower closes on its slot.
 *
 * A follower is capped at `followSpeedOf` (§1.2's soldier speed x1.30, times §1.13's
 * `cohesion`) and never overshoots its slot. Inside the ARRIVE_EPSILON dead-band it does not
 * move at all.
 */
export function advanceFormationFollow(state: BattleState): void {
  const command = commandUnitOf(state)
  if (!command) return
  const center = command.position
  const followSpeed = followSpeedOf(state)

  for (const unit of state.friendlies) {
    if (unit.id === state.commandUnitId) continue
    if (unit.life !== 'standing') continue

    const assignment = findAssignment(state.slotAssignments, unit.id)
    // §1.4: a body without a slot (the original commander while a soldier holds
    // command) has nothing to follow. It is never left standing for more than the
    // tick in which §1.5 rule 1 returns command to it.
    if (!assignment) {
      unit.lastDisplacement = 0
      continue
    }

    const target = slotPosition(center, assignment.slotIndex)
    const dx = target.x - unit.position.x
    const dy = target.y - unit.position.y
    const distance = Math.hypot(dx, dy)

    // The settle rule. Exactly zero, not approximately zero.
    if (distance <= ARRIVE_EPSILON) {
      unit.lastDisplacement = 0
      continue
    }

    const step = Math.min(distance, followSpeed)
    const from = unit.position
    const to = stepMove(from, (dx / distance) * step, (dy / distance) * step)
    unit.position = to
    unit.lastDisplacement = displacementOf(from, to)
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
export function moveEnemyTowards(enemy: EnemyUnit, target: Vec2, speed: number): number {
  const dx = target.x - enemy.position.x
  const dy = target.y - enemy.position.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    enemy.lastDisplacement = 0
    return 0
  }
  const step = Math.min(distance, speed)
  const from = enemy.position
  const to = stepMove(from, (dx / distance) * step, (dy / distance) * step)
  enemy.position = to
  enemy.lastDisplacement = displacementOf(from, to)
  return enemy.lastDisplacement
}
