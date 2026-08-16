import { expect, test } from 'vitest'

import { createPrng } from '../../src/core/prng'
import { createGameplayInputQueue } from '../../src/core/gameplay/input-queue'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { createInitialGameState } from '../../src/core/gameplay/state'
import {
  FORMATION_JITTER,
  INITIAL_FORMATION_OFFSETS,
  TEAL_INITIAL_CENTER,
} from '../../src/core/gameplay/constants'

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
  const expectedOffsets = []

  for (let index = 0; index < 16; index += 1) {
    const base = INITIAL_FORMATION_OFFSETS[index % INITIAL_FORMATION_OFFSETS.length]
    expectedOffsets.push({
      x: base.x + expectedFormation.range(-FORMATION_JITTER, FORMATION_JITTER),
      y: base.y + expectedFormation.range(-FORMATION_JITTER, FORMATION_JITTER),
    })
  }

  expect(new Set(state.friendlies.map((unit) => unit.formationOffset)).size).toBe(16)
  expect(state.friendlies.map((unit) => unit.formationOffset)).toEqual(expectedOffsets)
  expect(state.prng.formation).toBe(expectedFormation.getState())
})

test('keeps every fixture entity id out of the runtime spawn range', () => {
  // The rescue-agency fixture seeds its own normal enemy, and spawnForTick issues ids
  // from `18 + wave.requested - 1` starting at tick 0 — so a fixture id inside that range
  // puts two live entities on the same id, and findNormalEnemy() (array-first) then lands
  // damage aimed at the spawned enemy on the fixture one instead.
  const game = createGameplaySimulation({ seed: '47', fixture: 'rescue-agency' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  game.step()
  const state = game.getState()

  const ids = [
    ...state.friendlies.map((unit) => unit.id),
    state.elite.id,
    ...state.normalEnemies.map((enemy) => enemy.id),
  ]
  expect(new Set(ids).size).toBe(ids.length)
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
