import { expect, test } from 'vitest'

import { createPrng } from '../../src/core/prng'
import { createGameplayInputQueue } from '../../src/core/gameplay/input-queue'
import { createInitialGameState } from '../../src/core/gameplay/state'
import { FORMATION_JITTER, TEAL_INITIAL_CENTER } from '../../src/core/gameplay/constants'

test('starts at tick zero with scarlet active and three independent streams', () => {
  const state = createInitialGameState('47')

  expect(state).toMatchObject({ combatTick: 0, mode: 'ready', activeSquad: 'scarlet' })
  expect(state.friendlies.filter((unit) => unit.squad === 'teal')).toHaveLength(8)
  expect(state.friendlies.filter((unit) => unit.squad === 'scarlet')).toHaveLength(8)
  expect(Object.keys(state.prng)).toEqual(['cards', 'formation', 'spawn'])
})

test('orders same-tick commands by sequence and copies payloads', () => {
  const queue = createGameplayInputQueue()
  queue.enqueue({ applyTick: 3, sequence: 2, kind: 'switch-squad' })
  queue.enqueue({ applyTick: 3, sequence: 1, kind: 'set-rescue', held: true })

  expect(queue.take(3).map((event) => event.sequence)).toEqual([1, 2])
})

test('consumes one formation jitter pair for each of the sixteen units', () => {
  const state = createInitialGameState('47')
  const expectedFormation = createPrng('47:formation')

  for (let index = 0; index < 16; index += 1) {
    expectedFormation.range(-FORMATION_JITTER, FORMATION_JITTER)
    expectedFormation.range(-FORMATION_JITTER, FORMATION_JITTER)
  }

  expect(new Set(state.friendlies.map((unit) => unit.formationOffset)).size).toBe(16)
  expect(state.prng.formation).toBe(expectedFormation.getState())
})

test('isolates mutable state vectors from sibling units and exported constants', () => {
  const state = createInitialGameState('47')
  const firstOffset = state.friendlies[0].formationOffset as { x: number; y: number }
  const siblingOffset = state.friendlies[8].formationOffset

  firstOffset.x += 10
  ;(state.squads.teal.lastCenter as { x: number; y: number }).x += 10

  expect(siblingOffset.x).not.toBe(firstOffset.x)
  expect(TEAL_INITIAL_CENTER.x).toBe(21)
})
