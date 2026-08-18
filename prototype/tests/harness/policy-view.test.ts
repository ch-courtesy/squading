// The pin behind `view.ts`'s two lists (batch F).
//
// The header of `src/core/harness/policy/view.ts` says what a policy may see and what it may
// not. That sentence is worth exactly as much as this file: every absence below is asserted
// TOGETHER with the fact that the field exists on the authoritative row it was projected from,
// so a typo in a field name cannot pass as a removal.

import { describe, expect, it } from 'vitest'

import {
  DOWNED_TICKS,
  ELITE_BLAST_RADIUS,
} from '../../src/core/battle/constants'
import { digestBattleState } from '../../src/core/battle/digest'
import { createEnemy, createInitialBattleState } from '../../src/core/battle/state'
import { projectPolicyView } from '../../src/core/harness/policy/view'
import type { BattleState } from '../../src/core/battle/types'

function freshState(): BattleState {
  return createInitialBattleState('seed-a')
}

describe('the policy view carries exactly what the screen carries', () => {
  it('has the top-level shape and nothing else', () => {
    const view = projectPolicyView(freshState())

    expect(Object.keys(view).sort()).toEqual(
      [
        'command',
        'enemies',
        'eliteTelegraph',
        'friendlies',
        'kills',
        'mode',
        'pendingUpgrade',
        'rescue',
        'rescueCandidateId',
        'tick',
        'ticksRemaining',
      ].sort(),
    )
  })

  it('projects a friendly row with the drawn fields and drops the bookkeeping ones', () => {
    const state = freshState()
    const view = projectPolicyView(state)
    const command = view.command
    expect(command).not.toBeNull()

    expect(Object.keys(command!).sort()).toEqual(
      ['downedTicksRemaining', 'hp', 'id', 'life', 'maxHp', 'position', 'slotIndex'].sort(),
    )

    // The absences, each paired with its presence on the row it came from — otherwise a
    // misspelled key name would "pass" as a removal forever.
    const source = state.friendlies.find((unit) => unit.id === command!.id)!
    for (const field of [
      'attackCooldown',
      'targetId',
      'invulnerableTicks',
      'rescuedByIds',
      'deathTick',
      'lastDisplacement',
      'downedTicks',
      'role',
      'nameIndex',
    ]) {
      expect(Object.hasOwn(source, field)).toBe(true)
      expect(Object.hasOwn(command!, field)).toBe(false)
    }
  })

  it('projects an enemy as a shape in a place, with no hp and no cooldown', () => {
    const state = freshState()
    state.enemies.push(createEnemy(101, 'shooter', { x: 10, y: 10 }))
    const view = projectPolicyView(state)

    expect(view.enemies.length).toBe(1)
    expect(Object.keys(view.enemies[0]).sort()).toEqual(['id', 'kind', 'position'].sort())

    const source = state.enemies[0]
    for (const field of [
      'hp',
      'maxHp',
      'life',
      'attackCooldown',
      'targetId',
      'contactSlotOwnerId',
      'deathTick',
      'lastDisplacement',
    ]) {
      expect(Object.hasOwn(source, field)).toBe(true)
      expect(Object.hasOwn(view.enemies[0], field)).toBe(false)
    }
  })

  it('omits the whole supply schedule, the streams and the remaining card pool', () => {
    const state = freshState()
    const view = projectPolicyView(state)

    for (const field of ['spawn', 'prng', 'rootSeed', 'upgrades', 'elite', 'stats', 'input', 'slotAssignments']) {
      expect(Object.hasOwn(state, field)).toBe(true)
      expect(Object.hasOwn(view, field)).toBe(false)
    }
  })

  it('shows only living enemies, because a dead body is not drawn', () => {
    const state = freshState()
    state.enemies.push(createEnemy(101, 'melee', { x: 10, y: 10 }))
    state.enemies.push(createEnemy(102, 'melee', { x: 11, y: 10 }))
    expect(projectPolicyView(state).enemies.map((enemy) => enemy.id)).toEqual([101, 102])

    state.enemies[0].life = 'dead'
    expect(projectPolicyView(state).enemies.map((enemy) => enemy.id)).toEqual([102])
  })

  it('counts the downed timer down and reports 0 for a body that is not downed', () => {
    const state = freshState()
    const soldier = state.friendlies.find((unit) => unit.id !== state.commandUnitId)!
    expect(projectPolicyView(state).friendlies.find((row) => row.id === soldier.id)!.downedTicksRemaining).toBe(0)

    soldier.life = 'downed'
    soldier.downedTicks = 100
    const row = projectPolicyView(state).friendlies.find((view) => view.id === soldier.id)!
    expect(row.life).toBe('downed')
    expect(row.downedTicksRemaining).toBe(DOWNED_TICKS - 100)
  })

  it('draws the elite circle only while a telegraph is running', () => {
    const state = freshState()
    expect(projectPolicyView(state).eliteTelegraph).toBeNull()

    state.elite.attackPhase = 'telegraph'
    state.elite.telegraphCenter = { x: 20, y: 12 }
    state.elite.telegraphRemaining = 30

    const telegraph = projectPolicyView(state).eliteTelegraph
    expect(telegraph).toEqual({ center: { x: 20, y: 12 }, radius: ELITE_BLAST_RADIUS })
    // The countdown is deliberately absent: §1.12 fixes the circle, not a timer.
    expect(Object.keys(telegraph!).sort()).toEqual(['center', 'radius'])

    state.elite.attackPhase = 'cooldown'
    expect(projectPolicyView(state).eliteTelegraph).toBeNull()
  })

  it('reports the lock in progress and the card screen when each exists', () => {
    const state = freshState()
    expect(projectPolicyView(state).rescue).toBeNull()
    expect(projectPolicyView(state).pendingUpgrade).toBeNull()

    state.rescue.active = true
    state.rescue.targetId = 4
    state.rescue.progress = 7
    expect(projectPolicyView(state).rescue).toEqual({ targetId: 4, progress: 7 })

    state.upgrades.rounds.push({ round: 1, tick: 100, offered: ['firepower', 'mobility', 'rapid'], chosen: null })
    expect(projectPolicyView(state).pendingUpgrade).toEqual({
      round: 1,
      offered: ['firepower', 'mobility', 'rapid'],
    })
  })

  it('leaves the state exactly as it found it', () => {
    const state = freshState()
    const before = digestBattleState(state)

    projectPolicyView(state)

    expect(digestBattleState(state)).toBe(before)

    // The detector is not blind: the same comparison catches a single moved body.
    state.friendlies[0].position = { x: 1, y: 1 }
    expect(digestBattleState(state)).not.toBe(before)
  })

  it('hands out copies, so a policy cannot steer a body through the view', () => {
    const state = freshState()
    const view = projectPolicyView(state)
    const source = state.friendlies.find((unit) => unit.id === view.command!.id)!
    const original = { ...source.position }

    view.command!.position.x += 5
    view.command!.position.y += 5

    expect(source.position).toEqual(original)
  })
})
