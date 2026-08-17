// Batch A fixtures for movement (§1.7), formation following and the settle
// dead-band (§1.4), and terrain ejection (§1.6).
//
// Terrain here is hand-authored, never seed-derived (§4.2).

import { describe, expect, it } from 'vitest'

import { containsAny, ejectFromRects } from '../../src/core/gameplay/geometry'
import { FORMATION_SLOTS } from '../../src/core/gameplay/formation'
import { HIGH_COVER_MIN_GAP, type TerrainRect } from '../../src/core/gameplay/terrain'
import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  COMMANDER_START,
  EJECT_EPSILON,
  ENEMY_STUCK_TICKS,
  FOLLOW_MAX_SPEED,
  MELEE_MOVE_SPEED,
  MOVE_EPSILON,
  SLOT_PULL_STEP,
  SOLDIER_MOVE_SPEED,
} from '../../src/core/battle/constants'
import {
  NO_ENEMY_MOVEMENT,
  advanceCommandUnit,
  advanceFormationFollow,
  advanceStep5Movement,
  ejectPoint,
  ejectTrappedUnits,
  moveEnemyTowards,
  slideMove,
} from '../../src/core/battle/movement'
import { createEnemy, createInitialBattleState, findFriendly } from '../../src/core/battle/state'
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

    advanceFormationFollow(state, false)

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

    advanceFormationFollow(state, false)

    expect(unit.position.x).toBe(before.x)
    expect(unit.position.y).toBe(before.y)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('moves at the follower speed cap when far from the slot', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 1, y: target.y }

    advanceFormationFollow(state, false)

    expect(unit.position.x).toBeCloseTo(target.x + 1 - FOLLOW_MAX_SPEED, 12)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
  })

  it('never overshoots the slot', () => {
    const state = stateWithTerrain([])
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + FOLLOW_MAX_SPEED / 2, y: target.y }

    advanceFormationFollow(state, false)

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

    advanceFormationFollow(state, false)

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

    advanceFormationFollow(state, false)

    const assignment = state.slotAssignments[0]
    expect(assignment.latchedPosition).not.toBeNull()
    expect(assignment.latchedPosition!.x).toBeCloseTo(expected.x, 12)
    expect(assignment.latchedPosition!.y).toBeCloseTo(expected.y, 12)
  })

  it('latches the pulled slot until the command unit moves again', () => {
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    advanceFormationFollow(state, false)
    const latched = { ...state.slotAssignments[0].latchedPosition! }
    expect(state.slotLatchOwnerId).toBe(state.commandUnitId)

    // The wall disappears; the command unit has not moved, so the latch holds and
    // the follower keeps a single fixed target instead of flickering back and forth.
    state.terrain.high = []
    advanceFormationFollow(state, false)
    expect(state.slotAssignments[0].latchedPosition).toEqual(latched)

    // The command unit moves: the latch is released and the raw slot returns.
    advanceFormationFollow(state, true)
    expect(state.slotAssignments[0].latchedPosition).toBeNull()
    expect(state.slotLatchOwnerId).toBeNull()
  })

  it('releases every latch when command passes to another body (§1.5)', () => {
    // A latch is an absolute world position derived from the command unit. Succession
    // moves the formation centre by up to the 2.460 slot radius without anybody
    // taking a step, so `commandUnitMoved` is false and the latch would survive —
    // aiming 15 followers at points around a body that no longer leads. In the
    // scenario succession exists for (stand still and rescue the downed original
    // commander) that would hold for the whole RESCUE_TICKS.
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    advanceFormationFollow(state, false)
    expect(state.slotAssignments[0].latchedPosition).not.toBeNull()

    // Command passes to a body standing clear of the wall. Nobody moved.
    findFriendly(state, 9)!.position = { x: 40, y: 20 }
    state.commandUnitId = 9
    advanceFormationFollow(state, false)

    expect(state.slotAssignments[0].latchedPosition).toBeNull()
    expect(state.slotLatchOwnerId).toBeNull()
  })

  it('re-latches against the new command unit when its slot is also blocked', () => {
    const state = stateWithTerrain([])
    const newCommand = findFriendly(state, 9)!
    newCommand.position = { x: 40, y: 20 }
    // Slot 0 relative to (40, 20) is (37.8, 18.9); swallow it.
    state.terrain.high = [{ kind: 'high', x: 37, y: 18, width: 2, height: 2 }]
    state.commandUnitId = 9

    advanceFormationFollow(state, false)

    expect(state.slotAssignments[0].latchedPosition).not.toBeNull()
    expect(state.slotLatchOwnerId).toBe(9)
  })

  it('lets a follower whose slot is unreachable fall under MOVE_EPSILON', () => {
    // The slot is latched behind a wall the follower cannot slide around, so the
    // distance to the slot never enters the ARRIVE_EPSILON dead-band. What matters
    // for §1.3 is the per-tick displacement, and the geometric approach drives that
    // under MOVE_EPSILON — the follower is not permanently silenced.
    const wall: TerrainRect = { kind: 'high', x: 25, y: 14, width: 2, height: 2 }
    const state = stateWithTerrain([wall])
    const unit = findFriendly(state, 2)!
    for (let tick = 0; tick < 200; tick += 1) advanceFormationFollow(state, false)
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
      advanceFormationFollow(state, false)
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
    advanceFormationFollow(state, false)

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

describe('§1.7 the arena clamp comes before the terrain test', () => {
  // Hand-authored terrain flush against the arena edge (§4.2 forbids seed-derived
  // fixtures here). `[0, 4) x [10, 14)` owns the whole left edge of that band, so
  // there is no legal position between the wall's inner face and the arena edge —
  // which is exactly why the clamp order matters only for a unit that is already
  // inside the wall, and why the rule is paired with §1.6 ejection.
  const EDGE: TerrainRect = { kind: 'high', x: 0, y: 10, width: 4, height: 4 }

  it('cancels the axis instead of clamping a unit back inside the wall', () => {
    // From (4.05, 12) pushing -x by 0.2: the raw x is 3.85, which is INSIDE the wall,
    // so x is cancelled and the unit stays put.
    expect(slideMove({ x: 4.05, y: 12 }, -0.2, 0, [EDGE])).toEqual({ x: 4.05, y: 12 })
  })

  it('does not let the clamp walk a trapped unit deeper along the wall', () => {
    // A unit inside the flush rectangle, pushing -x past the arena edge. This START
    // POSITION is unreachable from seed-generated terrain — the generator insets every
    // rectangle by TERRAIN_MARGIN = 2.0, so nothing is ever flush against the arena
    // edge — and can only be built by §4.2's hand-authored fixture terrain. It is also
    // the only kind of position from which the clamp order is observable at all: a
    // flush rectangle owns the whole strip between its inner face and the boundary, so
    // there is no legal position from which a clamp can trigger.
    //   clamp first (the rule): x -> 0.0, which is inside `[0, 4)`, so x is CANCELLED
    //                           and the position does not change at all. Displacement
    //                           0, and §1.6's ejection at the end of step 5 frees it.
    //   test first (the old wording): x -> -0.05 is OUTSIDE the half-open rectangle,
    //                           so it is accepted, and the clamp then lands the unit
    //                           on x = 0 — still inside, but having "moved" 0.05
    //                           through a wall that was supposed to stop it.
    expect(slideMove({ x: 0.05, y: 12 }, -0.1, 0, [EDGE])).toEqual({ x: 0.05, y: 12 })
  })

  it('still clamps at an edge with no terrain in the way', () => {
    expect(slideMove({ x: 0.05, y: 2 }, -0.1, 0, [EDGE])).toEqual({ x: 0, y: 2 })
    expect(slideMove({ x: 0.05, y: 2 }, -0.1, -0.1, [EDGE])).toEqual({ x: 0, y: 1.9 })
  })
})

describe('§1.16 step 5: the ejection barrier runs last', () => {
  const WALL: TerrainRect = { kind: 'high', x: 10, y: 10, width: 4, height: 4 }

  it('leaves a trapped unit motionless for the tick, then frees it', () => {
    // The ordering is observable, which is why it is pinned. Ejecting BEFORE movement
    // would free the unit and let it move in the same tick — and §1.3 would then
    // silence it. Ejecting after movement gives it displacement 0 (so it may fire)
    // and a legal position before step 6 reads cooldowns.
    const state = stateWithTerrain([WALL])
    const unit = findFriendly(state, 4)!
    unit.position = { x: 11, y: 12 }

    advanceFormationFollow(state, false)
    expect(unit.lastDisplacement).toBe(0)

    ejectTrappedUnits(state)
    expect(containsAny([WALL], unit.position.x, unit.position.y)).toBe(false)
  })

  it('advanceStep5Movement runs follow, then enemies, then ejection', () => {
    const state = stateWithTerrain([WALL])
    const enemy = createEnemy(101, 'melee', { x: 11, y: 12 })
    state.enemies.push(enemy)

    const order: string[] = []
    advanceStep5Movement(state, false, () => {
      order.push('enemies')
      // An enemy that ends its own move inside high cover is caught by the barrier —
      // §1.10 does not have to remember to eject, and it cannot forget.
      expect(containsAny([WALL], enemy.position.x, enemy.position.y)).toBe(true)
    })

    expect(order).toEqual(['enemies'])
    expect(containsAny([WALL], enemy.position.x, enemy.position.y)).toBe(false)
    expect(enemy.position).toEqual({ x: 10 - EJECT_EPSILON, y: 12 })
  })

  it('NO_ENEMY_MOVEMENT is an explicit choice, not a default', () => {
    const state = stateWithTerrain([WALL])
    const enemy = createEnemy(101, 'melee', { x: 11, y: 12 })
    state.enemies.push(enemy)

    advanceStep5Movement(state, false, NO_ENEMY_MOVEMENT)

    expect(enemy.position).toEqual({ x: 10 - EJECT_EPSILON, y: 12 })
  })

  it('leaves two touching rectangles in a single push', () => {
    // A = [10,14) x [10,14) and B = [6,10) x [10,14) share the face x = 10, so the
    // union spans [6,14) x [10,14). Per-rectangle nearest-face ejection bounces here
    // forever: out of A through -x lands EJECT_EPSILON inside B, whose nearest face is
    // now that same seam, and back it goes. Measuring against the union instead:
    //   -x: boundary 6  -> 5
    //   +x: boundary 14 -> 3
    //   -y: boundary 10 -> 2      <- tie with +y, -y wins the order
    //   +y: boundary 14 -> 2
    const seam: TerrainRect[] = [WALL, { kind: 'high', x: 6, y: 10, width: 4, height: 4 }]

    // The per-rectangle rule really does fail here: two passes return to the start.
    const first = ejectFromRects(seam, 11, 12, EJECT_EPSILON)!
    const second = ejectFromRects(seam, first.x, first.y, EJECT_EPSILON)!
    expect(containsAny(seam, first.x, first.y)).toBe(true)
    expect(containsAny(seam, second.x, second.y)).toBe(true)

    const ejected = ejectPoint({ x: 11, y: 12 }, seam)!
    expect(ejected.axis).toBe('-y')
    expect(ejected).toEqual({ x: 11, y: 10 - EJECT_EPSILON, axis: '-y' })
    expect(containsAny(seam, ejected.x, ejected.y)).toBe(false)
  })

  it('leaves an L of three overlapping rectangles in a single push', () => {
    // A vertical arm [20,22) x [10,20) and a horizontal arm [20,28) x [10,12),
    // overlapping in the corner block [20,22) x [10,12). From (21, 11) — inside all
    // three — the union is the L, and every direction has to clear the whole of it:
    //   -x: boundary 20 -> 1      <- the winner
    //   +x: boundary 28 -> 7      (the horizontal arm reaches out to 28)
    //   -y: boundary 10 -> 1      tie, but -x is earlier in the order
    //   +y: boundary 20 -> 9      (the vertical arm reaches up to 20)
    const ell: TerrainRect[] = [
      { kind: 'high', x: 20, y: 10, width: 2, height: 10 },
      { kind: 'high', x: 20, y: 10, width: 8, height: 2 },
      { kind: 'high', x: 20, y: 10, width: 2, height: 2 },
    ]

    const ejected = ejectPoint({ x: 21, y: 11 }, ell)!
    expect(ejected).toEqual({ x: 20 - EJECT_EPSILON, y: 11, axis: '-x' })
    expect(containsAny(ell, ejected.x, ejected.y)).toBe(false)
  })

  it('breaks a four-way tie at the centre of a square with -x', () => {
    // Every direction clears the union at exactly 2.0. The distances are compared
    // before the epsilon is applied, so all four are bit-equal and the tie-break —
    // not floating-point rounding — decides.
    const ejected = ejectPoint({ x: 12, y: 12 }, [WALL])!
    expect(ejected).toEqual({ x: 10 - EJECT_EPSILON, y: 12, axis: '-x' })
  })

  it('throws when the union cannot be escaped inside the arena', () => {
    // Hand-authored terrain covering the whole arena: no direction reaches free space
    // without leaving `[0, 56] x [0, 32]`. §1.6 calls this a terrain-authoring error,
    // and the alternative — returning a position that is still inside a wall — would
    // present as a frozen unit ten batches later instead of as a bad fixture now.
    const sealed: TerrainRect[] = [{ kind: 'high', x: 0, y: 0, width: 56, height: 32 }]
    expect(() => ejectPoint({ x: 28, y: 16 }, sealed)).toThrow(/cannot leave/)
    // Unreachable from a seed: high cover keeps a 5.0 gap from its own class and is
    // inset from the arena edge.
    expect(HIGH_COVER_MIN_GAP).toBe(5)
  })
})

describe('§1.7 the 30-tick stuck counter', () => {
  it('counts consecutive zero-displacement ticks and resets on any movement', () => {
    // Pure movement bookkeeping, so it lives with movement: the retarget decision at
    // 30 is §1.8/§1.9's, but if the counter were left to them an enemy grinding
    // against a wall would never be noticed and I1 would read as a supply problem.
    // 9.99 + MELEE_MOVE_SPEED (0.075) = 10.065, inside `[10, 14)`, so x is cancelled
    // and dy is 0 — net displacement is exactly 0 from the very first tick.
    const wall: TerrainRect = { kind: 'high', x: 10, y: 10, width: 4, height: 4 }
    const enemy = createEnemy(101, 'melee', { x: 9.99, y: 12 })
    const target = { x: 20, y: 12 }

    for (let tick = 0; tick < ENEMY_STUCK_TICKS; tick += 1) {
      expect(moveEnemyTowards(enemy, target, MELEE_MOVE_SPEED, [wall])).toBe(0)
    }
    expect(enemy.zeroDisplacementTicks).toBe(ENEMY_STUCK_TICKS)

    // One real step resets it.
    moveEnemyTowards(enemy, { x: 9.99, y: 20 }, MELEE_MOVE_SPEED, [wall])
    expect(enemy.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    expect(enemy.zeroDisplacementTicks).toBe(0)
  })

  it('counts a unit already standing on its target as stuck', () => {
    const enemy = createEnemy(101, 'melee', { x: 5, y: 5 })
    moveEnemyTowards(enemy, { x: 5, y: 5 }, MELEE_MOVE_SPEED, [])
    moveEnemyTowards(enemy, { x: 5, y: 5 }, MELEE_MOVE_SPEED, [])
    expect(enemy.zeroDisplacementTicks).toBe(2)
  })
})
