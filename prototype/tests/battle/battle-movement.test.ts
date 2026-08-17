// Movement fixtures: the arena clamp (§1.7), formation following and the settle
// dead-band (§1.4), and step 5's composition (§1.16).
//
// §1.6 removed cover, so the fixtures that pinned x-then-y sliding, union ejection, the
// slot pull, the pull latch and the 30-tick stuck counter are gone with the rules. What
// remains is deliberately small: the arena edge is now the ONLY thing that can turn
// movement input into zero displacement, which makes it the only remaining witness for
// §1.3's "판정 대상은 입력이 아니라 실제 변위다".

import { describe, expect, it } from 'vitest'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  COMMANDER_START,
  FOLLOW_MAX_SPEED,
  MELEE_MOVE_SPEED,
  MOVE_EPSILON,
  SOLDIER_MOVE_SPEED,
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

  it('makes displacement exactly 0 inside the arrival dead-band', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    // 0.003 < ARRIVE_EPSILON 0.004: inside the band, so the follower must not move AT
    // ALL. "Approximately 0" would silence this soldier forever under §1.3.
    unit.position = { x: target.x + 0.003, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position).toEqual({ x: target.x + 0.003, y: target.y })
    expect(unit.lastDisplacement).toBe(0)
  })

  it('closes exactly onto the slot just outside the dead-band', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    // 0.01 > ARRIVE_EPSILON 0.004 and 0.01 <= FOLLOW_MAX_SPEED 0.13, so the step is the
    // whole distance and the follower lands on the slot. It is also >= MOVE_EPSILON, so
    // §1.3 reads this tick as movement and the follower does not fire on it.
    unit.position = { x: target.x + 0.01, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.lastDisplacement).toBeCloseTo(0.01, 12)
    expect(unit.lastDisplacement).toBeGreaterThanOrEqual(MOVE_EPSILON)
    expect(ARRIVE_EPSILON).toBeLessThanOrEqual(MOVE_EPSILON)
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

describe('§1.16 step 4: command unit movement', () => {
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

  it('gives input-with-no-displacement at the arena edge — the §1.3 witness', () => {
    // The last remaining way to hold a movement input and still have displacement 0.
    // §1.3 judges displacement, so this unit may fire; `battle-combat.test.ts` pins that
    // half.
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

describe('§1.16 step 5 composition', () => {
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
