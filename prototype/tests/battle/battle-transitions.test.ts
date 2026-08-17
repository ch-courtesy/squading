// Batch C fixtures, part 4: §1.16 downed·사망 전이, 복귀·승계 — the transition step.
//
// The order inside the step is the rule under test as much as any single transition is:
// this tick's downs land BEFORE succession looks for a body, which is the only reason
// "the nearest soldier fell in the same tick" resolves to the next-nearest instead of
// handing command to a corpse.

import { describe, expect, it } from 'vitest'

import {
  COMMANDER_MOVE_SPEED,
  DOWNED_TICKS,
  SOLDIER_HP,
  SOLDIER_MOVE_SPEED,
} from '../../src/core/battle/constants'
import { advanceCommandUnit } from '../../src/core/battle/movement'
import {
  COMMANDER_ID,
  createEnemy,
  createInitialBattleState,
  findEnemy,
  findFriendly,
} from '../../src/core/battle/state'
import { resolveRescueLock } from '../../src/core/battle/rescue'
import { resolveTransitions } from '../../src/core/battle/transitions'
import type { BattleState, FriendlyUnit } from '../../src/core/battle/types'

function unit(state: BattleState, id: number): FriendlyUnit {
  const found = findFriendly(state, id)
  if (!found) throw new Error(`fixture has no friendly ${id}`)
  return found
}

/** Only the listed bodies are standing, at the listed positions; the rest are dead. */
function fixture(standing: Record<number, { x: number; y: number }>, tick = 100): BattleState {
  const state = createInitialBattleState('seed-a')
  state.mode = 'running'
  state.combatTick = tick

  for (const body of state.friendlies) {
    const position = standing[body.id]
    if (!position) {
      body.life = 'dead'
      body.hp = 0
      body.deathTick = 0
      continue
    }
    body.position = { x: position.x, y: position.y }
  }
  return state
}

describe("§1.16 downed and death transitions", () => {
  it('sends a friendly at zero hp to downed, not to dead', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 29, y: 16 } })
    const soldier = unit(state, 2)
    soldier.hp = 0
    soldier.targetId = 101
    soldier.lastDisplacement = 0.4

    const outcome = resolveTransitions(state)

    expect(soldier.life).toBe('downed')
    expect(soldier.deathTick).toBeNull()
    expect(soldier.downedTicks).toBe(0)
    expect(soldier.targetId).toBeNull()
    expect(soldier.lastDisplacement).toBe(0)
    expect(outcome.friendlyDowns).toEqual([2])
    expect(outcome.friendlyDeaths).toEqual([])
  })

  it('kills a downed friendly after exactly DOWNED_TICKS ticks and never sooner', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 29, y: 16 } })
    const soldier = unit(state, 2)
    soldier.life = 'downed'
    soldier.hp = 0
    soldier.downedTicks = DOWNED_TICKS - 2

    expect(resolveTransitions(state).friendlyDeaths).toEqual([])
    expect(soldier.downedTicks).toBe(DOWNED_TICKS - 1)
    expect(soldier.life).toBe('downed')

    const outcome = resolveTransitions(state)
    expect(outcome.friendlyDeaths).toEqual([2])
    expect(soldier.life).toBe('dead')
    expect(soldier.deathTick).toBe(state.combatTick)
  })

  it('does not charge a downed tick to a body that fell this very tick', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 29, y: 16 } })
    const soldier = unit(state, 2)
    soldier.hp = 0

    resolveTransitions(state)
    expect(soldier.downedTicks).toBe(0)

    resolveTransitions(state)
    expect(soldier.downedTicks).toBe(1)
  })

  it("kills an enemy at zero hp and hands the accounting its id and its kind", () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 } })
    state.enemies = [
      createEnemy(101, 'melee', { x: 29, y: 16 }),
      createEnemy(102, 'shooter', { x: 30, y: 16 }),
      createEnemy(1000, 'elite', { x: 31, y: 16 }),
    ]
    findEnemy(state, 101)!.hp = 0
    findEnemy(state, 101)!.contactSlotOwnerId = COMMANDER_ID
    findEnemy(state, 1000)!.hp = 0

    const outcome = resolveTransitions(state)

    expect(outcome.enemyDeaths).toEqual([
      { id: 101, kind: 'melee' },
      { id: 1000, kind: 'elite' },
    ])
    expect(findEnemy(state, 101)?.life).toBe('dead')
    expect(findEnemy(state, 101)?.deathTick).toBe(state.combatTick)
    expect(findEnemy(state, 101)?.contactSlotOwnerId).toBeNull()
    expect(findEnemy(state, 102)?.life).toBe('standing')
    // §1.13 excludes the elite from the kill count, so the accounting needs the kind — this step
    // does not touch `stats.kills` at all.
    expect(state.stats.kills).toBe(0)
  })
})

describe('§1.5 succession', () => {
  it('hands command to the nearest standing soldier when the command unit falls', () => {
    const state = fixture({
      [COMMANDER_ID]: { x: 28, y: 16 },
      2: { x: 32, y: 16 },
      3: { x: 29, y: 16 },
      4: { x: 30, y: 16 },
    })
    unit(state, COMMANDER_ID).hp = 0

    const outcome = resolveTransitions(state)

    expect(state.commandUnitId).toBe(3)
    expect(outcome.commandUnitChanged).toBe(true)
    expect(outcome.previousCommandUnitId).toBe(COMMANDER_ID)
    expect(outcome.allUnitsLost).toBe(false)
    // §1.5: the commander's death alone is not a defeat.
    expect(state.mode).toBe('running')
    expect(state.failureReason).toBeNull()
  })

  it('breaks a distance tie by ascending id', () => {
    const state = fixture({
      [COMMANDER_ID]: { x: 28, y: 16 },
      5: { x: 28, y: 17 },
      6: { x: 28, y: 15 },
    })
    unit(state, COMMANDER_ID).hp = 0

    resolveTransitions(state)
    expect(state.commandUnitId).toBe(5)
  })

  it('skips a soldier that was downed in the same tick', () => {
    const state = fixture({
      [COMMANDER_ID]: { x: 28, y: 16 },
      3: { x: 28.5, y: 16 }, // nearest, but falls in this very tick
      4: { x: 30, y: 16 },
    })
    unit(state, COMMANDER_ID).hp = 0
    unit(state, 3).hp = 0

    const outcome = resolveTransitions(state)

    expect(outcome.friendlyDowns).toEqual([COMMANDER_ID, 3])
    expect(state.commandUnitId).toBe(4)
    expect(unit(state, 3).life).toBe('downed')
  })

  it('reverts to the original commander while the acting commander is still standing', () => {
    // The path a prior review found unreachable: a soldier holds command, has just finished
    // rescuing the original commander (§1.11), and is itself unhurt.
    const state = fixture({
      [COMMANDER_ID]: { x: 28.5, y: 16 },
      2: { x: 28, y: 16 },
      3: { x: 29, y: 16 },
    })
    state.commandUnitId = 2
    const original = unit(state, COMMANDER_ID)
    original.life = 'standing'
    original.hp = original.maxHp / 2

    const outcome = resolveTransitions(state)

    expect(state.commandUnitId).toBe(COMMANDER_ID)
    expect(outcome.commandUnitChanged).toBe(true)
    expect(unit(state, 2).life).toBe('standing')
    expect(outcome.allUnitsLost).toBe(false)
  })

  it('reverts before it promotes when both could fire in one tick', () => {
    // The acting commander falls in the same tick the original commander is back on its
    // feet: §1.5's rule 1 runs first, so command goes home rather than to a third body.
    const state = fixture({
      [COMMANDER_ID]: { x: 40, y: 16 }, // furthest away — proximity must not decide this
      2: { x: 28, y: 16 },
      3: { x: 28.5, y: 16 },
    })
    state.commandUnitId = 2
    unit(state, COMMANDER_ID).hp = unit(state, COMMANDER_ID).maxHp / 2
    unit(state, 2).hp = 0

    resolveTransitions(state)

    expect(state.commandUnitId).toBe(COMMANDER_ID)
  })

  it('clears the held movement vector on succession and carries Space across', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 3: { x: 29, y: 16 } })
    unit(state, COMMANDER_ID).hp = 0
    state.input = { move: { x: 0.6, y: -0.8 }, spaceHeld: true }

    resolveTransitions(state)

    // §1.5's stated reason: an inherited move vector puts the new body in a moving state,
    // and §1.11's lock cannot establish while the move vector is non-zero — so the one
    // rescue succession exists for would be impossible.
    expect(state.input.move).toEqual({ x: 0, y: 0 })
    expect(state.input.spaceHeld).toBe(true)
  })

  it('reflects succession from the NEXT tick, and drives the new body at its own speed', () => {
    // §1.5: "승계 결과는 다음 tick의 1단계(입력 적용)부터 반영된다." Succession runs after
    // command-unit movement, so the promoted body cannot have moved in the tick it
    // was promoted in — there is no movement step left to run.
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 3: { x: 29, y: 16 } })
    state.input = { move: { x: 1, y: 0 }, spaceHeld: false }
    const commander = unit(state, COMMANDER_ID)
    const promoted = unit(state, 3)

    // Tick T, the movement step: the player is still driving the commander.
    expect(advanceCommandUnit(state)).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
    const promotedBefore = { ...promoted.position }

    // Tick T, damage and transitions: the commander is finished and command passes.
    commander.hp = 0
    resolveTransitions(state)
    expect(state.commandUnitId).toBe(3)
    expect(promoted.position).toEqual(promotedBefore)

    // Tick T+1, the input step supplies a vector again (succession zeroed the held one), and
    // moves the promoted body at SOLDIER speed — succession moves command, never the role.
    state.input.move = { x: 0, y: -1 }
    expect(advanceCommandUnit(state)).toBeCloseTo(SOLDIER_MOVE_SPEED, 12)
    expect(promoted.position.y).toBeCloseTo(promotedBefore.y - SOLDIER_MOVE_SPEED, 12)
  })

  it("reports all-units-lost when no standing soldier is left, and leaves the verdict to the 승패 판정", () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 } })
    unit(state, COMMANDER_ID).hp = 0

    const outcome = resolveTransitions(state)

    expect(outcome.allUnitsLost).toBe(true)
    // §1.16 puts the verdict in the 승패 판정, with `all-units-lost` outranking `elite-survived`.
    expect(state.mode).toBe('running')
    expect(state.result).toBeNull()
    expect(state.failureReason).toBeNull()
  })

  it('cancels a rescue in progress when the command unit falls', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 3: { x: 29, y: 16 } })
    const target = unit(state, 4)
    target.life = 'downed'
    target.hp = 0
    target.position = { x: 28.5, y: 16 }
    state.input = { move: { x: 0, y: 0 }, spaceHeld: true }
    resolveRescueLock(state, { movementKeydown: false })
    state.rescue.progress = 20
    expect(state.rescue.targetId).toBe(4)

    unit(state, COMMANDER_ID).hp = 0
    resolveTransitions(state)

    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
    expect(state.commandUnitId).toBe(3)
  })

  it('cancels a rescue whose target dies of its downed timer in the same tick', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 } })
    const target = unit(state, 4)
    target.life = 'downed'
    target.hp = 0
    target.downedTicks = DOWNED_TICKS - 1
    target.position = { x: 28.5, y: 16 }
    state.input = { move: { x: 0, y: 0 }, spaceHeld: true }
    resolveRescueLock(state, { movementKeydown: false })
    state.rescue.progress = 35

    const outcome = resolveTransitions(state)

    expect(outcome.friendlyDeaths).toEqual([4])
    expect(state.rescue).toMatchObject({ active: false, targetId: null, progress: 0 })
    expect(state.commandUnitId).toBe(COMMANDER_ID)
  })

  it('leaves a standing command unit and a healthy roster completely alone', () => {
    const state = fixture({ [COMMANDER_ID]: { x: 28, y: 16 }, 2: { x: 29, y: 16 } })
    unit(state, 2).hp = SOLDIER_HP
    state.input = { move: { x: 1, y: 0 }, spaceHeld: false }

    const outcome = resolveTransitions(state)

    expect(outcome).toMatchObject({
      enemyDeaths: [],
      friendlyDowns: [],
      friendlyDeaths: [],
      commandUnitChanged: false,
      allUnitsLost: false,
    })
    expect(state.commandUnitId).toBe(COMMANDER_ID)
    expect(state.input.move).toEqual({ x: 1, y: 0 })
  })
})
