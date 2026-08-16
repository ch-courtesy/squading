// The v6 formation (§1.4): 15 world-axis-fixed slots around the command unit.
//
// The slots do NOT rotate with movement. Slot assignment is by ascending soldier
// id and never recomputed, so this table is positional and its order is part of
// the contract.
//
//   (-2.2,-1.1) (-1.1,-1.1) ( 0.0,-1.1) ( 1.1,-1.1) ( 2.2,-1.1)
//   (-2.2, 0.0) (-1.1, 0.0)      *      ( 1.1, 0.0) ( 2.2, 0.0)
//   (-2.2, 1.1) (-1.1, 1.1) ( 0.0, 1.1) ( 1.1, 1.1) ( 2.2, 1.1)
//                           ( 0.0, 2.2)
//
// This module holds only the geometry of the formation — where the 16 bodies end
// up for a given command-unit position. The follow/arrive dynamics (§1.4's
// ARRIVE_EPSILON dead zone) belong to the movement rules and are not needed to
// measure I9, which asks a purely static question.

import { containsAny, type Rect } from './geometry'

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

export const SLOT_PULL_STEP = 0.1
export const SLOT_PULL_MAX_STEPS = 30

/**
 * §1.4: a slot inside movement-blocking terrain is pulled toward the command unit
 * in `0.1` steps, at most `30` times; the first point that lands outside is used.
 * If 30 steps are not enough, the command unit's own position is used.
 *
 * `30 * 0.1 = 3.0` exceeds the 2.460 maximum slot radius, so the pull is clamped
 * at the command unit rather than overshooting past it.
 */
export function resolveSlotPosition(
  centerX: number,
  centerY: number,
  slot: FormationSlot,
  movementBlockers: readonly Rect[],
): FormationSlot {
  const x = centerX + slot.x
  const y = centerY + slot.y
  if (!containsAny(movementBlockers, x, y)) return { x, y }

  const distance = Math.hypot(slot.x, slot.y)
  if (distance > 0) {
    const unitX = -slot.x / distance
    const unitY = -slot.y / distance
    for (let step = 1; step <= SLOT_PULL_MAX_STEPS; step += 1) {
      const travelled = Math.min(step * SLOT_PULL_STEP, distance)
      const pulledX = x + unitX * travelled
      const pulledY = y + unitY * travelled
      if (!containsAny(movementBlockers, pulledX, pulledY)) return { x: pulledX, y: pulledY }
    }
  }

  return { x: centerX, y: centerY }
}

/**
 * The 16 bodies for a command unit standing at `(centerX, centerY)`: index 0 is
 * the command unit, 1..15 are the slots in table order.
 */
export function resolveFormation(
  centerX: number,
  centerY: number,
  movementBlockers: readonly Rect[],
): FormationSlot[] {
  const positions: FormationSlot[] = [{ x: centerX, y: centerY }]
  for (const slot of FORMATION_SLOTS) {
    positions.push(resolveSlotPosition(centerX, centerY, slot, movementBlockers))
  }
  return positions
}
