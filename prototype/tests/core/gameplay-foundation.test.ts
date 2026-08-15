import { expect, test } from 'vitest'

import { createGameplayInputQueue } from '../../src/core/gameplay/input-queue'
import { createInitialGameState } from '../../src/core/gameplay/state'

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
