// Batch A fixtures for the authoritative battle state (§1.1, §1.2, §1.14, §1.17).

import { describe, expect, it } from 'vitest'

import { createPrng, type Prng } from '../../src/core/prng'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ARRIVE_EPSILON,
  COMBAT_TICK_LIMIT,
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_MOVE_SPEED,
  COMMANDER_RANGE,
  COMMANDER_START,
  ELITE_APPROACH_RANGE,
  ENGAGE_RADIUS,
  FOLLOW_MAX_SPEED,
  FOLLOW_SPEED_MULTIPLIER,
  MOVE_EPSILON,
  SHOOTER_RANGE,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
  SPAWN_RADIUS,
} from '../../src/core/battle/constants'
import {
  NAME_POOL,
  NAME_POOL_SIZE,
  assignNameIndices,
  shuffleNamePool,
} from '../../src/core/battle/names'
import {
  STREAM_NAMES,
  createStreamStates,
  nextStreamFloat,
  streamPrng,
} from '../../src/core/battle/streams'
import {
  COMMANDER_ID,
  ROSTER_SIZE,
  SOLDIER_IDS,
  createInitialBattleState,
  movementBlockers,
  sightBlockers,
} from '../../src/core/battle/state'
import { canonicalizeBattleState, digestBattleState } from '../../src/core/battle/digest'
import { FORMATION_SLOTS } from '../../src/core/gameplay/formation'

function countingPrng(inner: Prng): { prng: Prng; draws: () => number } {
  let draws = 0
  return {
    prng: {
      getState: () => inner.getState(),
      nextUint32: () => {
        draws += 1
        return inner.nextUint32()
      },
      nextFloat: () => {
        draws += 1
        return inner.nextFloat()
      },
      range: (min, max) => {
        draws += 1
        return inner.range(min, max)
      },
    },
    draws: () => draws,
  }
}

describe('§1.2 anchors and §1.4 structural invariants', () => {
  it('pins the fixed friendly anchors the harness may not touch', () => {
    expect(COMMANDER_MOVE_SPEED).toBe(0.115)
    expect(COMMANDER_RANGE).toBe(6.0)
    expect(COMMANDER_ATTACK_INTERVAL).toBe(10)
    expect(SOLDIER_MOVE_SPEED).toBe(0.1)
    expect(SOLDIER_RANGE).toBe(5.0)
    expect(SOLDIER_ATTACK_INTERVAL).toBe(12)
    expect(FOLLOW_SPEED_MULTIPLIER).toBe(1.3)
    expect(FOLLOW_MAX_SPEED).toBeCloseTo(0.13, 12)
  })

  it('keeps ARRIVE_EPSILON <= MOVE_EPSILON (§1.4 invariant relation)', () => {
    expect(ARRIVE_EPSILON).toBeLessThanOrEqual(MOVE_EPSILON)
  })

  it('keeps the spec-mandated placeholder constraints', () => {
    // §1.9: a shooter that outranges a soldier has to close, and §1.3 makes the
    // approach free of return fire.
    expect(SHOOTER_RANGE).toBeLessThan(SOLDIER_RANGE)
    // §1.12: same argument for the elite.
    expect(ELITE_APPROACH_RANGE).toBeLessThan(SOLDIER_RANGE)
    // §1.10: overlapping spawn and engage radii refill the cap with enemies in transit.
    expect(SPAWN_RADIUS).toBeGreaterThanOrEqual(ENGAGE_RADIUS + 2.0)
  })

  it('pins the arena and the clock (§1.1)', () => {
    expect(ARENA_WIDTH).toBe(56)
    expect(ARENA_HEIGHT).toBe(32)
    expect(COMMANDER_START).toEqual({ x: 28, y: 16 })
    expect(COMBAT_TICK_LIMIT).toBe(2700)
  })
})

describe('§1.17 named streams', () => {
  it('derives exactly the four named streams', () => {
    expect([...STREAM_NAMES]).toEqual(['spawn', 'cards', 'terrain', 'names'])
  })

  it('gives each stream a different starting state for the same root seed', () => {
    const states = createStreamStates('seed-a')
    const values = STREAM_NAMES.map((name) => states[name])
    expect(new Set(values).size).toBe(STREAM_NAMES.length)
  })

  it('consuming one stream never disturbs another', () => {
    const clean = createStreamStates('seed-a')
    const cleanNames = shuffleNamePool(streamPrng(clean, 'names'))

    const disturbed = createStreamStates('seed-a')
    for (let index = 0; index < 50; index += 1) nextStreamFloat(disturbed, 'spawn')
    for (let index = 0; index < 7; index += 1) nextStreamFloat(disturbed, 'cards')
    for (let index = 0; index < 13; index += 1) nextStreamFloat(disturbed, 'terrain')
    const disturbedNames = shuffleNamePool(streamPrng(disturbed, 'names'))

    expect(disturbedNames).toEqual(cleanNames)
  })

  it('advances only the stream it is asked for', () => {
    const states = createStreamStates('seed-a')
    const before = { ...states }
    nextStreamFloat(states, 'spawn')
    expect(states.spawn).not.toBe(before.spawn)
    expect(states.cards).toBe(before.cards)
    expect(states.terrain).toBe(before.terrain)
    expect(states.names).toBe(before.names)
  })

  it('exposes a Prng view that writes back into the stream state', () => {
    const states = createStreamStates('seed-a')
    const prng = streamPrng(states, 'cards')
    const value = prng.nextUint32()
    expect(states.cards).toBe(value)
    expect(prng.getState()).toBe(states.cards)
  })
})

describe('§1.14 names', () => {
  it('holds exactly 24 distinct names', () => {
    expect(NAME_POOL).toHaveLength(NAME_POOL_SIZE)
    expect(NAME_POOL_SIZE).toBe(24)
    expect(new Set(NAME_POOL).size).toBe(24)
  })

  it('consumes exactly 23 draws for one Fisher-Yates shuffle', () => {
    const counting = countingPrng(createPrng('seed-a:names'))
    shuffleNamePool(counting.prng)
    expect(counting.draws()).toBe(23)
  })

  it('assigns the first 16 of the shuffled pool, and takes no extra draws', () => {
    const counting = countingPrng(createPrng('seed-a:names'))
    const assigned = assignNameIndices(counting.prng, ROSTER_SIZE)
    expect(counting.draws()).toBe(23)
    expect(assigned).toEqual(shuffleNamePool(createPrng('seed-a:names')).slice(0, ROSTER_SIZE))
    expect(new Set(assigned).size).toBe(ROSTER_SIZE)
  })

  it('is a permutation of the whole pool, not a partial draw', () => {
    const shuffled = shuffleNamePool(createPrng('seed-a:names'))
    expect([...shuffled].sort((a, b) => a - b)).toEqual(
      Array.from({ length: NAME_POOL_SIZE }, (_, index) => index),
    )
  })

  it('assigns names in id order', () => {
    const state = createInitialBattleState('seed-a')
    const expected = assignNameIndices(streamPrng(createStreamStates('seed-a'), 'names'), ROSTER_SIZE)
    const byId = [...state.friendlies].sort((left, right) => left.id - right.id)
    expect(byId.map((unit) => unit.nameIndex)).toEqual(expected)
  })
})

describe('initial authoritative state', () => {
  it('builds 1 commander + 15 soldiers with ids 1..16', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.friendlies).toHaveLength(ROSTER_SIZE)
    expect(state.friendlies.map((unit) => unit.id)).toEqual(
      Array.from({ length: ROSTER_SIZE }, (_, index) => index + 1),
    )
    expect(state.friendlies[0].role).toBe('commander')
    expect(state.friendlies.slice(1).every((unit) => unit.role === 'soldier')).toBe(true)
    expect(state.commandUnitId).toBe(COMMANDER_ID)
    expect(state.originalCommanderId).toBe(COMMANDER_ID)
  })

  it('starts the commander at §1.1 and every soldier settled on its slot', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.friendlies[0].position).toEqual({ x: COMMANDER_START.x, y: COMMANDER_START.y })
    for (const assignment of state.slotAssignments) {
      const unit = state.friendlies.find((candidate) => candidate.id === assignment.unitId)
      const slot = FORMATION_SLOTS[assignment.slotIndex]
      expect(unit?.position.x).toBeCloseTo(COMMANDER_START.x + slot.x, 12)
      expect(unit?.position.y).toBeCloseTo(COMMANDER_START.y + slot.y, 12)
    }
  })

  it('assigns slots by ascending soldier id and leaves the commander slotless', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.slotAssignments.map((entry) => entry.unitId)).toEqual([...SOLDIER_IDS])
    expect(state.slotAssignments.map((entry) => entry.slotIndex)).toEqual(
      FORMATION_SLOTS.map((_, index) => index),
    )
    expect(state.slotAssignments.some((entry) => entry.unitId === COMMANDER_ID)).toBe(false)
  })

  it('starts empty for the later batches', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.enemies).toEqual([])
    expect(state.spawn.backlog).toEqual([])
    expect(state.spawn.discardedByAbsoluteCap).toBe(0)
    expect(state.elite.phase).toBe('absent')
    expect(state.upgrades.rounds).toEqual([])
    expect(state.upgrades.remainingPool).toHaveLength(8)
    expect(state.rescue).toEqual({ active: false, targetId: null, progress: 0 })
    expect(state.combatTick).toBe(0)
    expect(state.mode).toBe('ready')
    expect(state.result).toBeNull()
    expect(state.failureReason).toBeNull()
    expect(state.input).toEqual({ move: { x: 0, y: 0 }, spaceHeld: false })
  })

  it('generates two-class terrain on the terrain stream', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.terrain.high.length).toBeGreaterThan(0)
    expect(state.terrain.low.length).toBeGreaterThan(0)
    expect(movementBlockers(state)).toEqual(state.terrain.high)
    expect(sightBlockers(state)).toEqual([...state.terrain.high, ...state.terrain.low])
    expect(state.prng.terrain).not.toBe(createStreamStates('seed-a').terrain)
  })
})

describe('§1.17 determinism and digest', () => {
  it('produces an identical initial state and digest for the same seed', () => {
    const left = createInitialBattleState('seed-a')
    const right = createInitialBattleState('seed-a')
    expect(right).toEqual(left)
    expect(digestBattleState(right)).toBe(digestBattleState(left))
  })

  it('produces a different digest for a different seed', () => {
    expect(digestBattleState(createInitialBattleState('seed-a'))).not.toBe(
      digestBattleState(createInitialBattleState('seed-b')),
    )
  })

  it('normalizes floats to 6 decimal places', () => {
    const left = createInitialBattleState('seed-a')
    const right = createInitialBattleState('seed-a')
    right.friendlies[3].position = {
      x: right.friendlies[3].position.x + 1e-9,
      y: right.friendlies[3].position.y,
    }
    expect(digestBattleState(right)).toBe(digestBattleState(left))

    right.friendlies[3].position = {
      x: right.friendlies[3].position.x + 1e-3,
      y: right.friendlies[3].position.y,
    }
    expect(digestBattleState(right)).not.toBe(digestBattleState(left))
  })

  it('is insensitive to array order but sensitive to every §1.17 field', () => {
    const base = createInitialBattleState('seed-a')
    const shuffled = createInitialBattleState('seed-a')
    shuffled.friendlies.reverse()
    shuffled.slotAssignments.reverse()
    expect(digestBattleState(shuffled)).toBe(digestBattleState(base))

    const fields: Array<(state: ReturnType<typeof createInitialBattleState>) => void> = [
      (state) => void (state.combatTick = 1),
      (state) => void (state.mode = 'running'),
      (state) => void (state.result = 'won'),
      (state) => void (state.failureReason = 'elite-survived'),
      (state) => void (state.commandUnitId = 3),
      (state) => void (state.input.spaceHeld = true),
      (state) => void (state.input.move = { x: 1, y: 0 }),
      (state) => void (state.friendlies[2].hp = 0.5),
      (state) => void (state.friendlies[2].maxHp = 9),
      (state) => void (state.friendlies[2].life = 'downed'),
      (state) => void (state.friendlies[2].attackCooldown = 4),
      (state) => void (state.friendlies[2].targetId = 900),
      (state) => void (state.friendlies[2].nameIndex = 23),
      (state) => void (state.friendlies[2].deathTick = 12),
      (state) => void state.friendlies[2].rescuedByIds.push(4),
      (state) => void (state.slotAssignments[0].latchedPosition = { x: 1, y: 2 }),
      (state) => void (state.spawn.discardedByAbsoluteCap = 1),
      (state) => void (state.spawn.discardedByBacklogOverflow = 1),
      (state) => void (state.elite.hp = 1),
      (state) => void (state.rescue.progress = 1),
      (state) => void (state.stats.kills = 1),
      (state) => void (state.prng.spawn = 12345),
      (state) => void (state.terrain.high.splice(0, 1)),
      (state) =>
        void state.enemies.push({
          id: 900,
          enemyClass: 'melee',
          hp: 1,
          maxHp: 1,
          life: 'standing',
          position: { x: 1, y: 1 },
          attackCooldown: 0,
          targetId: null,
          deathTick: null,
          lastDisplacement: 0,
          zeroDisplacementTicks: 0,
          excludedTargetId: null,
          contactSlotOwnerId: null,
        }),
      (state) =>
        void state.upgrades.rounds.push({ round: 1, tick: 10, offered: ['firepower'], chosen: null }),
    ]

    const baseline = digestBattleState(base)
    for (const mutate of fields) {
      const state = createInitialBattleState('seed-a')
      mutate(state)
      expect(digestBattleState(state), `digest ignored a §1.17 field`).not.toBe(baseline)
    }
  })

  it('canonicalizes to sorted keys and sorted units', () => {
    const state = createInitialBattleState('seed-a')
    const canonical = canonicalizeBattleState(state) as Record<string, unknown>
    expect(Object.keys(canonical)).toEqual([...Object.keys(canonical)].sort())
    expect(canonical.rootSeed).toBe('seed-a')
    expect(canonical.schemaVersion).toBe(1)
  })
})
