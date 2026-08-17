// §1.7 movement, §1.6 ejection, §1.4 follow.
//
// Three rules, and each one exists to close a specific hole:
//
//   sliding (§1.7)   — each axis is clamped to the arena FIRST, then tested against
//                      terrain: x applied and tested, then y from that result. The
//                      axis order is fixed because the two orders give different
//                      answers at a corner, and a digest that depends on evaluation
//                      order is not a digest. The clamp order matters too — clamping
//                      after the terrain test would push a unit back INTO a rectangle
//                      that sits flush against the arena edge.
//   ejection (§1.6)  — rectangles are half-open, so a unit found inside one cannot
//                      be freed by moving it onto a face; it has to be pushed past
//                      the face by EJECT_EPSILON. The direction is measured against
//                      the UNION of everything containing it, so touching rectangles
//                      are escaped in one push instead of bouncing. §1.16 puts this
//                      at the END of step
//                      5, after everything has moved, and that placement is
//                      observable: a trapped unit has displacement 0 for that tick,
//                      so §1.3 lets it fire, and it is freed before step 6 reads
//                      cooldowns. Ejecting before movement instead would let the unit
//                      move that same tick and §1.3 would silence it.
//   settle (§1.4)    — a follower within ARRIVE_EPSILON of its slot does not move
//                      AT ALL. Not "moves a little": the displacement must be
//                      exactly 0, or §1.3 reads it as movement and the soldier never
//                      fires again.
//
// Enemy movement (§1.9) is NOT here — it belongs to the enemy batch. It plugs into
// `advanceStep5Movement` as an explicit argument, so it is inside the ejection
// barrier without having to remember to be.

import { containsAny, containsPoint, type Axis, type Ejection, type Rect } from '../gameplay/geometry'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  EJECT_EPSILON,
  FOLLOW_MAX_SPEED,
  SOLDIER_MOVE_SPEED,
} from './constants'
import {
  clearSlotLatches,
  findAssignment,
  latchesAreStale,
  recordLatchOwner,
  resolveSlotTarget,
} from './formation'
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

/** The four ejection directions, in §1.6's tie-break order. */
const EJECT_AXES: readonly Axis[] = ['-x', '+x', '-y', '+y']

type UnionExit = {
  /** Distance to the union boundary, WITHOUT the epsilon (see below). */
  distance: number
  /** The boundary coordinate on the travelled axis, without the epsilon. */
  boundary: number
}

/**
 * How far, along one axis, until the point leaves the UNION of every rectangle in
 * its way — `Infinity` if it cannot be done inside the arena.
 *
 * The walk is what makes it a union rather than a rectangle: leave the rectangles
 * that contain the point (taking the furthest face among them, since overlapping
 * rectangles must all be escaped), then check whether the new coordinate is inside
 * some *other* rectangle and keep going. Each iteration passes at least one face in
 * the travel direction, so `blockers.length + 1` iterations is a hard bound.
 *
 * `distance` is measured to the boundary and NOT to the final position, so that four
 * equal distances stay bit-equal. Adding `epsilon` before comparing turns 2.0 into
 * `2.0020000000000007` on one axis and `2.0019999999999989` on another, and §1.6's
 * `-x, +x, -y, +y` tie-break — which only exists for exact ties — would be decided by
 * rounding instead.
 */
function unionExit(
  px: number,
  py: number,
  blockers: readonly Rect[],
  epsilon: number,
  axis: Axis,
): UnionExit {
  const horizontal = axis === '-x' || axis === '+x'
  const negative = axis === '-x' || axis === '-y'
  const origin = horizontal ? px : py
  const limit = horizontal ? ARENA_WIDTH : ARENA_HEIGHT

  let probe = origin
  // The last real face crossed. `probe` carries the epsilon offset, so it must not be
  // reported as the boundary — that would apply the epsilon twice, and once per hop
  // when the walk crosses several rectangles.
  let lastBoundary = origin
  for (let step = 0; step <= blockers.length; step += 1) {
    let boundary: number | null = null
    for (const rect of blockers) {
      const x = horizontal ? probe : px
      const y = horizontal ? py : probe
      if (!containsPoint(rect, x, y)) continue
      const face = negative
        ? horizontal
          ? rect.x
          : rect.y
        : horizontal
          ? rect.x + rect.width
          : rect.y + rect.height
      if (boundary === null) boundary = face
      else boundary = negative ? Math.min(boundary, face) : Math.max(boundary, face)
    }

    // Nothing contains the probe: it is out of the union.
    if (boundary === null) {
      return { distance: Math.abs(lastBoundary - origin), boundary: lastBoundary }
    }

    lastBoundary = boundary
    probe = negative ? boundary - epsilon : boundary + epsilon
    if (negative ? probe < 0 : probe > limit) return { distance: Infinity, boundary }
  }

  return { distance: Infinity, boundary: lastBoundary }
}

/**
 * §1.6: push a unit out of movement-blocking terrain.
 *
 * The direction is chosen against the UNION of every rectangle containing the point,
 * not against one rectangle's nearest face. Per-rectangle nearest-face ejection
 * oscillates forever between two rectangles that share a face — the face just crossed
 * is `EJECT_EPSILON` away and therefore always the nearest one — and no loop count
 * fixes that, because every pass reverses the previous one. Measuring the escape
 * distance across the union removes the oscillation by construction: the winning
 * direction leaves ALL of the terrain in a single push.
 *
 * Seed-generated high cover keeps a 5.0 gap from its own class, so a seed can never
 * produce a touching pair; §4.2's hand-authored fixture terrain can, which is exactly
 * why the rule cannot rely on the gap.
 *
 * Ties break `-x, +x, -y, +y`. A point that cannot leave the union in any direction
 * without leaving the arena is a terrain-authoring error and throws.
 */
export function ejectPoint(
  position: Vec2,
  blockers: readonly Rect[],
  epsilon: number = EJECT_EPSILON,
): Ejection | null {
  if (!containsAny(blockers, position.x, position.y)) return null

  let best: { axis: Axis; distance: number; boundary: number } | null = null
  for (const axis of EJECT_AXES) {
    const exit = unionExit(position.x, position.y, blockers, epsilon, axis)
    if (exit.distance === Infinity) continue
    // Strict `<` walked in tie-break order: the first axis to own a distance keeps it.
    if (best === null || exit.distance < best.distance) best = { axis, ...exit }
  }

  if (best === null) {
    throw new Error(
      `battle/movement: (${position.x}, ${position.y}) cannot leave movement-blocking terrain in any direction without leaving the arena — terrain authoring error (§1.6)`,
    )
  }

  const ejected: Ejection =
    best.axis === '-x'
      ? { x: best.boundary - epsilon, y: position.y, axis: '-x' }
      : best.axis === '+x'
        ? { x: best.boundary + epsilon, y: position.y, axis: '+x' }
        : best.axis === '-y'
          ? { x: position.x, y: best.boundary - epsilon, axis: '-y' }
          : { x: position.x, y: best.boundary + epsilon, axis: '+y' }

  // Defensive: the union walk is supposed to make this unreachable. If it ever fires,
  // the alternative would be handing back a position that is still inside a wall while
  // reporting success — which presents as a frozen unit and a balance anomaly, not as
  // a bug in this function.
  if (containsAny(blockers, ejected.x, ejected.y)) {
    throw new Error(
      `battle/movement: ejection of (${position.x}, ${position.y}) via ${best.axis} is still inside movement-blocking terrain (§1.6)`,
    )
  }

  return ejected
}

function ejectUnit(unit: { position: Vec2 }, blockers: readonly Rect[]): boolean {
  const ejected = ejectPoint(unit.position, blockers)
  if (!ejected) return false
  unit.position = clampToArena(ejected.x, ejected.y)
  return true
}

/**
 * §1.6/§1.16 step 5, last thing: everyone alive who ended the step inside blocking
 * terrain is pushed out.
 *
 * Running this once at the end of the whole step — rather than per mover before it
 * moves — is what makes it impossible to forget. A spawn (step 2) that lands an
 * enemy inside high cover is corrected here on the same tick, before step 7 ever
 * looks at it; the enemy batch does not have to remember to call anything, and the
 * elite arrives through the same door because it is an ordinary row in `enemies`.
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
 * input, and not a flag left behind in the state. The return value is also step 5's
 * `commandUnitMoved` argument; making the caller pass it means a tick loop that
 * skips this step, or runs step 5 twice, is a type error rather than a squad that
 * quietly holds stale slots.
 */
export function advanceCommandUnit(state: BattleState): number {
  const unit = commandUnitOf(state)
  if (!unit || unit.life !== 'standing') return 0

  const blockers = movementBlockers(state)

  // §1.11: the rescue lock is decided in step 3, before movement, so the very first
  // locked tick already produces no movement.
  const magnitude = state.rescue.active ? 0 : Math.hypot(state.input.move.x, state.input.move.y)
  if (magnitude === 0) {
    unit.lastDisplacement = 0
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
  return displacement
}

/**
 * Tick step 5 (§1.16), friendly half: every standing follower closes on its slot.
 *
 * A follower is capped at `FOLLOW_MAX_SPEED` (§1.2, soldier speed x1.30) and never
 * overshoots its slot. Inside the ARRIVE_EPSILON dead-band it does not move at all.
 *
 * `commandUnitMoved` is required, not inferred: pass `advanceCommandUnit`'s return
 * value `!== 0`. §1.4's latch is released here and nowhere else, so a caller that
 * forgot to run step 4 would otherwise leave every latched follower aiming at a
 * position the command unit has long since walked away from — with no error.
 *
 * Ejection is NOT done here; it belongs to the end of the whole of step 5, which is
 * `advanceStep5Movement`.
 */
export function advanceFormationFollow(state: BattleState, commandUnitMoved: boolean): void {
  const command = commandUnitOf(state)
  if (!command) return

  const blockers = movementBlockers(state)
  const center = command.position
  // Decided once for the whole pass: a follower resolved late in the loop must see
  // the same release decision as one resolved early.
  const releaseLatch = latchesAreStale(state, commandUnitMoved)
  if (releaseLatch) clearSlotLatches(state)

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

    const target = resolveSlotTarget(assignment, center, blockers, false)
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

  recordLatchOwner(state)
}

/**
 * Enemy movement written by the enemy batch (§1.9), as step 5 sees it.
 *
 * It is an argument rather than an import so that enemy movement is structurally
 * inside the ejection barrier below.
 */
export type EnemyMovementRule = (state: BattleState) => void

/**
 * An explicit "no enemy movement rule is wired yet".
 *
 * Named, exported and ugly on purpose: the tick loop has to name it to get the
 * behaviour, so "enemies do not move" can only ever be a decision someone typed, not
 * a default that quietly held for three batches.
 */
export const NO_ENEMY_MOVEMENT: EnemyMovementRule = () => {}

/**
 * §1.16 step 5, whole: "추종·적 이동 (슬라이딩, 정착 dead-zone, 아레나 클램프),
 * 그 뒤 §1.6 지형 밀어내기".
 *
 * The ejection pass is the reason this composer exists. Putting it at the end of
 * `advanceFormationFollow` would leave it BEFORE enemy movement, since §1.16 lists
 * followers first — enemies would move after the barrier and any enemy that ended
 * its move inside high cover would stay there, frozen at displacement 0 and firing
 * forever. One owner for the whole step keeps the barrier last.
 */
export function advanceStep5Movement(
  state: BattleState,
  commandUnitMoved: boolean,
  moveEnemies: EnemyMovementRule,
): void {
  advanceFormationFollow(state, commandUnitMoved)
  moveEnemies(state)
  ejectTrappedUnits(state)
}

/**
 * Exposed for the enemy batch (§1.9) so it slides by the same rules.
 *
 * It also owns the §1.7 stuck counter, because that counter is pure movement
 * bookkeeping: "how many consecutive ticks was this enemy's NET displacement 0". The
 * retarget *decision* at 30 belongs to §1.8/§1.9, but if the counter were left to
 * them, an enemy grinding against a wall would simply never be noticed — and I1
 * would read it as a supply-curve problem rather than a stuck body.
 */
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
    enemy.zeroDisplacementTicks += 1
    return 0
  }
  const step = Math.min(distance, speed)
  const from = enemy.position
  const to = slideMove(from, (dx / distance) * step, (dy / distance) * step, blockers)
  enemy.position = to
  enemy.lastDisplacement = displacementOf(from, to)
  // §1.7: exactly 0, not "under MOVE_EPSILON". A shooter creeping around a corner at
  // 0.001/tick is making progress; one pinned against a wall is not.
  enemy.zeroDisplacementTicks = enemy.lastDisplacement === 0 ? enemy.zeroDisplacementTicks + 1 : 0
  return enemy.lastDisplacement
}
