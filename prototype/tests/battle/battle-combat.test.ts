// Batch B fixtures: attack-while-moving (§1.3), target selection (§1.8), the two
// enemy classes (§1.9) and the range advantage that replaced cover (§1.6).
//
// There is no terrain (§1.6), so there are no hand-authored layouts here any more and no
// sight fixtures at all. Every expected coordinate, tick and shot count below is
// hand-computed from the constants, not read back off the implementation.

import { describe, expect, it } from 'vitest'

import {
  ARENA_WIDTH,
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_MOVE_SPEED,
  MELEE_ATTACK_INTERVAL,
  MELEE_DAMAGE,
  MELEE_MOVE_SPEED,
  MELEE_RANGE,
  RANGE_ADVANTAGE,
  SHOOTER_ATTACK_INTERVAL,
  SHOOTER_DAMAGE,
  SHOOTER_MOVE_SPEED,
  SHOOTER_RANGE,
  SHOOTER_STANDOFF,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  advanceCooldowns,
  resolveEnemyAttacks,
  resolveFriendlyAttacks,
} from '../../src/core/battle/attacks'
import { advanceTargeting, selectFriendlyTargetId } from '../../src/core/battle/targeting'
import { advanceEnemyMovement, isEnemyEngaged } from '../../src/core/battle/enemy'
import { COMMANDER_ID, createEnemy, createInitialBattleState, findEnemy, findFriendly } from '../../src/core/battle/state'
import type { BattleState, EnemyUnit, FriendlyUnit } from '../../src/core/battle/types'

/**
 * A battle with only the named friendlies standing.
 *
 * The other bodies are marked dead rather than moved off-arena: every rule in this
 * batch skips non-standing units, so a dead body cannot silently take a slot, absorb
 * a shot or shift a "nearest" tie.
 */
function fixture(options: { friendlies?: Record<number, { x: number; y: number }> } = {}): BattleState {
  const state = createInitialBattleState('seed-a')

  const kept = options.friendlies ?? { [COMMANDER_ID]: { x: 28, y: 16 } }
  for (const unit of state.friendlies) {
    const position = kept[unit.id]
    if (!position) {
      unit.life = 'dead'
      unit.hp = 0
      unit.deathTick = 0
      continue
    }
    unit.position = { x: position.x, y: position.y }
  }
  return state
}

function commanderOf(state: BattleState): FriendlyUnit {
  const unit = findFriendly(state, COMMANDER_ID)
  if (!unit) throw new Error('fixture has no commander')
  return unit
}

function enemyOf(state: BattleState, id: number): EnemyUnit {
  const enemy = findEnemy(state, id)
  if (!enemy) throw new Error(`fixture has no enemy ${id}`)
  return enemy
}

describe('§1.3 units attack while moving', () => {
  it('fires and decrements on a tick the unit really moved', () => {
    // A real movement pass, not a hand-set displacement: the commander walks AWAY from the
    // melee at full speed and shoots it on the same tick.
    //   position 28 -> 27.885, so the gap goes 2.0 -> 2.115, still inside COMMANDER_RANGE 6.0.
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    state.input.move = { x: -1, y: 0 }

    const displacement = advanceCommandUnit(state)
    expect(displacement).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
    expect(commander.position.x).toBeCloseTo(28 - COMMANDER_MOVE_SPEED, 12)

    // The cooldown pass does not consult the displacement (§1.3: "cooldown은 항상 감소한다").
    advanceCooldowns(state)
    expect(commander.attackCooldown).toBe(0)

    advanceTargeting(state)
    expect(commander.targetId).toBe(101)
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 101,
        amount: COMMANDER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
    expect(commander.attackCooldown).toBe(COMMANDER_ATTACK_INTERVAL)
  })

  it('gives a body in constant motion exactly the firepower of a body that never moves', () => {
    // The direct measurement of the reversal, and the guard against re-gating on motion.
    //
    // Hand-computed for the commander over 300 ticks: the cooldown starts at 0, so it fires on
    // tick 1 and sets 10; ten decrements later it is ready again on tick 11. Shots land on
    // 1, 11, 21, ... 291 — floor(299 / 10) + 1 = 30 — and NOTHING about that arithmetic
    // mentions displacement.
    //
    // Under v6~v8 the same loop gave 30 shots for the stopped policy and 0 for the moving one
    // (a unit that never stops never decrements), and a policy stopping 1 tick in 10 kept 3.
    // If any of that comes back, the two counts below stop being equal.
    const TICKS = 300
    const EXPECTED_SHOTS = 30

    const shotsWhile = (moving: boolean): number => {
      const state = fixture()
      // Parked 2.0 away and left alone: this fixture measures the friendly's clock, so the
      // melee is a target dummy that neither moves nor dies.
      state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
      const commander = commanderOf(state)
      let shots = 0

      for (let tick = 1; tick <= TICKS; tick += 1) {
        if (moving) {
          // Alternate direction so 300 ticks of real movement stay inside the arena and
          // inside COMMANDER_RANGE of the dummy: +x on odd ticks, -x on even ones.
          state.input.move = { x: tick % 2 === 1 ? 1 : -1, y: 0 }
          expect(advanceCommandUnit(state)).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
        }
        advanceCooldowns(state)
        advanceTargeting(state)
        shots += resolveFriendlyAttacks(state).length
      }
      return shots
    }

    expect(shotsWhile(false)).toBe(EXPECTED_SHOTS)
    expect(shotsWhile(true)).toBe(EXPECTED_SHOTS)
    expect(EXPECTED_SHOTS).toBe(Math.floor((TICKS - 1) / COMMANDER_ATTACK_INTERVAL) + 1)
  })

  it('fires while pinned against the arena edge, where input produces no displacement', () => {
    // The one place a held input yields zero displacement. It used to be the witness for
    // "the rule judges displacement, not input"; with no such rule left it is the witness
    // that the shot does not depend on either.
    const state = fixture({ friendlies: { [COMMANDER_ID]: { x: ARENA_WIDTH, y: 12 } } })
    state.enemies = [createEnemy(101, 'melee', { x: ARENA_WIDTH - 3, y: 12 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(commander.position).toEqual({ x: ARENA_WIDTH, y: 12 })

    advanceCooldowns(state)
    expect(commander.attackCooldown).toBe(0)
    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state)).toHaveLength(1)
  })

  it('decrements an enemy cooldown while it closes, as it always did', () => {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 34, y: 16 })]
    const melee = enemyOf(state, 101)
    melee.attackCooldown = 5
    melee.targetId = COMMANDER_ID

    advanceEnemyMovement(state)
    expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    advanceCooldowns(state)
    expect(melee.attackCooldown).toBe(4)
  })

  it('leaves a downed body cold: no cooldown ticks off while it waits for a rescue', () => {
    // The one condition the cooldown pass still has. §1.5 can hand command back to a revived
    // body, so a cooldown that ran down while it lay there would buy it a free volley.
    const state = fixture()
    const commander = commanderOf(state)
    commander.attackCooldown = 5
    commander.life = 'downed'

    advanceCooldowns(state)
    expect(commander.attackCooldown).toBe(5)
  })
})

describe('§1.3 / I8 flight is futile — the melee outruns the command unit', () => {
  /**
   * §4.2 "도망 불가": the command unit runs in a straight line and the gap shrinks every tick.
   *
   * ALL OF THE ARITHMETIC BELOW IS FROM THE CONSTANTS, NOT FROM A RUN.
   *
   *   MELEE_MOVE_SPEED       0.140
   *   COMMANDER_MOVE_SPEED   0.115
   *   CLOSING_PER_TICK       0.140 - 0.115 = 0.025   <- the whole design bet, one subtraction
   *
   * Within a tick the command unit moves first and the melee second (§1.16), so one tick is
   * `gap + 0.115 - 0.140`. Starting at 2.02 the gap after n ticks is `2.02 - 0.025n`:
   *
   *   n=1  1.995     n=10  1.770     n=40  1.020     n=50  0.770  <- still out of contact
   *   n=2  1.970     n=20  1.520     n=51  0.745  <- <= MELEE_RANGE 0.75, first swing
   *
   * 2.02 rather than a round 2.0 on purpose: at 2.0 the crossing lands on `2.0 - 0.025 x 50 =
   * 0.750` EXACTLY, and whether `distance <= MELEE_RANGE` holds there is decided by the last
   * bits of a hypot rather than by the design. 2.02 puts the first contact tick strictly
   * inside contact range, and tick 50 strictly outside it.
   *
   * The commander covers 51 x 0.115 = 5.865 metres to lose 51 x 0.025 = 1.275 of gap. That is
   * what "이동은 도망이 아니라 위치 선택이다" costs when it is spent on flight.
   */
  const CLOSING_PER_TICK = MELEE_MOVE_SPEED - COMMANDER_MOVE_SPEED
  const START_GAP = 2.02
  const CONTACT_TICK = 51

  function fleeing(): { state: BattleState; commander: FriendlyUnit; melee: EnemyUnit } {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 28 + START_GAP, y: 16 })]
    const melee = enemyOf(state, 101)
    // Pre-claimed, so §1.16's one-tick selection lag is not part of the arithmetic: the melee
    // is already hunting on tick 1. `battle-combat`'s range-advantage fixture measures the lag
    // itself; this one measures the speeds.
    melee.targetId = COMMANDER_ID
    melee.contactSlotOwnerId = COMMANDER_ID
    // Straight line, directly away from the melee, held for every tick.
    state.input.move = { x: -1, y: 0 }
    return { state, commander: commanderOf(state), melee }
  }

  function gapOf(commander: FriendlyUnit, melee: EnemyUnit): number {
    return Math.hypot(melee.position.x - commander.position.x, melee.position.y - commander.position.y)
  }

  it('closes the gap by exactly (melee speed - commander speed) every tick', () => {
    expect(MELEE_MOVE_SPEED).toBeGreaterThan(COMMANDER_MOVE_SPEED)
    expect(CLOSING_PER_TICK).toBeCloseTo(0.025, 12)

    const { state, commander, melee } = fleeing()
    let previous = gapOf(commander, melee)
    expect(previous).toBeCloseTo(START_GAP, 12)

    const expected = new Map([
      [1, 1.995],
      [2, 1.97],
      [10, 1.77],
      [20, 1.52],
      [40, 1.02],
      [50, 0.77],
    ])

    for (let tick = 1; tick <= 50; tick += 1) {
      // The two movement steps, in §1.16's order and nothing else — this fixture is about
      // distance, so no attack pass runs and neither body can die and stop moving.
      expect(advanceCommandUnit(state)).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
      advanceEnemyMovement(state)
      expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)

      const gap = gapOf(commander, melee)
      // Every tick, without exception: this is the assertion §4.2 asks for.
      expect(gap, `tick ${tick} did not close the gap`).toBeLessThan(previous)
      expect(previous - gap).toBeCloseTo(CLOSING_PER_TICK, 9)
      const hand = expected.get(tick)
      if (hand !== undefined) expect(gap, `tick ${tick}`).toBeCloseTo(hand, 9)
      previous = gap
    }

    // 50 ticks of full-speed flight, and the melee is nearer than when it started.
    expect(previous).toBeCloseTo(START_GAP - 50 * CLOSING_PER_TICK, 9)
    expect(previous).toBeGreaterThan(MELEE_RANGE)
    // The commander travelled 5.75 metres to give up 1.25 of them.
    expect(commander.position.x).toBeCloseTo(28 - 50 * COMMANDER_MOVE_SPEED, 9)
  })

  it('lands the first swing on the hand-computed tick, with the commander still at full speed', () => {
    // Window: 56 ticks. The first swing is at 51 and MELEE_ATTACK_INTERVAL 15 puts the second
    // at 66, so exactly one swing belongs in here — and the gap at 56 is 2.02 - 1.4 = 0.62,
    // clear of the `<= MELEE_RANGE` boundary in both directions.
    const WINDOW = 56
    const { state, commander, melee } = fleeing()
    let firstSwingTick = 0
    let swings = 0

    for (let tick = 1; tick <= WINDOW; tick += 1) {
      // Flight is real on every one of these ticks: full displacement, never clamped.
      expect(advanceCommandUnit(state)).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
      advanceEnemyMovement(state)
      advanceCooldowns(state)
      advanceTargeting(state)
      const landed = resolveEnemyAttacks(state).length
      if (landed > 0) {
        swings += landed
        if (firstSwingTick === 0) firstSwingTick = tick
      }
    }

    expect(firstSwingTick).toBe(CONTACT_TICK)
    expect(swings).toBe(1)
    expect(gapOf(commander, melee)).toBeCloseTo(START_GAP - WINDOW * CLOSING_PER_TICK, 9)
    expect(gapOf(commander, melee)).toBeLessThan(MELEE_RANGE)
    // 6.44 metres of running, and it is in contact anyway.
    expect(commander.position.x).toBeCloseTo(28 - WINDOW * COMMANDER_MOVE_SPEED, 9)
  })
})

describe('§1.8 target selection', () => {
  it('takes the elite over a nearer ordinary enemy', () => {
    const state = fixture()
    state.enemies = [
      createEnemy(101, 'melee', { x: 29, y: 16 }), // distance 1
      createEnemy(1000, 'elite', { x: 32, y: 16 }), // distance 4
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(1000)

    // Without the elite in the list the same commander takes the nearest.
    state.enemies = [state.enemies[0]]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('breaks a distance tie by ascending id', () => {
    const state = fixture()
    state.enemies = [
      createEnemy(101, 'melee', { x: 30, y: 16 }),
      createEnemy(102, 'melee', { x: 26, y: 16 }),
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('spends nothing when there is no candidate', () => {
    const state = fixture()
    // Distance 6.5 > COMMANDER_RANGE 6.0.
    state.enemies = [createEnemy(101, 'melee', { x: 34.5, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 0

    advanceTargeting(state)
    expect(commander.targetId).toBeNull()
    expect(resolveFriendlyAttacks(state)).toEqual([])
    expect(commander.attackCooldown).toBe(0)
  })
})

describe('§1.9 melee', () => {
  it('closes on its target and holds at contact range', () => {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
    const melee = enemyOf(state, 101)
    melee.targetId = COMMANDER_ID
    melee.contactSlotOwnerId = COMMANDER_ID

    // distance 2.0 > MELEE_RANGE 0.75 -> one step of MELEE_MOVE_SPEED toward (28, 16).
    advanceEnemyMovement(state)
    expect(melee.position.x).toBeCloseTo(30 - MELEE_MOVE_SPEED, 12)
    expect(melee.position.y).toBeCloseTo(16, 12)
    expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    // Out of contact range it does not attack, even with a ready cooldown.
    expect(resolveEnemyAttacks(state)).toEqual([])

    // Inside contact range: displacement is exactly 0 and the attack lands.
    melee.position = { x: 28.5, y: 16 }
    advanceEnemyMovement(state)
    expect(melee.position).toEqual({ x: 28.5, y: 16 })
    expect(melee.lastDisplacement).toBe(0)
    expect(resolveEnemyAttacks(state)).toEqual([
      {
        side: 'enemy',
        attackerId: 101,
        targetId: COMMANDER_ID,
        amount: MELEE_DAMAGE,
        cause: 'melee-contact',
      },
    ])
    expect(melee.attackCooldown).toBe(MELEE_ATTACK_INTERVAL)
  })

  it('gives the contact slot to the lower id and overflows the rest by distance then id', () => {
    // One contact slot per friendly. Three melees stacked at (28, 20):
    //   commander 1 at (28, 16) is 4.0 away, soldier 2 at (30, 16) is 4.4721 away.
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 30, y: 16 } },
    })
    state.enemies = [
      createEnemy(101, 'melee', { x: 28, y: 20 }),
      createEnemy(102, 'melee', { x: 28, y: 20 }),
      createEnemy(103, 'melee', { x: 28, y: 20 }),
    ]

    advanceTargeting(state)

    // 101 wins the nearer friendly because it is the lower id.
    expect(enemyOf(state, 101).targetId).toBe(1)
    expect(enemyOf(state, 101).contactSlotOwnerId).toBe(1)
    // 102 finds slot 1 taken and retargets to the nearest friendly with a free slot.
    expect(enemyOf(state, 102).targetId).toBe(2)
    expect(enemyOf(state, 102).contactSlotOwnerId).toBe(2)
    // 103 finds every slot taken. §1.9 has no "waiting for a slot" state, so it
    // targets the nearest friendly and holds no slot.
    expect(enemyOf(state, 103).targetId).toBe(1)
    expect(enemyOf(state, 103).contactSlotOwnerId).toBeNull()
  })

  it('holds a claimed slot across ticks and only re-picks when it loses one', () => {
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 30, y: 16 } },
    })
    state.enemies = [
      createEnemy(101, 'melee', { x: 28, y: 20 }),
      createEnemy(102, 'melee', { x: 28, y: 20 }),
    ]

    for (let tick = 1; tick <= 5; tick += 1) advanceTargeting(state)
    // A claim is stable: §1.9 makes retargeting a consequence of NOT holding a slot,
    // so an enemy does not re-optimise every tick and the assignment cannot thrash.
    expect(enemyOf(state, 101).contactSlotOwnerId).toBe(1)
    expect(enemyOf(state, 102).contactSlotOwnerId).toBe(2)

    // 102's target goes down; friendly 1's only contact slot is taken, so 102 falls
    // through to the nearest friendly with no slot at all.
    findFriendly(state, 2)!.life = 'downed'
    advanceTargeting(state)
    expect(enemyOf(state, 102).targetId).toBe(1)
    expect(enemyOf(state, 102).contactSlotOwnerId).toBeNull()
    expect(enemyOf(state, 101).contactSlotOwnerId).toBe(1)
  })
})

describe('§1.9 shooter', () => {
  const [STANDOFF_LOW, STANDOFF_HIGH] = SHOOTER_STANDOFF

  function shooterAt(x: number, y: number): { state: BattleState; shooter: EnemyUnit } {
    const state = fixture()
    state.enemies = [createEnemy(201, 'shooter', { x, y })]
    const shooter = enemyOf(state, 201)
    shooter.targetId = COMMANDER_ID
    shooter.contactSlotOwnerId = COMMANDER_ID
    return { state, shooter }
  }

  it('approaches above the band, holds inside it, retreats below it', () => {
    // Band is [2.7, 4.275] for SHOOTER_RANGE 4.5 and the [0.60, 0.95] ratio.
    expect(STANDOFF_LOW).toBeCloseTo(2.7, 12)
    expect(STANDOFF_HIGH).toBeCloseTo(4.275, 12)

    // 6.0 > 4.275: one 0.06 step toward (28, 16).
    const approach = shooterAt(34, 16)
    advanceEnemyMovement(approach.state)
    expect(approach.shooter.position.x).toBeCloseTo(33.94, 12)
    expect(approach.shooter.position.y).toBeCloseTo(16, 12)
    // §1.9: it fires from the band only, so closing costs it the shot.
    expect(resolveEnemyAttacks(approach.state)).toEqual([])

    // 3.5 is inside the band: exactly zero displacement, and it fires.
    const hold = shooterAt(31.5, 16)
    advanceEnemyMovement(hold.state)
    expect(hold.shooter.position).toEqual({ x: 31.5, y: 16 })
    expect(hold.shooter.lastDisplacement).toBe(0)
    expect(isEnemyEngaged(hold.state, hold.shooter)).toBe(true)
    expect(resolveEnemyAttacks(hold.state)).toEqual([
      {
        side: 'enemy',
        attackerId: 201,
        targetId: COMMANDER_ID,
        amount: SHOOTER_DAMAGE,
        cause: 'shooter-shot',
      },
    ])
    expect(hold.shooter.attackCooldown).toBe(SHOOTER_ATTACK_INTERVAL)

    // 2.0 < 2.7: one 0.06 step directly away from the target.
    const retreat = shooterAt(30, 16)
    advanceEnemyMovement(retreat.state)
    expect(retreat.shooter.position.x).toBeCloseTo(30.06, 12)
    expect(retreat.shooter.position.y).toBeCloseTo(16, 12)
    expect(retreat.shooter.lastDisplacement).toBeCloseTo(SHOOTER_MOVE_SPEED, 12)
    expect(resolveEnemyAttacks(retreat.state)).toEqual([])
  })

  it('uses two target slots per friendly', () => {
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 30, y: 16 } },
    })
    state.enemies = [
      createEnemy(201, 'shooter', { x: 28, y: 20 }),
      createEnemy(202, 'shooter', { x: 28, y: 20 }),
      createEnemy(203, 'shooter', { x: 28, y: 20 }),
      createEnemy(204, 'shooter', { x: 28, y: 20 }),
      createEnemy(205, 'shooter', { x: 28, y: 20 }),
    ]

    advanceTargeting(state)
    expect(state.enemies.map((enemy) => enemy.contactSlotOwnerId)).toEqual([1, 1, 2, 2, null])
    expect(enemyOf(state, 205).targetId).toBe(1)
  })

  it('shares a friendly between a melee contact slot and two shooter slots', () => {
    // The two slot kinds are separate pools (§1.9 names them separately), so one
    // friendly can hold one melee and two shooters at once.
    const state = fixture()
    state.enemies = [
      createEnemy(101, 'melee', { x: 28, y: 20 }),
      createEnemy(201, 'shooter', { x: 28, y: 20 }),
      createEnemy(202, 'shooter', { x: 28, y: 20 }),
    ]
    advanceTargeting(state)
    expect(state.enemies.map((enemy) => enemy.contactSlotOwnerId)).toEqual([1, 1, 1])
  })
})

describe('§1.6 range advantage — the mechanism that replaced cover', () => {
  it('lets a soldier in the gap shoot a shooter that cannot shoot back', () => {
    // The gap is SOLDIER_RANGE 5.0 - SHOOTER_RANGE 4.5 = 0.5, and the shooter can only
    // fire from inside its standoff band, whose top is 0.95 x 4.5 = 4.275. So a soldier
    // standing 4.6 away is:
    //   * inside its own 5.0 range        -> it shoots
    //   * outside the shooter's 4.5 range -> the shooter cannot reach it at all
    // Hand-computed: place soldier 2 at (28, 16) and the shooter at (32.6, 16).
    expect(RANGE_ADVANTAGE).toBeCloseTo(0.5, 12)
    const distance = 4.6
    expect(distance).toBeLessThan(SOLDIER_RANGE)
    expect(distance).toBeGreaterThan(SHOOTER_RANGE)

    const state = fixture({ friendlies: { 2: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(201, 'shooter', { x: 28 + distance, y: 16 })]
    const soldier = findFriendly(state, 2)!
    const shooter = enemyOf(state, 201)

    advanceTargeting(state)
    expect(soldier.targetId).toBe(201)

    // Both sides get their attack step on the same tick, from the same positions.
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: 2,
        targetId: 201,
        amount: SOLDIER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
    expect(resolveEnemyAttacks(state)).toEqual([])
    expect(isEnemyEngaged(state, shooter)).toBe(false)
  })

  it('loses the advantage as soon as the shooter closes into its band', () => {
    // 4.2 is inside the band [2.7, 4.275] and inside the soldier's 5.0, so both fire.
    const state = fixture({ friendlies: { 2: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(201, 'shooter', { x: 32.2, y: 16 })]

    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state)).toHaveLength(1)
    expect(resolveEnemyAttacks(state)).toEqual([
      {
        side: 'enemy',
        attackerId: 201,
        targetId: 2,
        amount: SHOOTER_DAMAGE,
        cause: 'shooter-shot',
      },
    ])
  })

  it('measures how long the advantage lasts against a closing melee', () => {
    // A STANDING soldier, so this measures the range advantage rather than the flight the
    // fixture above measures. A melee at MELEE_MOVE_SPEED 0.140 starting 4.6 away has to cover
    // 4.6 - 0.75 = 3.85 to reach contact: ceil(3.85 / 0.140) = 28 moving ticks. It stands still
    // on tick 1 because the movement step moves toward a target the selection step has not
    // chosen yet (§1.16's declared one-tick lag), so contact lands on tick 29:
    // 4.6 - 28 x 0.140 = 0.680 <= 0.75, while tick 28 is still at 0.820.
    // The soldier fires on ticks 1, 13, 25 — three shots before the first swing, and that
    // number is the pressure §1.6 describes ("근접형은 접근을 허용하는 순간 이 우위가
    // 무너진다"). It is two shots fewer than the same fixture measured at the old 0.075: the
    // melee's speed is what buys the squad its window, and the window just got shorter.
    // The soldier's cooldown at tick 29 is 12 - (29 - 25) = 8.
    const state = fixture({ friendlies: { 2: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(101, 'melee', { x: 32.6, y: 16 })]
    const soldier = findFriendly(state, 2)!
    const melee = enemyOf(state, 101)

    let friendlyShots = 0
    let enemySwings = 0
    let contactTick = 0
    for (let tick = 1; tick <= 60 && enemySwings === 0; tick += 1) {
      advanceEnemyMovement(state)
      advanceCooldowns(state)
      advanceTargeting(state)
      friendlyShots += resolveFriendlyAttacks(state).length
      const swings = resolveEnemyAttacks(state).length
      if (swings > 0) {
        enemySwings += swings
        contactTick = tick
      }
    }

    expect(contactTick).toBe(29)
    expect(friendlyShots).toBe(3)
    // still closing at the tick of first contact — the advantage ends because the
    // melee arrives, not because it has stopped.
    expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    expect(soldier.attackCooldown).toBe(SOLDIER_ATTACK_INTERVAL - 4)
  })
})

describe('attack pass ordering and shape', () => {
  it('emits damage events in ascending attacker id, friendlies then enemies', () => {
    // Friendly 1 at (28,16) and friendly 2 at (30,16); melee 101 at (28.5,16) is in
    // contact with 1, melee 102 at (30.5,16) is in contact with 2, and each melee is
    // nearest to the friendly it contacts, so §1.9's slots assign themselves.
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 30, y: 16 } },
    })
    state.enemies = [
      createEnemy(101, 'melee', { x: 28.5, y: 16 }),
      createEnemy(102, 'melee', { x: 30.5, y: 16 }),
    ]

    advanceTargeting(state)
    const friendly = resolveFriendlyAttacks(state)
    const enemy = resolveEnemyAttacks(state)
    expect(friendly.map((event) => event.attackerId)).toEqual([1, 2])
    expect(enemy.map((event) => event.attackerId)).toEqual([101, 102])
    expect([...friendly, ...enemy].every((event) => event.amount > 0)).toBe(true)
  })

  it('never targets a downed friendly', () => {
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 32, y: 16 } },
    })
    commanderOf(state).life = 'downed'
    state.enemies = [createEnemy(101, 'melee', { x: 28, y: 17 })]

    advanceTargeting(state)
    expect(enemyOf(state, 101).targetId).toBe(2)
  })

  it('leaves the elite row to §1.12 — it neither retargets nor moves nor contacts', () => {
    const state = fixture()
    state.enemies = [createEnemy(1000, 'elite', { x: 30, y: 16 })]
    state.elite.enemyId = 1000
    const elite = enemyOf(state, 1000)

    advanceTargeting(state)
    advanceEnemyMovement(state)
    expect(elite.targetId).toBeNull()
    expect(elite.position).toEqual({ x: 30, y: 16 })
    expect(resolveEnemyAttacks(state)).toEqual([])
  })
})
