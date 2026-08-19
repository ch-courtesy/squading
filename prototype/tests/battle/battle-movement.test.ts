// Movement fixtures: the arena clamp (§1.7), formation following and the settle
// dead-band (§1.4), and the composition of the 추종·적 이동 step (§1.16).
//
// §1.6 removed cover, so the fixtures that pinned x-then-y sliding, union ejection, the
// slot pull, the pull latch and the 30-tick stuck counter are gone with the rules. What
// remains is deliberately small. The arena edge is the only thing that can turn movement
// input into zero displacement; under v6~v8 that made it the witness for §1.3's stop test,
// and now that §1.3 has no stop test it is just the clamp reporting honestly.

import { describe, expect, it } from 'vitest'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  COMMANDER_START,
  FOLLOW_MAX_SPEED,
  LEASH_RADIUS,
  MELEE_MOVE_SPEED,
  SHOOTER_RANGE,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { FORMATION_SLOTS, slotPosition } from '../../src/core/battle/formation'
import {
  NO_ENEMY_MOVEMENT,
  advanceCommandUnit,
  advanceFormationFollow,
  advanceMovement,
  clampToArena,
  moveEnemyTowards,
  stepMove,
} from '../../src/core/battle/movement'
import { createEnemy, createInitialBattleState, findFriendly } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'

function slotTarget(state: BattleState, unitId: number): { x: number; y: number } {
  const assignment = state.slotAssignments.find((entry) => entry.unitId === unitId)!
  const command = findFriendly(state, state.commandUnitId)!
  return slotPosition(command.position, assignment.slotIndex)
}

describe('§1.7 the arena clamp is the whole movement boundary', () => {
  it('clamps a step to the arena on both axes', () => {
    expect(stepMove({ x: 0.05, y: 0.05 }, -1, -1)).toEqual({ x: 0, y: 0 })
    expect(stepMove({ x: 55.9, y: 31.9 }, 1, 1)).toEqual({ x: ARENA_WIDTH, y: ARENA_HEIGHT })
    expect(clampToArena(-3, 40)).toEqual({ x: 0, y: ARENA_HEIGHT })
  })

  it('does not otherwise interfere: an interior step lands exactly where asked', () => {
    // Nothing between (20,10) and (20.2, 10.4) any more — no rectangle, no slide, no
    // ejection.
    const result = stepMove({ x: 20, y: 10 }, 0.2, 0.4)
    expect(result.x).toBeCloseTo(20.2, 12)
    expect(result.y).toBeCloseTo(10.4, 12)
  })
})

describe('§1.4 formation following', () => {
  it('leaves a follower already on its slot with displacement exactly 0', () => {
    // `createInitialBattleState` seats all 15 soldiers on their slots (§1.4), so this is
    // the state of the squad at tick 0.
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const before = { ...unit.position }

    advanceFormationFollow(state)
    expect(unit.position).toEqual(before)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('does not jitter inside the arrival dead-band: the position is byte-identical for 100 ticks', () => {
    // §1.4's stated reason, and now its only one: "점근하며 미세 진동하는 것을 막는다."
    // 0.003 < ARRIVE_EPSILON 0.004, so the follower must not move AT ALL — not "move a
    // little", which is what an asymptotic approach looks like tick after tick.
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    const parked = { x: target.x + 0.003, y: target.y }
    unit.position = { ...parked }

    for (let tick = 1; tick <= 100; tick += 1) {
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(parked)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('closes exactly onto the slot just outside the dead-band', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    // 0.01 > ARRIVE_EPSILON 0.004 and 0.01 <= FOLLOW_MAX_SPEED 0.13, so the step is the
    // whole distance and the follower lands on the slot. Whether it also fires on this tick
    // is no longer a question the displacement answers (§1.3).
    unit.position = { x: target.x + 0.01, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.lastDisplacement).toBeCloseTo(0.01, 12)
    expect(ARRIVE_EPSILON).toBeLessThan(0.01)
  })

  it('moves at the follower speed cap when far from the slot', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 1, y: target.y }

    advanceFormationFollow(state)
    // 1.0 away, capped at FOLLOW_MAX_SPEED = 0.1 x 1.30 = 0.13.
    expect(unit.position.x).toBeCloseTo(target.x + 1 - FOLLOW_MAX_SPEED, 12)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
  })

  it('never overshoots the slot', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 0.05, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.lastDisplacement).toBeCloseTo(0.05, 12)
  })

  it('does not move the command unit or non-standing units', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    const downed = findFriendly(state, 5)!
    downed.life = 'downed'
    const commandBefore = { ...command.position }
    // Parked far off its slot: a standing follower would close on it, a downed one is
    // left exactly where it fell.
    downed.position = { x: 1, y: 1 }

    advanceFormationFollow(state)
    expect(command.position).toEqual(commandBefore)
    expect(downed.position).toEqual({ x: 1, y: 1 })
    expect(downed.lastDisplacement).toBe(0)
  })

  it('aims at command unit + offset with no pull and no latch', () => {
    // The slot is a pure function of the command unit's position now. Two ticks of
    // standing still therefore give the follower the same fixed target, which is what
    // §1.4's dead-band needs in order to produce an exact 0.
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: 10, y: 10 }
    const assignment = state.slotAssignments.find((entry) => entry.unitId === 2)!
    const slot = FORMATION_SLOTS[assignment.slotIndex]

    expect(slotTarget(state, 2)).toEqual({ x: 10 + slot.x, y: 10 + slot.y })
    expect(Object.keys(assignment).sort()).toEqual(['slotIndex', 'unitId'])
  })
})

describe('§1.4.1 leash engagement — the soldiers fight for themselves', () => {
  // WHAT THESE ARE MEASURED AGAINST. `LEASH_RADIUS` is 8.0, the band is
  // `[SHOOTER_RANGE 4.5, SOLDIER_RANGE 5.0]`, the follow cap is 0.13 and the command unit
  // starts at (28, 16). Every distance below is hand-computed off those four numbers, so a
  // tuning pass that moves any of them fails these loudly instead of quietly re-deriving.
  //
  // `advanceFormationFollow` is called directly rather than through a tick, because §1.16
  // runs 대상 선택 AFTER 추종·적 이동: what this step engages against is a target it derives
  // itself, and driving a whole tick would hide which of the two picked it.

  /** Soldier 2 holds slot 0, `(-2.2, -1.1)` — so its rest position is `(25.8, 14.9)`. */
  const SOLDIER = 2

  it('leaves its slot for an enemy inside the leash, and stays for one outside', () => {
    // The contrast IS the evidence that the leash exists: same board, same soldier, one
    // enemy moved from 7.0 to 9.0 away from the command unit.
    const inside = createInitialBattleState('seed-a')
    inside.enemies = [createEnemy(101, 'melee', { x: COMMANDER_START.x + 7, y: 16 })]
    const engaged = findFriendly(inside, SOLDIER)!
    const slot = { ...engaged.position }
    expect(slot).toEqual({ x: 25.8, y: 14.9 })

    advanceFormationFollow(inside)
    // 9.2655 away from the enemy at (35, 16), so it closes at the follow cap.
    expect(engaged.position.x).toBeGreaterThan(slot.x)
    expect(engaged.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)

    const outside = createInitialBattleState('seed-a')
    outside.enemies = [createEnemy(101, 'melee', { x: COMMANDER_START.x + 9, y: 16 })]
    const held = findFriendly(outside, SOLDIER)!
    const heldSlot = { ...held.position }

    advanceFormationFollow(outside)
    expect(held.position).toEqual(heldSlot)
    expect(held.lastDisplacement).toBe(0)
    // Not a fluke of the epsilon: the enemy is 9.0 out and the leash is 8.0.
    expect(LEASH_RADIUS).toBeGreaterThan(7)
    expect(LEASH_RADIUS).toBeLessThan(9)
  })

  it('walks to its OWN POINT on the band and stops there, not onto the enemy (§1.6)', () => {
    // Enemy at (31, 16): 3.0 from the command unit, so well inside the leash.
    //
    // v10 PINNED A DIFFERENT POINT HERE and this fixture is the edit that says so. It used to
    // assert the soldier stopped 5.0 away ALONG THE LINE IT HAPPENED TO STAND ON, which is the
    // rule that let fifteen soldiers stack on one spot. v11 gives the goal an angle as well as
    // a distance, and the angle is this soldier's own slot offset.
    //
    // HAND-COMPUTED. Slot 0 is `(-2.2, -1.1) = 1.1 x (-2, -1)`, and `|(-2, -1)| = sqrt(5)`, so
    // the bearing is `(-2/sqrt(5), -1/sqrt(5))` exactly. The far edge is `SOLDIER_RANGE 5.0`, so
    // the goal is `(31, 16) + 5 x bearing = (31 - 2*sqrt(5), 16 - sqrt(5))`.
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(101, 'melee', { x: 31, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    unit.position = { x: 31 - 5.3, y: 16 }

    const goal = { x: 31 - 2 * Math.sqrt(5), y: 16 - Math.sqrt(5) }
    for (let tick = 0; tick < 100; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(goal.x, 12)
    expect(unit.position.y).toBeCloseTo(goal.y, 12)

    // The distance is still the band's far edge — the angle changed, the radius did not.
    const distance = Math.hypot(31 - unit.position.x, 16 - unit.position.y)
    expect(distance).toBeCloseTo(SOLDIER_RANGE, 12)
    // §1.6's gap, per unit: it shoots and a shooter at the same spot could not shoot back.
    expect(distance).toBeGreaterThan(SHOOTER_RANGE)

    // And it holds: on its own point the displacement is exactly 0, not "small".
    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(goal.x, 12)
    expect(unit.position.y).toBeCloseTo(goal.y, 12)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('moves to its own bearing even when it is ALREADY inside the band (v11)', () => {
    // v10 held still here — anywhere in `[4.5, 5.0]` was a resting place, whatever the angle.
    // That is exactly the rule that produced the knot, so v11 must NOT hold: a soldier at the
    // right distance and the wrong angle has somewhere to go.
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(101, 'melee', { x: 31, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    // 4.7 is strictly between 4.5 and 5.0 — v10's dead-band, dead centre.
    const parked = { x: 31 - 4.7, y: 16 }
    unit.position = { ...parked }

    advanceFormationFollow(state)
    expect(unit.position).not.toEqual(parked)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)

    // And where it goes is its slot's bearing, not "somewhere else".
    for (let tick = 0; tick < 100; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(31 - 2 * Math.sqrt(5), 12)
    expect(unit.position.y).toBeCloseTo(16 - Math.sqrt(5), 12)

    // THEN it holds, exactly. The dead-band did not disappear; it moved to the goal point.
    for (let tick = 1; tick <= 50; tick += 1) {
      const settled = { ...unit.position }
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(settled)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('returns to its slot when the target is gone, and settles without jitter', () => {
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(101, 'melee', { x: 34, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    const slot = { ...unit.position }

    for (let tick = 0; tick < 20; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeGreaterThan(slot.x + 2)

    // The enemy dies. §1.4.1: no candidate, so the follow rule of §1.4 takes over again.
    state.enemies = []
    for (let tick = 0; tick < 200; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(slot.x, 12)
    expect(unit.position.y).toBeCloseTo(slot.y, 12)

    // §1.4's dead-band, on the return: exactly still, for fifty more ticks.
    for (let tick = 1; tick <= 50; tick += 1) {
      const settled = { ...unit.position }
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(settled)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('anchors the leash to the COMMAND UNIT, not to the soldier and not to its slot', () => {
    // THE design point of §1.4.1. Both halves put the same soldier at (29, 16) and the same
    // enemy at (35, 16) — 6.0 apart, so the soldier is outside its own range and would
    // close on the enemy if the leash were measured from itself. Only the command unit moves.
    function board(commandX: number) {
      const state = createInitialBattleState('seed-a')
      findFriendly(state, state.commandUnitId)!.position = { x: commandX, y: 16 }
      state.enemies = [createEnemy(101, 'melee', { x: 35, y: 16 })]
      const unit = findFriendly(state, SOLDIER)!
      unit.position = { x: 29, y: 16 }
      return { state, unit }
    }

    // Command unit at (28, 16): 7.0 from the enemy, inside the leash. The soldier engages
    // and walks AWAY from its slot at (25.8, 14.9), toward the enemy.
    const near = board(28)
    advanceFormationFollow(near.state)
    expect(near.unit.position.x).toBeGreaterThan(29)

    // Command unit at (10, 16): 25.0 from the enemy, outside it. Nothing about the soldier
    // or the enemy changed, and it walks the other way, back to its slot at (7.8, 14.9).
    const far = board(10)
    advanceFormationFollow(far.state)
    expect(far.unit.position.x).toBeLessThan(29)
    expect(far.unit.position.y).toBeLessThan(16)
  })

  it('never leashes the command unit itself — player input is its only mover (§1.4.1)', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, state.commandUnitId)!
    state.enemies = [createEnemy(101, 'melee', { x: command.position.x + 3, y: command.position.y })]
    const before = { ...command.position }

    advanceFormationFollow(state)
    expect(command.position).toEqual(before)
    expect(command.lastDisplacement).toBe(0)
    // 3.0 is inside the band's near edge, so every soldier around it is backing off — this
    // is the tick on which a leashed command unit would be most obvious.
    expect(findFriendly(state, SOLDIER)!.lastDisplacement).toBeGreaterThan(0)
  })

  it('moves the leash centre with §1.5 succession', () => {
    // Enemy at (44, 10): 17.09 from the original commander at (28, 16) and 4.0 from soldier
    // 5 at (40, 10). The soldier under test sits at (38, 10), 6.0 from the enemy.
    function board(commandUnitId: number) {
      const state = createInitialBattleState('seed-a')
      state.commandUnitId = commandUnitId
      findFriendly(state, 5)!.position = { x: 40, y: 10 }
      state.enemies = [createEnemy(101, 'melee', { x: 44, y: 10 })]
      const unit = findFriendly(state, SOLDIER)!
      unit.position = { x: 38, y: 10 }
      return { state, unit }
    }

    // Command with the original commander: the enemy is off the leash, so the soldier walks
    // back toward its slot at (25.8, 14.9) — leftward.
    const beforeSuccession = board(1)
    advanceFormationFollow(beforeSuccession.state)
    expect(beforeSuccession.unit.position.x).toBeLessThan(38)

    // §1.5 hands command to soldier 5. Same enemy, same soldier, and now it engages.
    const afterSuccession = board(5)
    advanceFormationFollow(afterSuccession.state)
    expect(afterSuccession.unit.position.x).toBeGreaterThan(38)
  })
})

describe('§1.4 slot assignment', () => {
  it('is never recomputed when the command unit changes', () => {
    const state = createInitialBattleState('seed-a')
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
    const state = createInitialBattleState('seed-a')
    state.commandUnitId = 5
    const slotOfFive = state.slotAssignments.find((entry) => entry.unitId === 5)!.slotIndex
    advanceFormationFollow(state)

    const occupants = state.slotAssignments.filter((entry) => entry.slotIndex === slotOfFive)
    expect(occupants).toHaveLength(1)
    expect(occupants[0].unitId).toBe(5)
  })
})

describe('§1.16 지휘 유닛 이동: command unit movement', () => {
  it('moves at the role speed and normalizes diagonal input', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 1 }

    const displacement = advanceCommandUnit(state)
    // 0.115 / sqrt(2) = 0.081317...
    expect(command.position.x).toBeCloseTo(COMMANDER_START.x + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
    expect(command.position.y).toBeCloseTo(COMMANDER_START.y + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
    expect(displacement).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
  })

  it('uses the soldier speed when a soldier holds command', () => {
    const state = createInitialBattleState('seed-a')
    state.commandUnitId = 7
    state.input.move = { x: 1, y: 0 }
    expect(advanceCommandUnit(state)).toBeCloseTo(SOLDIER_MOVE_SPEED, 12)
  })

  it('does not move with a zero input vector', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    const before = { ...command.position }
    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual(before)
    expect(command.lastDisplacement).toBe(0)
  })

  it('does not move while the rescue lock is held (§1.11 seam)', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 0 }
    state.rescue = { active: true, targetId: 3, progress: 4 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual({ x: COMMANDER_START.x, y: COMMANDER_START.y })
  })

  it('gives input-with-no-displacement at the arena edge', () => {
    // The last remaining way to hold a movement input and still have displacement 0. It has
    // no effect on the unit's firepower (§1.3); `battle-combat.test.ts` pins that half.
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: ARENA_WIDTH, y: 16 }
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual({ x: ARENA_WIDTH, y: 16 })
    expect(command.lastDisplacement).toBe(0)
  })

  it('clamps a partial step at the edge and reports the clamped displacement', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: 55.9, y: 16 }
    state.input.move = { x: 1, y: 0 }

    // 55.9 + 0.115 = 56.015 -> clamped to 56, so the real displacement is 0.1.
    const displacement = advanceCommandUnit(state)
    expect(command.position.x).toBe(ARENA_WIDTH)
    expect(displacement).toBeCloseTo(0.1, 10)
    expect(displacement).toBeLessThan(COMMANDER_MOVE_SPEED)
  })
})

describe('§1.16 추종·적 이동 composition', () => {
  it('runs followers and then enemies, and nothing else', () => {
    const state = createInitialBattleState('seed-a')
    const follower = findFriendly(state, 2)!
    const target = slotTarget(state, 2)
    follower.position = { x: target.x + 1, y: target.y }
    state.enemies = [createEnemy(101, 'melee', { x: 40, y: 16 })]

    const order: string[] = []
    advanceMovement(state, (battle) => {
      // The follower has already moved by the time the enemy rule runs.
      order.push(battle.friendlies[1].lastDisplacement > 0 ? 'after-follow' : 'before-follow')
      moveEnemyTowards(battle.enemies[0], { x: 0, y: 16 }, MELEE_MOVE_SPEED)
    })

    expect(order).toEqual(['after-follow'])
    expect(follower.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
    expect(state.enemies[0].position.x).toBeCloseTo(40 - MELEE_MOVE_SPEED, 12)
  })

  it('NO_ENEMY_MOVEMENT is an explicit choice, not a default', () => {
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(101, 'melee', { x: 40, y: 16 })]
    advanceMovement(state, NO_ENEMY_MOVEMENT)
    expect(state.enemies[0].position).toEqual({ x: 40, y: 16 })
    expect(state.enemies[0].lastDisplacement).toBe(0)
  })
})

describe('§1.7 moveEnemyTowards', () => {
  it('steps at its speed, never overshoots, and clamps to the arena', () => {
    const enemy = createEnemy(101, 'melee', { x: 10, y: 16 })
    expect(moveEnemyTowards(enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(
      MELEE_MOVE_SPEED,
      12,
    )
    expect(enemy.position.x).toBeCloseTo(10 + MELEE_MOVE_SPEED, 12)

    // Closer than one step: land exactly on the target.
    enemy.position = { x: 19.99, y: 16 }
    expect(moveEnemyTowards(enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(0.01, 12)
    expect(enemy.position.x).toBeCloseTo(20, 12)

    // Already there: displacement exactly 0, and no counter to bump any more.
    expect(moveEnemyTowards(enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBe(0)
    expect(Object.keys(enemy)).not.toContain('zeroDisplacementTicks')

    // The arena edge clamps, and the displacement reported is the clamped one.
    enemy.position = { x: ARENA_WIDTH - 0.02, y: 16 }
    expect(moveEnemyTowards(enemy, { x: 60, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(0.02, 10)
    expect(enemy.position.x).toBe(ARENA_WIDTH)
  })
})
