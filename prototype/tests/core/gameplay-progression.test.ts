import { expect, test } from 'vitest'

import { ARENA_HEIGHT, ARENA_WIDTH } from '../../src/core/gameplay/constants'
import {
  SPAWN_TABLE,
  applyPendingUpgrade,
  applyUpgradeChoice,
  enterUpgradeIfEligible,
  recordNormalKill,
  spawnForTick,
} from '../../src/core/gameplay/progression'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { digestGameState } from '../../src/core/gameplay/digest'
import { advanceFriendlyAttacks } from '../../src/core/gameplay/combat'
import { createStateFixture, makeFriendly, makeNormalEnemy } from '../helpers/gameplay-fixtures'

function nextXorshift32(state: number): number {
  let value = state >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

test('defines 35 spawn events requesting exactly 97 normal enemies including the tick 870 tail', () => {
  expect(SPAWN_TABLE).toHaveLength(35)
  expect(SPAWN_TABLE.reduce((sum, event) => sum + event.count, 0)).toBe(97)
  expect(SPAWN_TABLE.at(-1)).toEqual({ tick: 870, count: 2 })
  expect(SPAWN_TABLE).toEqual([
    { tick: 0, count: 2 }, { tick: 30, count: 2 }, { tick: 60, count: 2 }, { tick: 90, count: 2 }, { tick: 120, count: 2 },
    { tick: 150, count: 3 }, { tick: 174, count: 3 }, { tick: 198, count: 3 }, { tick: 222, count: 3 }, { tick: 246, count: 3 }, { tick: 270, count: 3 }, { tick: 294, count: 3 }, { tick: 318, count: 3 }, { tick: 342, count: 3 },
    { tick: 360, count: 4 }, { tick: 380, count: 4 }, { tick: 400, count: 4 }, { tick: 420, count: 4 }, { tick: 440, count: 4 }, { tick: 460, count: 4 }, { tick: 480, count: 4 }, { tick: 500, count: 4 }, { tick: 520, count: 4 },
    { tick: 540, count: 2 }, { tick: 570, count: 2 }, { tick: 600, count: 2 }, { tick: 630, count: 2 }, { tick: 660, count: 2 }, { tick: 690, count: 2 }, { tick: 720, count: 2 }, { tick: 750, count: 2 }, { tick: 780, count: 2 }, { tick: 810, count: 2 }, { tick: 840, count: 2 }, { tick: 870, count: 2 },
  ])
})

test('discards capped requests while consuming one spawn angle per request', () => {
  const state = createStateFixture()
  state.normalEnemies = Array.from({ length: 20 }, (_, index) => makeNormalEnemy(101 + index, 0, 0))
  const before = state.prng.spawn

  spawnForTick(state, 360)

  expect(state.normalEnemies).toHaveLength(20)
  expect(state.prng.spawn).toBe(nextXorshift32(nextXorshift32(nextXorshift32(nextXorshift32(before)))))
  expect(state.wave).toEqual({ cursor: 15, requested: 4, discarded: 4 })
})

test('clamps an off-arena spawn without consuming a reroll angle', () => {
  const state = createStateFixture('top-clamp')
  const before = state.prng.spawn

  spawnForTick(state, 0)

  expect(state.prng.spawn).toBe(nextXorshift32(nextXorshift32(before)))
  expect(state.normalEnemies).toHaveLength(2)
  expect(state.normalEnemies.some((enemy) => enemy.position.x === 0 || enemy.position.x === ARENA_WIDTH || enemy.position.y === 0 || enemy.position.y === ARENA_HEIGHT)).toBe(true)
})

test('processes each scheduled spawn event only once', () => {
  const state = createStateFixture('once-per-event')

  spawnForTick(state, 0)
  spawnForTick(state, 0)

  expect(state.wave).toEqual({ cursor: 1, requested: 2, discarded: 0 })
  expect(state.normalEnemies.map((enemy) => enemy.id)).toEqual([18, 19])
})

test('records the XP 15 to 16 transition and pauses exactly once with a card offer', () => {
  const state = createStateFixture('xp-boundary')
  state.stats.xp = 15

  recordNormalKill(state)
  enterUpgradeIfEligible(state)

  expect(state.stats).toMatchObject({ kills: 1, xp: 16 })
  expect(state.mode).toBe('awaiting-upgrade')
  expect([...state.upgrade.offered].sort()).toEqual(['march', 'power', 'vigor'])
  enterUpgradeIfEligible(state)
  expect(state.mode).toBe('awaiting-upgrade')
})

test('awards one XP when a friendly attack kills a normal enemy', () => {
  const state = createStateFixture('combat-xp')
  state.activeSquad = 'teal'
  state.friendlies = [makeFriendly(1, 'teal', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0, 0)]
  state.normalEnemies[0].hp = 0.14

  advanceFriendlyAttacks(state)

  expect(state.normalEnemies[0].hp).toBe(0)
  expect(state.stats).toMatchObject({ kills: 1, xp: 1 })
})

test.each([
  ['power', { damageMultiplier: 1.3, movementMultiplier: 1, hpMultiplier: 1 }],
  ['march', { damageMultiplier: 1, movementMultiplier: 1.15, hpMultiplier: 1 }],
  ['vigor', { damageMultiplier: 1, movementMultiplier: 1, hpMultiplier: 1.25 }],
] as const)('applies %s exactly once to both squads', (choice, expected) => {
  const state = createStateFixture(`card-${choice}`)
  state.mode = 'awaiting-upgrade'
  state.upgrade = { offered: [choice], choice: null, applied: false }
  state.friendlies[0].hp = 0.4
  const hpBefore = state.friendlies.map((friendly) => ({ hp: friendly.hp, maxHp: friendly.maxHp }))

  applyUpgradeChoice(state, 0)
  applyPendingUpgrade(state)
  applyPendingUpgrade(state)

  expect(state.squads.teal).toMatchObject(expected)
  expect(state.squads.scarlet).toMatchObject(expected)
  if (choice === 'vigor') {
    expect(state.friendlies.map((friendly) => ({ hp: friendly.hp, maxHp: friendly.maxHp }))).toEqual(
      hpBefore.map(({ hp, maxHp }) => ({ hp: hp * 1.25, maxHp: maxHp * 1.25 })),
    )
  }
  expect(state.upgrade).toMatchObject({ choice, applied: true })
})

test('rejects an invalid offered-card index atomically', () => {
  const state = createStateFixture('invalid-card')
  state.mode = 'awaiting-upgrade'
  state.upgrade = { offered: ['power', 'march', 'vigor'], choice: null, applied: false }
  const before = digestGameState(state)

  expect(() => applyUpgradeChoice(state, 3)).toThrow(TypeError)
  expect(digestGameState(state)).toBe(before)
})

test('records a zero-time card choice and applies it only during the next running tick phase 4', () => {
  const game = createGameplaySimulation({ seed: 'next-tick-upgrade' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  const state = game.getState() as ReturnType<typeof createStateFixture>
  state.stats.xp = 16

  game.step()
  expect(state.mode).toBe('awaiting-upgrade')
  const index = state.upgrade.offered.indexOf('power')
  game.enqueue({ applyTick: state.combatTick, sequence: 1, kind: 'choose-upgrade', index: index as 0 | 1 | 2 })
  expect(state.squads.teal.damageMultiplier).toBe(1)

  game.step()

  expect(state.squads.teal.damageMultiplier).toBe(1.3)
  expect(state.squads.scarlet.damageMultiplier).toBe(1.3)
  expect(state.upgrade.applied).toBe(true)
})

test('shuffles only display order with the cards stream and never perturbs spawn angles', () => {
  const left = createStateFixture('isolated-streams')
  const right = createStateFixture('isolated-streams')
  const spawnBefore = left.prng.spawn
  const cardsBefore = left.prng.cards

  left.stats.xp = 16
  enterUpgradeIfEligible(left)
  spawnForTick(left, 0)
  spawnForTick(right, 0)

  expect(left.prng.cards).not.toBe(cardsBefore)
  expect(left.prng.spawn).not.toBe(spawnBefore)
  expect(left.prng.spawn).toBe(right.prng.spawn)
  expect(left.normalEnemies.map((enemy) => enemy.position)).toEqual(right.normalEnemies.map((enemy) => enemy.position))
  expect([...left.upgrade.offered].sort()).toEqual(['march', 'power', 'vigor'])
  expect(left.upgrade.offered).toEqual(['march', 'power', 'vigor'])
})

test('different valid card choices produce different authority digests', () => {
  const left = createStateFixture('choice-digest')
  const right = createStateFixture('choice-digest')
  for (const state of [left, right]) {
    state.mode = 'awaiting-upgrade'
    state.upgrade = { offered: ['power', 'march', 'vigor'], choice: null, applied: false }
  }

  applyUpgradeChoice(left, 0)
  applyUpgradeChoice(right, 1)
  applyPendingUpgrade(left)
  applyPendingUpgrade(right)

  expect(digestGameState(left)).not.toBe(digestGameState(right))
})
