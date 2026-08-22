// §1.4: the 15 world-axis slots and the fixed id-ascending assignment table.
//
// The slots do NOT rotate with movement, and the assignment is made once and never
// recomputed — when command passes to a soldier (§1.5) that soldier's slot simply goes
// vacant ("빈칸을 남긴다").
//
//   (-2.2,-1.1) (-1.1,-1.1) ( 0.0,-1.1) ( 1.1,-1.1) ( 2.2,-1.1)
//   (-2.2, 0.0) (-1.1, 0.0)      *      ( 1.1, 0.0) ( 2.2, 0.0)
//   (-2.2, 1.1) (-1.1, 1.1) ( 0.0, 1.1) ( 1.1, 1.1) ( 2.2, 1.1)
//                           ( 0.0, 2.2)
//
// WHY THIS TABLE IS A COPY. Batch A imported it from `gameplay/formation.ts` and wrote
// "never copied", because at the time both the game and the I9 harness needed the same
// slot geometry AND the same terrain-aware slot pull. §1.6 removed cover: the game path
// no longer has terrain, sight or geometry of any kind, and `gameplay/formation.ts` still
// pulls slots out of movement blockers using `gameplay/geometry.ts`. Importing it would
// drag both archived modules back into the live game, which is exactly what §2's 폐기
// 기록 forbids. So the 15 offsets — pure data, unchanged since §1.4 was written — live
// here, and `tests/battle/battle-no-cover.test.ts` pins them equal to the archived
// table so the duplication cannot drift.
//
// The pull and its latch are GONE, not moved. Both existed only for slots that landed
// inside terrain; with no terrain a slot is always `command unit + offset`, which is a
// fixed world point while the command unit stands still — the condition §1.4's settle
// dead-band needs to make a follower's displacement exactly 0.

import type { SlotAssignment, Vec2 } from './types'

export type FormationSlot = {
  x: number
  y: number
}

export const FORMATION_SLOTS: readonly FormationSlot[] = [
  { x: -2.2, y: -1.1 },
  { x: -1.1, y: -1.1 },
  { x: 0.0, y: -1.1 },
  { x: 1.1, y: -1.1 },
  { x: 2.2, y: -1.1 },
  { x: -2.2, y: 0.0 },
  { x: -1.1, y: 0.0 },
  { x: 1.1, y: 0.0 },
  { x: 2.2, y: 0.0 },
  { x: -2.2, y: 1.1 },
  { x: -1.1, y: 1.1 },
  { x: 0.0, y: 1.1 },
  { x: 1.1, y: 1.1 },
  { x: 2.2, y: 1.1 },
  { x: 0.0, y: 2.2 },
]

/** §1.4: 15 slots + the command unit itself. */
export const FORMATION_SIZE = FORMATION_SLOTS.length + 1
/** §1.4: `hypot(2.2, 1.1) = 2.460`. */
export const FORMATION_MAX_SLOT_RADIUS = Math.max(
  ...FORMATION_SLOTS.map((slot) => Math.hypot(slot.x, slot.y)),
)

/**
 * §1.4: slots go to soldier ids in ascending order, once.
 *
 * There are 15 slots and 16 bodies, and the commander is the body without one. The
 * table is never recomputed, so when command passes to a soldier (§1.5) that
 * soldier's slot simply goes vacant and the original commander — who by §1.5 rule 1
 * reclaims command on the very next tick it stands — has no slot to follow. Both
 * are the spec's "빈칸을 남긴다", and both are why this function takes the roster
 * once rather than the current command unit.
 *
 * FEWER BODIES THAN SLOTS IS LEGAL, and campaign §1.1 is what makes it reachable: a stage entered
 * with three dead has twelve followers and the last three slots stand empty. That is the same
 * "빈칸을 남긴다" the paragraph above describes, not a new rule — the assignment is still ascending
 * id onto ascending slot index, and `slotPosition` still resolves each one to `command unit +
 * offset`. MORE bodies than slots is still a throw: there would be a follower with nowhere to
 * stand, and silently dropping it is how a body disappears from a run.
 */
export function createSlotAssignments(soldierIds: readonly number[]): SlotAssignment[] {
  if (soldierIds.length > FORMATION_SLOTS.length) {
    throw new Error(
      `battle/formation: there are ${FORMATION_SLOTS.length} slots, got ${soldierIds.length} soldiers`,
    )
  }
  return [...soldierIds]
    .sort((left, right) => left - right)
    .map((unitId, slotIndex) => ({ unitId, slotIndex }))
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

/**
 * The world position of a slot: world-axis fixed, no rotation, no pull.
 *
 * This is the whole of slot resolution now. It is a pure function of the command unit's
 * position, so two callers in the same tick cannot disagree and no state is involved.
 */
export function slotPosition(center: Vec2, slotIndex: number): Vec2 {
  const slot = FORMATION_SLOTS[slotIndex]
  return { x: center.x + slot.x, y: center.y + slot.y }
}

/**
 * The 16 body positions for a command unit at `center`: index 0 is the command unit,
 * 1..15 are the slots in table order.
 */
export function formationPositions(center: Vec2): Vec2[] {
  const positions: Vec2[] = [{ x: center.x, y: center.y }]
  for (let index = 0; index < FORMATION_SLOTS.length; index += 1) {
    positions.push(slotPosition(center, index))
  }
  return positions
}
