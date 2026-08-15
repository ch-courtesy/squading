import { expect, test } from 'vitest'

import { ELITE_AREA_DAMAGE, ELITE_AREA_RADIUS, ELITE_MOVE_SPEED, SCARLET_MOVE_SPEED } from '../../src/core/gameplay/constants'
import { advanceElite, handleEliteDeath, resolveOutcome, spawnElite } from '../../src/core/gameplay/elite'
import { advanceMovement } from '../../src/core/gameplay/movement'
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

function nextSpawn(state: number): number {
  let value = state >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return value >>> 0
}

test('uses the exact warning and damage sequences through tick 880', () => {
  const game = createGameplaySimulation({ seed: 'elite-fixture', fixture: 'determinism' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })

  stepTo(game, 900)

  expect(game.getState().elite.warningTicks).toEqual([570, 610, 650, 690, 730, 770, 810, 850])
  expect(game.getState().elite.damageTicks).toEqual([600, 640, 680, 720, 760, 800, 840, 880])
})

test('consumes normal request angles before exactly one elite angle at tick 540', () => {
  const state = createStateFixture('elite-spawn-order')
  state.combatTick = 540
  const before = state.prng.spawn
  const game = createGameplaySimulation({ seed: 'elite-spawn-order' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  const gameState = game.getState() as typeof state
  gameState.combatTick = 540
  gameState.wave.cursor = 23

  game.step()

  expect(gameState.prng.spawn).toBe(nextSpawn(nextSpawn(nextSpawn(before))))
  expect(gameState.normalEnemies).toHaveLength(2)
  expect(gameState.elite.spawned).toBe(true)
})

test('spawns five units from the active center and clamps elite tracking at the target', () => {
  const state = createStateFixture('elite-motion')
  state.activeSquad = 'teal'
  state.squads.teal.lastCenter = { x: 10, y: 10 }
  const before = state.prng.spawn

  spawnElite(state, 540)

  expect(Math.hypot(state.elite.position.x - 10, state.elite.position.y - 10)).toBeCloseTo(5)
  expect(state.prng.spawn).toBe(nextSpawn(before))

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

  handleEliteDeath(state)
  resolveOutcome(state)

  expect(state).toMatchObject({ mode: 'won', failureReason: null })
  expect(state.elite).toMatchObject({ telegraphCenter: null, telegraphRemaining: 0, cycleIndex: 0 })
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
  ['base healthy long', 1, false, [-0.9, -0.3, 0.3, 0.9], 0],
  ['base healthy short', 1, false, [-0.18, -0.06, 0.06, 0.18], 0],
  ['base exhausted long', 1, true, [-0.9, -0.3, 0.3, 0.9], 2],
  ['base exhausted short', 1, true, [-0.18, -0.06, 0.06, 0.18], 0],
  ['march healthy long', 1.15, false, [-0.9, -0.3, 0.3, 0.9], 0],
  ['march healthy short', 1.15, false, [-0.18, -0.06, 0.06, 0.18], 0],
  ['march exhausted long', 1.15, true, [-0.9, -0.3, 0.3, 0.9], 0],
  ['march exhausted short', 1.15, true, [-0.18, -0.06, 0.06, 0.18], 0],
] as const)('keeps the %s formation-wide elite evasion result hand-derived', (_name, marchMultiplier, exhausted, offsets, expectedHits) => {
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

  expect(state.damageEvents).toHaveLength(expectedHits)
  const travel = SCARLET_MOVE_SPEED * marchMultiplier * (exhausted ? 0.7 : 1) * 30
  for (const [index, friendly] of state.friendlies.entries()) {
    expect(friendly.position.x).toBeCloseTo(10 + offsets[index % offsets.length] + travel)
  }
  expect(state.friendlies.filter((friendly) => friendly.hp === friendly.maxHp - ELITE_AREA_DAMAGE)).toHaveLength(expectedHits)
})
