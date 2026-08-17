// §1.4: slot assignment and slot resolution.
//
// The geometry — the 15 world-axis slots and the 0.1-step pull out of blocking
// terrain — already lives in `core/gameplay/formation.ts` and is imported, not
// copied. What this module adds is the part that is stateful and therefore could
// not live in the stage-1 geometry work:
//
//   * the assignment table, fixed once at creation and never recomputed, and
//   * the pull latch, which holds a pulled slot in place until the command unit
//     moves again.
//
// Why the latch (§1.4's own "왜"): a slot that flips in and out of terrain while
// the command unit stands still gives its follower a target that moves every tick,
// so the follower's displacement never reaches 0 and §1.3 silences that one soldier
// forever. Latching the pulled position removes the oscillation by construction —
// the target is a fixed world point for as long as the command unit is stationary.

import { containsAny, type Rect } from '../gameplay/geometry'
import { FORMATION_SLOTS, resolveSlotPosition } from '../gameplay/formation'
import type { BattleState, SlotAssignment, Vec2 } from './types'

export { FORMATION_MAX_SLOT_RADIUS, FORMATION_SIZE, FORMATION_SLOTS } from '../gameplay/formation'

/**
 * §1.4: slots go to soldier ids in ascending order, once.
 *
 * There are 15 slots and 16 bodies, and the commander is the body without one. The
 * table is never recomputed, so when command passes to a soldier (§1.5) that
 * soldier's slot simply goes vacant and the original commander — who by §1.5 rule 1
 * reclaims command on the very next tick it stands — has no slot to follow. Both
 * are the spec's "빈칸을 남긴다", and both are why this function takes the roster
 * once rather than the current command unit.
 */
export function createSlotAssignments(soldierIds: readonly number[]): SlotAssignment[] {
  if (soldierIds.length !== FORMATION_SLOTS.length) {
    throw new Error(
      `battle/formation: ${FORMATION_SLOTS.length} slots need ${FORMATION_SLOTS.length} soldiers, got ${soldierIds.length}`,
    )
  }
  return [...soldierIds]
    .sort((left, right) => left - right)
    .map((unitId, slotIndex) => ({ unitId, slotIndex, latchedPosition: null }))
}

export function findAssignment(
  assignments: readonly SlotAssignment[],
  unitId: number,
): SlotAssignment | null {
  for (const assignment of assignments) {
    if (assignment.unitId === unitId) return assignment
  }
  return null
}

/** The raw, un-pulled world position of a slot: world-axis fixed, no rotation. */
export function rawSlotPosition(center: Vec2, slotIndex: number): Vec2 {
  const slot = FORMATION_SLOTS[slotIndex]
  return { x: center.x + slot.x, y: center.y + slot.y }
}

/** Drop every latch. Cheap, and the only way a latch is ever released. */
export function clearSlotLatches(state: BattleState): void {
  for (const assignment of state.slotAssignments) assignment.latchedPosition = null
  state.slotLatchOwnerId = null
}

/**
 * Both reasons a latch goes stale (§1.4):
 *
 *   1. the command unit took a step — the caller's `commandUnitMoved`, and
 *   2. the command unit was REPLACED (§1.5), which moves the formation centre by up
 *      to the 2.460 slot radius without anyone taking a step.
 *
 * (2) is the reachable version of the flicker §1.4 describes. It bites in exactly
 * the scenario succession exists for: the stand-in stops next to the downed original
 * commander and holds still for `RESCUE_TICKS`, so latched followers would aim at
 * points derived from the *previous* body's position for the whole rescue.
 */
export function latchesAreStale(state: BattleState, commandUnitMoved: boolean): boolean {
  return commandUnitMoved || state.slotLatchOwnerId !== state.commandUnitId
}

/**
 * Record which command unit the current latches belong to. Called once per follow
 * pass, after the slots have been resolved.
 */
export function recordLatchOwner(state: BattleState): void {
  const latched = state.slotAssignments.some((assignment) => assignment.latchedPosition !== null)
  state.slotLatchOwnerId = latched ? state.commandUnitId : null
}

/**
 * The world position a follower should aim at this tick, applying and maintaining
 * the pull latch. Mutates `assignment.latchedPosition`, which is authoritative
 * state and part of the digest.
 *
 * `releaseLatch` must already account for both staleness causes — use
 * `latchesAreStale`.
 */
export function resolveSlotTarget(
  assignment: SlotAssignment,
  center: Vec2,
  movementBlockers: readonly Rect[],
  releaseLatch: boolean,
): Vec2 {
  if (releaseLatch) assignment.latchedPosition = null
  if (assignment.latchedPosition) return assignment.latchedPosition

  const raw = rawSlotPosition(center, assignment.slotIndex)
  if (!containsAny(movementBlockers, raw.x, raw.y)) return raw

  const pulled = resolveSlotPosition(
    center.x,
    center.y,
    FORMATION_SLOTS[assignment.slotIndex],
    movementBlockers,
  )
  assignment.latchedPosition = { x: pulled.x, y: pulled.y }
  return assignment.latchedPosition
}
