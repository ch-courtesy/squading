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
//                      ALL. Not "moves a little": the displacement must be exactly 0,
//                      or §1.3 reads it as movement and the soldier never fires again.
//                      This is the one rule in here that the teardown did not touch, and
//                      it is now easier to satisfy: a slot is `command unit + offset`
//                      with no pull and no latch, so it is a fixed point whenever the
//                      command unit stands still.
//
// Enemy movement (§1.9) is NOT here — it belongs to `enemy.ts`. It stays an explicit
// argument of `advanceMovement` so that a tick loop which forgets it is a type
// error rather than a battle where nothing attacks.

import { ARENA_HEIGHT, ARENA_WIDTH, ARRIVE_EPSILON, COMMANDER_MOVE_SPEED, FOLLOW_MAX_SPEED, SOLDIER_MOVE_SPEED } from './constants'
import { findAssignment, slotPosition } from './formation'
import type { BattleState, EnemyUnit, FriendlyUnit, Vec2 } from './types'

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

export function clampToArena(x: number, y: number): Vec2 {
  return { x: clamp(x, ARENA_WIDTH), y: clamp(y, ARENA_HEIGHT) }
}

/**
 * §1.7: apply the step and clamp the result to the arena. That is the whole rule.
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

export function moveSpeedOf(unit: FriendlyUnit): number {
  return unit.role === 'commander' ? COMMANDER_MOVE_SPEED : SOLDIER_MOVE_SPEED
}

/**
 * Tick step 4 (§1.16): the command unit consumes the held movement vector.
 *
 * The held vector is treated as a DIRECTION, not a displacement — the input layer
 * (§1.15) is what decides whether a pointer drag is long enough to count, and it
 * clamps anything under MOVE_EPSILON to zero before the core ever sees it. The core
 * only asks "is it zero".
 *
 * Returns the actual displacement, which is what §1.3 and step 6 judge — not the
 * input, and not a flag left behind in the state. Walking into the arena edge is still
 * the one way to have input and no displacement, and §1.3 still lets that unit fire.
 */
export function advanceCommandUnit(state: BattleState): number {
  const unit = commandUnitOf(state)
  if (!unit || unit.life !== 'standing') return 0

  // §1.11: the rescue lock is decided in step 3, before movement, so the very first
  // locked tick already produces no movement.
  const magnitude = state.rescue.active ? 0 : Math.hypot(state.input.move.x, state.input.move.y)
  if (magnitude === 0) {
    unit.lastDisplacement = 0
    return 0
  }

  const speed = moveSpeedOf(unit)
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
 * Tick step 5 (§1.16), friendly half: every standing follower closes on its slot.
 *
 * A follower is capped at `FOLLOW_MAX_SPEED` (§1.2, soldier speed x1.30) and never
 * overshoots its slot. Inside the ARRIVE_EPSILON dead-band it does not move at all.
 */
export function advanceFormationFollow(state: BattleState): void {
  const command = commandUnitOf(state)
  if (!command) return
  const center = command.position

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

    const step = Math.min(distance, FOLLOW_MAX_SPEED)
    const from = unit.position
    const to = stepMove(from, (dx / distance) * step, (dy / distance) * step)
    unit.position = to
    unit.lastDisplacement = displacementOf(from, to)
  }
}

/**
 * Enemy movement written by the enemy rules (§1.9), as step 5 sees it.
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
 * §1.16 step 5, whole: "추종·적 이동 (정착 dead-zone, 아레나 클램프)".
 *
 * The §1.6 ejection barrier that used to end this step is gone with terrain. The
 * composer stays, because the ORDER inside step 5 is still a rule — followers, then
 * enemies — and because it is the seam batch C and F plug their movers into.
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
