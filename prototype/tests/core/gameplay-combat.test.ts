import { expect, test } from 'vitest'

import { ARENA_WIDTH, SCARLET_MOVE_SPEED } from '../../src/core/gameplay/constants'
import { advanceFriendlyAttacks, advanceNormalAttacks } from '../../src/core/gameplay/combat'
import { advanceMovement } from '../../src/core/gameplay/movement'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { createStateFixture, makeFriendly, makeNormalEnemy } from '../helpers/gameplay-fixtures'

test('clamps enemy movement to the target without overshoot', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.01, 0)]

  advanceMovement(state)

  expect(state.normalEnemies[0].position).toEqual({ x: 0, y: 0 })
})

test('reselects a dead target before the next id-ordered attack', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0), makeFriendly(2, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0), makeNormalEnemy(102, 0.6, 0)]
  state.normalEnemies[0].hp = 0.11

  advanceFriendlyAttacks(state)

  expect(state.normalEnemies.map((enemy) => enemy.hp)).toEqual([0, 0.89])
})

test('only the two lowest enemy ids damage one friendly', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [101, 102, 103].map((id) => makeNormalEnemy(id, 0.5, 0))

  advanceNormalAttacks(state)

  expect(state.damageEvents.map((event) => event.sourceId)).toEqual([101, 102])
})

test('does not let out-of-range enemies reserve contact attack slots', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [
    makeNormalEnemy(101, 10, 0),
    makeNormalEnemy(102, 11, 0),
    makeNormalEnemy(103, 0.5, 0),
  ]

  advanceNormalAttacks(state)

  expect(state.damageEvents.map((event) => event.sourceId)).toEqual([103])
})

test('retains a third enemy re-target through the next movement phase', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0), makeFriendly(2, 'scarlet', 3, 0)]
  state.normalEnemies = [101, 102, 103].map((id) => makeNormalEnemy(id, 0.5, 0))

  advanceMovement(state)
  advanceNormalAttacks(state)
  advanceMovement(state)

  expect(state.normalEnemies[2].targetId).toBe(2)
})

test('moves the inactive squad toward the active squad trailing point', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'teal', 0, 5), makeFriendly(2, 'scarlet', 10, 5)]
  state.activeSquad = 'scarlet'
  state.squads.scarlet.lastDirection = { x: 1, y: 0 }

  advanceMovement(state)

  expect(state.friendlies[0].position).toMatchObject({ y: 5 })
  expect(state.friendlies[0].position.x).toBeCloseTo(0.14)
})

test('keeps a squad last center when it has no standing soldiers', () => {
  const state = createStateFixture()
  const friendly = makeFriendly(1, 'scarlet', 5, 5)
  friendly.life = 'downed'
  state.friendlies = [friendly]
  state.squads.scarlet.lastCenter = { x: 7, y: 8 }

  advanceMovement(state)

  expect(state.squads.scarlet.lastCenter).toEqual({ x: 7, y: 8 })
})

test('prioritizes an in-range elite over a closer normal enemy', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]
  state.elite.spawned = true
  state.elite.position = { x: 1, y: 0 }

  advanceFriendlyAttacks(state)

  expect(state).toMatchObject({ elite: { hp: 24.39 }, normalEnemies: [{ hp: 1 }] })
})

test('does not attack again before its cooldown expires', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]

  advanceFriendlyAttacks(state)
  advanceFriendlyAttacks(state)

  expect(state.normalEnemies[0].hp).toBe(0.89)
})

test('runs movement and attack reducers through the simulation facade', () => {
  const game = createGameplaySimulation({ seed: 'facade' })
  const before = game.getState().friendlies.find((friendly) => friendly.squad === 'scarlet')!.position.x
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: 1, y: 0 })

  game.step()

  expect(game.getState().friendlies.find((friendly) => friendly.squad === 'scarlet')!.position.x).toBeGreaterThan(before)
})

test('normalizes active formation movement and clamps it inside the arena', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', ARENA_WIDTH - 0.01, 2)]
  state.input.move = { x: 3, y: 4 }

  advanceMovement(state)

  expect(state.friendlies[0].position).toEqual({ x: ARENA_WIDTH, y: 2 + SCARLET_MOVE_SPEED * 0.8 })
})

test('stops normals and clears targets when nobody is standing', () => {
  const state = createStateFixture()
  const friendly = makeFriendly(1, 'scarlet', 0, 0)
  friendly.life = 'downed'
  state.friendlies = [friendly]
  state.normalEnemies = [makeNormalEnemy(101, 2, 0)]
  state.normalEnemies[0].targetId = 1

  advanceMovement(state)

  expect(state.normalEnemies[0]).toMatchObject({ position: { x: 2, y: 0 }, targetId: null })
})
