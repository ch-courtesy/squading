// §5 stage 1 fixtures: the relay. What crosses a stage boundary, and what must not.
//
// THE ONE THING TO KNOW BEFORE READING THE HELPERS. `STAGES` has ONE row, so `nextStageIdOf(1)` is
// null and a won stage 1 completes the campaign (§5: "스테이지가 하나뿐이므로 스테이지 1을 이기면
// 캠페인 승리"). The relay itself is therefore exercised by carrying a finished squad into another
// STAGE 1 battle — `enterNextStage` below — which is what a stage boundary does minus the
// different numbers §5 stage 2 will give the second stage. `advanceStage`'s happy path cannot be
// reached from a one-row table and is not faked here; its two guards are.

import { describe, expect, it } from 'vitest'

import {
  CARD_POOL,
  UPGRADE_KILL_THRESHOLDS,
  type CardId,
} from '../../src/core/battle/constants'
import { nameOf } from '../../src/core/battle/names'
import { createInitialBattleState } from '../../src/core/battle/state'
import { createStreamStates } from '../../src/core/battle/streams'
import { resolveKillAccounting } from '../../src/core/battle/upgrades'
import {
  campaignKills,
  chosenUpgradeCards,
  firepowerMultiplierOf,
  hasUpgrade,
} from '../../src/core/battle/upgrades'
import type { BattleState } from '../../src/core/battle/types'
import { startStageBattle } from '../../src/core/campaign/campaign'
import {
  carriedSquadOf,
  createCampaignState,
  campaignOutcome,
  nextStageIdOf,
  type CampaignState,
} from '../../src/core/campaign/state'
import { advanceStage, completeStage } from '../../src/core/campaign/transition'

/** A finished stage-1 battle, won, with nothing else touched. */
function wonStage(seed = 'relay-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'won'
  state.result = 'won'
  state.combatTick = 1900
  return state
}

function kill(state: BattleState, ids: readonly number[]): void {
  for (const id of ids) {
    const unit = state.friendlies.find((body) => body.id === id)!
    unit.life = 'dead'
    unit.hp = 0
    unit.deathTick = 1200
  }
}

/**
 * The next stage's battle, built from the campaign the way the shell builds it.
 *
 * `phase` is forced to `in-stage` because with one stage in the table `completeStage` answers
 * `campaign-over`/`complete` and `advanceStage` is unreachable. Everything below the phase — the
 * carried squad, the cards, the cumulative kills, the seed derivation — is the production path,
 * `startStageBattle` included.
 */
function enterNextStage(campaign: CampaignState) {
  return startStageBattle({ ...campaign, phase: 'in-stage' })
}

describe('§1.1 the relay carries the squad, its names and its hp', () => {
  it('starts the next stage with thirteen when three were lost, under the same names', () => {
    const finished = wonStage()
    const lost = [4, 9, 12]
    kill(finished, lost)
    const namesBefore = new Map(
      finished.friendlies.map((unit) => [unit.id, nameOf(unit.nameIndex)]),
    )

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    expect(next.friendlies).toHaveLength(13)
    expect(next.friendlies.map((unit) => unit.id).sort((a, b) => a - b)).toEqual(
      [1, 2, 3, 5, 6, 7, 8, 10, 11, 13, 14, 15, 16],
    )
    for (const unit of next.friendlies) {
      expect(nameOf(unit.nameIndex)).toBe(namesBefore.get(unit.id))
    }
    // §1.14: the dead are a record, by name, and the ones lost are the ones missing.
    expect(campaign.fallen.map((entry) => entry.id)).toEqual(lost)
    expect(campaign.fallen.map((entry) => nameOf(entry.nameIndex))).toEqual(
      lost.map((id) => namesBefore.get(id)),
    )
    expect(campaign.fallen.every((entry) => entry.stageId === 1)).toBe(true)
  })

  it('does not heal: a body that ended a stage hurt starts the next one hurt', () => {
    const finished = wonStage()
    const hurt = finished.friendlies.find((unit) => unit.id === 6)!
    hurt.hp = hurt.maxHp * 0.25

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    const carried = next.friendlies.find((unit) => unit.id === 6)!
    expect(carried.hp).toBe(hurt.hp)
    expect(carried.maxHp).toBe(hurt.maxHp)
    expect(carried.hp).toBeLessThan(carried.maxHp)
    // And every other body is on the number it ended with too, not on a refilled bar.
    for (const unit of next.friendlies) {
      const before = finished.friendlies.find((body) => body.id === unit.id)!
      expect(unit.hp).toBe(before.hp)
      expect(unit.maxHp).toBe(before.maxHp)
    }
  })

  it('carries §1.13 `vitality` as the raised maximum, because that is where the card lives', () => {
    const finished = wonStage()
    for (const unit of finished.friendlies) {
      unit.maxHp *= 1.25
      unit.hp *= 1.25
    }
    finished.upgrades.rounds.push({
      round: 1,
      tick: 400,
      offered: ['vitality', 'cover', 'rapid'],
      chosen: 'vitality',
    })

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    const before = finished.friendlies.find((unit) => unit.id === 2)!
    expect(next.friendlies.find((unit) => unit.id === 2)!.maxHp).toBe(before.maxHp)
    // The card is held, and it is NOT applied a second time on the way in.
    expect(hasUpgrade(next, 'vitality')).toBe(true)
    expect(next.friendlies.find((unit) => unit.id === 2)!.maxHp).not.toBe(before.maxHp * 1.25)
  })

  it('resets everything §1.1 says resets, and the reset is structural', () => {
    const finished = wonStage()
    finished.combatTick = 2100
    finished.stats.kills = 40
    finished.stats.rescues = 3
    finished.spawn.backlog.push({
      id: 900,
      kind: 'melee',
      position: { x: 3, y: 4 },
      requestedTick: 7,
      sequence: 0,
    })
    finished.spawn.lastRequestTick = 2090
    finished.elite.enemyId = 1000
    finished.elite.attackPhase = 'telegraph'
    finished.rescue = { active: true, targetId: 5, progress: 12 }

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    expect(next.combatTick).toBe(0)
    expect(next.mode).toBe('ready')
    expect(next.result).toBeNull()
    expect(next.enemies).toEqual([])
    expect(next.spawn.backlog).toEqual([])
    expect(next.spawn.lastRequestTick).toBe(-1)
    expect(next.elite.enemyId).toBeNull()
    expect(next.elite.attackPhase).toBe('idle')
    expect(next.rescue).toEqual({ active: false, targetId: null, progress: 0 })
    // The STAGE's kill count resets; the campaign's does not (the fixture below is about that).
    expect(next.stats.kills).toBe(0)
    expect(next.stats.rescues).toBe(0)
    // And a carried body arrives with no memory of the last fight's bookkeeping.
    for (const unit of next.friendlies) {
      expect(unit.life).toBe('standing')
      expect(unit.deathTick).toBeNull()
      expect(unit.downedTicks).toBe(0)
      expect(unit.invulnerableTicks).toBe(0)
      expect(unit.rescuedByIds).toEqual([])
      expect(unit.targetId).toBeNull()
      expect(unit.attackCooldown).toBe(0)
    }
  })
})

describe('§1.3 a body still down when the stage ends is dead', () => {
  it('leaves the downed behind, so nobody can wait out a rescue', () => {
    const finished = wonStage()
    const down = finished.friendlies.find((unit) => unit.id === 11)!
    down.life = 'downed'
    down.hp = 0
    down.downedTicks = 120

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    expect(next.friendlies.some((unit) => unit.id === 11)).toBe(false)
    expect(campaign.fallen.map((entry) => entry.id)).toEqual([11])
    expect(next.friendlies).toHaveLength(15)
  })

  it('makes §1.5\'s successor the next stage\'s commander when the commander is down', () => {
    const finished = wonStage()
    const commander = finished.friendlies.find((unit) => unit.id === 1)!
    commander.life = 'downed'
    commander.hp = 0
    // §1.5 has already moved command by the winning tick; the fixture states the outcome of it.
    finished.commandUnitId = 7

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign).state()

    expect(campaign.squad!.commandUnitId).toBe(7)
    expect(next.commandUnitId).toBe(7)
    // §1.5 rule 1 would otherwise send command back to a body that is not in this stage at all.
    expect(next.originalCommanderId).toBe(7)
    expect(next.friendlies.some((unit) => unit.id === 1)).toBe(false)
    // The successor leads with a SOLDIER's numbers. §1.5 moves command, never the body's role,
    // and no rule promotes a statline at a stage boundary — losing the commander is a permanent
    // loss of the commander's range and damage, which is the weight §1.1 asks for.
    expect(next.friendlies.find((unit) => unit.id === 7)!.role).toBe('soldier')
    // §1.4: the command unit has no slot, and the remaining fourteen take the first fourteen.
    expect(next.slotAssignments.map((entry) => entry.unitId)).not.toContain(7)
    expect(next.slotAssignments).toHaveLength(14)
    expect(next.slotAssignments.map((entry) => entry.slotIndex)).toEqual(
      Array.from({ length: 14 }, (_, index) => index),
    )
  })
})

describe('§1.2 the cards and the kill count are the campaign\'s, not the stage\'s', () => {
  it('keeps a held card working and never offers it again', () => {
    const finished = wonStage()
    finished.upgrades.rounds.push({
      round: 1,
      tick: 400,
      offered: ['firepower', 'cover', 'rapid'],
      chosen: 'firepower',
    })
    finished.upgrades.remainingPool = finished.upgrades.remainingPool.filter(
      (card) => card !== 'firepower',
    )

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign)
    const state = next.state()

    expect(campaign.cards).toEqual(['firepower'])
    expect(state.upgrades.carriedCards).toEqual(['firepower'])
    // The effect is live from tick 0 of the new stage, read through the same predicate as ever.
    expect(hasUpgrade(state, 'firepower')).toBe(true)
    expect(firepowerMultiplierOf(state)).toBeCloseTo(1.3, 12)
    expect(chosenUpgradeCards(state)).toEqual(['firepower'])

    // §1.2: "한 캠페인에 같은 카드는 한 번만." Drive the new stage's first round and read what it
    // offered — through the real accounting step, not by inspecting the pool.
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    const opened = resolveKillAccounting(state, {
      enemyDeaths: [],
      friendlyDowns: [],
      friendlyDeaths: [],
      previousCommandUnitId: state.commandUnitId,
      commandUnitId: state.commandUnitId,
      commandUnitChanged: false,
      allUnitsLost: false,
    }).openedRound
    expect(opened).not.toBeNull()
    expect(opened!.offered).not.toContain('firepower')
    expect(opened!.offered).toHaveLength(3)
  })

  it('measures §1.13 thresholds against the CAMPAIGN total, not the stage', () => {
    const finished = wonStage()
    finished.stats.kills = 20

    const campaign = completeStage(createCampaignState('root-a'), finished)
    expect(campaign.kills).toBe(20)

    const state = enterNextStage(campaign).state()
    expect(state.stats.priorKills).toBe(20)
    expect(state.stats.kills).toBe(0)
    expect(campaignKills(state)).toBe(20)
    // 15 is spent; the next card is the 45 one.
    expect(state.upgrades.nextThresholdIndex).toBe(1)

    const transitions = {
      enemyDeaths: [],
      friendlyDowns: [],
      friendlyDeaths: [],
      previousCommandUnitId: state.commandUnitId,
      commandUnitId: state.commandUnitId,
      commandUnitChanged: false,
      allUnitsLost: false,
    }

    // 24 more kills — 44 in the campaign, one short — opens nothing. Under a per-stage reading it
    // would have opened at 15 and again nowhere near here.
    state.stats.kills = 24
    expect(resolveKillAccounting(state, transitions).openedRound).toBeNull()

    state.stats.kills = 25
    const opened = resolveKillAccounting(state, transitions).openedRound
    expect(opened).not.toBeNull()
    expect(campaignKills(state)).toBe(UPGRADE_KILL_THRESHOLDS[1])
    expect(opened!.round).toBe(2)
  })

  it('spends every threshold the carried kills have already passed', () => {
    const finished = wonStage()
    finished.stats.kills = UPGRADE_KILL_THRESHOLDS[2]

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const state = enterNextStage(campaign).state()

    expect(state.upgrades.nextThresholdIndex).toBe(3)
  })

  it('leaves a first stage exactly as it was: no carry, no prior kills, no held cards', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.stats.priorKills).toBe(0)
    expect(state.upgrades.carriedCards).toEqual([])
    expect(state.upgrades.nextThresholdIndex).toBe(0)
    expect(state.upgrades.remainingPool).toEqual([...CARD_POOL])
    expect(campaignKills(state)).toBe(0)
  })
})

describe('§1.14 names are drawn once per campaign, not once per stage', () => {
  it('draws 23 for the first stage and NONE for a carried one', () => {
    const first = createInitialBattleState('seed-a')
    // One Fisher-Yates pass over the 24-name pool is the whole of the `names` stream's movement.
    expect(first.prng.names).not.toBe(createStreamStates('seed-a').names)

    const campaign = completeStage(createCampaignState('root-a'), wonStage('seed-a'))
    const next = enterNextStage(campaign).state()

    // The stream is exactly where the seed put it: a carried stage draws no name at all, because
    // there is no body in it whose name is not already decided.
    expect(next.prng.names).toBe(createStreamStates(next.rootSeed).names)
    expect(next.prng.spawn).toBe(createStreamStates(next.rootSeed).spawn)
    expect(next.prng.cards).toBe(createStreamStates(next.rootSeed).cards)
  })
})

describe('§1.4 / §1.5 the campaign ends, and there is no stage retry', () => {
  it('ends the campaign on a lost stage', () => {
    const finished = createInitialBattleState('seed-a')
    finished.mode = 'lost'
    finished.result = 'lost'
    finished.failureReason = 'elite-survived'
    finished.stats.kills = 88

    const campaign = completeStage(createCampaignState('root-a'), finished)

    expect(campaign.phase).toBe('campaign-over')
    expect(campaign.end).toBe('defeat')
    expect(campaignOutcome(campaign)).toBe('lost')
    // The kills and the dead are still recorded — the end screen reads them (§1.14).
    expect(campaign.kills).toBe(88)
    expect(() => advanceStage(campaign)).toThrow(/cannot advance from campaign-over/)
  })

  it('ends the campaign when the last stage is won', () => {
    // §5 stage 1: one stage, so this is the whole win path today.
    expect(nextStageIdOf(1)).toBeNull()
    const campaign = completeStage(createCampaignState('root-a'), wonStage())
    expect(campaign.phase).toBe('campaign-over')
    expect(campaign.end).toBe('complete')
    expect(campaignOutcome(campaign)).toBe('won')
  })

  it('refuses to fold a stage that has not ended', () => {
    const running = createInitialBattleState('seed-a')
    running.mode = 'running'
    expect(() => completeStage(createCampaignState('root-a'), running)).toThrow(/has not ended/)
  })

  it('refuses to advance from any phase but `stage-cleared`', () => {
    const campaign = createCampaignState('root-a')
    expect(campaign.phase).toBe('in-stage')
    expect(() => advanceStage(campaign)).toThrow(/cannot advance from in-stage/)
    // The other half of the guard: a `stage-cleared` with no next stage is a state the relay
    // cannot produce, and if one ever reached here it would be a loud failure rather than a
    // campaign quietly restarted on the stage it just finished.
    expect(() => advanceStage({ ...campaign, phase: 'stage-cleared' })).toThrow(/unreachable/)
  })

  it('has no squad to hand on when a won stage leaves nobody standing', () => {
    const finished = wonStage()
    kill(
      finished,
      finished.friendlies.map((unit) => unit.id),
    )

    const campaign = completeStage(createCampaignState('root-a'), finished)

    expect(campaign.squad).toBeNull()
    expect(carriedSquadOf(campaign)).toBeNull()
    expect(campaign.fallen).toHaveLength(16)
    // §1.5's clause is real but it is not what fires here: this stage was the LAST one, so the
    // campaign is complete rather than stranded. The ordering is stated in `transition.ts`.
    expect(campaign.end).toBe('complete')
  })

  it('carries a squad that a stage cost nothing, unchanged', () => {
    const campaign = completeStage(createCampaignState('root-a'), wonStage())
    expect(campaign.squad!.members).toHaveLength(16)
    expect(campaign.fallen).toEqual([])
    const next = enterNextStage(campaign).state()
    expect(next.friendlies).toHaveLength(16)
    expect(next.slotAssignments).toHaveLength(15)
  })
})

describe('the carried squad is checked, not trusted', () => {
  it('refuses a squad whose command unit is not in it', () => {
    expect(() =>
      createInitialBattleState('seed-a', 1, {
        commandUnitId: 99,
        members: [{ id: 2, role: 'soldier', nameIndex: 0, hp: 1, maxHp: 1.4 }],
        cards: [],
        priorKills: 0,
      }),
    ).toThrow(/carried command unit 99/)
  })

  it('refuses an empty squad', () => {
    expect(() =>
      createInitialBattleState('seed-a', 1, {
        commandUnitId: 1,
        members: [],
        cards: [],
        priorKills: 0,
      }),
    ).toThrow(/nobody in it/)
  })

  it('refuses more followers than §1.4 has slots', () => {
    const members = Array.from({ length: 17 }, (_, index) => ({
      id: index + 1,
      role: 'soldier' as const,
      nameIndex: index,
      hp: 1.4,
      maxHp: 1.4,
    }))
    expect(() =>
      createInitialBattleState('seed-a', 1, {
        commandUnitId: 1,
        members,
        cards: [] as CardId[],
        priorKills: 0,
      }),
    ).toThrow(/15 slots, got 16 soldiers/)
  })
})
