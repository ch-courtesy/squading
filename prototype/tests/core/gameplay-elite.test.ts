import { expect, test } from 'vitest'

import { ELITE_AREA_DAMAGE, ELITE_AREA_RADIUS, ELITE_MOVE_SPEED, SCARLET_MOVE_SPEED } from '../../src/core/gameplay/constants'
import { advanceElite, resolveOutcome, spawnElite } from '../../src/core/gameplay/elite'
import { advanceMovement } from '../../src/core/gameplay/movement'
import { spawnForTick } from '../../src/core/gameplay/progression'
import { resolveRescueAndDownedTimers } from '../../src/core/gameplay/rescue'
import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { createStateFixture, makeFriendly } from '../helpers/gameplay-fixtures'

function stepTo(game: ReturnType<typeof createGameplaySimulation>, target: number): void {
  let sequence = 1
  while (game.getState().combatTick < target) {
    if (game.getState().mode === 'awaiting-upgrade') {
      const index = game.getState().upgrade.offered.indexOf('power') as 0 | 1 | 2
      game.enqueue({ applyTick: game.getState().combatTick, sequence: sequence++, kind: 'choose-upgrade', index })
    }
    game.step()
  }
}

test('uses the exact warning and damage sequences through tick 880', () => {
  const game = createGameplaySimulation({ seed: 'elite-fixture', fixture: 'determinism' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })

  stepTo(game, 900)

  expect(game.getState().elite.warningTicks).toEqual([570, 610, 650, 690, 730, 770, 810, 850])
  expect(game.getState().elite.damageTicks).toEqual([600, 640, 680, 720, 760, 800, 840, 880])
})

test('uses draw one and two for tick-540 normals before draw three for the elite', () => {
  const expected = createStateFixture('elite-spawn-order')
  expected.combatTick = 540
  expected.wave.cursor = 23
  expected.activeSquad = 'teal'
  expected.squads.teal.lastCenter = { x: 12, y: 8 }
  spawnForTick(expected, 540)
  spawnElite(expected, 540)
  advanceMovement(expected)
  advanceElite(expected, 540)

  const game = createGameplaySimulation({ seed: 'elite-spawn-order' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  const gameState = game.getState() as typeof expected
  gameState.combatTick = 540
  gameState.wave.cursor = 23
  gameState.activeSquad = 'teal'
  gameState.squads.teal.lastCenter = { x: 12, y: 8 }

  game.step()

  expect(gameState.normalEnemies.map((enemy) => enemy.position)).toEqual(expected.normalEnemies.map((enemy) => enemy.position))
  expect(gameState.elite.position).toEqual(expected.elite.position)
})

test('spawns five units from the active center and clamps elite tracking at the target', () => {
  const state = createStateFixture('elite-motion')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 10, y: 10 }
  const expected = createStateFixture('elite-motion')
  expected.activeSquad = 'teal'
  expected.squads.teal.lastCenter = { x: 10, y: 10 }

  spawnElite(state, 540)
  spawnElite(expected, 540)

  expect(Math.hypot(state.elite.position.x - 10, state.elite.position.y - 10)).toBeCloseTo(5)
  expect(state.elite.position).toEqual(expected.elite.position)
  expect(state.prng.spawn).toBe(expected.prng.spawn)

  state.elite.position = { x: 10 + ELITE_MOVE_SPEED / 2, y: 10 }
  advanceElite(state, 541)

  expect(state.elite.position).toEqual({ x: 10, y: 10 })
})

test('freezes the warning center before a squad can move away', () => {
  const state = createStateFixture()
  state.elite.spawned = true
  state.elite.position = { x: 0, y: 0 }
  state.activeSquad = 'scarlet'
  state.squads.scarlet.lastCenter = { x: 4, y: 6 }

  advanceElite(state, 570)
  state.squads.scarlet.lastCenter = { x: 20, y: 20 }
  advanceElite(state, 571)

  expect(state.elite).toMatchObject({ telegraphCenter: { x: 4, y: 6 }, telegraphRemaining: 29 })
})

test('damages only standing friendlies at or inside the two-unit boundary and feeds rescue damage', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 2, 0)
  const casualty = makeFriendly(2, 'teal', 1, 0)
  casualty.life = 'downed'
  casualty.hp = 0
  const outside = makeFriendly(3, 'teal', 2.001, 0)
  const downed = makeFriendly(4, 'teal', 0, 0)
  downed.life = 'downed'
  downed.hp = 0
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = 30
  state.friendlies = [rescuer, casualty, outside, downed]
  state.activeSquad = 'teal'
  state.elite.spawned = true
  state.elite.telegraphCenter = { x: 0, y: 0 }
  state.elite.telegraphRemaining = 1

  advanceElite(state, 600)

  expect(rescuer.hp).toBeCloseTo(rescuer.maxHp - ELITE_AREA_DAMAGE)
  expect(outside.hp).toBe(outside.maxHp)
  expect(downed.hp).toBe(0)
  expect(state.damageEvents).toEqual([{ sourceId: state.elite.id, targetId: rescuer.id, amount: ELITE_AREA_DAMAGE, kind: 'elite-area' }])
  resolveRescueAndDownedTimers(state)
  expect(rescuer.rescueProgress).toBe(15)
})

test('elite death cancels a live telegraph and wins before same-tick wipe', () => {
  const state = createStateFixture()
  state.combatTick = 600
  state.friendlies.forEach((unit) => { unit.hp = 0; unit.life = 'downed' })
  state.elite.spawned = true
  state.elite.hp = 0
  state.elite.telegraphCenter = { x: 10, y: 10 }
  state.elite.telegraphRemaining = 10

  resolveOutcome(state)

  expect(state).toMatchObject({ mode: 'won', failureReason: null })
  expect(state.elite).toMatchObject({ spawned: false, targetId: null, telegraphCenter: null, telegraphRemaining: 0, cycleIndex: 0 })
})

test('loses when every friendly is no longer standing before the elite deadline', () => {
  const state = createStateFixture()
  state.elite.spawned = true
  state.friendlies.forEach((unit) => { unit.life = 'downed'; unit.hp = 0 })

  resolveOutcome(state)

  expect(state).toMatchObject({ mode: 'lost', failureReason: 'all-units-lost' })
})

test('loses at combat tick 900 when the elite survives', () => {
  const state = createStateFixture()
  state.combatTick = 900
  state.elite.spawned = true

  resolveOutcome(state)

  expect(state).toMatchObject({ mode: 'lost', failureReason: 'elite-survived' })
})

test('terminal resolution prevents an otherwise eligible upgrade entry', () => {
  const game = createGameplaySimulation({ seed: 'terminal-over-upgrade' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  const state = game.getState() as ReturnType<typeof createStateFixture>
  state.stats.xp = 16
  state.friendlies.forEach((unit) => { unit.life = 'downed'; unit.hp = 0 })

  game.step()

  expect(state).toMatchObject({ mode: 'lost', failureReason: 'all-units-lost' })
  expect(state.upgrade.offered).toEqual([])
})

test.each([
  ['base healthy long', 1, false, [-0.9, -0.3, 0.3, 0.9], []],
  ['base healthy short', 1, false, [-0.18, -0.06, 0.06, 0.18], []],
  ['base exhausted long', 1, true, [-0.9, -0.3, 0.3, 0.9], [1, 5]],
  ['base exhausted short', 1, true, [-0.18, -0.06, 0.06, 0.18], []],
  ['march healthy long', 1.15, false, [-0.9, -0.3, 0.3, 0.9], []],
  ['march healthy short', 1.15, false, [-0.18, -0.06, 0.06, 0.18], []],
  ['march exhausted long', 1.15, true, [-0.9, -0.3, 0.3, 0.9], []],
  ['march exhausted short', 1.15, true, [-0.18, -0.06, 0.06, 0.18], []],
] as const)('keeps the %s formation-wide elite evasion result hand-derived', (_name, marchMultiplier, exhausted, offsets, expectedHitIds) => {
  const state = createStateFixture()
  state.activeSquad = 'scarlet'
  state.squads.scarlet.movementMultiplier = marchMultiplier
  state.squads.scarlet.exhausted = exhausted
  state.input.move = { x: 1, y: 0 }
  state.elite.spawned = true
  state.elite.position = { x: 100, y: 0 }
  state.elite.telegraphCenter = { x: 10, y: 10 }
  state.elite.telegraphRemaining = 1
  state.friendlies = Array.from({ length: 8 }, (_, index) => makeFriendly(index + 1, 'scarlet', 10 + offsets[index % offsets.length], 10 + (index < 4 ? -0.1 : 0.1)))

  for (let tick = 0; tick < 30; tick += 1) advanceMovement(state)
  advanceElite(state, 600)

  expect(state.damageEvents.map((event) => event.targetId)).toEqual(expectedHitIds)
  const travel = SCARLET_MOVE_SPEED * marchMultiplier * (exhausted ? 0.7 : 1) * 30
  for (const [index, friendly] of state.friendlies.entries()) {
    expect(friendly.position.x).toBeCloseTo(10 + offsets[index % offsets.length] + travel)
  }
  expect(state.friendlies.filter((friendly) => friendly.hp === friendly.maxHp - ELITE_AREA_DAMAGE).map((friendly) => friendly.id)).toEqual(expectedHitIds)
})
