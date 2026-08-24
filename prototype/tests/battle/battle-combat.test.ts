// Batch B fixtures: attack-while-moving (§1.3), target selection (§1.8), the two
// enemy classes (§1.9) and the range advantage that replaced cover (§1.6).
//
// Batch N adds §1.4.2, the command unit's melee, at the bottom of this file. It lives here
// because it is resolved in the SAME STEP as everything above — the 아군 공격 step (§1.16 gains
// no row) — and the whole of the rule is a distance test inside `resolveFriendlyAttacks`.
//
// There is no terrain (§1.6), so there are no hand-authored layouts here any more and no
// sight fixtures at all. Every expected coordinate, tick and shot count below is
// hand-computed from the constants, not read back off the implementation.

import { describe, expect, it } from 'vitest'

import {
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_MELEE_DAMAGE,
  COMMANDER_MELEE_INTERVAL,
  COMMANDER_MELEE_RANGE,
  COMMANDER_MOVE_SPEED,
  COMMANDER_RANGE,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  advanceCooldowns,
  resolveEnemyAttacks,
  resolveFriendlyAttacks,
} from '../../src/core/battle/attacks'
import { advanceTargeting, selectFriendlyTargetId } from '../../src/core/battle/targeting'
import { advanceEnemyMovement, isEnemyEngaged } from '../../src/core/battle/enemy'
import {
  CHARGER_IDS,
  COMMANDER_ID,
  RIFLEMAN_IDS,
  createEnemy,
  createInitialBattleState,
  findEnemy,
  findFriendly,
} from '../../src/core/battle/state'

/**
 * §1.2.1 SPLIT THE SQUAD, AND EVERY FIXTURE BELOW THAT SAYS "SOLDIER" MEANS RIFLEMAN.
 *
 * These used soldier id 2 because before the split every soldier outranged the shooter, so any
 * of them showed §1.6's gap. Id 2 now holds the front rank, and a skirmisher is DEFINED by
 * being outranged — that is §1.2.1's entire point — so id 2 can no longer demonstrate the thing
 * these tests exist to demonstrate. Naming the class says what was always meant.
 */
const RIFLE = RIFLEMAN_IDS[0]
import { commandBatch } from '../../src/core/battle/input'
import { advanceBattleTick } from '../../src/core/battle/tick'
import type { ResolvedTick } from '../../src/core/battle/tick'
import type { BattleState, EnemyUnit, FriendlyUnit } from '../../src/core/battle/types'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  arenaWidth: ARENA_WIDTH,
  meleeAttackInterval: MELEE_ATTACK_INTERVAL,
  meleeDamage: MELEE_DAMAGE,
  meleeMoveSpeed: MELEE_MOVE_SPEED,
  meleeRange: MELEE_RANGE,
  rangeAdvantage: RANGE_ADVANTAGE,
  shooterAttackInterval: SHOOTER_ATTACK_INTERVAL,
  shooterDamage: SHOOTER_DAMAGE,
  shooterMoveSpeed: SHOOTER_MOVE_SPEED,
  shooterRange: SHOOTER_RANGE,
  shooterStandoff: SHOOTER_STANDOFF,
} = stageConfigOf(1)

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
    state.enemies = [createEnemy(state, 101, 'melee', { x: 30, y: 16 })]
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
      state.enemies = [createEnemy(state, 101, 'melee', { x: 30, y: 16 })]
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
    state.enemies = [createEnemy(state, 101, 'melee', { x: ARENA_WIDTH - 3, y: 12 })]
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
    state.enemies = [createEnemy(state, 101, 'melee', { x: 34, y: 16 })]
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
    state.enemies = [createEnemy(state, 101, 'melee', { x: 28 + START_GAP, y: 16 })]
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
      createEnemy(state, 101, 'melee', { x: 29, y: 16 }), // distance 1
      createEnemy(state, 1000, 'elite', { x: 32, y: 16 }), // distance 4
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(1000)

    // Without the elite in the list the same commander takes the nearest.
    state.enemies = [state.enemies[0]]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('breaks a distance tie by ascending id', () => {
    const state = fixture()
    state.enemies = [
      createEnemy(state, 101, 'melee', { x: 30, y: 16 }),
      createEnemy(state, 102, 'melee', { x: 26, y: 16 }),
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('spends nothing when there is no candidate', () => {
    const state = fixture()
    // Distance 6.5 > COMMANDER_RANGE 6.0.
    state.enemies = [createEnemy(state, 101, 'melee', { x: 34.5, y: 16 })]
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
    state.enemies = [createEnemy(state, 101, 'melee', { x: 30, y: 16 })]
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
      createEnemy(state, 101, 'melee', { x: 28, y: 20 }),
      createEnemy(state, 102, 'melee', { x: 28, y: 20 }),
      createEnemy(state, 103, 'melee', { x: 28, y: 20 }),
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
      createEnemy(state, 101, 'melee', { x: 28, y: 20 }),
      createEnemy(state, 102, 'melee', { x: 28, y: 20 }),
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
    state.enemies = [createEnemy(state, 201, 'shooter', { x, y })]
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
      createEnemy(state, 201, 'shooter', { x: 28, y: 20 }),
      createEnemy(state, 202, 'shooter', { x: 28, y: 20 }),
      createEnemy(state, 203, 'shooter', { x: 28, y: 20 }),
      createEnemy(state, 204, 'shooter', { x: 28, y: 20 }),
      createEnemy(state, 205, 'shooter', { x: 28, y: 20 }),
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
      createEnemy(state, 101, 'melee', { x: 28, y: 20 }),
      createEnemy(state, 201, 'shooter', { x: 28, y: 20 }),
      createEnemy(state, 202, 'shooter', { x: 28, y: 20 }),
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
    // Hand-computed: place the rifleman at (28, 16) and the shooter at (32.6, 16).
    expect(RANGE_ADVANTAGE).toBeCloseTo(0.5, 12)
    const distance = 4.6
    expect(distance).toBeLessThan(SOLDIER_RANGE)
    expect(distance).toBeGreaterThan(SHOOTER_RANGE)

    const state = fixture({ friendlies: { [RIFLE]: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(state, 201, 'shooter', { x: 28 + distance, y: 16 })]
    const soldier = findFriendly(state, RIFLE)!
    const shooter = enemyOf(state, 201)

    advanceTargeting(state)
    expect(soldier.targetId).toBe(201)

    // Both sides get their attack step on the same tick, from the same positions.
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: RIFLE,
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
    const state = fixture({ friendlies: { [RIFLE]: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(state, 201, 'shooter', { x: 32.2, y: 16 })]

    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state)).toHaveLength(1)
    expect(resolveEnemyAttacks(state)).toEqual([
      {
        side: 'enemy',
        attackerId: 201,
        targetId: RIFLE,
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
    const state = fixture({ friendlies: { [RIFLE]: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(state, 101, 'melee', { x: 32.6, y: 16 })]
    const soldier = findFriendly(state, RIFLE)!
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
      createEnemy(state, 101, 'melee', { x: 28.5, y: 16 }),
      createEnemy(state, 102, 'melee', { x: 30.5, y: 16 }),
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
    state.enemies = [createEnemy(state, 101, 'melee', { x: 28, y: 17 })]

    advanceTargeting(state)
    expect(enemyOf(state, 101).targetId).toBe(2)
  })

  it('leaves the elite row to §1.12 — it neither retargets nor moves nor contacts', () => {
    const state = fixture()
    state.enemies = [createEnemy(state, 1000, 'elite', { x: 30, y: 16 })]
    state.elite.enemyId = 1000
    const elite = enemyOf(state, 1000)

    advanceTargeting(state)
    advanceEnemyMovement(state)
    expect(elite.targetId).toBeNull()
    expect(elite.position).toEqual({ x: 30, y: 16 })
    expect(resolveEnemyAttacks(state)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §1.4.2 — the command unit's melee (batch N)
// ---------------------------------------------------------------------------

/**
 * THE WHOLE RULE IS A TRADE, and these fixtures are what hold each half of it.
 *
 * §1.4.2: inside `COMMANDER_MELEE_RANGE`, against a target whose own class holds distance, the
 * command unit strikes in melee; in every other case it fires the ranged attack it has always
 * had. Both are automatic (§1.3 already made every attack automatic) and §1.15 gains no key. What
 * it costs is §1.6's range advantage: the melee range is well inside `SHOOTER_RANGE`, so a tick
 * spent in melee is a tick spent where the shooters can answer, and `constants.ts` asserts that
 * relation rather than trusting it.
 *
 * WHY EVERY TARGET BELOW IS A `shooter` AND NOT A `melee` (v13). v12 had no class clause and
 * these fixtures all used a `melee` body, which made them unable to distinguish the rule from the
 * one §1.4.2 now states — `scripts/mutate.mjs` measured exactly that and MISSED. §1.3 requires
 * `MELEE_MOVE_SPEED > COMMANDER_MOVE_SPEED`, so a melee-class enemy arrives at contact range on
 * its own and a swing that lands on it was bought with nothing; a shooter holds
 * `SHOOTER_STANDOFF` low `2.70` and only the player can cross it. The pair at the top of this
 * block is what separates the two, and everything after it uses the class that can actually
 * produce a swing.
 *
 * NO STATE FIELD AND NO DRAW. "Am I in melee range" is a distance computed inside the attack
 * step from positions the movement step already wrote. `tests/battle/battle-state.test.ts`'s
 * key-set pins are what prove nothing was added; these fixtures prove the rule works without it.
 */
describe('§1.4.2 the command unit strikes in melee inside its melee range', () => {
  /** Both fixtures below, so the only difference between them is the one distance. */
  function commanderAgainstAShooterAt(gap: number): {
    state: BattleState
    commander: FriendlyUnit
  } {
    const state = fixture()
    state.enemies = [createEnemy(state, 101, 'shooter', { x: 28 + gap, y: 16 })]
    return { state, commander: commanderOf(state) }
  }

  it('swings at a shooter at melee range, and shoots a melee-class enemy at the SAME distance', () => {
    // §1.4.2 (v13): "근접은 §1.8이 고른 대상이 `shooter` 또는 `elite`일 때만 나간다. 근접형
    // (`melee`)에게는 기존 사거리 공격으로 친다."
    //
    // THE PAIR DIFFERS IN ONE THING AND IT IS THE CLASS. Same commander, same position, same gap,
    // same enemy id, same everything the §1.8 step reads except `kind`. A rule that tested only
    // the distance would produce `friendly-melee` on both lines; a rule that never swung would
    // produce `friendly-attack` on both. Exactly one of the two is what §1.4.2 asks for.
    //
    // WHY THE CLASS IS THE RIGHT AXIS, and it is not a taste: §1.3 REQUIRES `MELEE_MOVE_SPEED >
    // COMMANDER_MOVE_SPEED`, so the melee-class body on the second line walked into this distance
    // by itself and the command unit gave up nothing to be here. The shooter on the first line
    // holds its standoff outside `COMMANDER_MELEE_RANGE` and will not close it, so the only way
    // the command unit is standing this close to one is that the player walked it in — and that
    // walk is inside `SHOOTER_RANGE`, which is the §1.6 price §1.4.2 says the melee costs.
    const gap = COMMANDER_MELEE_RANGE - 0.01

    const shooter = fixture()
    shooter.enemies = [createEnemy(shooter, 101, 'shooter', { x: 28 + gap, y: 16 })]
    advanceTargeting(shooter)
    expect(commanderOf(shooter).targetId).toBe(101)
    expect(resolveFriendlyAttacks(shooter)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 101,
        amount: COMMANDER_MELEE_DAMAGE,
        cause: 'friendly-melee',
      },
    ])
    expect(commanderOf(shooter).attackCooldown).toBe(COMMANDER_MELEE_INTERVAL)

    const closer = fixture()
    closer.enemies = [createEnemy(closer, 101, 'melee', { x: 28 + gap, y: 16 })]
    advanceTargeting(closer)
    expect(commanderOf(closer).targetId).toBe(101)
    expect(resolveFriendlyAttacks(closer)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 101,
        amount: COMMANDER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
    expect(commanderOf(closer).attackCooldown).toBe(COMMANDER_ATTACK_INTERVAL)
  })

  it('marks a charger\u2019s blow as a cleaver\u2019s and a rifleman\u2019s as a rifle\u2019s, in one tick', () => {
    // THE REGRESSION THIS FILE MISSED FOR FOUR BATCHES. §1.2.1's charger had melee reach and melee
    // damage from the day it landed, and every fixture that measured it measured a number — so
    // nothing noticed that its blow went out with `cause: 'friendly-attack'`, the rifle's value.
    // The renderer reads `cause` and nothing else to pick a swing over a shot, so on the board the
    // whole class carried a rifle and puffed smoke at contact range. It was a melee class in every
    // respect the simulation could see and none the player could.
    //
    // Both bodies are in the SAME tick against the SAME target, so the slot is the only variable:
    // whatever separates these two causes cannot be distance, health, target or timing.
    const rifleId = RIFLEMAN_IDS[0]
    const chargerId = CHARGER_IDS[0]
    const state = fixture({ friendlies: {
      [rifleId]: { x: 28, y: 16 },
      [chargerId]: { x: 28, y: 16.5 },
    } })
    state.enemies = [createEnemy(state, 101, 'melee', { x: 28.4, y: 16.2 })]

    advanceTargeting(state)
    const causes = new Map(resolveFriendlyAttacks(state).map((event) => [event.attackerId, event.cause]))
    expect(causes.get(chargerId)).toBe('charger-melee')
    expect(causes.get(rifleId)).toBe('friendly-attack')
    // And it is a THIRD value, not §1.4.2's. `friendly-melee` names the command unit's swing and
    // three fixtures in this file assert only the command unit can make one; folding the charger
    // into it would leave each of them passing for the wrong reason.
    expect([...causes.values()]).not.toContain('friendly-melee')
  })

  it('swings at the elite at melee range, which is the other half of the same clause', () => {
    // §1.4.2 names TWO classes and a fixture that pinned only the shooter would let "shooter" be
    // written where "shooter or elite" is meant. `ELITE_APPROACH_RANGE 4.5` is the elite's own
    // standoff and is far outside `COMMANDER_MELEE_RANGE 1.2`, so it is the same argument as the
    // shooter's: the command unit is only ever this close because it walked there.
    const state = fixture()
    state.enemies = [createEnemy(state, 1000, 'elite', { x: 28 + COMMANDER_MELEE_RANGE - 0.01, y: 16 })]
    state.elite.enemyId = 1000

    advanceTargeting(state)
    expect(commanderOf(state).targetId).toBe(1000)
    expect(resolveFriendlyAttacks(state).map((event) => event.cause)).toEqual(['friendly-melee'])
  })

  it('swings inside the melee range', () => {
    // 1.19 = COMMANDER_MELEE_RANGE - 0.01, hand-computed off the constant so the fixture moves
    // with §5's tuning instead of pinning a literal that would silently stop being inside.
    // THE AXIS HERE IS DISTANCE, not class — the pair with the fixture below holds the boundary,
    // and the pair at the top of the block holds the class. Both targets are shooters so that
    // this pair varies exactly one thing.
    const gap = COMMANDER_MELEE_RANGE - 0.01
    const { state, commander } = commanderAgainstAShooterAt(gap)
    expect(gap).toBeLessThan(COMMANDER_MELEE_RANGE)

    advanceTargeting(state)
    expect(commander.targetId).toBe(101)
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 101,
        amount: COMMANDER_MELEE_DAMAGE,
        cause: 'friendly-melee',
      },
    ])
    expect(commander.attackCooldown).toBe(COMMANDER_MELEE_INTERVAL)
  })

  it('shoots from just outside it — the same fixture, one hundredth further out', () => {
    // The non-vacuity of the pair: everything here is identical to the fixture above except
    // `gap`, which is 0.02 larger. If the melee branch were reached unconditionally, or never
    // reached at all, exactly one of the two would fail.
    const gap = COMMANDER_MELEE_RANGE + 0.01
    const { state, commander } = commanderAgainstAShooterAt(gap)
    expect(gap).toBeGreaterThan(COMMANDER_MELEE_RANGE)
    expect(gap).toBeLessThan(COMMANDER_RANGE)

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

  it('counts a distance of exactly the melee range as inside it', () => {
    // §1.8 admits a candidate at `distance <= range` and §1.4.2 is written the same way, so the
    // boundary is inclusive. The coordinates are chosen so the subtraction is EXACT — `0` and
    // `COMMANDER_MELEE_RANGE` — because `28 + 1.2 - 28` is 1.1999999999999993 in binary floating
    // point and would test the open side of the boundary while claiming to test the closed one.
    const state = fixture({ friendlies: { [COMMANDER_ID]: { x: 0, y: 16 } } })
    state.enemies = [createEnemy(state, 101, 'shooter', { x: COMMANDER_MELEE_RANGE, y: 16 })]
    expect(Math.hypot(COMMANDER_MELEE_RANGE - 0, 0)).toBe(COMMANDER_MELEE_RANGE)

    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state).map((event) => event.cause)).toEqual(['friendly-melee'])
  })

  it('gives a soldier nothing at the same distance', () => {
    // §1.4.2: "병사는 갖지 않는다". Soldier 2 stands exactly where the commander stood in the
    // first fixture, against the same enemy, and fires its rifle for `SOLDIER_DAMAGE`. The enemy
    // is a `shooter` so that the v13 class clause cannot be what produces the rifle here — this
    // fixture is about the id, and a melee-class body would let it pass for the wrong reason.
    const state = fixture({ friendlies: { [RIFLE]: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(state, 101, 'shooter', { x: 28 + COMMANDER_MELEE_RANGE - 0.01, y: 16 })]

    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: RIFLE,
        targetId: 101,
        amount: SOLDIER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
    expect(findFriendly(state, RIFLE)!.attackCooldown).toBe(SOLDIER_ATTACK_INTERVAL)
  })

  it('follows the COMMAND UNIT, not the body that started as commander', () => {
    // §1.4.2 gives the melee to the 지휘 유닛, and §1.5 lets that be a soldier. So the fixture
    // stands BOTH bodies at the same distance from the same enemy and promotes the soldier:
    // the soldier swings and the original commander — no longer the command unit — shoots.
    // The two events differ in nothing else, which is what makes this a test of the id and not
    // of the distance.
    const gap = COMMANDER_MELEE_RANGE - 0.01
    const state = fixture({
      friendlies: { [COMMANDER_ID]: { x: 28, y: 16 }, [RIFLE]: { x: 28, y: 16 } },
    })
    state.enemies = [createEnemy(state, 101, 'shooter', { x: 28 + gap, y: 16 })]
    state.commandUnitId = RIFLE

    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 101,
        amount: COMMANDER_DAMAGE,
        cause: 'friendly-attack',
      },
      {
        side: 'friendly',
        attackerId: RIFLE,
        targetId: 101,
        amount: COMMANDER_MELEE_DAMAGE,
        cause: 'friendly-melee',
      },
    ])
  })

  it('is the trade §1.4.2 describes: the melee range is inside what the shooters can answer', () => {
    // Not a behaviour test — a statement of the geometry the rule is made of, next to the
    // fixtures that use it. `constants.ts` asserts the same relation at import; this says out
    // loud what it buys. A command unit at melee range from anything is inside the standoff
    // band every shooter on the board fires from.
    expect(COMMANDER_MELEE_RANGE).toBeLessThan(SHOOTER_RANGE)
    expect(COMMANDER_MELEE_DAMAGE).toBeGreaterThan(COMMANDER_DAMAGE)
    expect(COMMANDER_MELEE_INTERVAL).toBeLessThanOrEqual(COMMANDER_ATTACK_INTERVAL)
  })

  it('does not melee a target the §1.8 ranking put outside the melee range', () => {
    // The reading this batch shipped, pinned so a later batch has to change a fixture to change
    // it: §1.4.2's "COMMANDER_MELEE_RANGE 안에 §1.8 순위의 대상이 있으면" is read as a test on
    // THE TARGET §1.8 ALREADY CHOSE (what the 대상 선택 step wrote), not a second ranking pass over the
    // bodies inside melee range. The two readings differ exactly here — an elite outside melee
    // range outranks a nearer body inside it (§1.8 puts 정예 first), so the command unit shoots
    // the elite instead of swinging at what is standing on top of it.
    //
    // The nearer body is a `shooter`, which the v13 class clause ADMITS. If it were the melee
    // class the fixture would pass for the wrong reason — the swing would be refused by the class
    // and the reading it means to pin would go untested.
    const state = fixture()
    state.enemies = [
      createEnemy(state, 101, 'shooter', { x: 28.4, y: 16 }),
      createEnemy(state, 1000, 'elite', { x: 32, y: 16 }),
    ]
    state.elite.enemyId = 1000

    advanceTargeting(state)
    expect(commanderOf(state).targetId).toBe(1000)
    expect(resolveFriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: COMMANDER_ID,
        targetId: 1000,
        amount: COMMANDER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
  })

  it('carries the swing out on the tick result, and leaves the state\u2019s shape alone', () => {
    // §1.4.2: "\ud53c\ud574 \uc774\ubca4\ud2b8\uc758 `cause`\ub294 `friendly-melee`\ub85c \uad6c\ubd84\ud55c\ub2e4. `DamageEvent`\ub294 `TickResult`\uc5d0\ub9cc
    // \uc788\uc73c\ubbc0\ub85c `BattleState`\uc640 digest \uad6c\uc870\uc5d0 \uc601\ud5a5\uc774 \uc5c6\uace0". This drives a WHOLE TICK — the reducer,
    // not the attack pass on its own — and asserts both halves of that sentence at once: the new
    // cause reaches the outside on the tick result, and the state it left behind has the same key
    // set as one that has never seen a melee.
    //
    // `battle-state.test.ts` pins the key sets against a literal list, which is the enforcement;
    // this is the demonstration that a tick which really produced a `friendly-melee` still
    // satisfies it, because a key added at runtime rather than at construction would pass there
    // and fail here.
    const state = fixture()
    state.mode = 'running'
    // A high id so the spawn step, which reserves ids from `FIRST_ENEMY_ID` upward, cannot
    // collide with the body this fixture placed by hand.
    // The gap is 0.5 rather than 1.19 because this fixture runs the WHOLE tick, enemy movement
    // included: a shooter this far inside its own standoff retreats by `SHOOTER_MOVE_SPEED 0.06`
    // before the attack step, and 1.19 + 0.06 would be outside `COMMANDER_MELEE_RANGE` by the
    // time the swing is resolved. 0.5 + 0.06 is not.
    state.enemies = [createEnemy(state, 900, 'shooter', { x: 28.5, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 0

    const result = advanceBattleTick(state, commandBatch([]))
    expect(result.ran).toBe(true)
    const causes = (result as ResolvedTick).damageEvents.map((event) => event.cause)
    expect(causes).toContain('friendly-melee')
    expect(Object.keys(state).sort()).toEqual(
      Object.keys(createInitialBattleState('seed-a')).sort(),
    )
    expect(Object.keys(commander).sort()).toEqual(
      Object.keys(createInitialBattleState('seed-a').friendlies[0]!).sort(),
    )
  })

  it('still costs nothing to move: the swing lands on a tick the command unit walked', () => {
    // §1.3 is unchanged by §1.4.2 — displacement gates nothing — and the melee must not
    // reintroduce the tax from the other side. The command unit walks away at full speed and
    // still swings, because it is still inside the melee range after the step.
    //   28 -> 27.885, so the gap goes 0.9 -> 1.015, still <= 1.2.
    const state = fixture()
    state.enemies = [createEnemy(state, 101, 'shooter', { x: 28.9, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    state.input.move = { x: -1, y: 0 }

    advanceCommandUnit(state)
    advanceCooldowns(state)
    expect(commander.attackCooldown).toBe(0)
    advanceTargeting(state)
    expect(resolveFriendlyAttacks(state).map((event) => event.cause)).toEqual(['friendly-melee'])
  })
})
