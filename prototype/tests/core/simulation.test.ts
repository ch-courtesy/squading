import { describe, expect, test } from 'vitest'

import { createSimulation } from '../../src/core/simulation'
import { createRendererBenchmark } from '../../src/scenarios/renderer-benchmark'

describe('renderer benchmark battle', () => {
  test.each([100, 200, 300] as const)(
    'starts load mode %i with one commander, two squads of eight, and an enemy commander',
    (enemyCount) => {
      const simulation = createSimulation(
        createRendererBenchmark({ seed: 'roster', enemyCount }).config,
      )
      const units = simulation.getSnapshot().units

      expect(units.filter((unit) => unit.kind === 'commander')).toHaveLength(1)
      expect(units.filter((unit) => unit.squad === 'teal')).toHaveLength(8)
      expect(units.filter((unit) => unit.squad === 'scarlet')).toHaveLength(8)
      expect(units.filter((unit) => unit.kind === 'enemy-commander')).toHaveLength(1)
      expect(units.filter((unit) => unit.kind === 'enemy')).toHaveLength(enemyCount)
    },
  )

  test('surviving exactly 75 seconds succeeds', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'survivors', enemyCount: 100 }).config,
    )

    for (let tick = 0; tick < 75 * 30 - 1; tick += 1) simulation.step({})

    expect(simulation.result).toBe('running')
    simulation.step({})

    expect(simulation.result).toBe('success')
    expect(simulation.getSnapshot().tick).toBe(75 * 30)
  })

  test('all combatants becoming incapacitated fails the battle', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'overrun', enemyCount: 300 }).config,
    )

    for (let tick = 0; tick < 75 * 30 && simulation.result === 'running'; tick += 1) {
      simulation.step({})
    }

    expect(simulation.result).toBe('failure')
    expect(simulation.getSnapshot().tick).toBeGreaterThanOrEqual(60 * 30)
    expect(
      simulation
        .getSnapshot()
        .units.filter((unit) => unit.team !== 'enemy')
        .every((unit) => unit.state === 'downed' || unit.state === 'dead'),
    ).toBe(true)
  })

  test('restart restores the original deterministic battle', () => {
    const scenario = createRendererBenchmark({ seed: 'restart', enemyCount: 100 })
    const simulation = createSimulation(scenario.config)
    const initial = simulation.getSnapshot()

    simulation.step({ moveX: 1, switchSquad: true })
    simulation.restart()

    expect(simulation.result).toBe('running')
    expect(simulation.getSnapshot()).toEqual(initial)
  })

  test('rescuing the initial casualty emits the renderer rescue signal', () => {
    const scenario = createRendererBenchmark({ seed: 'rescue', enemyCount: 100 })
    const simulation = createSimulation(scenario.config)

    simulation.step({ rescue: true })

    expect(simulation.getSnapshot().effects).toContainEqual(
      expect.objectContaining({ kind: 'rescue-signal' }),
    )
    expect(simulation.getSnapshot().units).toContainEqual(
      expect.objectContaining({ state: 'rescuing' }),
    )
  })

  test('keeps projectiles alive long enough to advance before they expire', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'projectile', enemyCount: 100 }).config,
    )

    for (let tick = 0; tick < 14; tick += 1) simulation.step({})

    const progress = []
    for (let tick = 0; tick < 5; tick += 1) {
      simulation.step({})
      progress.push(simulation.getSnapshot().projectiles[0]?.progress01)
    }

    expect(progress).toHaveLength(5)
    progress.forEach((value, index) => {
      expect(value).toBeCloseTo(index * 0.2)
    })
    simulation.step({})
    expect(simulation.getSnapshot().projectiles).toHaveLength(0)
  })

  test('returns transient moving, attacking, and rescuing states to idle', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'transient', enemyCount: 100 }).config,
    )

    simulation.step({ moveX: 1, rescue: true })
    expect(simulation.getSnapshot().units.some((unit) => unit.state === 'moving')).toBe(true)
    expect(simulation.getSnapshot().units.some((unit) => unit.state === 'rescuing')).toBe(true)

    for (let tick = 0; tick < 60; tick += 1) simulation.step({})
    const friendlies = simulation.getSnapshot().units.filter((unit) => unit.team !== 'enemy')
    expect(friendlies.some((unit) => unit.state === 'moving')).toBe(false)
    expect(friendlies.some((unit) => unit.state === 'attacking')).toBe(false)
    expect(friendlies.some((unit) => unit.state === 'rescuing')).toBe(false)
  })

  test('advances enemies in a fixed id-ordered wave sequence', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'waves', enemyCount: 100 }).config,
    )
    const enemiesAtStart = simulation
      .getSnapshot()
      .units.filter((unit) => unit.kind === 'enemy')

    simulation.step({})
    const firstWave = simulation
      .getSnapshot()
      .units.filter((unit) => unit.kind === 'enemy')
    const firstWaveIds = firstWave
      .filter((unit) => unit.state === 'moving')
      .map((unit) => unit.id)

    expect(firstWaveIds).toEqual(Array.from({ length: 25 }, (_, index) => 19 + index))

    for (let tick = 1; tick < 31; tick += 1) simulation.step({})
    const secondWaveIds = simulation
      .getSnapshot()
      .units.filter((unit) => unit.kind === 'enemy' && unit.state === 'moving')
      .map((unit) => unit.id)

    expect(secondWaveIds).toEqual(Array.from({ length: 50 }, (_, index) => 19 + index))
    expect(firstWave.some((unit, index) => unit.x !== enemiesAtStart[index]?.x)).toBe(
      true,
    )
  })

  test('the core expires renderer effects according to their tick lifetime', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'effect-lifetime', enemyCount: 100 }).config,
    )

    simulation.step({ rescue: true })
    for (let tick = 0; tick < 44; tick += 1) simulation.step({})
    expect(simulation.getSnapshot().effects).toContainEqual(
      expect.objectContaining({ kind: 'rescue-signal' }),
    )

    simulation.step({})
    expect(simulation.getSnapshot().effects).not.toContainEqual(
      expect.objectContaining({ kind: 'rescue-signal' }),
    )
  })

  test('auto combat advances fatigue and emits a morale break before success', () => {
    const simulation = createSimulation(
      createRendererBenchmark({ seed: 'combat', enemyCount: 100 }).config,
    )

    const moraleBreakTargets = new Set<number>()
    const moraleBreakEffects = new Set<number>()
    for (let tick = 0; tick < 75 * 30; tick += 1) {
      simulation.step({})
      for (const effect of simulation.getSnapshot().effects) {
        if (effect.kind !== 'morale-break' || moraleBreakEffects.has(effect.id)) continue
        moraleBreakEffects.add(effect.id)
        const target = simulation
          .getSnapshot()
          .units.find((unit) => unit.x === effect.x && unit.y === effect.y)
        if (target) {
          expect(moraleBreakTargets.has(target.id)).toBe(false)
          moraleBreakTargets.add(target.id)
        }
      }
    }
    const snapshot = simulation.getSnapshot()

    expect(snapshot.units.some((unit) => unit.fatigue01 > 0)).toBe(true)
    expect(moraleBreakEffects.size).toBeGreaterThan(0)
  })
})
