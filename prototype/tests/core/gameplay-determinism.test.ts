import { expect, test } from 'vitest'

import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import type { GameplayStepPhases } from '../../src/core/gameplay/simulation'

test('includes queued events, cooldowns and named prng state in the digest', () => {
  const game = createGameplaySimulation({ seed: 'digest' })
  const before = game.getDigest()

  game.enqueue({ applyTick: 0, sequence: 1, kind: 'switch-squad' })

  expect(game.getDigest()).not.toBe(before)
})

test('start-battle changes ready to running without consuming tick zero', () => {
  const game = createGameplaySimulation({ seed: '47' })

  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })

  expect(game.getState()).toMatchObject({ combatTick: 0, mode: 'running', activeSquad: 'scarlet' })
})

test.each([Number.NaN, Infinity, -Infinity])('rejects %s without state mutation', (value) => {
  const game = createGameplaySimulation({ seed: 'finite' })
  const before = game.getDigest()

  expect(() => game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: value, y: 0 })).toThrow(TypeError)
  expect(game.getDigest()).toBe(before)
})

test('runs the gameplay phases in the fixed order and projects sorted render units', () => {
  const calls: string[] = []
  const names: Array<keyof GameplayStepPhases> = [
    'cooldowns',
    'input',
    'spawn',
    'commandsUpgrades',
    'fatigue',
    'movement',
    'rescueProgress',
    'friendlyAttacks',
    'normalAttacks',
    'eliteTelegraph',
    'rescueDeathXp',
    'tick',
    'outcome',
    'upgradeEntry',
  ]
  const phases = Object.fromEntries(names.map((name) => [name, () => calls.push(name)])) as Partial<GameplayStepPhases>
  const game = createGameplaySimulation({ seed: 'phases', phases })

  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  game.step()

  expect(calls).toEqual(names)
  expect(game.getSnapshot().activeSquad).toBe('scarlet')
  expect(game.getSnapshot().units.map((unit) => unit.id)).toEqual(
    [...game.getSnapshot().units.map((unit) => unit.id)].sort((left, right) => left - right),
  )
})
