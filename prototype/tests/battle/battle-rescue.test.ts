// Batch C fixtures, part 2: §1.11 rescue — the lock (step 3) and the progress (step 8).
//
// Placeholders this file was hand-computed against: RESCUE_RANGE 1.5, RESCUE_TICKS 36,
// RESCUE_INVULNERABLE_TICKS 45, RESCUE_REVIVE_FRACTION 0.5, SOLDIER_HP 1.4,
// COMMANDER_MOVE_SPEED 0.115. Every count below is derived from the constant, so a tuning
// pass moves the numbers without rewriting the claims.

import { describe, expect, it } from 'vitest'

import {
  COMMANDER_MOVE_SPEED,
  RESCUE_INVULNERABLE_TICKS,
  RESCUE_RANGE,
  RESCUE_REVIVE_FRACTION,
  RESCUE_TICKS,
  SOLDIER_HP,
} from '../../src/core/battle/constants'
import { applyStep12Damage } from '../../src/core/battle/damage'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  cancelRescue,
  rescueCandidateId,
  resolveStep3RescueLock,
  resolveStep8Rescue,
} from '../../src/core/battle/rescue'
import { COMMANDER_ID, createInitialBattleState, findFriendly } from '../../src/core/battle/state'
import type { BattleState, DamageEvent, FriendlyUnit } from '../../src/core/battle/types'

const NO_EVENTS = { movementKeydown: false }
const MOVE_KEYDOWN = { movementKeydown: true }

function unit(state: BattleState, id: number): FriendlyUnit {
  const found = findFriendly(state, id)
  if (!found) throw new Error(`fixture has no friendly ${id}`)
  return found
}

/**
 * The commander stands at (28,16) holding Space with no movement input; every soldier
 * named in `downed` lies at the given offset from it, and every other body is dead so it
 * cannot shift a tie.
 */
function fixture(downed: Record<number, { dx: number; dy: number }>): BattleState {
  const state = createInitialBattleState('seed-a')
  state.mode = 'running'
  const commander = unit(state, COMMANDER_ID)

  for (const body of state.friendlies) {
    if (body.id === COMMANDER_ID) continue
    const offset = downed[body.id]
    if (!offset) {
      body.life = 'dead'
      body.hp = 0
      body.deathTick = 0
      continue
    }
    body.life = 'downed'
    body.hp = 0
    body.downedTicks = 0
    body.position = { x: commander.position.x + offset.dx, y: commander.position.y + offset.dy }
  }

  state.input = { move: { x: 0, y: 0 }, spaceHeld: true }
  return state
}

function shotAt(targetId: number, amount: number): DamageEvent {
  return { side: 'enemy', attackerId: 101, targetId, amount, cause: 'shooter-shot' }
}

describe('§1.11 lock establishment (step 3)', () => {
  it('does not establish while the movement input vector is non-zero', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    state.input.move = { x: 1, y: 0 }

    resolveStep3RescueLock(state, NO_EVENTS)

    expect(state.rescue.active).toBe(false)
    expect(state.rescue.targetId).toBeNull()

    // Release the key and the same tick's three conditions are all met.
    state.input.move = { x: 0, y: 0 }
    resolveStep3RescueLock(state, NO_EVENTS)
    expect(state.rescue).toMatchObject({ active: true, targetId: 2, progress: 0 })
  })

  it('needs Space, a candidate and a zero move vector — all three', () => {
    const noSpace = fixture({ 2: { dx: 0.5, dy: 0 } })
    noSpace.input.spaceHeld = false
    resolveStep3RescueLock(noSpace, NO_EVENTS)
    expect(noSpace.rescue.active).toBe(false)

    // Out of range by a hair: RESCUE_RANGE is a radius, not a suggestion.
    const outOfRange = fixture({ 2: { dx: RESCUE_RANGE + 0.01, dy: 0 } })
    resolveStep3RescueLock(outOfRange, NO_EVENTS)
    expect(outOfRange.rescue.active).toBe(false)
    expect(rescueCandidateId(outOfRange)).toBeNull()

    const inRange = fixture({ 2: { dx: RESCUE_RANGE, dy: 0 } })
    resolveStep3RescueLock(inRange, NO_EVENTS)
    expect(inRange.rescue.active).toBe(true)
  })

  it('will not establish for a command unit that is not standing', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    const commander = unit(state, COMMANDER_ID)
    commander.life = 'downed'
    commander.hp = 0

    resolveStep3RescueLock(state, NO_EVENTS)
    expect(state.rescue.active).toBe(false)
  })

  it('ranks candidates original commander -> downedTicks ascending -> id', () => {
    // A soldier holds command; the original commander and two soldiers are all in range.
    const state = fixture({ 3: { dx: 0.4, dy: 0 }, 4: { dx: 0.5, dy: 0 } })
    const commander = unit(state, COMMANDER_ID)
    commander.life = 'downed'
    commander.hp = 0
    commander.downedTicks = 240 // the longest wait by far
    commander.position = { x: 28.6, y: 16 }
    const acting = unit(state, 2)
    acting.life = 'standing'
    acting.hp = SOLDIER_HP
    acting.position = { x: 28, y: 16 }
    state.commandUnitId = acting.id
    unit(state, 3).downedTicks = 5
    unit(state, 4).downedTicks = 5

    // §1.11: the original commander outranks both a shorter wait and a lower id.
    expect(rescueCandidateId(state)).toBe(COMMANDER_ID)

    // With the original commander out of range, the shorter wait wins.
    commander.position = { x: 40, y: 16 }
    unit(state, 4).downedTicks = 1
    expect(rescueCandidateId(state)).toBe(4)

    // Tied waits fall back to the lower id.
    unit(state, 4).downedTicks = 5
    expect(rescueCandidateId(state)).toBe(3)
  })
})

describe('§1.11 cancellation (step 3)', () => {
  it('cancels on a movement keydown event and resets progress to zero', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    state.rescue.progress = 17

    resolveStep3RescueLock(state, MOVE_KEYDOWN)

    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('does NOT cancel on a merely held movement vector — that was the v5 defect', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    const commander = unit(state, COMMANDER_ID)
    resolveStep3RescueLock(state, NO_EVENTS)
    state.rescue.progress = 9

    // W is still down from the walk over here: held state, no new keydown event.
    state.input.move = { x: 0, y: -1 }
    resolveStep3RescueLock(state, NO_EVENTS)

    expect(state.rescue).toMatchObject({ active: true, targetId: 2, progress: 9 })

    // §1.11: the freeze applies while the lock is held, so step 4 produces no movement.
    const before = { ...commander.position }
    expect(advanceCommandUnit(state)).toBe(0)
    expect(commander.position).toEqual(before)
    expect(commander.lastDisplacement).toBe(0)

    // And only while it is held: once cancelled the same held vector moves the body again.
    cancelRescue(state)
    expect(advanceCommandUnit(state)).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
    expect(commander.position.y).toBeCloseTo(before.y - COMMANDER_MOVE_SPEED, 12)
  })

  it('cancels when Space is released', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    state.rescue.progress = 30

    state.input.spaceHeld = false
    resolveStep3RescueLock(state, NO_EVENTS)

    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('cancels when the target stops being downed or the command unit falls', () => {
    const dead = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(dead, NO_EVENTS)
    dead.rescue.progress = 12
    unit(dead, 2).life = 'dead'
    resolveStep3RescueLock(dead, NO_EVENTS)
    expect(dead.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })

    const fallen = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(fallen, NO_EVENTS)
    fallen.rescue.progress = 12
    unit(fallen, COMMANDER_ID).life = 'downed'
    resolveStep3RescueLock(fallen, NO_EVENTS)
    expect(fallen.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })
})

describe('§1.11 progress and completion (step 8)', () => {
  it('advances one tick at a time and completes on exactly RESCUE_TICKS', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    const target = unit(state, 2)

    for (let tick = 0; tick < RESCUE_TICKS - 1; tick += 1) {
      expect(resolveStep8Rescue(state)).toBeNull()
    }
    expect(state.rescue.progress).toBe(RESCUE_TICKS - 1)
    expect(target.life).toBe('downed')

    expect(resolveStep8Rescue(state)).toEqual({ targetId: 2, rescuerId: COMMANDER_ID })
    expect(target.life).toBe('standing')
    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('revives at exactly half of maxHp, with the invulnerability window and the record', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    const target = unit(state, 2)
    // A raised maxHp is where the v1 review found 62.5% instead of 50%: the fraction is of
    // maxHp, never of a stored base.
    target.maxHp = 2.0
    state.rescue.progress = RESCUE_TICKS - 1

    resolveStep8Rescue(state)

    expect(target.hp).toBeCloseTo(2.0 * RESCUE_REVIVE_FRACTION, 12)
    expect(target.hp).toBeCloseTo(target.maxHp / 2, 12)
    expect(target.downedTicks).toBe(0)
    expect(target.deathTick).toBeNull()
    expect(target.invulnerableTicks).toBe(RESCUE_INVULNERABLE_TICKS)
    expect(target.rescuedByIds).toEqual([COMMANDER_ID])
    expect(state.stats.rescues).toBe(1)
  })

  it('neither advances nor rolls back progress on a hit tick', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    resolveStep8Rescue(state)
    resolveStep8Rescue(state)
    expect(state.rescue.progress).toBe(2)

    // Tick T: the rescuer is shot. Step 12 runs after step 8, so the freeze it causes lands
    // on the next progress step — the one-tick lag §1.16's ordering forces.
    applyStep12Damage(state, [shotAt(COMMANDER_ID, 0.3)])
    expect(state.rescue.progress).toBe(2)
    expect(state.rescue.hitPending).toBe(true)

    // Tick T+1: no advance, and no rollback either (§1.11: "증가하지 않으며 감소하지도").
    resolveStep8Rescue(state)
    expect(state.rescue.progress).toBe(2)
    expect(state.rescue.active).toBe(true)
    expect(state.rescue.hitPending).toBe(false)

    // Tick T+2, unhit: progress resumes from where it stopped.
    resolveStep8Rescue(state)
    expect(state.rescue.progress).toBe(3)
  })

  it('does not freeze progress for damage dealt to somebody other than the rescuer', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 }, 5: { dx: 0.6, dy: 0 } })
    const bystander = unit(state, 5)
    bystander.life = 'standing'
    bystander.hp = SOLDIER_HP
    resolveStep3RescueLock(state, NO_EVENTS)

    applyStep12Damage(state, [shotAt(bystander.id, 0.3)])
    expect(state.rescue.hitPending).toBe(false)

    resolveStep8Rescue(state)
    expect(state.rescue.progress).toBe(1)
  })

  it('absorbs a hit for the whole invulnerability window and then stops', () => {
    const state = fixture({ 2: { dx: 0.5, dy: 0 } })
    resolveStep3RescueLock(state, NO_EVENTS)
    const target = unit(state, 2)
    state.rescue.progress = RESCUE_TICKS - 1
    resolveStep8Rescue(state)

    const revived = SOLDIER_HP * RESCUE_REVIVE_FRACTION
    expect(target.hp).toBeCloseTo(revived, 12)

    // The completion tick's own damage step is inside the window.
    const first = applyStep12Damage(state, [shotAt(target.id, 0.5)])
    expect(target.hp).toBeCloseTo(revived, 12)
    expect(first.applied[0]).toMatchObject({ absorbed: true, dealt: 0 })
    expect(first.absorbedByInvulnerability).toBeCloseTo(0.5, 12)
    expect(target.invulnerableTicks).toBe(RESCUE_INVULNERABLE_TICKS - 1)

    // The window is exactly RESCUE_INVULNERABLE_TICKS damage steps long, completion tick
    // included: 1 spent above, so RESCUE_INVULNERABLE_TICKS - 1 quiet ones exhaust it.
    for (let tick = 0; tick < RESCUE_INVULNERABLE_TICKS - 1; tick += 1) {
      applyStep12Damage(state, [])
    }
    expect(target.invulnerableTicks).toBe(0)

    const after = applyStep12Damage(state, [shotAt(target.id, 0.5)])
    expect(target.hp).toBeCloseTo(revived - 0.5, 12)
    expect(after.applied[0]).toMatchObject({ absorbed: false })
  })
})
