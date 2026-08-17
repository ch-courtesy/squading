// Batch B fixtures: move/fire exclusivity (§1.3), target selection (§1.8) and the
// two enemy classes (§1.9).
//
// Terrain here is hand-authored, never seed-derived (§4.2). Every expected
// coordinate, tick and shot count below is hand-computed from the constants, not
// read back off the implementation.

import { describe, expect, it } from 'vitest'

import type { TerrainRect } from '../../src/core/gameplay/terrain'
import {
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_MOVE_SPEED,
  ENEMY_STUCK_TICKS,
  MELEE_ATTACK_INTERVAL,
  MELEE_DAMAGE,
  MELEE_MOVE_SPEED,
  MELEE_RANGE,
  MOVE_EPSILON,
  SHOOTER_ATTACK_INTERVAL,
  SHOOTER_DAMAGE,
  SHOOTER_MOVE_SPEED,
  SHOOTER_STANDOFF,
} from '../../src/core/battle/constants'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  advanceStep6Cooldowns,
  resolveStep10EnemyAttacks,
  resolveStep9FriendlyAttacks,
} from '../../src/core/battle/attacks'
import { advanceStep7Targeting, selectFriendlyTargetId } from '../../src/core/battle/targeting'
import { advanceEnemyMovement, shooterSightDenied } from '../../src/core/battle/enemy'
import { hasBattleSight } from '../../src/core/battle/sight'
import { hasLineOfSight } from '../../src/core/gameplay/geometry'
import { COMMANDER_ID, createEnemy, createInitialBattleState, findEnemy, findFriendly, sightBlockers } from '../../src/core/battle/state'
import type { BattleState, EnemyUnit, FriendlyUnit } from '../../src/core/battle/types'

const HIGH_BLOCK: TerrainRect = { kind: 'high', x: 10, y: 10, width: 4, height: 4 }

/**
 * A battle with hand-authored terrain and only the named friendlies standing.
 *
 * The other bodies are marked dead rather than moved off-arena: every rule in this
 * batch skips non-standing units, so a dead body cannot silently take a slot, absorb
 * a shot or shift a "nearest" tie.
 */
function fixture(options: {
  high?: TerrainRect[]
  low?: TerrainRect[]
  friendlies?: Record<number, { x: number; y: number }>
}): BattleState {
  const state = createInitialBattleState('seed-a')
  state.terrain.high = options.high ?? []
  state.terrain.low = options.low ?? []

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
    const state = fixture({})
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
    const state = fixture({})
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

  it('lets a unit blocked by terrain fire — the rule judges displacement, not input', () => {
    // (9.99, 12) pushing +x into [10,14) x [10,14): x -> 10.065 is inside and is
    // cancelled, dy is 0, so the actual displacement is exactly 0 (§1.7).
    const state = fixture({ high: [HIGH_BLOCK], friendlies: { [COMMANDER_ID]: { x: 9.99, y: 12 } } })
    state.enemies = [createEnemy(101, 'melee', { x: 6, y: 12 })]
    const commander = commanderOf(state)
    commander.attackCooldown = 1
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(commander.position).toEqual({ x: 9.99, y: 12 })
    expect(commander.lastDisplacement).toBe(0)

    advanceStep6Cooldowns(state)
    expect(commander.attackCooldown).toBe(0)
    advanceStep7Targeting(state)
    expect(resolveStep9FriendlyAttacks(state)).toHaveLength(1)
  })

  it('does not apply to enemies: their cooldown runs while they close', () => {
    const state = fixture({})
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
      const state = fixture({})
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
    const state = fixture({})
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
    const state = fixture({})
    state.enemies = [
      createEnemy(101, 'melee', { x: 30, y: 16 }),
      createEnemy(102, 'melee', { x: 26, y: 16 }),
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('skips a candidate behind cover and takes a further visible one', () => {
    // Low cover [29,31) x [14,18). The commander at (28,16) has:
    //   101 at (32,16) — distance 4, segment crosses the rectangle -> blocked
    //   102 at (28,21) — distance 5, segment runs up x = 28 -> clear
    const low: TerrainRect = { kind: 'low', x: 29, y: 14, width: 2, height: 4 }
    const state = fixture({ low: [low] })
    state.enemies = [
      createEnemy(101, 'melee', { x: 32, y: 16 }),
      createEnemy(102, 'melee', { x: 28, y: 21 }),
    ]
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(102)

    // Same geometry without the cover: the nearer one wins, so the fixture really is
    // testing sight and not distance.
    state.terrain.low = []
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('does not let a rectangle block a segment that starts inside it (§1.6)', () => {
    // The commander stands INSIDE low cover [29,31) x [14,18) and shoots out; §1.6
    // exempts a rectangle that contains an endpoint. Raw `hasLineOfSight` does NOT
    // implement that exemption, which is why this batch owns `hasBattleSight`.
    const low: TerrainRect = { kind: 'low', x: 29, y: 14, width: 2, height: 4 }
    const state = fixture({ low: [low], friendlies: { [COMMANDER_ID]: { x: 30, y: 16 } } })
    state.enemies = [createEnemy(101, 'melee', { x: 34, y: 16 })]

    expect(hasLineOfSight(30, 16, 34, 16, sightBlockers(state))).toBe(false)
    expect(hasBattleSight(30, 16, 34, 16, sightBlockers(state))).toBe(true)
    expect(selectFriendlyTargetId(state, commanderOf(state))).toBe(101)
  })

  it('spends nothing when there is no candidate', () => {
    const state = fixture({})
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
    const state = fixture({})
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
    const state = fixture({})
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
    expect(hold.shooter.zeroDisplacementTicks).toBe(0)
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

  it('applies sliding to the retreat (§1.9), and a blocked retreat counts as stuck', () => {
    // Friendly at (15.55, 12), shooter at (14.05, 12): distance 1.5 < 2.7, so the
    // shooter retreats along -x to 13.99 — inside [10,14) x [10,14), so §1.7 cancels
    // the x component. dy is 0, so the net displacement is exactly 0. Unlike a
    // deliberate hold this DOES advance the stuck counter: the shooter wanted to move.
    const state = fixture({
      high: [HIGH_BLOCK],
      friendlies: { [COMMANDER_ID]: { x: 15.55, y: 12 } },
    })
    state.enemies = [createEnemy(201, 'shooter', { x: 14.05, y: 12 })]
    const shooter = enemyOf(state, 201)
    shooter.targetId = COMMANDER_ID
    shooter.contactSlotOwnerId = COMMANDER_ID

    advanceEnemyMovement(state)
    expect(shooter.position).toEqual({ x: 14.05, y: 12 })
    expect(shooter.lastDisplacement).toBe(0)
    expect(shooter.zeroDisplacementTicks).toBe(1)

    // Away from the wall the same retreat is a clean 0.06 step along -x.
    shooter.position = { x: 16.5, y: 12 }
    findFriendly(state, COMMANDER_ID)!.position = { x: 18, y: 12 }
    advanceEnemyMovement(state)
    expect(shooter.position.x).toBeCloseTo(16.44, 12)
    expect(shooter.zeroDisplacementTicks).toBe(0)
  })

  it('orbits the shorter way when sight is lost, and does not fire', () => {
    // Target at (28, 16), shooter at (31.5, 16): distance 3.5, inside the band.
    // Low cover [29.5, 30.5) x [15.9, 17.9) blocks the straight segment. Its lower
    // edge is 0.1 below the sight line and its upper edge is 1.9 above it, so the
    // shorter arc to sight is clockwise (-y). One 5-degree probe clears it: at
    // -5 degrees the segment reaches y = 16 - 1.5*tan(5) = 15.869 at x = 29.5, below
    // the rectangle; at +5 degrees it is still inside it.
    const low: TerrainRect = { kind: 'low', x: 29.5, y: 15.9, width: 1, height: 2 }
    const state = fixture({ low: [low] })
    state.enemies = [createEnemy(201, 'shooter', { x: 31.5, y: 16 })]
    const shooter = enemyOf(state, 201)
    shooter.targetId = COMMANDER_ID
    shooter.contactSlotOwnerId = COMMANDER_ID

    expect(hasBattleSight(31.5, 16, 28, 16, sightBlockers(state))).toBe(false)
    expect(shooterSightDenied(state, shooter)).toBe(true)

    // Radial is (+x); the clockwise tangent is (0, -1) and the whole move speed goes
    // into it (§1.9), so the step is straight down by 0.06.
    advanceEnemyMovement(state)
    expect(shooter.position.x).toBeCloseTo(31.5, 12)
    expect(shooter.position.y).toBeCloseTo(16 - SHOOTER_MOVE_SPEED, 12)
    expect(resolveStep10EnemyAttacks(state)).toEqual([])
  })

  it('orbits the other way when the cover is mirrored', () => {
    // Same rectangle reflected about y = 16: [29.5, 30.5) x [14.1, 16.1). Now the
    // short arc is counter-clockwise (+y).
    const low: TerrainRect = { kind: 'low', x: 29.5, y: 14.1, width: 1, height: 2 }
    const state = fixture({ low: [low] })
    state.enemies = [createEnemy(201, 'shooter', { x: 31.5, y: 16 })]
    const shooter = enemyOf(state, 201)
    shooter.targetId = COMMANDER_ID
    shooter.contactSlotOwnerId = COMMANDER_ID

    expect(hasBattleSight(31.5, 16, 28, 16, sightBlockers(state))).toBe(false)
    advanceEnemyMovement(state)
    expect(shooter.position.x).toBeCloseTo(31.5, 12)
    expect(shooter.position.y).toBeCloseTo(16 + SHOOTER_MOVE_SPEED, 12)
  })

  it('resolves a symmetric wall counter-clockwise', () => {
    // Low cover [29.5, 30.5) x [15.5, 16.5) is symmetric about the sight line, so both
    // arcs to sight are the same length: 1.5*tan(angle) must exceed 0.5, i.e. 18.44
    // degrees, which the 5-degree probe first clears at step 4 (20 degrees) on BOTH
    // sides at once. §1.9 does not name a tie-break, so this pins the one we chose.
    const low: TerrainRect = { kind: 'low', x: 29.5, y: 15.5, width: 1, height: 1 }
    const state = fixture({ low: [low] })
    state.enemies = [createEnemy(201, 'shooter', { x: 31.5, y: 16 })]
    const shooter = enemyOf(state, 201)
    shooter.targetId = COMMANDER_ID
    shooter.contactSlotOwnerId = COMMANDER_ID

    expect(hasBattleSight(31.5, 16, 28, 16, sightBlockers(state))).toBe(false)
    advanceEnemyMovement(state)
    expect(shooter.position.y).toBeCloseTo(16 + SHOOTER_MOVE_SPEED, 12)
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
    const state = fixture({})
    state.enemies = [
      createEnemy(101, 'melee', { x: 28, y: 20 }),
      createEnemy(201, 'shooter', { x: 28, y: 20 }),
      createEnemy(202, 'shooter', { x: 28, y: 20 }),
    ]
    advanceStep7Targeting(state)
    expect(state.enemies.map((enemy) => enemy.contactSlotOwnerId)).toEqual([1, 1, 1])
  })
})

describe('§1.7 stuck retarget', () => {
  it('retargets after 30 zero-displacement ticks and excludes the target it gave up', () => {
    // Melee at (9.99, 12) pursuing friendly 1 at (20, 12) through [10,14) x [10,14):
    // x -> 10.065 is inside and is cancelled, dy is 0, so every tick nets exactly 0.
    const state = fixture({
      high: [HIGH_BLOCK],
      friendlies: { [COMMANDER_ID]: { x: 20, y: 12 }, 2: { x: 9, y: 20 } },
    })
    state.enemies = [createEnemy(101, 'melee', { x: 9.99, y: 12 })]
    const melee = enemyOf(state, 101)
    melee.targetId = COMMANDER_ID
    melee.contactSlotOwnerId = COMMANDER_ID

    for (let tick = 1; tick <= ENEMY_STUCK_TICKS; tick += 1) {
      advanceEnemyMovement(state)
      expect(melee.lastDisplacement).toBe(0)
      expect(melee.zeroDisplacementTicks).toBe(tick)
      if (tick < ENEMY_STUCK_TICKS) {
        advanceStep7Targeting(state)
        expect(melee.targetId).toBe(COMMANDER_ID)
        expect(melee.excludedTargetId).toBeNull()
      }
    }

    advanceStep7Targeting(state)
    expect(melee.excludedTargetId).toBe(COMMANDER_ID)
    expect(melee.targetId).toBe(2)
    expect(melee.contactSlotOwnerId).toBe(2)
    // Reset, or the retarget would fire again on every following tick.
    expect(melee.zeroDisplacementTicks).toBe(0)
  })

  it('does not count a deliberate hold as being stuck', () => {
    // A melee sitting at contact range and a shooter holding inside the band both
    // have displacement 0 by design (§1.9). Charging that against §1.7 would make a
    // shooter dump its target every 30 ticks — every attack interval.
    const state = fixture({})
    state.enemies = [
      createEnemy(101, 'melee', { x: 28.5, y: 16 }),
      createEnemy(201, 'shooter', { x: 31.5, y: 16 }),
    ]
    for (const enemy of state.enemies) {
      enemy.targetId = COMMANDER_ID
      enemy.contactSlotOwnerId = COMMANDER_ID
    }

    for (let tick = 1; tick <= ENEMY_STUCK_TICKS + 5; tick += 1) {
      advanceEnemyMovement(state)
      advanceStep7Targeting(state)
    }
    for (const enemy of state.enemies) {
      expect(enemy.lastDisplacement).toBe(0)
      expect(enemy.zeroDisplacementTicks).toBe(0)
      expect(enemy.targetId).toBe(COMMANDER_ID)
      expect(enemy.excludedTargetId).toBeNull()
    }
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
    const state = fixture({})
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
