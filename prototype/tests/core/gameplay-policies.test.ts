import { describe, expect, test, vi } from 'vitest'

import {
  decideSkilledCommands,
  runDeterminismFixture,
  runGameplayPolicy,
  runRescueAgencyScenario,
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

  test('continues authoritative mutation after seed 47 loses every standing unit', () => {
    const run = runDeterminismFixture('47')

    expect(run.zeroStandingTick).toBe(753)
    expect(run.postWipeObservations[0].tick).toBe(753)
    expect(run.postWipeObservations.at(-1)?.tick).toBe(900)

    for (let index = 1; index < run.postWipeObservations.length; index += 1) {
      const previous = run.postWipeObservations[index - 1]
      const current = run.postWipeObservations[index]
      const previousPositions = new Map(previous.normalPositions.map((normal) => [normal.id, normal.position]))
      for (const normal of current.normalPositions) {
        const previousPosition = previousPositions.get(normal.id)
        if (previousPosition) expect(normal.position).toEqual(previousPosition)
      }
    }

    const wipe = run.postWipeObservations[0]
    const afterOneTick = run.postWipeObservations[1]
    const advancingTimer = wipe.downedTimers.find((casualty) => casualty.ticks > 1)!
    expect(afterOneTick.downedTimers).toContainEqual({ id: advancingTimer.id, ticks: advancingTimer.ticks - 1 })

    const final = run.postWipeObservations.at(-1)!
    expect(final.spawnPrng).not.toBe(wipe.spawnPrng)
    expect(final.wave.requested).toBeGreaterThan(wipe.wave.requested)
    expect(final.wave).toMatchObject({ cursor: 35, requested: 97 })
    expect(final.warningTicks).toEqual([570, 610, 650, 690, 730, 770, 810, 850])
    expect(final.damageTicks).toEqual([600, 640, 680, 720, 760, 800, 840, 880])
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
      for (const seed of SEEDS) {
        for (const policy of POLICIES) expect(() => runGameplayPolicy(seed, policy)).not.toThrow()
      }
      expect(random).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })
})

test('completes a safe rescue through deterministic public commands', () => {
  const first = runRescueAgencyScenario('47')
  const second = runRescueAgencyScenario('47')

  expect(second).toEqual(first)
  expect(first.approach.startDistance).toBeGreaterThan(1.5)
  expect(first.approach.endDistance).toBeLessThanOrEqual(1.5)
  expect(first.approach.minimumNormalDistance).toBeGreaterThanOrEqual(3)
  expect(first.commands).toContainEqual(expect.objectContaining({ kind: 'set-rescue', held: true }))
  expect(first.progress).toHaveLength(29)
  for (let index = 0; index < first.progress.length; index += 1) {
    expect(first.progress[index].progress).toBe(index + 1)
    expect(first.progress[index].rescuerId).toBe(first.progress[0].rescuerId)
    expect(first.progress[index].casualtyId).toBe(first.progress[0].casualtyId)
  }
  expect(first.completedTick).toBe(first.progress.at(-1)!.tick + 1)
  expect(first.rescues).toBe(1)
  expect(first.finalDigest).toMatch(/^[0-9a-f]{8}$/)
})
