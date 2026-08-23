// Batch C fixtures, part 2: §1.11 rescue — the 구조 lock 판정 and 구조 진행 steps.
//
// Placeholders this file was hand-computed against: RESCUE_RANGE 1.5, RESCUE_TICKS 36,
// RESCUE_INVULNERABLE_TICKS 45, RESCUE_REVIVE_FRACTION 1.0 (§1.11 v15), SOLDIER_HP 1.4,
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
import { applyDamage, dealtToUnit } from '../../src/core/battle/damage'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  advanceRescueProgress,
  cancelRescue,
  rescueCandidateId,
  resolveRescueLock,
} from '../../src/core/battle/rescue'
import {
  COMMANDER_ID,
  RIFLEMAN_IDS,
  createInitialBattleState,
  findFriendly,
} from '../../src/core/battle/state'

/**
 * §1.2.1 split the squad; every fixture here that says "soldier" means a RIFLEMAN.
 *
 * Id 2 was the generic soldier because before the split there was only one kind. It now holds
 * §1.4's front rank, so it carries the skirmisher's reach, hp and damage — which is the class
 * these fixtures are not about.
 */
const RIFLE = RIFLEMAN_IDS[0]
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

describe("§1.11 lock establishment (구조 lock 판정)", () => {
  it('establishes WITH a movement key held — §1.11 v19 dropped that condition', () => {
    // The inverse of what this fixture used to assert, and the inversion is the change. Through
    // v18 a non-zero axis blocked the lock, so reaching a body meant releasing every movement
    // key before pressing Space. A person played it and said rescue did not feel like rescuing;
    // that hand-shuffle was half of it. Space beats movement now, and the command unit still
    // does not move while locked, so the cost is unchanged and the RULE pays it.
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    state.input.move = { x: 1, y: 0 }

    resolveRescueLock(state, NO_EVENTS)

    expect(state.rescue).toMatchObject({ active: true, targetId: RIFLE, progress: 0 })

    // And releasing the key changes nothing, which is what makes the axis irrelevant rather
    // than merely tolerated.
    state.input.move = { x: 0, y: 0 }
    resolveRescueLock(state, NO_EVENTS)
    expect(state.rescue).toMatchObject({ active: true, targetId: RIFLE, progress: 0 })
  })

  it('needs Space, a candidate and a zero move vector — all three', () => {
    const noSpace = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    noSpace.input.spaceHeld = false
    resolveRescueLock(noSpace, NO_EVENTS)
    expect(noSpace.rescue.active).toBe(false)

    // Out of range by a hair: RESCUE_RANGE is a radius, not a suggestion.
    const outOfRange = fixture({ [RIFLE]: { dx: RESCUE_RANGE + 0.01, dy: 0 } })
    resolveRescueLock(outOfRange, NO_EVENTS)
    expect(outOfRange.rescue.active).toBe(false)
    expect(rescueCandidateId(outOfRange)).toBeNull()

    const inRange = fixture({ [RIFLE]: { dx: RESCUE_RANGE, dy: 0 } })
    resolveRescueLock(inRange, NO_EVENTS)
    expect(inRange.rescue.active).toBe(true)
  })

  it('will not establish for a command unit that is not standing', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    const commander = unit(state, COMMANDER_ID)
    commander.life = 'downed'
    commander.hp = 0

    resolveRescueLock(state, NO_EVENTS)
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
    const acting = unit(state, RIFLE)
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

describe("§1.11 cancellation (구조 lock 판정)", () => {
  it('does NOT cancel on a movement keydown — §1.11 v19 took it off the list', () => {
    // Also an inversion. v19 lets Space override movement, and a rule where Space beats movement
    // while movement cancels Space is a rule arguing with itself. Only releasing Space, the
    // target leaving, or the performer going down end a lock now.
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    state.rescue.progress = 17

    resolveRescueLock(state, MOVE_KEYDOWN)

    expect(state.rescue).toMatchObject({ active: true, targetId: RIFLE, progress: 17 })

    // Non-vacuous: the one input that DOES end it still does.
    state.input.spaceHeld = false
    resolveRescueLock(state, NO_EVENTS)
    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('does NOT cancel on a merely held movement vector — that was the v5 defect', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    const commander = unit(state, COMMANDER_ID)
    resolveRescueLock(state, NO_EVENTS)
    state.rescue.progress = 9

    // W is still down from the walk over here: held state, no new keydown event.
    state.input.move = { x: 0, y: -1 }
    resolveRescueLock(state, NO_EVENTS)

    expect(state.rescue).toMatchObject({ active: true, targetId: RIFLE, progress: 9 })

    // §1.11: the freeze applies while the lock is held, so `advanceCommandUnit` produces none.
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
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    state.rescue.progress = 30

    state.input.spaceHeld = false
    resolveRescueLock(state, NO_EVENTS)

    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('cancels when the target stops being downed or the command unit falls', () => {
    const dead = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(dead, NO_EVENTS)
    dead.rescue.progress = 12
    unit(dead, RIFLE).life = 'dead'
    resolveRescueLock(dead, NO_EVENTS)
    expect(dead.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })

    const fallen = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(fallen, NO_EVENTS)
    fallen.rescue.progress = 12
    unit(fallen, COMMANDER_ID).life = 'downed'
    resolveRescueLock(fallen, NO_EVENTS)
    expect(fallen.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })
})

describe("§1.11 progress and completion (구조 진행)", () => {
  it('advances one tick at a time and completes on exactly RESCUE_TICKS', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    const target = unit(state, RIFLE)

    for (let tick = 0; tick < RESCUE_TICKS - 1; tick += 1) {
      expect(advanceRescueProgress(state, applyDamage(state, []))).toBeNull()
    }
    expect(state.rescue.progress).toBe(RESCUE_TICKS - 1)
    expect(target.life).toBe('downed')

    expect(advanceRescueProgress(state, applyDamage(state, []))).toEqual({
      targetId: RIFLE,
      rescuerId: COMMANDER_ID,
    })
    expect(target.life).toBe('standing')
    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
  })

  it('revives to the full fraction of maxHp, with the invulnerability window and the record', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    const target = unit(state, RIFLE)
    // A raised maxHp is where the v1 review found 62.5% instead of 50%: the fraction is of
    // maxHp, never of a stored base.
    target.maxHp = 2.0
    state.rescue.progress = RESCUE_TICKS - 1

    advanceRescueProgress(state, applyDamage(state, []))

    expect(target.hp).toBeCloseTo(2.0 * RESCUE_REVIVE_FRACTION, 12)
    // The v1 review's defect was reading the fraction off a STORED BASE rather than off
    // `maxHp`, which showed up as 62.5%. `maxHp` is raised to 2.0 above precisely so the two
    // readings differ, and this is the assertion that tells them apart — it used to say
    // `maxHp / 2`, which pinned the fraction's VALUE as well and had to be rewritten when §1.11
    // (v15) took it to 1.0. The guard is "not the base", not "one half".
    expect(target.hp).not.toBeCloseTo(SOLDIER_HP * RESCUE_REVIVE_FRACTION, 6)
    expect(target.downedTicks).toBe(0)
    expect(target.deathTick).toBeNull()
    expect(target.invulnerableTicks).toBe(RESCUE_INVULNERABLE_TICKS)
    expect(target.rescuedByIds).toEqual([COMMANDER_ID])
    expect(state.stats.rescues).toBe(1)
  })

  it('neither advances nor rolls back progress on a hit tick, in the same tick as the hit', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    advanceRescueProgress(state, applyDamage(state, []))
    advanceRescueProgress(state, applyDamage(state, []))
    expect(state.rescue.progress).toBe(2)

    // One tick, in §1.16's order: `applyDamage` runs, then `advanceRescueProgress` reads it. No
    // and no rollback either (§1.11: "증가하지 않으며 감소하지도 않는다").
    const damage = applyDamage(state, [shotAt(COMMANDER_ID, 0.3)])
    expect(dealtToUnit(damage, COMMANDER_ID)).toBeCloseTo(0.3, 12)
    expect(advanceRescueProgress(state, damage)).toBeNull()
    expect(state.rescue.progress).toBe(2)
    expect(state.rescue.active).toBe(true)

    // The next quiet tick resumes from where it stopped — the earned progress is kept, so
    // intermittent fire makes a rescue slow rather than impossible.
    advanceRescueProgress(state, applyDamage(state, []))
    expect(state.rescue.progress).toBe(3)
  })

  it('does not freeze progress for damage dealt to somebody other than the rescuer', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 }, 5: { dx: 0.6, dy: 0 } })
    const bystander = unit(state, 5)
    bystander.life = 'standing'
    bystander.hp = SOLDIER_HP
    resolveRescueLock(state, NO_EVENTS)

    const damage = applyDamage(state, [shotAt(bystander.id, 0.3)])
    expect(dealtToUnit(damage, COMMANDER_ID)).toBe(0)

    advanceRescueProgress(state, damage)
    expect(state.rescue.progress).toBe(1)
  })

  it('does not count a hit the invulnerability window absorbed as a 피격', () => {
    // The rescuer was itself rescued a moment ago, so it is inside its own window. Nothing
    // came off its hp, so §1.11's freeze has nothing to freeze.
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    const commander = unit(state, COMMANDER_ID)
    commander.invulnerableTicks = 5

    const damage = applyDamage(state, [shotAt(COMMANDER_ID, 0.3)])
    expect(damage.applied[0]).toMatchObject({ absorbed: true, dealt: 0 })
    expect(dealtToUnit(damage, COMMANDER_ID)).toBe(0)

    advanceRescueProgress(state, damage)
    expect(state.rescue.progress).toBe(1)
  })

  it('absorbs a hit for the whole invulnerability window and then stops', () => {
    const state = fixture({ [RIFLE]: { dx: 0.5, dy: 0 } })
    resolveRescueLock(state, NO_EVENTS)
    const target = unit(state, RIFLE)
    state.rescue.progress = RESCUE_TICKS - 1
    advanceRescueProgress(state, applyDamage(state, []))

    const revived = SOLDIER_HP * RESCUE_REVIVE_FRACTION
    expect(target.hp).toBeCloseTo(revived, 12)
    expect(target.invulnerableTicks).toBe(RESCUE_INVULNERABLE_TICKS)

    // §1.16 puts the revival after this tick's damage step, so the window
    // covers the NEXT RESCUE_INVULNERABLE_TICKS damage steps — which costs the revived body
    // nothing, because it was still downed while this tick's damage step ran.
    const first = applyDamage(state, [shotAt(target.id, 0.5)])
    expect(target.hp).toBeCloseTo(revived, 12)
    expect(first.applied[0]).toMatchObject({ absorbed: true, dealt: 0 })
    expect(first.absorbedByInvulnerability).toBeCloseTo(0.5, 12)
    expect(target.invulnerableTicks).toBe(RESCUE_INVULNERABLE_TICKS - 1)

    // 1 window tick spent above, so RESCUE_INVULNERABLE_TICKS - 1 quiet ones exhaust it.
    for (let tick = 0; tick < RESCUE_INVULNERABLE_TICKS - 1; tick += 1) {
      applyDamage(state, [])
    }
    expect(target.invulnerableTicks).toBe(0)

    const after = applyDamage(state, [shotAt(target.id, 0.5)])
    expect(target.hp).toBeCloseTo(revived - 0.5, 12)
    expect(after.applied[0]).toMatchObject({ absorbed: false })
  })
})
