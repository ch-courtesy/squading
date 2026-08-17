// Batch A fixtures for movement (§1.7), formation following and the settle
// dead-band (§1.4), and terrain ejection (§1.6).
//
// Terrain here is hand-authored, never seed-derived (§4.2).

import { describe, expect, it } from 'vitest'

import { containsAny } from '../../src/core/gameplay/geometry'
import { FORMATION_SLOTS } from '../../src/core/gameplay/formation'
import type { TerrainRect } from '../../src/core/gameplay/terrain'
import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  COMMANDER_START,
  EJECT_EPSILON,
  FOLLOW_MAX_SPEED,
  MOVE_EPSILON,
  SLOT_PULL_STEP,
  SOLDIER_MOVE_SPEED,
} from '../../src/core/battle/constants'
import {
  advanceCommandUnit,
  advanceFormationFollow,
  ejectPoint,
  ejectTrappedUnits,
  slideMove,
} from '../../src/core/battle/movement'
import { createInitialBattleState, findFriendly } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'

const BLOCK: TerrainRect = { kind: 'high', x: 10, y: 10, width: 4, height: 4 }
const LOW: TerrainRect = { kind: 'low', x: 10, y: 10, width: 4, height: 4 }

function stateWithTerrain(high: TerrainRect[], low: TerrainRect[] = []): BattleState {
  const state = createInitialBattleState('seed-a')
  state.terrain.high = high
  state.terrain.low = low
  return state
}

describe('§1.7 sliding', () => {
  it('cancels only the blocked axis on a frontal push', () => {
    // Straight at the -x face of [10,14) x [10,14): x is cancelled, y never moved.
    expect(slideMove({ x: 9.9, y: 12 }, 0.2, 0, [BLOCK])).toEqual({ x: 9.9, y: 12 })
  })

  it('resolves the corner with x first, and the y-first answer is different', () => {
    // Hand-computed. From (9.9, 9.9) with (+0.2, +0.2) against [10,14) x [10,14):
    //   x -> 10.1; (10.1, 9.9) has y = 9.9 outside [10,14) -> x survives.
    //   y -> 10.1; (10.1, 10.1) is inside      -> y is cancelled.
    // Result (10.1, 9.9). Applying y first would have kept y and cancelled x,
    // giving (9.9, 10.1) — so this fixture pins the axis order, not just the slide.
    const result = slideMove({ x: 9.9, y: 9.9 }, 0.2, 0.2, [BLOCK])
    expect(result.x).toBeCloseTo(10.1, 12)
    expect(result.y).toBeCloseTo(9.9, 12)
  })

  it('keeps y when x is the blocked component', () => {
    // From (9.9, 11): x -> 10.1 is inside -> cancelled; y -> 11.2 at x = 9.9 is free.
    const result = slideMove({ x: 9.9, y: 11 }, 0.2, 0.2, [BLOCK])
    expect(result.x).toBeCloseTo(9.9, 12)
    expect(result.y).toBeCloseTo(11.2, 12)
  })

  it('cancels both components in a concave pocket', () => {
    // A = [10,14) x [10,14), B = [6,10) x [6,10) meet at the corner (10, 10).
    // From (9.9, 10.2) with (+0.2, -0.4):
    //   x -> 10.1 lands in A          -> cancelled, x stays 9.9
    //   y ->  9.8 at x = 9.9 lands in B -> cancelled, y stays 10.2
    // Net displacement is exactly 0, which by §1.3 still lets the unit fire.
    const pocket: TerrainRect[] = [BLOCK, { kind: 'high', x: 6, y: 6, width: 4, height: 4 }]
    expect(slideMove({ x: 9.9, y: 10.2 }, 0.2, -0.4, pocket)).toEqual({ x: 9.9, y: 10.2 })
  })

  it('ignores low cover — it blocks sight only', () => {
    const result = slideMove({ x: 9.9, y: 9.9 }, 0.2, 0.2, [])
    expect(result.x).toBeCloseTo(10.1, 12)
    expect(result.y).toBeCloseTo(10.1, 12)
    expect(containsAny([LOW], result.x, result.y)).toBe(true)
  })

  it('clamps to the arena', () => {
    expect(slideMove({ x: 0.05, y: 0.05 }, -1, -1, [])).toEqual({ x: 0, y: 0 })
    expect(slideMove({ x: 55.9, y: 31.9 }, 1, 1, [])).toEqual({ x: 56, y: 32 })
  })
})

describe('§1.6 ejection', () => {
  it('pushes out through the nearest face by EJECT_EPSILON', () => {
    expect(ejectPoint({ x: 11, y: 12 }, [BLOCK])).toEqual({ x: 10 - EJECT_EPSILON, y: 12, axis: '-x' })
    expect(ejectPoint({ x: 13, y: 12 }, [BLOCK])).toEqual({ x: 14 + EJECT_EPSILON, y: 12, axis: '+x' })
    expect(ejectPoint({ x: 12, y: 11 }, [BLOCK])).toEqual({ x: 12, y: 10 - EJECT_EPSILON, axis: '-y' })
    expect(ejectPoint({ x: 12, y: 13 }, [BLOCK])).toEqual({ x: 12, y: 14 + EJECT_EPSILON, axis: '+y' })
  })

  it('breaks ties in the order -x, +x, -y, +y', () => {
    // Dead centre: all four faces are 2.0 away.
    expect(ejectPoint({ x: 12, y: 12 }, [BLOCK])?.axis).toBe('-x')
    // +x and -y tie at 1.0, both closer than -x (3.0) and +y (3.0).
    expect(ejectPoint({ x: 13, y: 11 }, [BLOCK])?.axis).toBe('+x')
    // -x and -y tie at 1.0.
    expect(ejectPoint({ x: 11, y: 11 }, [BLOCK])?.axis).toBe('-x')
    // -x and +y tie at 1.0.
    expect(ejectPoint({ x: 11, y: 13 }, [BLOCK])?.axis).toBe('-x')
  })

  it('lands strictly outside, which the half-open faces do not do on their own', () => {
    for (const point of [
      { x: 11, y: 12 },
      { x: 12, y: 11 },
      { x: 12, y: 12 },
      { x: 13, y: 13 },
    ]) {
      const ejected = ejectPoint(point, [BLOCK])
      expect(ejected).not.toBeNull()
      expect(containsAny([BLOCK], ejected!.x, ejected!.y)).toBe(false)
    }
    // The -x face itself is still inside: this is why the epsilon exists.
    expect(containsAny([BLOCK], 10, 12)).toBe(true)
  })

  it('returns null outside and ignores low cover', () => {
    expect(ejectPoint({ x: 20, y: 20 }, [BLOCK])).toBeNull()
    expect(ejectPoint({ x: 12, y: 12 }, [])).toBeNull()
  })

  it('ejects every trapped standing unit and no one else', () => {
    const state = stateWithTerrain([BLOCK])
    const trapped = findFriendly(state, 4)!
    const dead = findFriendly(state, 5)!
    trapped.position = { x: 11, y: 12 }
    dead.position = { x: 11, y: 12 }
    dead.life = 'dead'

    ejectTrappedUnits(state)

    expect(trapped.position).toEqual({ x: 10 - EJECT_EPSILON, y: 12 })
    expect(dead.position).toEqual({ x: 11, y: 12 })
  })
})

describe('§1.4 formation following', () => {
  function slotTarget(state: BattleState, unitId: number): { x: number; y: number } {
    const assignment = state.slotAssignments.find((entry) => entry.unitId === unitId)!
    const slot = FORMATION_SLOTS[assignment.slotIndex]
    const command = findFriendly(state, state.commandUnitId)!
    return { x: command.position.x + slot.x, y: command.position.y + slot.y }
  }

  it('leaves a follower already on its slot with displacement exactly 0', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const before = { ...unit.position }

    advanceFormationFollow(state)

    expect(unit.position).toEqual(before)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('makes displacement exactly 0 inside the arrival dead-band', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    const offset = ARRIVE_EPSILON * 0.75
    unit.position = { x: target.x + offset, y: target.y }
    const before = { ...unit.position }

    advanceFormationFollow(state)

    expect(unit.position.x).toBe(before.x)
    expect(unit.position.y).toBe(before.y)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('moves at the follower speed cap when far from the slot', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 1, y: target.y }

    advanceFormationFollow(state)

    expect(unit.position.x).toBeCloseTo(target.x + 1 - FOLLOW_MAX_SPEED, 12)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
  })

  it('never overshoots the slot', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + FOLLOW_MAX_SPEED / 2, y: target.y }

    advanceFormationFollow(state)

    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.position.y).toBeCloseTo(target.y, 12)
  })

  it('does not move the command unit or non-standing units', () => {
    const state = stateWithTerrain([])
    const command = findFriendly(state, state.commandUnitId)!
    const downed = findFriendly(state, 6)!
    downed.life = 'downed'
    downed.position = { x: 40, y: 20 }
    const commandBefore = { ...command.position }

    advanceFormationFollow(state)

    expect(command.position).toEqual(commandBefore)
    expect(downed.position).toEqual({ x: 40, y: 20 })
  })

  it('pulls a slot that is inside movement-blocking terrain toward the command unit', () => {
    // Slot 0 = (-2.2, -1.1) -> (25.8, 14.9) with the commander at (28, 16).
    // The wall [25, 27) x [14, 16) swallows it. The pull walks 0.1 at a time along
    // the unit vector toward the command unit: (2.2, 1.1) / 2.46... The first step
    // that leaves the wall is the one where x reaches 27, i.e. step 14.
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    const slot = FORMATION_SLOTS[0]
    const radius = Math.hypot(slot.x, slot.y)
    const expected = {
      x: COMMANDER_START.x + slot.x + (-slot.x / radius) * (14 * SLOT_PULL_STEP),
      y: COMMANDER_START.y + slot.y + (-slot.y / radius) * (14 * SLOT_PULL_STEP),
    }
    expect(containsAny([wall], expected.x, expected.y)).toBe(false)

    advanceFormationFollow(state)

    const assignment = state.slotAssignments[0]
    expect(assignment.latchedPosition).not.toBeNull()
    expect(assignment.latchedPosition!.x).toBeCloseTo(expected.x, 12)
    expect(assignment.latchedPosition!.y).toBeCloseTo(expected.y, 12)
  })

  it('latches the pulled slot until the command unit moves again', () => {
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    advanceFormationFollow(state)
    const latched = { ...state.slotAssignments[0].latchedPosition! }

    // The wall disappears; the command unit has not moved, so the latch holds and
    // the follower keeps a single fixed target instead of flickering back and forth.
    state.terrain.high = []
    state.commandUnitMoved = false
    advanceFormationFollow(state)
    expect(state.slotAssignments[0].latchedPosition).toEqual(latched)

    // The command unit moves: the latch is released and the raw slot returns.
    state.commandUnitMoved = true
    advanceFormationFollow(state)
    expect(state.slotAssignments[0].latchedPosition).toBeNull()
  })

  it('lets a follower whose slot is unreachable fall under MOVE_EPSILON', () => {
    // The slot is latched behind a wall the follower cannot slide around, so the
    // distance to the slot never enters the ARRIVE_EPSILON dead-band. What matters
    // for §1.3 is the per-tick displacement, and the geometric approach drives that
    // under MOVE_EPSILON — the follower is not permanently silenced.
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    const unit = findFriendly(state, 2)!
    for (let tick = 0; tick < 200; tick += 1) advanceFormationFollow(state)
    expect(unit.lastDisplacement).toBeLessThan(MOVE_EPSILON)
  })
})

describe('§1.4 slot assignment', () => {
  it('is never recomputed when the command unit changes', () => {
    const state = stateWithTerrain([])
    const before = state.slotAssignments.map((entry) => ({ ...entry }))

    state.commandUnitId = 5
    state.input.move = { x: 1, y: 0 }
    for (let tick = 0; tick < 10; tick += 1) {
      advanceCommandUnit(state)
      advanceFormationFollow(state)
    }

    expect(state.slotAssignments.map((entry) => entry.unitId)).toEqual(
      before.map((entry) => entry.unitId),
    )
    expect(state.slotAssignments.map((entry) => entry.slotIndex)).toEqual(
      before.map((entry) => entry.slotIndex),
    )
  })

  it('leaves the command unit slot vacant instead of reshuffling', () => {
    const state = stateWithTerrain([])
    state.commandUnitId = 5
    const slotOfFive = state.slotAssignments.find((entry) => entry.unitId === 5)!.slotIndex
    advanceFormationFollow(state)

    const occupants = state.slotAssignments.filter((entry) => entry.slotIndex === slotOfFive)
    expect(occupants).toHaveLength(1)
    expect(occupants[0].unitId).toBe(5)
  })
})

describe('§1.7 command unit movement', () => {
  it('moves at the role speed and normalizes diagonal input', () => {
    const state = stateWithTerrain([])
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 1 }

    const displacement = advanceCommandUnit(state)

    expect(displacement).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
    expect(command.position.x).toBeCloseTo(COMMANDER_START.x + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
    expect(state.commandUnitMoved).toBe(true)
  })

  it('uses the soldier speed when a soldier holds command', () => {
    const state = stateWithTerrain([])
    state.commandUnitId = 5
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBeCloseTo(SOLDIER_MOVE_SPEED, 12)
  })

  it('does not move with a zero input vector', () => {
    const state = stateWithTerrain([])
    const command = findFriendly(state, 1)!
    const before = { ...command.position }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual(before)
    expect(state.commandUnitMoved).toBe(false)
  })

  it('does not move while the rescue lock is held (§1.11 seam)', () => {
    const state = stateWithTerrain([])
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 0 }
    state.rescue = { active: true, targetId: 7, progress: 3 }
    const before = { ...command.position }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual(before)
  })

  it('slides along movement-blocking terrain', () => {
    const state = stateWithTerrain([{ kind: 'high', x: 29, y: 10, width: 4, height: 12 }])
    const command = findFriendly(state, 1)!
    command.position = { x: 28.95, y: 16 }
    state.input.move = { x: 1, y: 1 }

    advanceCommandUnit(state)

    expect(command.position.x).toBe(28.95)
    expect(command.position.y).toBeCloseTo(16 + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
  })
})
