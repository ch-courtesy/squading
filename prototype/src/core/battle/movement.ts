// §1.7 movement, §1.6 ejection, §1.4 follow.
//
// Three rules, and each one exists to close a specific hole:
//
//   sliding (§1.7)   — x is applied and tested first, then y from the result. The
//                      order is fixed because the two orders give different answers
//                      at a corner, and a digest that depends on evaluation order is
//                      not a digest.
//   ejection (§1.6)  — rectangles are half-open, so a unit found inside one cannot
//                      be freed by moving it onto a face; it has to be pushed past
//                      the face by EJECT_EPSILON. Sliding alone can never free such
//                      a unit either (every axis test says "inside"), so movement
//                      begins by ejecting the mover.
//   settle (§1.4)    — a follower within ARRIVE_EPSILON of its slot does not move
//                      AT ALL. Not "moves a little": the displacement must be
//                      exactly 0, or §1.3 reads it as movement and the soldier never
//                      fires again.
//
// Enemy movement (§1.9) is NOT here — it belongs to the enemy batch, which should
// use `slideMove` and `ejectPoint` rather than reimplementing them.

import { containsAny, ejectFromRects, type Ejection, type Rect } from '../gameplay/geometry'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  EJECT_EPSILON,
  FOLLOW_MAX_SPEED,
  SOLDIER_MOVE_SPEED,
} from './constants'
import { findAssignment, resolveSlotTarget } from './formation'
import { movementBlockers } from './state'
import type { BattleState, EnemyUnit, FriendlyUnit, Vec2 } from './types'

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

export function clampToArena(x: number, y: number): Vec2 {
  return { x: clamp(x, ARENA_WIDTH), y: clamp(y, ARENA_HEIGHT) }
}

/**
 * §1.7: apply x, test, cancel on a hit; then apply y from that result, test, cancel.
 *
 * Only movement-blocking terrain is passed in — low cover blocks sight and nothing
 * else. The arena clamp is applied per axis before the terrain test, so walking into
 * the arena edge behaves like walking into a wall rather than teleporting.
 */
export function slideMove(from: Vec2, dx: number, dy: number, blockers: readonly Rect[]): Vec2 {
  let x = clamp(from.x + dx, ARENA_WIDTH)
  if (containsAny(blockers, x, from.y)) x = from.x

  let y = clamp(from.y + dy, ARENA_HEIGHT)
  if (containsAny(blockers, x, y)) y = from.y

  return { x, y }
}

/** §1.6: nearest-face ejection with the `-x, +x, -y, +y` tie-break. */
export function ejectPoint(
  position: Vec2,
  blockers: readonly Rect[],
  epsilon: number = EJECT_EPSILON,
): Ejection | null {
  return ejectFromRects(blockers, position.x, position.y, epsilon)
}

function ejectUnit(unit: { position: Vec2 }, blockers: readonly Rect[]): boolean {
  const ejected = ejectPoint(unit.position, blockers)
  if (!ejected) return false
  unit.position = clampToArena(ejected.x, ejected.y)
  return true
}

/**
 * §1.6 applied to everyone currently alive. The spawn batch (§1.10, §1.12) calls
 * this after placing a body; movement calls it on the mover, because a trapped unit
 * can never slide out on its own.
 *
 * Ejection deliberately does NOT count as displacement: it is a correction of an
 * illegal position, not a move, and charging it against §1.3 would silence a unit
 * for a tick it never chose to move.
 */
export function ejectTrappedUnits(state: BattleState): number {
  const blockers = movementBlockers(state)
  let ejected = 0
  for (const unit of state.friendlies) {
    if (unit.life === 'dead') continue
    if (ejectUnit(unit, blockers)) ejected += 1
  }
  for (const enemy of state.enemies) {
    if (enemy.life === 'dead') continue
    if (ejectUnit(enemy, blockers)) ejected += 1
  }
  if (state.elite.phase !== 'absent' && state.elite.phase !== 'dead') {
    if (ejectUnit(state.elite, blockers)) ejected += 1
  }
  return ejected
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
 * input. A command unit pinned against a wall has displacement 0 and may fire.
 */
export function advanceCommandUnit(state: BattleState): number {
  const unit = commandUnitOf(state)
  if (!unit || unit.life !== 'standing') {
    state.commandUnitMoved = false
    return 0
  }

  const blockers = movementBlockers(state)
  ejectUnit(unit, blockers)

  // §1.11: the rescue lock is decided in step 3, before movement, so the very first
  // locked tick already produces no movement.
  const magnitude = state.rescue.active ? 0 : Math.hypot(state.input.move.x, state.input.move.y)
  if (magnitude === 0) {
    unit.lastDisplacement = 0
    state.commandUnitMoved = false
    return 0
  }

  const speed = moveSpeedOf(unit)
  const from = unit.position
  const to = slideMove(
    from,
    (state.input.move.x / magnitude) * speed,
    (state.input.move.y / magnitude) * speed,
    blockers,
  )
  const displacement = displacementOf(from, to)
  unit.position = to
  unit.lastDisplacement = displacement
  // §1.4: any real movement invalidates a latched slot, because the latch stores a
  // world position rather than an offset.
  state.commandUnitMoved = displacement !== 0
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

  const blockers = movementBlockers(state)
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

    ejectUnit(unit, blockers)

    const target = resolveSlotTarget(assignment, center, blockers, state.commandUnitMoved)
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
    const to = slideMove(from, (dx / distance) * step, (dy / distance) * step, blockers)
    unit.position = to
    unit.lastDisplacement = displacementOf(from, to)
  }

  // The latch release is consumed once per tick: a follower resolved later in the
  // loop must see the same release decision as one resolved earlier.
  state.commandUnitMoved = false
}

/** Exposed for the enemy batch (§1.9) so it slides and ejects by the same rules. */
export function moveEnemyTowards(
  enemy: EnemyUnit,
  target: Vec2,
  speed: number,
  blockers: readonly Rect[],
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
  const to = slideMove(from, (dx / distance) * step, (dy / distance) * step, blockers)
  enemy.position = to
  enemy.lastDisplacement = displacementOf(from, to)
  return enemy.lastDisplacement
}
