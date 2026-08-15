import { expect, test } from 'vitest'

import { BATTLE_TICKS } from '../../src/core/gameplay/constants'
import { digestGameState } from '../../src/core/gameplay/digest'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import type { GameplayStepPhases } from '../../src/core/gameplay/simulation'
import { createStateFixture } from '../helpers/gameplay-fixtures'

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

test('toggle-pause applies synchronously and clears persistent input without consuming a tick', () => {
  const game = createGameplaySimulation({ seed: 'pause' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: 1, y: -1 })
  game.enqueue({ applyTick: 0, sequence: 2, kind: 'set-rescue', held: true })
  game.step()
  const tick = game.getState().combatTick

  game.enqueue({ applyTick: tick, sequence: 3, kind: 'toggle-pause' })

  expect(game.getState()).toMatchObject({ mode: 'paused', combatTick: tick, input: { move: { x: 0, y: 0 }, rescueHeld: false } })
  game.enqueue({ applyTick: tick, sequence: 4, kind: 'toggle-pause' })
  expect(game.getState()).toMatchObject({ mode: 'running', combatTick: tick, input: { move: { x: 0, y: 0 }, rescueHeld: false } })
})

test('choose-upgrade applies synchronously in awaiting-upgrade and clears persistent input', () => {
  const game = createGameplaySimulation({ seed: 'upgrade' })
  const state = game.getState() as { mode: string; input: { move: { x: number; y: number }; rescueHeld: boolean }; upgrade: { offered: readonly ('power' | 'march' | 'vigor')[]; choice: string | null; applied: boolean } }
  state.mode = 'awaiting-upgrade'
  state.input = { move: { x: 1, y: 1 }, rescueHeld: true }
  state.upgrade = { offered: ['power', 'march', 'vigor'], choice: null, applied: true }
  const tick = game.getState().combatTick

  game.enqueue({ applyTick: tick, sequence: 0, kind: 'choose-upgrade', index: 1 })

  expect(game.getState()).toMatchObject({
    mode: 'running',
    combatTick: tick,
    input: { move: { x: 0, y: 0 }, rescueHeld: false },
    upgrade: { choice: 'march', applied: false },
  })
})

test('rejects malformed upgrade index without state mutation', () => {
  const game = createGameplaySimulation({ seed: 'invalid-upgrade' })
  const state = game.getState() as { mode: string; upgrade: { offered: readonly ('power' | 'march' | 'vigor')[]; choice: string | null; applied: boolean } }
  state.mode = 'awaiting-upgrade'
  state.upgrade = { offered: ['power', 'march', 'vigor'], choice: null, applied: false }
  const before = game.getDigest()

  expect(() => game.enqueue({ applyTick: 0, sequence: 0, kind: 'choose-upgrade', index: 3 } as never)).toThrow(TypeError)

  expect(game.getDigest()).toBe(before)
})

test('does not execute phases or increment past the battle tick cap', () => {
  const calls: string[] = []
  const game = createGameplaySimulation({ seed: 'cap', phases: { cooldowns: () => calls.push('cooldowns') } })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  ;(game.getState() as { combatTick: number }).combatTick = BATTLE_TICKS

  game.step()

  expect(game.getState().combatTick).toBe(BATTLE_TICKS)
  expect(calls).toEqual([])
})

test('digest ignores insertion order for otherwise equal damage events', () => {
  const left = createStateFixture('damage-order')
  const right = createStateFixture('damage-order')
  const first = { sourceId: 1, targetId: 2, amount: 0.1, kind: 'contact' as const }
  const second = { sourceId: 1, targetId: 2, amount: 0.2, kind: 'contact' as const }
  left.damageEvents.push(first, second)
  right.damageEvents.push(second, first)

  expect(digestGameState(left)).toBe(digestGameState(right))
})
