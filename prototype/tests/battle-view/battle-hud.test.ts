import { describe, expect, it } from 'vitest'

import {
  CARD_EFFECTS,
  COMBAT_TICK_LIMIT,
  DOWNED_TICKS,
  RESCUE_RANGE,
  RESCUE_TICKS,
} from '../../src/core/battle/constants'
import { nameOf } from '../../src/core/battle/names'
import { COMMANDER_ID, createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'
import { BATTLE_TICKS_PER_SECOND } from '../../src/core/battle-view/snapshot'
import { UPGRADE_CARD_LABELS, projectBattleHud } from '../../src/core/battle-view/hud'

function stateAt(seed = 'hud-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

function unitOf(state: BattleState, id: number) {
  return state.friendlies.find((unit) => unit.id === id)!
}

describe('battle-view: the HUD projection', () => {
  it('counts §1.1 down in seconds and never below zero', () => {
    const state = stateAt()
    state.combatTick = COMBAT_TICK_LIMIT - 300
    expect(projectBattleHud(state).secondsRemaining).toBeCloseTo(300 / BATTLE_TICKS_PER_SECOND, 6)

    state.combatTick = COMBAT_TICK_LIMIT + 40
    expect(projectBattleHud(state).secondsRemaining).toBe(0)
  })

  it('names every body, and marks which one the player is driving', () => {
    const state = stateAt()
    const hud = projectBattleHud(state)

    expect(hud.roster).toHaveLength(16)
    expect(hud.command?.id).toBe(COMMANDER_ID)
    expect(hud.command?.isCommand).toBe(true)
    expect(hud.roster.filter((entry) => entry.isCommand)).toHaveLength(1)
    expect(hud.command?.name).toBe(nameOf(unitOf(state, COMMANDER_ID).nameIndex))
    // The chip carries both halves of the hp bar the projection's licence rests on.
    expect(hud.command?.maxHp).toBeGreaterThan(0)
    expect(hud.command?.hp01).toBeCloseTo(hud.command!.hp / hud.command!.maxHp, 9)
  })

  it('splits the roster three ways and races §1.11 downed clock', () => {
    const state = stateAt()
    const downed = unitOf(state, 3)
    downed.life = 'downed'
    downed.downedTicks = 40
    const gone = unitOf(state, 4)
    gone.life = 'dead'
    gone.deathTick = 120

    const hud = projectBattleHud(state)
    expect([hud.standing, hud.downed, hud.dead]).toEqual([14, 1, 1])
    expect(hud.roster.find((entry) => entry.id === 3)?.downedTicksRemaining).toBe(DOWNED_TICKS - 40)
    expect(hud.roster.find((entry) => entry.id === 4)?.downedTicksRemaining).toBe(0)
  })

  it('marks the body Space would pick up, which is the highlight the world draws too', () => {
    const state = stateAt()
    const body = unitOf(state, 6)
    body.life = 'downed'
    body.position = { x: 28 + RESCUE_RANGE / 2, y: 16 }

    const hud = projectBattleHud(state)
    expect(hud.rescueCandidateId).toBe(body.id)
    expect(hud.roster.filter((entry) => entry.isRescueCandidate).map((entry) => entry.id)).toEqual([body.id])
  })

  it('echoes §1.15 Space back, which is the only feedback it has with nobody down', () => {
    const state = stateAt()
    expect(projectBattleHud(state).rescueHeld).toBe(false)
    state.input.spaceHeld = true
    expect(projectBattleHud(state).rescueHeld).toBe(true)
  })

  it('reports a rescue in progress against the duration §1.13 can shorten', () => {
    const state = stateAt()
    const body = unitOf(state, 7)
    body.life = 'downed'
    state.rescue = { active: true, targetId: body.id, progress: 9 }

    const hud = projectBattleHud(state)
    expect(hud.rescue).toEqual({
      targetId: body.id,
      targetName: nameOf(body.nameIndex),
      progress: 9,
      total: RESCUE_TICKS,
    })
  })

  it('offers §1.13 cards on the keys that choose them, with the effect the constant says', () => {
    const state = stateAt()
    state.mode = 'awaiting-upgrade'
    state.upgrades.rounds.push({ round: 1, tick: 400, offered: ['firepower', 'cover', 'rapid'], chosen: null })

    const hud = projectBattleHud(state)
    expect(hud.pendingUpgrade?.round).toBe(1)
    expect(hud.pendingUpgrade?.cards.map((card) => card.slot)).toEqual([1, 2, 3])
    expect(hud.pendingUpgrade?.cards.map((card) => card.id)).toEqual(['firepower', 'cover', 'rapid'])
    // The magnitude on screen is the constant, not a second copy of it.
    expect(hud.pendingUpgrade?.cards[0].effect).toContain(`${Math.round(CARD_EFFECTS.firepower * 100)}`)
    expect(hud.pendingUpgrade?.cards[0].name).toBe(UPGRADE_CARD_LABELS.firepower.name)
  })

  it('reports the cards already taken once the round is answered', () => {
    const state = stateAt()
    state.upgrades.rounds.push({ round: 1, tick: 400, offered: ['firepower', 'cover', 'rapid'], chosen: 'cover' })

    const hud = projectBattleHud(state)
    expect(hud.pendingUpgrade).toBeNull()
    expect(hud.chosenCards.map((card) => card.id)).toEqual(['cover'])
  })

  it('builds §1.14 result screen out of the record the state kept', () => {
    const state = stateAt()
    state.mode = 'lost'
    state.result = 'lost'
    state.failureReason = 'all-units-lost'
    state.stats = { kills: 42, rescues: 1, priorKills: 0 }

    const fallen = unitOf(state, 9)
    fallen.life = 'dead'
    fallen.deathTick = 1234
    const revived = unitOf(state, 10)
    revived.rescuedByIds = [COMMANDER_ID]
    const commander = unitOf(state, COMMANDER_ID)
    commander.life = 'downed'

    const hud = projectBattleHud(state)
    expect(hud.casualties).toEqual([{ name: nameOf(fallen.nameIndex), deathTick: 1234 }])
    expect(hud.rescueRecords).toEqual([
      { name: nameOf(revived.nameIndex), rescuers: [nameOf(commander.nameIndex)] },
    ])
    // §1.14's "지휘관 생존 여부" is about the ORIGINAL commander, not whoever holds command.
    expect(hud.commanderSurvived).toBe(false)
    expect(hud.kills).toBe(42)
    expect(hud.rescues).toBe(1)
  })

  it('shows no enemy hp anywhere, because §1 draws no enemy hp bar', () => {
    const hud = projectBattleHud(stateAt())
    expect(Object.keys(hud)).not.toContain('eliteHp')
    expect(JSON.stringify(hud)).not.toContain('elite')
  })
})
