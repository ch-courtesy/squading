import { describe, expect, test, vi } from 'vitest'

import { createSimulation } from '../../src/core/simulation'
import { hashSnapshot } from '../../src/core/snapshot'
import { createRendererBenchmark } from '../../src/scenarios/renderer-benchmark'

function runBenchmark(seed: string) {
  const scenario = createRendererBenchmark({ seed, enemyCount: 100 })
  const simulation = createSimulation(scenario.config)

  for (let tick = 0; tick < 75 * 30; tick += 1) {
    simulation.step(scenario.inputLog.at(tick))
  }

  return simulation.getSnapshot()
}

describe('deterministic simulation', () => {
  test('the same seed and input log produce the same snapshot hash', () => {
    expect(hashSnapshot(runBenchmark('repeatable'))).toBe(
      hashSnapshot(runBenchmark('repeatable')),
    )
  })

  test('a different seed changes the simulated snapshot', () => {
    expect(hashSnapshot(runBenchmark('seed-a'))).not.toBe(
      hashSnapshot(runBenchmark('seed-b')),
    )
  })

  test('the core never delegates randomness to Math.random', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used by the core')
    })

    try {
      expect(() => runBenchmark('owned-prng')).not.toThrow()
      expect(random).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })

  test('copies configuration so restart cannot be changed by its caller', () => {
    const config = { seed: 'immutable-config', enemyCount: 100 as const }
    const simulation = createSimulation(config)
    const initial = hashSnapshot(simulation.getSnapshot())

    Object.assign(config, { seed: 'changed', enemyCount: 300 })
    simulation.restart()

    expect(hashSnapshot(simulation.getSnapshot())).toBe(initial)
  })

  test('copies input entries so later caller mutations cannot change playback', async () => {
    const entries = { 0: { moveX: 1 } }
    const { createInputLog } = await import('../../src/core/input-log')
    const log = createInputLog(entries)

    entries[0].moveX = -1

    expect(log.at(0)).toEqual({ moveX: 1 })
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite movement %s without contaminating snapshots',
    (moveX) => {
      const simulation = createSimulation(
        createRendererBenchmark({ seed: 'finite-input', enemyCount: 100 }).config,
      )
      const before = simulation.getSnapshot()

      expect(() => simulation.step({ moveX })).toThrow('moveX must be finite')
      expect(simulation.getSnapshot()).toEqual(before)
    },
  )

  test('snapshot collections are sorted by stable numeric ids', () => {
    const snapshot = runBenchmark('ordered-ids')
    const ids = (values: ReadonlyArray<{ id: number }>) => values.map(({ id }) => id)

    expect(ids(snapshot.units)).toEqual([...ids(snapshot.units)].sort((a, b) => a - b))
    expect(ids(snapshot.projectiles)).toEqual(
      [...ids(snapshot.projectiles)].sort((a, b) => a - b),
    )
    expect(ids(snapshot.effects)).toEqual([...ids(snapshot.effects)].sort((a, b) => a - b))
  })
})
