// Batch D fixtures, part 1: §1.12 the elite.
//
// Every tick and every coordinate in here is hand-computed from §1.1/§1.2/§1.12 and the
// placeholder constants, never read off the implementation:
//
//   arrival    tick 1800, `SPAWN_RADIUS = 13` from the command unit on ONE `spawn` draw. For
//              `seed-a` that draw is `0.671090...`, so the angle is `4.216585...` rad and the
//              offset is `(-6.184599, -11.434628)`.
//   telegraph  starts on the tick the elite is idle, impacts `ELITE_TELEGRAPH_TICKS = 54`
//              ticks later, then `ELITE_COOLDOWN_TICKS = 56` of cooldown: a 110-tick cycle,
//              so an elite that arrives at 1800 impacts at 1854, 1964, 2074, ...
//   dodge      54 ticks x commander `0.115` = `6.21` of travel against a blast radius of
//              `2.4` and a formation that reaches `hypot(2.2, 1.1) = 2.4596` behind the
//              command unit. `6.21 - 2.4596 = 3.7504 > 2.4`, which is the arithmetic §1.12
//              claims when it puts a dodge inside the telegraph.

import { describe, expect, it } from 'vitest'

import {
  COMBAT_TICK_LIMIT,
  COMMANDER_HP,
  COMMANDER_MOVE_SPEED,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import { applyDamage } from '../../src/core/battle/damage'
import {
  advanceCooldowns,
  resolveEnemyAttacks,
  resolveFriendlyAttacks,
} from '../../src/core/battle/attacks'
import { digestBattleState } from '../../src/core/battle/digest'
import { advanceRescueProgress } from '../../src/core/battle/rescue'
import {
  chooseUpgradeCard,
  pendingUpgradeRound,
  resolveKillAccounting,
} from '../../src/core/battle/upgrades'
import {
  advanceAllEnemyMovement,
  advanceEliteMovement,
  resolveEliteArrival,
  resolveEliteCycle,
  resolveEnemyArrivals,
} from '../../src/core/battle/elite'
import { FORMATION_MAX_SLOT_RADIUS } from '../../src/core/battle/formation'
import { advanceCommandUnit, advanceMovement, clampToArena } from '../../src/core/battle/movement'
import { resolveBattleOutcome } from '../../src/core/battle/outcome'
import { engagedEnemyCount, liveEnemyCount } from '../../src/core/battle/spawn'
import {
  COMMANDER_ID,
  ELITE_ID,
  createEnemy,
  createInitialBattleState,
  eliteEnemy,
  findFriendly,
} from '../../src/core/battle/state'
import { createStreamStates, nextStreamRange } from '../../src/core/battle/streams'
import { advanceFriendlyTargeting, advanceTargeting } from '../../src/core/battle/targeting'
import { resolveTransitions, type TransitionOutcome } from '../../src/core/battle/transitions'
import type { BattleState, EnemyUnit, FriendlyUnit } from '../../src/core/battle/types'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  absoluteEnemyCap: ABSOLUTE_ENEMY_CAP,
  eliteApproachRange: ELITE_APPROACH_RANGE,
  eliteBlastRadius: ELITE_BLAST_RADIUS,
  eliteCooldownTicks: ELITE_COOLDOWN_TICKS,
  eliteDamage: ELITE_DAMAGE,
  eliteHp: ELITE_HP,
  eliteMoveSpeed: ELITE_MOVE_SPEED,
  eliteSpawnTick: ELITE_SPAWN_TICK,
  eliteTelegraphTicks: ELITE_TELEGRAPH_TICKS,
  spawnRadius: SPAWN_RADIUS,
} = stageConfigOf(1)

const TAU = Math.PI * 2

function fixture(tick = ELITE_SPAWN_TICK, seed = 'seed-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  state.combatTick = tick
  return state
}

/** The elite already on the board, so the cycle can be exercised without the arrival. */
function withElite(position = { x: 40, y: 16 }, tick = ELITE_SPAWN_TICK): BattleState {
  const state = fixture(tick)
  state.enemies.push(createEnemy(state, ELITE_ID, 'elite', position))
  state.elite.enemyId = ELITE_ID
  state.elite.spawnTick = tick
  return state
}

function unit(state: BattleState, id: number): FriendlyUnit {
  const found = findFriendly(state, id)
  if (!found) throw new Error(`fixture has no friendly ${id}`)
  return found
}

function elite(state: BattleState): EnemyUnit {
  const found = eliteEnemy(state)
  if (!found) throw new Error('fixture has no elite')
  return found
}

/** The first `count` `spawn` angles of a seed, drawn from an independent stream. */
function spawnAngles(count: number, seed = 'seed-a'): number[] {
  const states = createStreamStates(seed)
  return Array.from({ length: count }, () => nextStreamRange(states, 'spawn', 0, TAU))
}

function transitionOutcome(overrides: Partial<TransitionOutcome> = {}): TransitionOutcome {
  return {
    enemyDeaths: [],
    friendlyDowns: [],
    friendlyDeaths: [],
    previousCommandUnitId: COMMANDER_ID,
    commandUnitId: COMMANDER_ID,
    commandUnitChanged: false,
    allUnitsLost: false,
    ...overrides,
  }
}

describe('§1.12 elite arrival', () => {
  it('arrives at tick 1800 at SPAWN_RADIUS from the command unit on exactly one spawn draw', () => {
    const state = fixture()
    const [angle] = spawnAngles(1)
    const expected = {
      x: 28 + Math.cos(angle) * SPAWN_RADIUS,
      y: 16 + Math.sin(angle) * SPAWN_RADIUS,
    }

    resolveEliteArrival(state)

    const body = elite(state)
    expect(body.id).toBe(ELITE_ID)
    expect(body.kind).toBe('elite')
    expect(body.hp).toBe(ELITE_HP)
    expect(body.maxHp).toBe(ELITE_HP)
    expect(body.life).toBe('standing')
    // Hand-computed from `seed-a:spawn`'s first float, 0.671090...
    expect(body.position.x).toBeCloseTo(28 - 6.1845991, 6)
    expect(body.position.y).toBeCloseTo(16 - 11.4346287, 6)
    expect(body.position.x).toBeCloseTo(expected.x, 12)
    expect(body.position.y).toBeCloseTo(expected.y, 12)
    expect(Math.hypot(body.position.x - 28, body.position.y - 16)).toBeCloseTo(SPAWN_RADIUS, 9)

    expect(state.elite.enemyId).toBe(ELITE_ID)
    expect(state.elite.spawnTick).toBe(ELITE_SPAWN_TICK)
    // Exactly one draw, on the `spawn` stream and nothing else.
    const reference = createStreamStates('seed-a')
    nextStreamRange(reference, 'spawn', 0, TAU)
    expect(state.prng.spawn).toBe(reference.spawn)
    expect(state.prng.cards).toBe(reference.cards)
    expect(state.prng.names).toBe(createInitialBattleState('seed-a').prng.names)
  })

  it('does not arrive before its tick and does not touch the stream', () => {
    const state = fixture(ELITE_SPAWN_TICK - 1)
    const before = { ...state.prng }

    resolveEliteArrival(state)

    expect(state.enemies).toEqual([])
    expect(state.elite.enemyId).toBeNull()
    expect(state.elite.spawnTick).toBeNull()
    expect(state.prng).toEqual(before)
  })

  it('arrives once — a second call adds no body and burns no draw', () => {
    const state = fixture()
    resolveEliteArrival(state)
    const after = { ...state.prng }

    resolveEliteArrival(state)

    expect(state.enemies.filter((enemy) => enemy.kind === 'elite')).toHaveLength(1)
    expect(state.prng).toEqual(after)
  })

  it('clamps the arrival into the arena (§1.7), the only adjustment a coordinate gets', () => {
    const state = fixture()
    unit(state, COMMANDER_ID).position = { x: 3, y: 3 }
    const [angle] = spawnAngles(1)

    resolveEliteArrival(state)

    // 3 - 6.184599 < 0 and 3 - 11.434628 < 0: both axes clamp.
    expect(elite(state).position).toEqual(
      clampToArena(state, 3 + Math.cos(angle) * SPAWN_RADIUS, 3 + Math.sin(angle) * SPAWN_RADIUS),
    )
    expect(elite(state).position).toEqual({ x: 0, y: 0 })
  })

  it('arrives after the spawn request of the same tick, which fixes the draw order', () => {
    const state = fixture()
    const [first, second] = spawnAngles(2)

    resolveEnemyArrivals(state)

    // Tick 1800 is a phase boundary with `lastRequestTick = -1`, so the phase's first request
    // goes out on this tick and takes the FIRST angle; the elite takes the second.
    const spawned = state.enemies.find((enemy) => enemy.kind !== 'elite')
    expect(spawned?.id).toBe(101)
    expect(spawned?.position.x).toBeCloseTo(28 + Math.cos(first) * SPAWN_RADIUS, 12)
    expect(spawned?.position.y).toBeCloseTo(16 + Math.sin(first) * SPAWN_RADIUS, 12)
    expect(elite(state).position.x).toBeCloseTo(28 + Math.cos(second) * SPAWN_RADIUS, 12)
    expect(elite(state).position.y).toBeCloseTo(16 + Math.sin(second) * SPAWN_RADIUS, 12)
  })

  it('arrives even at the absolute enemy cap — §1.10 caps requests, not the elite', () => {
    const state = fixture()
    for (let index = 0; index < ABSOLUTE_ENEMY_CAP; index += 1) {
      state.enemies.push(createEnemy(state, 101 + index, 'melee', { x: 50, y: 30 }))
    }

    resolveEliteArrival(state)

    expect(elite(state).life).toBe('standing')
    // §1.10: "정예도 두 상한에 함께 센다" — it counts towards both, which is what pushes the
    // ordinary supply over the line, not something that keeps the elite off the board.
    expect(liveEnemyCount(state)).toBe(ABSOLUTE_ENEMY_CAP + 1)
  })

  it('counts towards the engaged cap population once it is inside ENGAGE_RADIUS', () => {
    const state = withElite({ x: 30, y: 16 })
    expect(engagedEnemyCount(state)).toBe(1)
    expect(liveEnemyCount(state)).toBe(1)
  })
})

describe('§1.12 elite movement', () => {
  it('closes on the command unit at ELITE_MOVE_SPEED', () => {
    const state = withElite({ x: 38, y: 16 })

    advanceEliteMovement(state)

    expect(elite(state).position.x).toBeCloseTo(38 - ELITE_MOVE_SPEED, 12)
    expect(elite(state).position.y).toBeCloseTo(16, 12)
    expect(elite(state).lastDisplacement).toBeCloseTo(ELITE_MOVE_SPEED, 12)
  })

  it('stops exactly at ELITE_APPROACH_RANGE instead of overshooting into it', () => {
    // 4.55 away, so the remaining approach (0.05) is shorter than one step (0.1).
    const state = withElite({ x: 28 + ELITE_APPROACH_RANGE + 0.05, y: 16 })

    advanceEliteMovement(state)

    expect(elite(state).position.x).toBeCloseTo(28 + ELITE_APPROACH_RANGE, 12)
    expect(elite(state).lastDisplacement).toBeCloseTo(0.05, 12)
  })

  it('holds still once it is at or inside the approach range, and never retreats', () => {
    const state = withElite({ x: 28 + ELITE_APPROACH_RANGE - 0.5, y: 16 })

    advanceEliteMovement(state)

    expect(elite(state).position).toEqual({ x: 28 + ELITE_APPROACH_RANGE - 0.5, y: 16 })
    expect(elite(state).lastDisplacement).toBe(0)
  })

  it('holds still when there is no standing command unit to close on', () => {
    const state = withElite({ x: 38, y: 16 })
    for (const body of state.friendlies) {
      body.life = 'downed'
      body.hp = 0
    }

    advanceEliteMovement(state)

    expect(elite(state).position).toEqual({ x: 38, y: 16 })
    expect(elite(state).lastDisplacement).toBe(0)
  })

  it('parks inside the squad\'s reach, which is why §1.12 caps the approach below 5.0', () => {
    // §1.12: "ELITE_APPROACH_RANGE < 병사 사거리 5.0" exists so the squad can answer back — a
    // unit that has to close cannot fire while closing (§1.3). With the elite settled at 4.5
    // on the +x axis, hand-computing every slot against soldier range 5.0 gives:
    //   in  (0,-1.1) 4.632  (1.1,-1.1) 3.573  (2.2,-1.1) 2.549
    //       (1.1, 0) 3.4    (2.2, 0)   2.3
    //       (0, 1.1) 4.632  (1.1, 1.1) 3.573  (2.2, 1.1) 2.549
    //   out (-2.2,*) 6.79/6.7  (-1.1,*) 5.707/5.6  (0, 2.2) 5.00899
    // so 8 of the 15 soldiers plus the commander (range 6.0) have it in range.
    expect(ELITE_APPROACH_RANGE).toBeLessThan(SOLDIER_RANGE)
    const state = withElite({ x: 28 + ELITE_APPROACH_RANGE, y: 16 })

    advanceFriendlyTargeting(state)

    const answering = state.friendlies.filter((body) => body.targetId === ELITE_ID)
    expect(answering.map((body) => body.id)).toEqual([1, 4, 5, 6, 9, 10, 13, 14, 15])
    expect(answering).toHaveLength(9)
    // The tail slot at (0, 2.2) is sqrt(4.5^2 + 2.2^2) = sqrt(25.09) = 5.00899 away — just
    // outside 5.0, and the pin that this count is geometry rather than a coincidence.
    expect(Math.hypot(ELITE_APPROACH_RANGE, 2.2)).toBeCloseTo(5.008992, 6)
    expect(Math.hypot(ELITE_APPROACH_RANGE, 2.2)).toBeGreaterThan(SOLDIER_RANGE)
    expect(unit(state, 16).targetId).toBeNull()
  })
})

describe('§1.12 telegraph, impact, cooldown', () => {
  it('starts the telegraph on the command unit\'s position and keeps it frozen there', () => {
    const state = withElite()
    state.input.move = { x: 1, y: 0 }

    expect(resolveEliteCycle(state)).toEqual([])
    expect(state.elite.attackPhase).toBe('telegraph')
    expect(state.elite.telegraphRemaining).toBe(ELITE_TELEGRAPH_TICKS)
    expect(state.elite.telegraphCenter).toEqual({ x: 28, y: 16 })

    // The command unit walks away for the whole telegraph. The centre must not follow it.
    for (let step = 1; step < ELITE_TELEGRAPH_TICKS; step += 1) {
      advanceCommandUnit(state)
      advanceMovement(state, advanceAllEnemyMovement)
      expect(resolveEliteCycle(state)).toEqual([])
      expect(state.elite.telegraphCenter).toEqual({ x: 28, y: 16 })
      expect(state.elite.telegraphRemaining).toBe(ELITE_TELEGRAPH_TICKS - step)
    }

    expect(unit(state, COMMANDER_ID).position.x).toBeCloseTo(28 + 53 * COMMANDER_MOVE_SPEED, 9)
  })

  it('impacts exactly ELITE_TELEGRAPH_TICKS after the telegraph started, then cools down', () => {
    const state = withElite()

    resolveEliteCycle(state)
    for (let step = 1; step < ELITE_TELEGRAPH_TICKS; step += 1) {
      expect(resolveEliteCycle(state)).toEqual([])
    }
    const impact = resolveEliteCycle(state)

    expect(impact.length).toBeGreaterThan(0)
    expect(state.elite.attackPhase).toBe('cooldown')
    expect(state.elite.cooldownRemaining).toBe(ELITE_COOLDOWN_TICKS)
    expect(state.elite.telegraphCenter).toBeNull()
    expect(state.elite.telegraphRemaining).toBe(0)

    // The cooldown runs out and the next telegraph starts in the same tick, so the cycle is
    // exactly 54 + 56 = 110 ticks: an elite that arrives at 1800 impacts at 1854 and 1964.
    for (let step = 1; step < ELITE_COOLDOWN_TICKS; step += 1) {
      expect(resolveEliteCycle(state)).toEqual([])
      expect(state.elite.attackPhase).toBe('cooldown')
    }
    expect(resolveEliteCycle(state)).toEqual([])
    expect(state.elite.attackPhase).toBe('telegraph')
    expect(state.elite.telegraphRemaining).toBe(ELITE_TELEGRAPH_TICKS)
  })

  it('lands the whole cycle on the ticks §1.12 predicts, counted from tick 1800', () => {
    const state = withElite()
    const impacts: number[] = []

    // The elite arrives on 1800 and the cycle is composed at its step every tick after.
    for (let tick = ELITE_SPAWN_TICK; tick <= ELITE_SPAWN_TICK + 280; tick += 1) {
      state.combatTick = tick
      if (resolveEliteCycle(state).length > 0) impacts.push(tick)
    }

    expect(impacts).toEqual([1854, 1964, 2074])
  })

  it('hits every standing body inside the blast radius and nothing outside it', () => {
    const state = withElite()

    resolveEliteCycle(state)
    let events = resolveEliteCycle(state)
    for (let step = 2; step <= ELITE_TELEGRAPH_TICKS; step += 1) events = resolveEliteCycle(state)

    // Nobody moved, so the centre is the command unit and the hit set is the slots within
    // 2.4 of it: the four corners (hypot(2.2, 1.1) = 2.4596) and the (±2.2, ±1.1) row ends
    // are out, everything else is in.
    expect(events.map((event) => event.targetId)).toEqual([1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 16])
    expect(events.every((event) => event.side === 'enemy')).toBe(true)
    expect(events.every((event) => event.cause === 'elite-blast')).toBe(true)
    expect(events.every((event) => event.attackerId === ELITE_ID)).toBe(true)
    expect(events.every((event) => event.amount === ELITE_DAMAGE)).toBe(true)

    const outcome = applyDamage(state, events)
    expect(unit(state, COMMANDER_ID).hp).toBeCloseTo(COMMANDER_HP - ELITE_DAMAGE, 12)
    expect(outcome.damageToFriendlies).toBeCloseTo(ELITE_DAMAGE * 12, 12)
    // The corner slots (ids 2, 6, 11, 15) are outside by 0.0596.
    expect(unit(state, 2).hp).toBe(unit(state, 2).maxHp)
    expect(Math.hypot(2.2, 1.1)).toBeCloseTo(2.459675, 6)
    expect(Math.hypot(2.2, 1.1)).toBeGreaterThan(ELITE_BLAST_RADIUS)
  })

  it('includes a body exactly on the edge of the circle, like every other range test', () => {
    const state = withElite()
    // The command unit stands on the origin so that the distance is the literal `2.4` rather
    // than `(28 + 2.4) - 28`, which binary floating point puts a hair under it.
    unit(state, COMMANDER_ID).position = { x: 0, y: 0 }
    const edge = unit(state, 2)
    edge.position = { x: 0, y: ELITE_BLAST_RADIUS }
    const outside = unit(state, 6)
    outside.position = { x: 0, y: ELITE_BLAST_RADIUS + 0.000001 }
    expect(Math.hypot(0, ELITE_BLAST_RADIUS)).toBe(ELITE_BLAST_RADIUS)

    resolveEliteCycle(state)
    let events: ReturnType<typeof resolveEliteCycle> = []
    for (let step = 1; step <= ELITE_TELEGRAPH_TICKS; step += 1) events = resolveEliteCycle(state)

    expect(events.map((event) => event.targetId)).toContain(2)
    expect(events.map((event) => event.targetId)).not.toContain(6)
  })

  it('hits a body that walked INTO the circle after the telegraph started', () => {
    const state = withElite()
    const walker = unit(state, 2)
    // Slot (-2.2, -1.1) is 2.4596 from the command unit: outside the blast at telegraph start.
    expect(Math.hypot(walker.position.x - 28, walker.position.y - 16)).toBeGreaterThan(
      ELITE_BLAST_RADIUS,
    )

    resolveEliteCycle(state)
    expect(state.elite.telegraphCenter).toEqual({ x: 28, y: 16 })
    // It drifts in while the telegraph runs. The impact is resolved against positions at
    // IMPACT time, not at telegraph time.
    walker.position = { x: 26, y: 16 }

    let events: ReturnType<typeof resolveEliteCycle> = []
    for (let step = 1; step <= ELITE_TELEGRAPH_TICKS; step += 1) events = resolveEliteCycle(state)

    expect(events.map((event) => event.targetId)).toContain(2)
  })

  it('does not hit a downed body — §1.12 gives the blast no rule for finishing one off', () => {
    const state = withElite()
    const fallen = unit(state, 3)
    fallen.life = 'downed'
    fallen.hp = 0

    resolveEliteCycle(state)
    let events: ReturnType<typeof resolveEliteCycle> = []
    for (let step = 1; step <= ELITE_TELEGRAPH_TICKS; step += 1) events = resolveEliteCycle(state)

    // Slot (-1.1, -1.1) is 1.5556 from the centre, so it is well inside the circle.
    expect(Math.hypot(fallen.position.x - 28, fallen.position.y - 16)).toBeLessThan(
      ELITE_BLAST_RADIUS,
    )
    expect(events.map((event) => event.targetId)).not.toContain(3)
    expect(events.map((event) => event.targetId)).toContain(4)
  })

  it('gives the formation room to clear the blast at commander speed (§1.12 arithmetic)', () => {
    // The claim, as arithmetic: one telegraph of travel minus the formation's own radius
    // still clears the blast, for the commander AND for a promoted soldier.
    expect(ELITE_TELEGRAPH_TICKS * COMMANDER_MOVE_SPEED).toBeCloseTo(6.21, 9)
    expect(FORMATION_MAX_SLOT_RADIUS).toBeCloseTo(2.459675, 6)
    expect(ELITE_TELEGRAPH_TICKS * COMMANDER_MOVE_SPEED - FORMATION_MAX_SLOT_RADIUS).toBeGreaterThan(
      ELITE_BLAST_RADIUS,
    )
    expect(ELITE_TELEGRAPH_TICKS * SOLDIER_MOVE_SPEED - FORMATION_MAX_SLOT_RADIUS).toBeGreaterThan(
      ELITE_BLAST_RADIUS,
    )

    // And as a run: hold one direction from the telegraph's first tick and the whole squad
    // is out of the circle when it lands.
    const state = withElite()
    state.input.move = { x: 1, y: 0 }
    resolveEliteCycle(state)

    let events: ReturnType<typeof resolveEliteCycle> = []
    for (let step = 1; step <= ELITE_TELEGRAPH_TICKS; step += 1) {
      advanceCommandUnit(state)
      advanceMovement(state, advanceAllEnemyMovement)
      events = resolveEliteCycle(state)
    }

    expect(events).toEqual([])
    const command = unit(state, 1)
    // The command unit's half is pure §1.12 arithmetic and §1.4.1 does not touch it:
    // 54 x 0.115 = 6.21 of travel, from a body the player drives and nothing else moves.
    expect(command.position.x - 28).toBeCloseTo(6.21, 9)

    const distances = state.friendlies
      .filter((body) => body.life === 'standing')
      .map((body) => Math.hypot(body.position.x - 28, body.position.y - 16))
    expect(Math.min(...distances)).toBeGreaterThan(ELITE_BLAST_RADIUS)

    // WHAT §1.4.1 TOOK AWAY FROM THIS FIXTURE. It used to read "the trailing slot (-2.2, 0) is
    // therefore 4.01 from the centre, which is the closest body on the board" — a derivation
    // that was true only while the fifteen were pinned to their slots. They are not any more:
    // the elite crosses into `LEASH_RADIUS` on its way in, the soldiers position against IT,
    // and where the closest body ends up is a function of the elite's approach rather than of
    // the slot table. So the number below is MEASURED at these placeholder values, not derived,
    // and it is here to notice a change rather than to justify one. The claim the fixture
    // exists for is the line above it, and that one is still derived: nobody is in the circle.
    expect(Math.min(...distances)).toBeCloseTo(3.525, 6)

    // And the reason it moved, asserted rather than assumed: the squad is off its slots.
    const trailing = unit(state, 2)
    const itsSlot = { x: command.position.x - 2.2, y: command.position.y - 1.1 }
    expect(
      Math.hypot(trailing.position.x - itsSlot.x, trailing.position.y - itsSlot.y),
    ).toBeGreaterThan(0.1)
  })

  it('deals no contact damage, at any distance', () => {
    const state = withElite({ x: 28.1, y: 16 })

    expect(resolveEnemyAttacks(state)).toEqual([])
    expect(elite(state).attackCooldown).toBe(0)
    // Its only damage is the blast, and that one is on the telegraph clock.
    expect(resolveEliteCycle(state)).toEqual([])
  })

  it('freezes the cycle while there is no standing command unit to aim at', () => {
    const state = withElite()
    for (const body of state.friendlies) {
      body.life = 'downed'
      body.hp = 0
    }

    expect(resolveEliteCycle(state)).toEqual([])
    expect(state.elite.attackPhase).toBe('idle')
    expect(state.elite.telegraphCenter).toBeNull()
  })
})

describe('§1.12 the elite dying mid-telegraph', () => {
  it('leaves no orphaned cycle state and never lands the impact', () => {
    const state = withElite()
    resolveEliteCycle(state)
    for (let step = 1; step <= ELITE_TELEGRAPH_TICKS - 1; step += 1) resolveEliteCycle(state)
    expect(state.elite.attackPhase).toBe('telegraph')
    expect(state.elite.telegraphRemaining).toBe(1)

    elite(state).hp = 0
    const outcome = resolveTransitions(state)

    expect(outcome.enemyDeaths).toEqual([{ id: ELITE_ID, kind: 'elite' }])
    expect(elite(state).life).toBe('dead')
    // The lifecycle record survives (§1.17 wants the arrival in the digest); the cycle does not.
    expect(state.elite).toEqual({
      enemyId: ELITE_ID,
      spawnTick: ELITE_SPAWN_TICK,
      attackPhase: 'idle',
      telegraphCenter: null,
      telegraphRemaining: 0,
      cooldownRemaining: 0,
    })

    // The impact that was one tick away never lands, and no new telegraph starts.
    expect(resolveEliteCycle(state)).toEqual([])
    expect(state.elite.attackPhase).toBe('idle')
    expect(unit(state, COMMANDER_ID).hp).toBe(COMMANDER_HP)
  })

  it('delivers the impact of the tick it dies on, because its cycle runs before the damage', () => {
    const state = withElite()
    resolveEliteCycle(state)
    for (let step = 1; step < ELITE_TELEGRAPH_TICKS; step += 1) resolveEliteCycle(state)

    const events = resolveEliteCycle(state)
    expect(events.length).toBeGreaterThan(0)

    // It was alive when it fired; the shots that kill it land in the same tick's damage step.
    elite(state).hp = 0
    resolveTransitions(state)
    expect(state.elite.attackPhase).toBe('idle')
    expect(state.elite.cooldownRemaining).toBe(0)
  })
})

describe('batch D adds no state and stays deterministic', () => {
  it('leaves every key-set pin from batch A exactly where it was', () => {
    // The digest walks the whole object (§1.17), so a field added for the elite or for the
    // upgrades would silently invalidate every recorded run. Batch D adds none: the elite cycle
    // and the card record were already in the shape batch A pinned, and every card effect is
    // DERIVED from `upgrades.rounds[].chosen` at the point of use.
    const state = fixture()
    resolveEnemyArrivals(state)
    resolveEliteCycle(state)
    resolveKillAccounting(state, transitionOutcome({ enemyDeaths: [{ id: 101, kind: 'melee' }] }))
    state.stats.kills = 999
    resolveKillAccounting(state, transitionOutcome({ enemyDeaths: [{ id: 102, kind: 'melee' }] }))
    chooseUpgradeCard(state, state.upgrades.rounds[0].offered[0])

    expect(Object.keys(state).sort()).toEqual(
      Object.keys(createInitialBattleState('seed-a')).sort(),
    )
    expect(Object.keys(state.elite).sort()).toEqual(
      ['enemyId', 'spawnTick', 'attackPhase', 'telegraphCenter', 'telegraphRemaining', 'cooldownRemaining'].sort(),
    )
    expect(Object.keys(state.upgrades).sort()).toEqual(
      ['remainingPool', 'rounds', 'nextThresholdIndex'].sort(),
    )
    expect(Object.keys(state.enemies[0]).sort()).toEqual(
      Object.keys(createEnemy(state, 101, 'melee', { x: 0, y: 0 })).sort(),
    )
  })

  it('runs a whole 90-second battle through the composed step order, twice, identically', () => {
    // §4.1's `tactical-no-input`: no movement and no rescue, only the upgrade choice. It is the
    // one policy with no player model in it, so it is the cleanest end-to-end check that the
    // batch-D steps compose — the elite arrives at 1800 on top of live spawning, its cycle runs
    // against a squad that is falling, and the verdict lands.
    const play = (seed: string): BattleState => {
      const state = createInitialBattleState(seed)
      state.mode = 'running'

      while (state.mode === 'running') {
        // 2
        resolveEnemyArrivals(state)
        // 3 and 4: no input at all, so the lock never establishes and nobody moves.
        advanceCommandUnit(state)
        // 5
        advanceMovement(state, advanceAllEnemyMovement)
        // 6, 7
        advanceCooldowns(state)
        advanceTargeting(state)
        // 8, 9, 10 -> 11, in §1.16's order
        const events = [
          ...resolveFriendlyAttacks(state),
          ...resolveEnemyAttacks(state),
          ...resolveEliteCycle(state),
        ]
        const damage = applyDamage(state, events)
        // 12, 13
        advanceRescueProgress(state, damage)
        const transitions = resolveTransitions(state)
        // 14, 15, 16
        resolveKillAccounting(state, transitions)
        state.combatTick += 1
        resolveBattleOutcome(state, transitions)

        // §1.13/§1.15: the only input this policy sends.
        const pending = pendingUpgradeRound(state)
        if (pending) chooseUpgradeCard(state, pending.offered[0])
      }
      return state
    }

    // THE SEED IS `seed-b` BECAUSE THE ARRIVAL HAS TO HAPPEN. This fixture asserts §1.12's
    // arrival tick, which a run that ends before tick 1800 never reaches. Batch I's balance
    // change (`PRESSURE_PHASES` 9/7/5, `LEASH_RADIUS` 10.0) wipes the card-only run at 1653 on
    // `seed-a`; measured over the eight band seeds, only `seed-b` (ends 2190) and `seed-h`
    // (ends 2013) still get to the arrival, and `seed-b` is the one the rest of this branch's
    // fixtures moved to for the same reason. `seed-a` is kept below as the "a different seed is
    // a different run" contrast, which does not care whether it reached the elite.
    const first = play('seed-b')
    const second = play('seed-b')

    // The run DECIDES — which verdict it reaches is a balance question and this fixture must not
    // pretend to answer it. Through batch H a standing squad actually killed the elite, i.e. §3's
    // I3 ("정지 플레이는 전멸한다") did not hold; at batch I's values this run is wiped instead.
    // Either way §5 stage 2 owns the number and pinning the outcome here would freeze it.
    expect(first.result).not.toBeNull()
    expect(['won', 'lost']).toContain(first.mode)
    // §1.12: the elite arrived on its tick, on top of §1.10's live supply.
    expect(first.elite.spawnTick).toBe(ELITE_SPAWN_TICK)
    expect(first.combatTick).toBeLessThanOrEqual(COMBAT_TICK_LIMIT)
    expect(digestBattleState(second)).toBe(digestBattleState(first))
    expect(second.combatTick).toBe(first.combatTick)
    expect(digestBattleState(play('seed-a'))).not.toBe(digestBattleState(first))
  })
})

describe('§1.12 / §1.16 the verdict the elite decides', () => {
  it('wins the run the moment the elite dies', () => {
    const state = withElite()
    elite(state).hp = 0
    const transitions = resolveTransitions(state)
    state.combatTick += 1

    resolveBattleOutcome(state, transitions)

    expect(state.mode).toBe('won')
    expect(state.result).toBe('won')
    expect(state.failureReason).toBeNull()
  })

  it('loses with elite-survived when the clock runs out with the elite alive', () => {
    const state = withElite()
    state.combatTick = COMBAT_TICK_LIMIT

    resolveBattleOutcome(state, transitionOutcome())

    expect(state.mode).toBe('lost')
    expect(state.result).toBe('lost')
    expect(state.failureReason).toBe('elite-survived')
  })

  it('leaves a running battle alone before the limit', () => {
    const state = withElite()
    state.combatTick = COMBAT_TICK_LIMIT - 1

    resolveBattleOutcome(state, transitionOutcome())

    expect(state.mode).toBe('running')
    expect(state.result).toBeNull()
    expect(state.failureReason).toBeNull()
  })

  it('ranks all-units-lost above elite-survived (§1.16)', () => {
    const state = withElite()
    state.combatTick = COMBAT_TICK_LIMIT

    resolveBattleOutcome(state, transitionOutcome({ allUnitsLost: true }))

    expect(state.mode).toBe('lost')
    expect(state.failureReason).toBe('all-units-lost')
  })

  it('ranks a win above every defeat, even on the final tick with the roster gone', () => {
    const state = withElite()
    state.combatTick = COMBAT_TICK_LIMIT

    resolveBattleOutcome(
      state,
      transitionOutcome({
        enemyDeaths: [{ id: ELITE_ID, kind: 'elite' }],
        allUnitsLost: true,
      }),
    )

    expect(state.mode).toBe('won')
    expect(state.result).toBe('won')
    expect(state.failureReason).toBeNull()
  })
})
