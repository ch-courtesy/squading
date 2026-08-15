import { expect, test } from 'vitest'

import { SCARLET_ATTACK_INTERVAL, SCARLET_MOVE_SPEED } from '../../src/core/gameplay/constants'
import { attackInterval } from '../../src/core/gameplay/combat'
import { advanceMovement } from '../../src/core/gameplay/movement'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { advanceFatigue, movementMultiplier } from '../../src/core/gameplay/squads'
import { createStateFixture, makeNormalEnemy, repeat, startRunningGame } from '../helpers/gameplay-fixtures'

test('rejects a switch before 60 ticks and accepts it on tick 60', () => {
  const game = startRunningGame('switch')
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'switch-squad' })
  game.step()
  repeat(58, () => game.step())
  game.enqueue({ applyTick: 59, sequence: 2, kind: 'switch-squad' })
  game.step()

  expect(game.getState().activeSquad).toBe('teal')

  game.enqueue({ applyTick: 60, sequence: 3, kind: 'switch-squad' })
  game.step()

  expect(game.getState()).toMatchObject({ activeSquad: 'scarlet', switchCooldown: 60 })
})

test('exhausts after 270 active ticks and fully recovers after 180 inactive ticks', () => {
  const state = createStateFixture()
  state.activeSquad = 'scarlet'
  state.input.move = { x: 1, y: 0 }

  repeat(270, () => advanceFatigue(state))

  expect(state.squads.scarlet).toMatchObject({ fatigue: 0.6, exhausted: true })

  state.activeSquad = 'teal'
  repeat(180, () => advanceFatigue(state))

  expect(state.squads.scarlet).toMatchObject({ fatigue: 0, exhausted: false })
})

test('counts an active squad with a selected target as exerting', () => {
  const state = createStateFixture()
  state.activeSquad = 'scarlet'
  state.friendlies = [state.friendlies.find((friendly) => friendly.squad === 'scarlet')!]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]
  state.friendlies[0].targetId = 101

  repeat(270, () => advanceFatigue(state))

  expect(state.squads.scarlet).toMatchObject({ fatigue: 0.6, exhausted: true })
})

test('applies exhaustion only to the controlled squad movement and attack interval', () => {
  const state = createStateFixture()
  state.activeSquad = 'scarlet'
  state.squads.scarlet.exhausted = true
  state.squads.teal.exhausted = true
  const scarlet = state.friendlies.find((friendly) => friendly.squad === 'scarlet')!

  expect(movementMultiplier(state, 'scarlet')).toBe(0.7)
  expect(movementMultiplier(state, 'teal')).toBe(1)
  expect(attackInterval(state, scarlet)).toBe(SCARLET_ATTACK_INTERVAL * 1.8)

  state.friendlies = [
    { ...state.friendlies.find((friendly) => friendly.squad === 'scarlet')!, position: { x: 10, y: 10 } },
    { ...state.friendlies.find((friendly) => friendly.squad === 'teal')!, position: { x: 0, y: 10 } },
  ]
  state.input.move = { x: 1, y: 0 }
  state.squads.scarlet.lastDirection = { x: 1, y: 0 }

  advanceMovement(state)

  expect(state.friendlies[0].position.x).toBeCloseTo(10 + SCARLET_MOVE_SPEED * 0.7)
  expect(state.friendlies[1].position.x).toBeGreaterThan(0)
})

test('keeps a defeated controlled squad selected until an explicit switch event', () => {
  const game = startRunningGame('no-auto-switch')
  const state = game.getState() as ReturnType<typeof createStateFixture>
  state.activeSquad = 'scarlet'
  for (const friendly of state.friendlies) {
    if (friendly.squad === 'scarlet') friendly.life = 'dead'
  }

  game.step()

  expect(game.getState().activeSquad).toBe('scarlet')
})

function controlledDamage(seed: string, squads: 'both' | 'teal' | 'scarlet'): number {
  const game = startRunningGame(seed)
  const state = game.getState() as ReturnType<typeof createStateFixture>
  state.friendlies = state.friendlies.filter((friendly) => squads === 'both' || friendly.squad === squads)
  state.activeSquad = squads === 'teal' ? 'teal' : 'scarlet'
  const target = makeNormalEnemy(999, 24, 13)
  target.hp = 1_000
  target.attackCooldown = 1_000
  state.normalEnemies = [target]

  if (squads === 'both') {
    for (let tick = 60, sequence = 1; tick < 900; tick += 60, sequence += 1) {
      game.enqueue({ applyTick: tick, sequence, kind: 'switch-squad' })
    }
  }
  repeat(900, () => game.step())
  return 1_000 - game.getState().normalEnemies[0].hp
}

test('switching squads sustains at least 20 percent more controlled-target damage over 30 seconds', () => {
  const switchingDamage = controlledDamage('damage-switch', 'both')
  const tealSoloDamage = controlledDamage('damage-teal', 'teal')
  const scarletSoloDamage = controlledDamage('damage-scarlet', 'scarlet')

  expect(switchingDamage).toBeGreaterThanOrEqual(tealSoloDamage * 1.2)
  expect(switchingDamage).toBeGreaterThanOrEqual(scarletSoloDamage * 1.2)
})
