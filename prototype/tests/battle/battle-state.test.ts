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
  createEnemy,
  createInitialBattleState,
  enemiesById,
  friendliesById,
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
  it('derives exactly the three named streams', () => {
    expect([...STREAM_NAMES]).toEqual(['spawn', 'cards', 'names'])
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
      const disturbedNames = shuffleNamePool(streamPrng(disturbed, 'names'))

    expect(disturbedNames).toEqual(cleanNames)
  })

  it('advances only the stream it is asked for', () => {
    const states = createStreamStates('seed-a')
    const before = { ...states }
    nextStreamFloat(states, 'spawn')
    expect(states.spawn).not.toBe(before.spawn)
    expect(states.cards).toBe(before.cards)
    expect(states.names).toBe(before.names)
  })

  it('exposes a Prng view that writes back into the stream state', () => {
    const states = createStreamStates('seed-a')
    const prng = streamPrng(states, 'cards')
    const value = prng.nextUint32()
    expect(states.cards).toBe(value)
    expect(prng.getState()).toBe(states.cards)
  })

  it('is bit-identical to core/prng.ts', () => {
    // `streams.ts` re-implements the xorshift step over a raw uint32 because the
    // digest has to see the stream position. Terrain and names are generated through
    // that re-implementation while the sweep tooling uses `createPrng` directly, so
    // the equivalence is load-bearing and pinned here rather than assumed.
    for (const name of STREAM_NAMES) {
      const view = streamPrng(createStreamStates('seed-a'), name)
      const direct = createPrng(`seed-a:${name}`)
      expect(view.getState()).toBe(direct.getState())
      for (let draw = 0; draw < 8; draw += 1) {
        expect(view.nextFloat()).toBe(direct.nextFloat())
        expect(view.getState()).toBe(direct.getState())
      }
    }
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

  it('keeps the roster in ascending id order and exposes that as a guarantee', () => {
    const state = createInitialBattleState('seed-a')
    expect(friendliesById(state).map((unit) => unit.id)).toEqual(state.friendlies.map((u) => u.id))

    // The accessor is the contract, not the array's current order.
    state.friendlies.reverse()
    state.enemies.push(createEnemy(102, 'melee', { x: 1, y: 1 }))
    state.enemies.push(createEnemy(101, 'shooter', { x: 2, y: 2 }))
    expect(friendliesById(state).map((unit) => unit.id)).toEqual(
      Array.from({ length: ROSTER_SIZE }, (_, index) => index + 1),
    )
    expect(enemiesById(state).map((enemy) => enemy.id)).toEqual([101, 102])
  })

  it('starts empty for the later batches', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.enemies).toEqual([])
    expect(state.spawn.backlog).toEqual([])
    expect(state.spawn.discardedByAbsoluteCap).toBe(0)
    // §1.12: the elite has no body yet, and its attack cycle is a separate axis from
    // its lifecycle so that "died mid-telegraph" is representable.
    expect(state.elite.enemyId).toBeNull()
    expect(state.elite.attackPhase).toBe('idle')
    expect(state.upgrades.rounds).toEqual([])
    expect(state.upgrades.remainingPool).toHaveLength(8)
    // Exactly §1.17's "구조 lock의 대상·진행도" and nothing else. §1.16 puts 구조 진행 after
    // 피해 적용, so "was the rescuer hit this tick" is read out of the damage step's return
    // value and never has to be remembered here.
    expect(state.rescue).toEqual({ active: false, targetId: null, progress: 0 })
    expect(state.spawn.requestsInPhase).toBe(0)
    expect(state.spawn.lastRequestTick).toBe(-1)
    expect(state.combatTick).toBe(0)
    expect(state.mode).toBe('ready')
    expect(state.result).toBeNull()
    expect(state.failureReason).toBeNull()
    expect(state.input).toEqual({ move: { x: 0, y: 0 }, spaceHeld: false })
  })

  it('pins the exact top-level field set of BattleState', () => {
    // This is the enforcement behind "no scratch in BattleState" (see types.ts).
    // The digest walks the whole object, so a memoized list or a debug counter added
    // here would silently change every digest in the project and invalidate every
    // recorded 8-seed band — and NOTHING else would fail, because no test asserts a
    // digest value, only that two runs agree. Adding a key must be a deliberate act
    // that shows up in a diff, so it has to be added to this list too.
    expect(Object.keys(createInitialBattleState('seed-a')).sort()).toEqual(
      [
        'combatTick',
        'commandUnitId',
        'elite',
        'enemies',
        'failureReason',
        'friendlies',
        'input',
        'mode',
        'originalCommanderId',
        'prng',
        'rescue',
        'result',
        'rootSeed',
        'schemaVersion',
        'slotAssignments',
        'spawn',
        'stats',
        'upgrades',
      ].sort(),
    )
  })

  it('pins the exact field set of every nested state object too', () => {
    // The top-level pin above is not enough, and batch C proved it: `spawn.requestsInPhase` was
    // added to a NESTED object and sailed through. The digest walks the whole tree, so a field
    // added anywhere in it changes every digest and invalidates every recorded 8-seed band —
    // and batches E and F are going to add fields to `upgrades` and `elite` next. Each of these
    // has to be argued in a diff, exactly like the top-level set.
    const state = createInitialBattleState('seed-a')

    expect(Object.keys(state.spawn).sort()).toEqual(
      [
        'backlog',
        'nextEnemyId',
        'nextRequestSequence',
        'lastRequestTick',
        'requestsInPhase',
        'discardedByBacklogOverflow',
        'discardedByAbsoluteCap',
      ].sort(),
    )
    expect(Object.keys(state.elite).sort()).toEqual(
      [
        'enemyId',
        'spawnTick',
        'attackPhase',
        'telegraphCenter',
        'telegraphRemaining',
        'cooldownRemaining',
      ].sort(),
    )
    expect(Object.keys(state.upgrades).sort()).toEqual(
      ['remainingPool', 'rounds', 'nextThresholdIndex'].sort(),
    )
    expect(Object.keys(state.rescue).sort()).toEqual(['active', 'targetId', 'progress'].sort())
    expect(Object.keys(state.stats).sort()).toEqual(['kills', 'rescues'].sort())
    expect(Object.keys(state.input).sort()).toEqual(['move', 'spaceHeld'].sort())

    // The two row types, which grow the digest once per unit rather than once per state.
    expect(Object.keys(state.friendlies[0]).sort()).toEqual(
      [
        'id',
        'role',
        'nameIndex',
        'hp',
        'maxHp',
        'life',
        'position',
        'attackCooldown',
        'targetId',
        'deathTick',
        'downedTicks',
        'invulnerableTicks',
        'rescuedByIds',
        'lastDisplacement',
      ].sort(),
    )
    expect(Object.keys(createEnemy(101, 'melee', { x: 0, y: 0 })).sort()).toEqual(
      [
        'id',
        'kind',
        'hp',
        'maxHp',
        'life',
        'position',
        'attackCooldown',
        'targetId',
        'deathTick',
        'lastDisplacement',
        'contactSlotOwnerId',
      ].sort(),
    )
  })

  it('has no terrain and no terrain stream (§1.6 removed cover)', () => {
    const state = createInitialBattleState('seed-a')
    expect('terrain' in state).toBe(false)
    expect(Object.keys(state.prng).sort()).toEqual(['cards', 'names', 'spawn'])
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

    // Every field §1.17 enumerates, one mutation each. Labelled so a failure names
    // the field the digest stopped watching.
    type Mutation = [string, (state: ReturnType<typeof createInitialBattleState>) => void]
    const fields: Mutation[] = [
      ['schemaVersion', (state) => void ((state as { schemaVersion: number }).schemaVersion = 2)],
      ['rootSeed', (state) => void (state.rootSeed = 'other')],
      ['combatTick', (state) => void (state.combatTick = 1)],
      ['mode', (state) => void (state.mode = 'running')],
      ['result', (state) => void (state.result = 'won')],
      ['failureReason', (state) => void (state.failureReason = 'elite-survived')],
      ['commandUnitId', (state) => void (state.commandUnitId = 3)],
      ['originalCommanderId', (state) => void (state.originalCommanderId = 3)],
      ['input.spaceHeld', (state) => void (state.input.spaceHeld = true)],
      ['input.move', (state) => void (state.input.move = { x: 1, y: 0 })],
      ['friendly.hp', (state) => void (state.friendlies[2].hp = 0.5)],
      ['friendly.maxHp', (state) => void (state.friendlies[2].maxHp = 9)],
      ['friendly.life', (state) => void (state.friendlies[2].life = 'downed')],
      ['friendly.position', (state) => void (state.friendlies[2].position = { x: 1, y: 1 })],
      ['friendly.attackCooldown', (state) => void (state.friendlies[2].attackCooldown = 4)],
      ['friendly.targetId', (state) => void (state.friendlies[2].targetId = 900)],
      ['friendly.nameIndex', (state) => void (state.friendlies[2].nameIndex = 23)],
      ['friendly.deathTick', (state) => void (state.friendlies[2].deathTick = 12)],
      ['friendly.rescuedByIds', (state) => void state.friendlies[2].rescuedByIds.push(4)],
      // §1.11's two per-unit counters. Both are read by a later tick (the downed timer expires
      // into death, the window absorbs), so a digest that ignored them would call two different
      // battles identical.
      ['friendly.downedTicks', (state) => void (state.friendlies[2].downedTicks = 5)],
      ['friendly.invulnerableTicks', (state) => void (state.friendlies[2].invulnerableTicks = 5)],
      ['friendly.lastDisplacement', (state) => void (state.friendlies[2].lastDisplacement = 0.1)],
      ['slotAssignments.slotIndex', (state) => void (state.slotAssignments[0].slotIndex = 14)],
      ['enemies (melee)', (state) => void state.enemies.push(createEnemy(900, 'melee', { x: 1, y: 1 }))],
      [
        'enemy.kind',
        (state) => {
          state.enemies.push(createEnemy(900, 'shooter', { x: 1, y: 1 }))
        },
      ],
      ['spawn.backlog', (state) => void state.spawn.backlog.push({ id: 900, kind: 'melee', position: { x: 3, y: 4 }, requestedTick: 7, sequence: 0 })],
      ['spawn.nextEnemyId', (state) => void (state.spawn.nextEnemyId = 500)],
      ['spawn.nextRequestSequence', (state) => void (state.spawn.nextRequestSequence = 7)],
      ['spawn.lastRequestTick', (state) => void (state.spawn.lastRequestTick = 12)],
      ['spawn.requestsInPhase', (state) => void (state.spawn.requestsInPhase = 3)],
      ['spawn.discardedByAbsoluteCap', (state) => void (state.spawn.discardedByAbsoluteCap = 1)],
      ['spawn.discardedByBacklogOverflow', (state) => void (state.spawn.discardedByBacklogOverflow = 1)],
      ['elite.enemyId', (state) => void (state.elite.enemyId = 1000)],
      ['elite.attackPhase', (state) => void (state.elite.attackPhase = 'telegraph')],
      ['elite.telegraphCenter', (state) => void (state.elite.telegraphCenter = { x: 2, y: 3 })],
      ['elite.telegraphRemaining', (state) => void (state.elite.telegraphRemaining = 9)],
      ['elite.cooldownRemaining', (state) => void (state.elite.cooldownRemaining = 9)],
      ['elite.spawnTick', (state) => void (state.elite.spawnTick = 1800)],
      ['upgrades.rounds', (state) => void state.upgrades.rounds.push({ round: 1, tick: 10, offered: ['firepower'], chosen: null })],
      ['upgrades.remainingPool', (state) => void state.upgrades.remainingPool.pop()],
      ['upgrades.nextThresholdIndex', (state) => void (state.upgrades.nextThresholdIndex = 1)],
      ['rescue.active', (state) => void (state.rescue.active = true)],
      ['rescue.targetId', (state) => void (state.rescue.targetId = 4)],
      ['rescue.progress', (state) => void (state.rescue.progress = 1)],
      ['stats.kills', (state) => void (state.stats.kills = 1)],
      ['stats.rescues', (state) => void (state.stats.rescues = 1)],
      ['prng.spawn', (state) => void (state.prng.spawn = 12345)],
      ['prng.cards', (state) => void (state.prng.cards = 12345)],
      ['prng.names', (state) => void (state.prng.names = 12345)],
    ]

    const baseline = digestBattleState(base)
    const seen = new Set<string>([baseline])
    for (const [label, mutate] of fields) {
      const state = createInitialBattleState('seed-a')
      mutate(state)
      const digest = digestBattleState(state)
      expect(digest, `digest ignored ${label}`).not.toBe(baseline)
      seen.add(digest)
    }
    // Every mutation is distinguishable from every other, not just from the baseline.
    expect(seen.size).toBe(fields.length + 1)
  })

  it('canonicalizes to sorted keys and sorted units', () => {
    const state = createInitialBattleState('seed-a')
    const canonical = canonicalizeBattleState(state) as Record<string, unknown>
    expect(Object.keys(canonical)).toEqual([...Object.keys(canonical)].sort())
    expect(canonical.rootSeed).toBe('seed-a')
    expect(canonical.schemaVersion).toBe(1)
  })
})
