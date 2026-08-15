import { expect, test } from 'vitest'

import { SCARLET_ATTACK_INTERVAL, SCARLET_MOVE_SPEED } from '../../src/core/gameplay/constants'
import { attackInterval } from '../../src/core/gameplay/combat'
import { advanceMovement } from '../../src/core/gameplay/movement'
import { SPAWN_TABLE } from '../../src/core/gameplay/progression'
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

  repeat(270, () => advanceFatigue(state, { moved: true, attacked: false, rescued: false }))

  expect(state.squads.scarlet).toMatchObject({ fatigue: 0.6, exhausted: true })

  state.activeSquad = 'teal'
  repeat(180, () => advanceFatigue(state, { moved: true, attacked: false, rescued: false }))

  expect(state.squads.scarlet).toMatchObject({ fatigue: 0, exhausted: false })
})

test('gains fatigue on an actual attack tick but not on a cooldown-only tick', () => {
  const game = startRunningGame('attack-activity')
  const state = game.getState() as ReturnType<typeof createStateFixture>
  const attacker = state.friendlies.find((friendly) => friendly.squad === 'scarlet')!
  attacker.attackCooldown = 1
  state.friendlies = [attacker]
  state.activeSquad = 'scarlet'
  state.normalEnemies = [makeNormalEnemy(101, 24, 13)]
  state.normalEnemies[0].attackCooldown = 1_000

  game.step()

  expect(game.getState().squads.scarlet.fatigue).toBe(1 / 450)

  game.step()

  expect(game.getState().squads.scarlet.fatigue).toBe(1 / 450)
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

test('keeps inactive follow speed at 0.14 when the controlled scarlet squad is exhausted', () => {
  const state = createStateFixture()
  state.friendlies = [
    { ...state.friendlies.find((friendly) => friendly.squad === 'teal')!, position: { x: 0, y: 5 }, formationOffset: { x: 0, y: 0 } },
    { ...state.friendlies.find((friendly) => friendly.squad === 'scarlet')!, position: { x: 10, y: 5 }, formationOffset: { x: 0, y: 0 } },
  ]
  state.activeSquad = 'scarlet'
  state.squads.scarlet.exhausted = true
  state.squads.scarlet.lastDirection = { x: 1, y: 0 }

  advanceMovement(state)

  expect(state.friendlies[0].position.x).toBeCloseTo(0.14)
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

function controlledDamage(seed: string, policy: 'alternate' | 'teal' | 'scarlet'): number {
  const game = createGameplaySimulation({ seed, fixture: 'determinism' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  const state = game.getState() as ReturnType<typeof createStateFixture>
  state.activeSquad = policy === 'teal' ? 'teal' : 'scarlet'
  state.wave.cursor = SPAWN_TABLE.length
  state.elite.hp = 0
  const target = makeNormalEnemy(999, 24, 13)
  target.hp = 1_000
  target.attackCooldown = 1_000
  state.normalEnemies = [target]

  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ] as const
  for (let tick = 0, sequence = 1; tick < 900; tick += 15, sequence += 1) {
    const direction = directions[(tick / 15) % directions.length]
    game.enqueue({ applyTick: tick, sequence, kind: 'set-move', ...direction })
  }

  if (policy === 'alternate') {
    for (let tick = 60, sequence = 1_000; tick < 900; tick += 60, sequence += 1) {
      game.enqueue({ applyTick: tick, sequence, kind: 'switch-squad' })
    }
  }
  repeat(900, () => game.step())
  return 1_000 - game.getState().normalEnemies[0].hp
}

test('switching squads sustains over 20 percent more controlled-target damage than either no-switch policy', () => {
  const switchingDamage = controlledDamage('damage-policy', 'alternate')
  const tealSoloDamage = controlledDamage('damage-policy', 'teal')
  const scarletSoloDamage = controlledDamage('damage-policy', 'scarlet')

  expect(switchingDamage).toBeGreaterThan(tealSoloDamage * 1.2)
  expect(switchingDamage).toBeGreaterThan(scarletSoloDamage * 1.2)
})
