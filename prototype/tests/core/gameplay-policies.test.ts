import { describe, expect, test, vi } from 'vitest'

import {
  decideSkilledCommands,
  runDeterminismFixture,
  runGameplayPolicy,
  type GameplayPolicy,
  type PolicyRun,
} from '../../src/scenarios/gameplay-policies'
import { createStateFixture, makeFriendly, makeNormalEnemy } from '../helpers/gameplay-fixtures'

const SEEDS = ['11', '29', '47', '71', '101', '131', '173', '211'] as const
const POLICIES = ['tactical-no-input', 'movement-only', 'skilled'] as const satisfies readonly GameplayPolicy[]
const CHECKPOINT_TICKS = [0, 150, 300, 360, 540, 660, 780, 900] as const

function wins(runs: readonly PolicyRun[]): number {
  return runs.filter((run) => run.mode === 'won').length
}

test('computes same-tick commands from the prospective squad after a fatigue switch', () => {
  const state = createStateFixture('prospective-switch')
  state.activeSquad = 'scarlet'
  state.squads.scarlet.fatigue = 0.55
  state.squads.scarlet.lastCenter = { x: 10, y: 10 }
  state.squads.teal.lastCenter = { x: 2, y: 2 }
  state.normalEnemies = [makeNormalEnemy(101, 1, 2)]

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'switch-squad' },
    { applyTick: 0, kind: 'set-rescue', held: false },
    { applyTick: 0, kind: 'set-move', x: 1, y: 0 },
  ])
})

test('cancels rescue and moves away from a live telegraph before every other priority', () => {
  const state = createStateFixture('telegraph-priority')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 2, y: 0 }
  state.elite.spawned = true
  state.elite.position = { x: 5, y: 0 }
  state.elite.telegraphCenter = { x: 1, y: 0 }
  const casualty = makeFriendly(2, 'teal', 2.5, 0)
  casualty.life = 'downed'
  casualty.downedTicks = 10
  state.friendlies = [makeFriendly(1, 'teal', 2, 0), casualty]

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'set-rescue', held: false },
    { applyTick: 0, kind: 'set-move', x: 1, y: 0 },
  ])
})

test('uses the squad last direction when its center equals the telegraph center', () => {
  const state = createStateFixture('telegraph-fallback')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 2, y: 2 }
  state.squads.teal.lastDirection = { x: 0, y: -1 }
  state.elite.spawned = true
  state.elite.position = { x: 2, y: 2 }
  state.elite.telegraphCenter = { x: 2, y: 2 }

  expect(decideSkilledCommands(state).at(-1)).toEqual({
    applyTick: 0,
    kind: 'set-move',
    x: 0,
    y: -1,
  })
})

test('approaches the most urgent safe casualty instead of an unsafe earlier casualty', () => {
  const state = createStateFixture('safe-casualty-approach')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 0, y: 0 }
  const unsafeUrgent = makeFriendly(2, 'teal', 1, 0)
  unsafeUrgent.life = 'downed'
  unsafeUrgent.downedTicks = 1
  const safeCasualty = makeFriendly(3, 'teal', 5, 0)
  safeCasualty.life = 'downed'
  safeCasualty.downedTicks = 10
  state.friendlies = [makeFriendly(1, 'teal', 0, 0), unsafeUrgent, safeCasualty]
  state.normalEnemies = [makeNormalEnemy(101, 2, 0)]

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'set-rescue', held: false },
    { applyTick: 0, kind: 'set-move', x: 5, y: 0 },
  ])
})

test('holds and stops for an eligible safe casualty before approaching an idle elite', () => {
  const state = createStateFixture('safe-casualty-hold')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 0, y: 0 }
  const casualty = makeFriendly(2, 'teal', 1, 0)
  casualty.life = 'downed'
  casualty.downedTicks = 10
  state.friendlies = [makeFriendly(1, 'teal', 0, 0), casualty]
  state.normalEnemies = [makeNormalEnemy(101, 4, 0)]
  state.elite.spawned = true
  state.elite.position = { x: 0.5, y: 0 }

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'set-rescue', held: true },
    { applyTick: 0, kind: 'set-move', x: 0, y: 0 },
  ])
})

test('approaches a live elite when there is no telegraph or safe casualty', () => {
  const state = createStateFixture('elite-approach')
  state.activeSquad = 'scarlet'
  state.squads.scarlet.lastCenter = { x: 1, y: 2 }
  state.elite.spawned = true
  state.elite.position = { x: 5, y: 4 }

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'set-rescue', held: false },
    { applyTick: 0, kind: 'set-move', x: 4, y: 2 },
  ])
})

test('flees the nearest living normal before the elite spawns', () => {
  const state = createStateFixture('normal-flee')
  state.activeSquad = 'scarlet'
  state.squads.scarlet.lastCenter = { x: 0, y: 0 }
  state.normalEnemies = [makeNormalEnemy(101, -2, 0), makeNormalEnemy(102, 5, 0)]

  expect(decideSkilledCommands(state)).toEqual([
    { applyTick: 0, kind: 'set-rescue', held: false },
    { applyTick: 0, kind: 'set-move', x: 2, y: 0 },
  ])
})

describe('gameplay determinism fixture', () => {
  test('repeats every authoritative checkpoint through tick 900', () => {
    const first = runDeterminismFixture('47')
    const second = runDeterminismFixture('47')

    expect(first.checkpoints.map((point) => point.tick)).toEqual(CHECKPOINT_TICKS)
    expect(second).toEqual(first)
  })
})

describe('seed-agnostic gameplay policies', () => {
  test('repeats terminal outcome, terminal-or-earlier checkpoints, and final digest for every seed and policy', () => {
    for (const seed of SEEDS) {
      for (const policy of POLICIES) {
        const first = runGameplayPolicy(seed, policy)
        const second = runGameplayPolicy(seed, policy)

        expect(second).toEqual(first)
        expect(first.checkpoints.every((point) => point.tick <= first.terminalTick)).toBe(true)
        expect(first.checkpoints.at(-1)?.tick).toBe(first.terminalTick)
        expect(first.mode === 'won' ? first.failureReason === null : first.failureReason !== null).toBe(true)
      }
    }
  })

  test('meets the three fixed agency result bands', () => {
    const noInput = SEEDS.map((seed) => runGameplayPolicy(seed, 'tactical-no-input'))
    const movement = SEEDS.map((seed) => runGameplayPolicy(seed, 'movement-only'))
    const skilled = SEEDS.map((seed) => runGameplayPolicy(seed, 'skilled'))

    expect(wins(noInput)).toBe(0)
    expect(wins(movement)).toBeLessThanOrEqual(2)
    expect(wins(skilled)).toBeGreaterThanOrEqual(6)
  })

  test('keeps tutorial seed 47 inside the fixed teaching windows', () => {
    const run = runGameplayPolicy('47', 'skilled')

    expect(run.firstAttackTick).not.toBeNull()
    expect(run.firstAttackTick!).toBeLessThanOrEqual(90)
    expect(run.firstDownedTick).toBeGreaterThanOrEqual(350)
    expect(run.firstDownedTick).toBeLessThanOrEqual(600)
    expect(run.upgradeTick).toBeGreaterThanOrEqual(200)
    expect(run.upgradeTick).toBeLessThanOrEqual(450)
  })

  test('reports the completed rescue count for the skilled tutorial run', () => {
    expect(Number.isInteger(runGameplayPolicy('47', 'skilled').rescues)).toBe(true)
  })

  test('never delegates fixture or policy randomness to Math.random', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used by gameplay policies')
    })

    try {
      expect(() => runDeterminismFixture('47')).not.toThrow()
      expect(() => runGameplayPolicy('47', 'skilled')).not.toThrow()
      expect(random).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })
})
