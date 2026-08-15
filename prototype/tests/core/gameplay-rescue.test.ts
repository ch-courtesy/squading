import { expect, test } from 'vitest'

import { advanceFriendlyAttacks, advanceNormalAttacks } from '../../src/core/gameplay/combat'
import { SCARLET_RESCUE_TICKS, TEAL_RESCUE_TICKS } from '../../src/core/gameplay/constants'
import { advanceMovement } from '../../src/core/gameplay/movement'
import { advanceRescueProgress, resolveRescueAndDownedTimers } from '../../src/core/gameplay/rescue'
import { projectRenderSnapshot } from '../../src/core/gameplay/snapshot'
import { createStateFixture, makeFriendly, makeNormalEnemy, repeat, startRunningGame } from '../helpers/gameplay-fixtures'

function downedFriendly(id: number, squad: 'teal' | 'scarlet', x: number, y: number, downedTicks = 240) {
  const friendly = makeFriendly(id, squad, x, y)
  friendly.life = 'downed'
  friendly.hp = 0
  friendly.downedTicks = downedTicks
  return friendly
}

test('does not lock a remote casualty after 90 held ticks', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 2, 0)
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'

  repeat(90, () => advanceRescueProgress(state, true))

  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })
})

test('filters to eligible casualties before remaining time and id ordering', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const remoteUrgent = downedFriendly(2, 'teal', 3, 0, 1)
  const eligible = downedFriendly(3, 'teal', 1, 0, 10)
  state.friendlies = [rescuer, remoteUrgent, eligible]
  state.activeSquad = 'teal'

  expect(advanceRescueProgress(state, true)).toBe(true)

  expect(rescuer).toMatchObject({ rescueTargetId: eligible.id, rescueProgress: 1 })
})

test.each([['teal', 29, 30], ['scarlet', 44, 45]] as const)(
  '%s completes only on the exact hold boundary',
  (squad, before, complete) => {
    const state = createStateFixture()
    const rescuer = makeFriendly(1, squad, 0, 0)
    const casualty = downedFriendly(2, squad, 1, 0)
    state.friendlies = [rescuer, casualty]
    state.activeSquad = squad

    repeat(before, () => { advanceRescueProgress(state, true); resolveRescueAndDownedTimers(state) })
    expect(casualty.life).toBe('downed')
    expect(rescuer.rescueProgress).toBe(before)

    advanceRescueProgress(state, true)
    resolveRescueAndDownedTimers(state)

    expect(casualty).toMatchObject({ life: 'standing', hp: casualty.maxHp * 0.5, downedTicks: 0 })
    expect(state.stats.rescues).toBe(1)
    expect(complete).toBe(before + 1)
  },
)

test('releasing hold, leaving range, downing the rescuer, or losing the casualty clears the rescue lock', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 1, 0)
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'

  advanceRescueProgress(state, true)
  advanceRescueProgress(state, false)
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })

  casualty.position.x = 2
  advanceRescueProgress(state, true)
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })

  casualty.position.x = 1
  advanceRescueProgress(state, true)
  rescuer.life = 'downed'
  advanceRescueProgress(state, true)
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })

  rescuer.life = 'standing'
  advanceRescueProgress(state, true)
  casualty.life = 'dead'
  advanceRescueProgress(state, true)
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })
})

test('locks exactly one nearest active rescuer out of movement and attacks', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const teammate = makeFriendly(2, 'teal', 0.5, 0)
  const casualty = downedFriendly(3, 'teal', 1, 0)
  state.friendlies = [rescuer, teammate, casualty]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]
  state.activeSquad = 'teal'
  state.input.move = { x: 1, y: 0 }

  expect(advanceRescueProgress(state, true)).toBe(true)
  advanceMovement(state)
  advanceFriendlyAttacks(state)

  expect(rescuer.position.x).toBeGreaterThan(0)
  expect(teammate.position).toEqual({ x: 0.5, y: 0 })
  expect(teammate.attackCooldown).toBe(0)
  expect(state.normalEnemies[0].hp).toBeCloseTo(0.86)
})

test('moves a newly selected rescuer before phase 7 locks it and adds one work', () => {
  const game = startRunningGame('rescue-phase-order')
  const state = game.getState() as ReturnType<typeof createStateFixture>
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const nearest = makeFriendly(2, 'teal', 0.5, 0)
  const casualty = downedFriendly(3, 'teal', 1, 0)
  state.friendlies = [rescuer, nearest, casualty]
  state.activeSquad = 'teal'
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: 1, y: 0 })
  game.enqueue({ applyTick: 0, sequence: 2, kind: 'set-rescue', held: true })

  game.step()

  expect(nearest).toMatchObject({ rescueTargetId: casualty.id, rescueProgress: 1 })
  expect(nearest.position.x).toBeCloseTo(0.61)
  expect(rescuer.position.x).toBeGreaterThan(0)
})

test('keeps the phase-6 rescuer when a moving teammate becomes closer before phase 7', () => {
  const game = startRunningGame('rescue-overtake')
  const state = game.getState() as ReturnType<typeof createStateFixture>
  const firstRescuer = makeFriendly(1, 'teal', 0, 0)
  const movingTeammate = makeFriendly(2, 'teal', -0.1, 0)
  const casualty = downedFriendly(3, 'teal', 1.4, 0)
  state.friendlies = [firstRescuer, movingTeammate, casualty]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]
  state.activeSquad = 'teal'
  firstRescuer.rescueTargetId = casualty.id
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: 1, y: 0 })
  game.enqueue({ applyTick: 0, sequence: 2, kind: 'set-rescue', held: true })

  game.step()

  expect(firstRescuer).toMatchObject({ position: { x: 0, y: 0 }, rescueTargetId: casualty.id, rescueProgress: 1, attackCooldown: 0 })
  expect(movingTeammate).toMatchObject({ rescueTargetId: null })
  expect(movingTeammate.position.x).toBeCloseTo(0.01)
  expect(movingTeammate.attackCooldown).toBeGreaterThan(0)
})

test('clears a released lock before movement so its former rescuer can move', () => {
  const game = startRunningGame('rescue-release-before-move')
  const state = game.getState() as ReturnType<typeof createStateFixture>
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 1, 0)
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = 10
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: 1, y: 0 })
  game.enqueue({ applyTick: 0, sequence: 2, kind: 'set-rescue', held: false })

  game.step()

  expect(rescuer.position.x).toBeCloseTo(0.11)
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })
})

test('applies +1 rescue work then contact damage for a net -14 progress', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 1, 0)
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = 20
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0)]

  expect(advanceRescueProgress(state, true)).toBe(true)
  advanceNormalAttacks(state)
  resolveRescueAndDownedTimers(state)

  expect(rescuer.rescueProgress).toBe(6)
})

test('applies contact and elite hits for a net -29 rescue progress', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 1, 0)
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = 40
  state.damageEvents.push(
    { sourceId: 101, targetId: rescuer.id, amount: 0.09, kind: 'contact' },
    { sourceId: 17, targetId: rescuer.id, amount: 0.35, kind: 'elite-area' },
  )

  advanceRescueProgress(state, true)
  resolveRescueAndDownedTimers(state)

  expect(rescuer.rescueProgress).toBe(11)
})

test('resolves completion before expiry, starts new downed timers next tick, and revives at half applied max hp', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'scarlet', 0, 0)
  const casualty = downedFriendly(2, 'scarlet', 1, 0, 1)
  const newlyDowned = makeFriendly(3, 'scarlet', 2, 0)
  const expiring = downedFriendly(4, 'scarlet', 3, 0, 1)
  newlyDowned.hp = 0
  state.friendlies = [rescuer, casualty, newlyDowned, expiring]
  state.activeSquad = 'scarlet'
  state.squads.scarlet.hpMultiplier = 1.2
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = SCARLET_RESCUE_TICKS

  resolveRescueAndDownedTimers(state)

  expect(casualty).toMatchObject({ life: 'standing', downedTicks: 0 })
  expect(casualty.hp).toBeCloseTo(0.45)
  expect(newlyDowned).toMatchObject({ life: 'downed', downedTicks: 240 })
  expect(expiring).toMatchObject({ life: 'dead', downedTicks: 0 })
  expect(state.stats.rescues).toBe(1)

  resolveRescueAndDownedTimers(state)

  expect(newlyDowned.downedTicks).toBe(239)
})

test('projects a rescue-signal effect at the locked casualty', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const casualty = downedFriendly(2, 'teal', 1, 1)
  state.friendlies = [rescuer, casualty]
  state.activeSquad = 'teal'
  state.combatTick = 17

  advanceRescueProgress(state, true)

  expect(projectRenderSnapshot(state).effects).toContainEqual({
    id: casualty.id,
    kind: 'rescue-signal',
    team: 'teal',
    x: 1,
    y: 1,
    startedTick: 17,
    durationTicks: TEAL_RESCUE_TICKS - 1,
  })
})
