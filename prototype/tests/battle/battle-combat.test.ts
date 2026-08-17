// Batch B fixtures: move/fire exclusivity (§1.3), target selection (§1.8), the two
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
  MOVE_EPSILON,
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
  advanceStep6Cooldowns,
  resolveStep10EnemyAttacks,
  resolveStep9FriendlyAttacks,
} from '../../src/core/battle/attacks'
import { advanceStep7Targeting, selectFriendlyTargetId } from '../../src/core/battle/targeting'
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

describe('§1.3 move/fire exclusivity', () => {
  it('freezes the cooldown and the shot of a unit that moved this tick', () => {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 4

    // Exactly at the threshold counts as movement (§1.3: "MOVE_EPSILON 이상").
    commander.lastDisplacement = MOVE_EPSILON
    advanceStep6Cooldowns(state)
    expect(commander.attackCooldown).toBe(4)

    advanceStep7Targeting(state)
    // Step 7 has no displacement gate: the target is chosen, the shot is not taken.
    expect(commander.targetId).toBe(101)
    expect(resolveStep9FriendlyAttacks(state)).toEqual([])

    // A ready cooldown does not buy a shot while moving either, and is not spent.
    commander.attackCooldown = 0
    commander.lastDisplacement = COMMANDER_MOVE_SPEED
    expect(resolveStep9FriendlyAttacks(state)).toEqual([])
    expect(commander.attackCooldown).toBe(0)
  })

  it('decrements and fires on a stopped tick', () => {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    commander.lastDisplacement = 0

    advanceStep6Cooldowns(state)
    expect(commander.attackCooldown).toBe(0)
    advanceStep7Targeting(state)
    expect(resolveStep9FriendlyAttacks(state)).toEqual([
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

  it('lets a unit stopped by the arena edge fire — the rule judges displacement, not input', () => {
    // §1.6 removed terrain, so the arena edge is the only place input can produce zero
    // displacement. The rule is unchanged: it reads displacement, never input.
    const state = fixture({ friendlies: { [COMMANDER_ID]: { x: ARENA_WIDTH, y: 12 } } })
    state.enemies = [createEnemy(101, 'melee', { x: ARENA_WIDTH - 3, y: 12 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(commander.position).toEqual({ x: ARENA_WIDTH, y: 12 })
    expect(commander.lastDisplacement).toBe(0)

    advanceStep6Cooldowns(state)
    expect(commander.attackCooldown).toBe(0)
    advanceStep7Targeting(state)
    expect(resolveStep9FriendlyAttacks(state)).toHaveLength(1)
  })

  it('does not apply to enemies: their cooldown runs while they close', () => {
    const state = fixture()
    state.enemies = [createEnemy(101, 'melee', { x: 34, y: 16 })]
    const melee = enemyOf(state, 101)
    melee.attackCooldown = 5
    melee.lastDisplacement = MELEE_MOVE_SPEED

    advanceStep6Cooldowns(state)
    expect(melee.attackCooldown).toBe(4)
  })

  /**
   * THE regression guard for the defect v6 exists to close (§1.3's "왜", I11).
   *
   * Two reviewers independently measured that with the cooldown still ticking while
   * moving, stopping for one tick per attack interval keeps 92~98% of full firepower
   * while outrunning every enemy. The table below is hand-computed for the commander
   * (interval 10) over 300 ticks, stopping on ticks where `(tick - 1) % k === 0`:
   *
   *   k    stopped ticks   f_stop   v6 shots   v5 shots (no freeze)
   *   1    300             1.000    30         30
   *   2    150             0.500    15         30   <- 100% of firepower at half stop
   *   3    100             0.333    10         25   <-  83%
   *   10    30             0.100     3         30   <- 100% of firepower at 10% stop
   *
   * v6 shots = floor((stopped - 1) / 10) + 1, because the cooldown only advances on a
   * stopped tick: the first stopped tick fires, and every 10th stopped tick after it
   * fires. That is exactly proportional to `f_stop`. The v5 column is the counterfactual
   * simulator below — the exploit, reproduced, so this test fails loudly if the freeze
   * is ever removed rather than quietly returning to v5 numbers.
   */
  it('makes firepower proportional to the stopped-tick fraction, not ~100%', () => {
    const TICKS = 300
    const table = [
      { every: 1, stopped: 300, v6: 30, v5: 30 },
      { every: 2, stopped: 150, v6: 15, v5: 30 },
      { every: 3, stopped: 100, v6: 10, v5: 25 },
      { every: 10, stopped: 30, v6: 3, v5: 30 },
    ]

    for (const row of table) {
      const state = fixture()
      state.enemies = [createEnemy(101, 'melee', { x: 30, y: 16 })]
      const commander = commanderOf(state)

      let stoppedTicks = 0
      let shots = 0
      for (let tick = 1; tick <= TICKS; tick += 1) {
        const stopped = (tick - 1) % row.every === 0
        if (stopped) stoppedTicks += 1
        // The movement passes are batch A's; here the displacement is the input to
        // §1.3, so it is set directly and the two rules that read it are run in
        // §1.16's order: step 6, then step 7, then step 9.
        commander.lastDisplacement = stopped ? 0 : COMMANDER_MOVE_SPEED
        advanceStep6Cooldowns(state)
        advanceStep7Targeting(state)
        shots += resolveStep9FriendlyAttacks(state).length
      }

      expect(stoppedTicks).toBe(row.stopped)
      expect(shots).toBe(row.v6)
      expect(v5Shots(row.every, TICKS, COMMANDER_ATTACK_INTERVAL)).toBe(row.v5)
    }

    // The headline: at a 10% stop fraction the v5 rule kept 100% of firepower; §1.3
    // gives exactly 10%.
    expect(3 / 30).toBeCloseTo(30 / 300, 12)
    expect(v5Shots(10, TICKS, COMMANDER_ATTACK_INTERVAL) / 30).toBe(1)
  })
})

/**
 * The v5 model: the cooldown decrements every tick, and only the SHOT needs a stopped
 * tick. Four lines, kept in the test rather than in `src/`, so the exploit is
 * measurable without being implementable.
 */
function v5Shots(stopEvery: number, ticks: number, interval: number): number {
  let cooldown = 0
  let shots = 0
  for (let tick = 1; tick <= ticks; tick += 1) {
    if (cooldown > 0) cooldown -= 1
    if ((tick - 1) % stopEvery === 0 && cooldown === 0) {
      shots += 1
      cooldown = interval
    }
  }
  return shots
}

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
    commander.lastDisplacement = 0

    advanceStep7Targeting(state)
    expect(commander.targetId).toBeNull()
    expect(resolveStep9FriendlyAttacks(state)).toEqual([])
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

    // distance 2.0 > MELEE_RANGE 0.75 -> one step of 0.075 toward (28, 16).
    advanceEnemyMovement(state)
    expect(melee.position.x).toBeCloseTo(30 - MELEE_MOVE_SPEED, 12)
    expect(melee.position.y).toBeCloseTo(16, 12)
    expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    // Out of contact range it does not attack, even with a ready cooldown.
    expect(resolveStep10EnemyAttacks(state)).toEqual([])

    // Inside contact range: displacement is exactly 0 and the attack lands.
    melee.position = { x: 28.5, y: 16 }
    advanceEnemyMovement(state)
    expect(melee.position).toEqual({ x: 28.5, y: 16 })
    expect(melee.lastDisplacement).toBe(0)
    expect(resolveStep10EnemyAttacks(state)).toEqual([
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

    advanceStep7Targeting(state)

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

    for (let tick = 1; tick <= 5; tick += 1) advanceStep7Targeting(state)
    // A claim is stable: §1.9 makes retargeting a consequence of NOT holding a slot,
    // so an enemy does not re-optimise every tick and the assignment cannot thrash.
    expect(enemyOf(state, 101).contactSlotOwnerId).toBe(1)
    expect(enemyOf(state, 102).contactSlotOwnerId).toBe(2)

    // 102's target goes down; friendly 1's only contact slot is taken, so 102 falls
    // through to the nearest friendly with no slot at all.
    findFriendly(state, 2)!.life = 'downed'
    advanceStep7Targeting(state)
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
    expect(resolveStep10EnemyAttacks(approach.state)).toEqual([])

    // 3.5 is inside the band: exactly zero displacement, and it fires.
    const hold = shooterAt(31.5, 16)
    advanceEnemyMovement(hold.state)
    expect(hold.shooter.position).toEqual({ x: 31.5, y: 16 })
    expect(hold.shooter.lastDisplacement).toBe(0)
    expect(isEnemyEngaged(hold.state, hold.shooter)).toBe(true)
    expect(resolveStep10EnemyAttacks(hold.state)).toEqual([
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
    expect(resolveStep10EnemyAttacks(retreat.state)).toEqual([])
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

    advanceStep7Targeting(state)
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
    advanceStep7Targeting(state)
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
    soldier.lastDisplacement = 0

    advanceStep7Targeting(state)
    expect(soldier.targetId).toBe(201)

    // Both sides get their attack step on the same tick, from the same positions.
    expect(resolveStep9FriendlyAttacks(state)).toEqual([
      {
        side: 'friendly',
        attackerId: 2,
        targetId: 201,
        amount: SOLDIER_DAMAGE,
        cause: 'friendly-attack',
      },
    ])
    expect(resolveStep10EnemyAttacks(state)).toEqual([])
    expect(isEnemyEngaged(state, shooter)).toBe(false)
  })

  it('loses the advantage as soon as the shooter closes into its band', () => {
    // 4.2 is inside the band [2.7, 4.275] and inside the soldier's 5.0, so both fire.
    const state = fixture({ friendlies: { 2: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(201, 'shooter', { x: 32.2, y: 16 })]
    const soldier = findFriendly(state, 2)!
    soldier.lastDisplacement = 0

    advanceStep7Targeting(state)
    expect(resolveStep9FriendlyAttacks(state)).toHaveLength(1)
    expect(resolveStep10EnemyAttacks(state)).toEqual([
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
    // A melee at MELEE_MOVE_SPEED 0.075 starting 4.6 away has to cover 4.6 - 0.75 = 3.85
    // to reach contact: ceil(3.85 / 0.075) = 52 moving ticks. It stands still on tick 1
    // because step 5 moves toward the target step 7 has not chosen yet (§1.16's declared
    // one-tick lag), so contact lands on tick 53: 4.6 - 52 x 0.075 = 0.700 <= 0.75.
    // The soldier fires on ticks 1, 13, 25, 37, 49 — five shots before the first swing,
    // and that number is the pressure §1.6 describes ("근접형은 접근을 허용하는 순간 이
    // 우위가 무너진다"). Its cooldown is then 12 - 4 = 8.
    const state = fixture({ friendlies: { 2: { x: 28, y: 16 } } })
    state.enemies = [createEnemy(101, 'melee', { x: 32.6, y: 16 })]
    const soldier = findFriendly(state, 2)!
    const melee = enemyOf(state, 101)

    let friendlyShots = 0
    let enemySwings = 0
    let contactTick = 0
    for (let tick = 1; tick <= 60 && enemySwings === 0; tick += 1) {
      soldier.lastDisplacement = 0
      advanceEnemyMovement(state)
      advanceStep6Cooldowns(state)
      advanceStep7Targeting(state)
      friendlyShots += resolveStep9FriendlyAttacks(state).length
      const swings = resolveStep10EnemyAttacks(state).length
      if (swings > 0) {
        enemySwings += swings
        contactTick = tick
      }
    }

    expect(contactTick).toBe(53)
    expect(friendlyShots).toBe(5)
    // still closing at the tick of first contact — the advantage ends because the
    // melee arrives, not because it has stopped.
    expect(melee.lastDisplacement).toBeCloseTo(MELEE_MOVE_SPEED, 12)
    expect(soldier.attackCooldown).toBe(SOLDIER_ATTACK_INTERVAL - 4)
  })
})

describe('batch B ordering and shape', () => {
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
    for (const unit of state.friendlies) unit.lastDisplacement = 0

    advanceStep7Targeting(state)
    const friendly = resolveStep9FriendlyAttacks(state)
    const enemy = resolveStep10EnemyAttacks(state)
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

    advanceStep7Targeting(state)
    expect(enemyOf(state, 101).targetId).toBe(2)
  })

  it('leaves the elite row to §1.12 — it neither retargets nor moves nor contacts', () => {
    const state = fixture()
    state.enemies = [createEnemy(1000, 'elite', { x: 30, y: 16 })]
    state.elite.enemyId = 1000
    const elite = enemyOf(state, 1000)

    advanceStep7Targeting(state)
    advanceEnemyMovement(state)
    expect(elite.targetId).toBeNull()
    expect(elite.position).toEqual({ x: 30, y: 16 })
    expect(resolveStep10EnemyAttacks(state)).toEqual([])
  })
})
