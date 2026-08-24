// §5 stage 1 fixtures: the relay. What crosses a stage boundary, and what must not.
//
// THE ONE THING TO KNOW BEFORE READING THE HELPERS, REWRITTEN BY §5 STAGE 2. `STAGES` has SEVEN
// rows now, so a won stage 1 answers `stage-cleared` and `nextStageIdOf(1)` is 2. `enterNextStage`
// below therefore walks the PRODUCTION path end to end — `advanceStage` then `startStageBattle` —
// and every fixture in this file that used to carry a finished squad into a second STAGE 1 battle
// now carries it into a real stage 2, on the derived seed `stageSeed(root, 2)` and under stage 2's
// numbers.
//
// WHAT THAT CLOSES. Campaign stage 1 reported two branches that had never executed: `advanceStage`'s
// happy path (only its two guards were reachable from a one-row table) and `stageSeed(root, n)` for
// `n > 1` (`stageSeed(root, 1)` is the root itself and returns before the derivation). Both run
// here now, in the same call the rest of the relay is measured through, rather than in a fixture
// written to reach them.

import { describe, expect, it } from 'vitest'

import {
  CARD_POOL,
  MAX_CARD_LEVEL,
  UPGRADE_KILL_THRESHOLDS,
  type CardId,
} from '../../src/core/battle/constants'
import { nameOf } from '../../src/core/battle/names'
import { createInitialBattleState } from '../../src/core/battle/state'
import { stageConfigOf, type StageId } from '../../src/core/battle/stages'
import { createStreamStates } from '../../src/core/battle/streams'
import { resolveKillAccounting } from '../../src/core/battle/upgrades'
import {
  cardLevelOf,
  firepowerMultiplierOf,
  offerableCards,
} from '../../src/core/battle/upgrades'
import type { BattleState } from '../../src/core/battle/types'
import { startStageBattle } from '../../src/core/campaign/campaign'
import { stageSeed } from '../../src/core/campaign/seed'
import {
  carriedSquadOf,
  createCampaignState,
  campaignOutcome,
  nextStageIdOf,
  type CampaignState,
} from '../../src/core/campaign/state'
import { advanceStage, completeStage } from '../../src/core/campaign/transition'

/** A finished battle, won, with nothing else touched. Stage 1 unless a stage is named. */
function wonStage(seed = 'relay-a', stageId: StageId = 1): BattleState {
  const state = createInitialBattleState(seed, stageId)
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
 * The next stage's battle, built from the campaign exactly the way the shell builds it.
 *
 * NO PROJECTION. `Campaign.advance()` is `advanceStage` followed by `startStageBattle` and this is
 * the same two calls, so what the fixtures below measure is the transition itself: the stage
 * number moves, the seed is re-derived for the new number, and the carried squad, the cards and
 * the cumulative kills cross. Forcing `phase` here — which is what this helper did while the table
 * had one row — would have left the stage number at 1 and quietly made every fixture below a
 * measurement of a second stage 1.
 */
function enterNextStage(campaign: CampaignState) {
  return startStageBattle(advanceStage(campaign))
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

  it('§1.1 v2 heals: a body that ended a stage hurt starts the next one full', () => {
    const finished = wonStage()
    const hurt = finished.friendlies.find((unit) => unit.id === 6)!
    hurt.hp = hurt.maxHp * 0.25
    const other = finished.friendlies.find((unit) => unit.id === 9)!
    other.hp = other.maxHp * 0.5

    const campaign = completeStage(createCampaignState('root-a'), finished)

    // The healed number is in the CAMPAIGN state, not applied on the way into the battle: the
    // squad the transition screen shows and the squad the next stage opens with are one object.
    for (const member of campaign.squad!.members) expect(member.hp).toBe(member.maxHp)

    const next = enterNextStage(campaign).state()

    const carried = next.friendlies.find((unit) => unit.id === 6)!
    expect(carried.hp).toBe(hurt.maxHp)
    expect(carried.maxHp).toBe(hurt.maxHp)
    // The wound is gone and it is gone for everyone, not only for the one body the fixture names.
    for (const unit of next.friendlies) {
      const before = finished.friendlies.find((body) => body.id === unit.id)!
      expect(unit.hp).toBe(before.maxHp)
      expect(unit.maxHp).toBe(before.maxHp)
    }
    // And it is a healing that had something to heal — a fixture where every body already ended
    // full would pass against a relay that copies `hp` straight through.
    expect(hurt.hp).toBeLessThan(hurt.maxHp)
    expect(other.hp).toBeLessThan(other.maxHp)
  })

  it('opens a carried body on the hp it was HANDED, not on a number the battle picks', () => {
    // §1.1 v2 lives in `campaign/transition.ts`, so the battle's job at this seam is to apply what
    // it is given. `createCarriedRoster` is reached here directly because the relay above can no
    // longer produce a wounded carried squad — which is exactly why the seam needs its own
    // fixture: a battle that refilled whatever it was handed would make the campaign's clause
    // impossible to observe from the battle side, and the two would agree by accident.
    const state = createInitialBattleState('seed-a', 1, {
      commandUnitId: 1,
      members: [
        { id: 1, role: 'commander', nameIndex: 0, hp: 1.25, maxHp: 5 },
        { id: 2, role: 'soldier', nameIndex: 1, hp: 0.35, maxHp: 1.4 },
      ],
      cardLevels: emptyLevels(),
      owedUpgradeRounds: 0,
    })

    expect(state.friendlies.find((unit) => unit.id === 1)!.hp).toBe(1.25)
    expect(state.friendlies.find((unit) => unit.id === 2)!.hp).toBe(0.35)
    expect(state.friendlies.find((unit) => unit.id === 2)!.maxHp).toBe(1.4)
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
    expect(cardLevelOf(next, 'vitality')).toBe(1)
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
  it('does not let §1.1 v2\'s healing reach them — the ground is not a wound', () => {
    // WHERE THE TWO CLAUSES MEET, stated once. §1.1 v2 heals and §1.3 kills, and both read the
    // same `life`: a body on 0 hp on the ground is not a body at 0 hp who needs topping up. The
    // mutation this was written after ("heal the downed as well, so the end of a stage is a free
    // rescue") was already caught by the fixture below, which counts bodies; this one says WHY,
    // by putting the healed survivors and the abandoned body in the same assertion.
    const finished = wonStage()
    const down = finished.friendlies.find((unit) => unit.id === 11)!
    down.life = 'downed'
    down.hp = 0
    down.downedTicks = 120
    const hurt = finished.friendlies.find((unit) => unit.id === 3)!
    hurt.hp = hurt.maxHp * 0.1

    const campaign = completeStage(createCampaignState('root-a'), finished)

    // Everyone who crosses is full — including the body that was one hit from the ground.
    expect(campaign.squad!.members).toHaveLength(15)
    for (const member of campaign.squad!.members) expect(member.hp).toBe(member.maxHp)
    expect(campaign.squad!.members.find((member) => member.id === 3)!.hp).toBe(hurt.maxHp)
    // And the one who was ON the ground crosses as a name, not as a full bar.
    expect(campaign.squad!.members.some((member) => member.id === 11)).toBe(false)
    expect(campaign.fallen.map((entry) => entry.id)).toEqual([11])
  })

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

/** Every card at zero — the full-table shape §1.13 v2 carries. */
function emptyLevels(): Record<CardId, number> {
  const levels = {} as Record<CardId, number>
  for (const card of CARD_POOL) levels[card] = 0
  return levels
}

describe('§1.2 v2 the card LEVELS are the campaign\'s and the thresholds are the stage\'s', () => {
  const noTransitions = (state: BattleState) => ({
    enemyDeaths: [],
    friendlyDowns: [],
    friendlyDeaths: [],
    previousCommandUnitId: state.commandUnitId,
    commandUnitId: state.commandUnitId,
    commandUnitChanged: false,
    allUnitsLost: false,
  })

  it('carries a card as a LEVEL, and goes on offering it until the cap', () => {
    // THE INVERSION. v1 asserted a carried card was never offered again, because a campaign
    // allowed one of each. v2 carries the level and offers the card until it reaches the cap —
    // so "offered again" is the rule, and what must hold instead is that the effect is live from
    // tick 0 and that taking it again is what raises it.
    const finished = wonStage()
    finished.upgrades.rounds.push({
      round: 1,
      tick: 400,
      offered: ['firepower', 'cover', 'rapid'],
      chosen: 'firepower',
    })

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const next = enterNextStage(campaign)
    const state = next.state()

    expect(campaign.cardLevels.firepower).toBe(1)
    expect(state.upgrades.carriedLevels.firepower).toBe(1)
    // Live from tick 0 of the new stage, read through the same function as ever.
    expect(cardLevelOf(state, 'firepower')).toBe(1)
    expect(firepowerMultiplierOf(state)).toBeCloseTo(1.3, 12)
    // Still a candidate: one level of three.
    expect(offerableCards(state)).toContain('firepower')
  })

  it('stops carrying a card into the offer once its level is at the cap', () => {
    const finished = wonStage()
    finished.upgrades.carriedLevels.firepower = MAX_CARD_LEVEL - 1
    finished.upgrades.rounds.push({
      round: 1,
      tick: 400,
      offered: ['firepower', 'cover', 'rapid'],
      chosen: 'firepower',
    })

    const campaign = completeStage(createCampaignState('root-a'), finished)
    const state = enterNextStage(campaign).state()

    expect(campaign.cardLevels.firepower).toBe(MAX_CARD_LEVEL)
    expect(offerableCards(state)).not.toContain('firepower')
    // And the effect is the capped one, not a fourth level acquired by carrying.
    expect(firepowerMultiplierOf(state)).toBeCloseTo(1 + 0.3 * MAX_CARD_LEVEL, 12)
  })

  it('measures §1.13 v2 thresholds against THIS STAGE, and resets them every stage', () => {
    // THE SECOND INVERSION, and the defect the whole redesign is about. v1 measured the campaign's
    // cumulative kills, so a squad that killed 229 in stage 1 opened NOTHING in stages 2-7. The
    // carried kills now spend no threshold at all.
    const finished = wonStage()
    finished.stats.kills = UPGRADE_KILL_THRESHOLDS[UPGRADE_KILL_THRESHOLDS.length - 1] * 3

    const campaign = completeStage(createCampaignState('root-a'), finished)
    expect(campaign.kills).toBe(finished.stats.kills)

    const state = enterNextStage(campaign).state()
    // The kill count is a RECORD on the campaign and reaches the battle nowhere.
    expect(state.upgrades.nextThresholdIndex).toBe(0)
    expect(state.stats.kills).toBe(0)

    // One short of this stage's first threshold opens nothing...
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0] - 1
    expect(resolveKillAccounting(state, noTransitions(state)).openedRound).toBeNull()
    // ...and reaching it opens round 1, in a stage that carried hundreds of kills in.
    state.stats.kills = UPGRADE_KILL_THRESHOLDS[0]
    const opened = resolveKillAccounting(state, noTransitions(state)).openedRound
    expect(opened).not.toBeNull()
    expect(opened!.round).toBe(1)
  })

  it('ACCUMULATES across stages — kills, card LEVELS and the dead all add up', () => {
    // TWO FOLDS, and the first fixture in this file that needs two. Everything above folds ONE
    // stage into a fresh campaign, where `campaign.kills + battle.stats.kills` and
    // `battle.stats.kills` are the same number and `[...campaign.fallen]` and `[]` are the same
    // list — so a relay that threw the campaign's history away every stage would pass all of them.
    const first = wonStage()
    first.stats.kills = 20
    kill(first, [4])
    first.upgrades.rounds.push({
      round: 1,
      tick: 400,
      offered: ['marksman', 'cover', 'rapid'],
      chosen: 'marksman',
    })

    const afterFirst = completeStage(createCampaignState('root-a'), first)
    expect(afterFirst.kills).toBe(20)
    expect(afterFirst.fallen.map((entry) => entry.id)).toEqual([4])
    expect(afterFirst.cardLevels.marksman).toBe(1)

    const second = enterNextStage(afterFirst).state()
    second.mode = 'won'
    second.result = 'won'
    second.stats.kills = 30
    kill(second, [8])
    // The SAME card again, which is the v2 case v1 could not express at all.
    second.upgrades.rounds.push({
      round: 1,
      tick: 900,
      offered: ['marksman', 'cover', 'rapid'],
      chosen: 'marksman',
    })

    // The campaign is on stage 2 by now because `enterNextStage` advanced it, and `completeStage`
    // refuses a battle whose stage is not the campaign's — so this is `advanceStage`'s result and
    // not a hand-set phase.
    const afterSecond = completeStage(advanceStage(afterFirst), second)

    expect(afterSecond.kills).toBe(50)
    expect(afterSecond.cardLevels.marksman).toBe(2)
    // §1.14: the first stage's dead are still on the record two stages later.
    expect(afterSecond.fallen.map((entry) => entry.id)).toEqual([4, 8])
    expect(afterSecond.squad!.members).toHaveLength(14)

    const third = enterNextStage(afterSecond).state()
    expect(third.upgrades.carriedLevels.marksman).toBe(2)
    expect(third.upgrades.nextThresholdIndex).toBe(0)
  })

  it('carries a round that the winning tick left unanswered (§1.2.1)', () => {
    // §1.16 puts `won` above `awaiting-upgrade`, so a round opened on the tick the elite died is
    // never answered and its card is simply gone. v1 recovered it by re-deriving "a threshold the
    // cumulative kills passed with no card to show for it"; v2 has no such derivation — the
    // thresholds reset and a LEVEL counts answered rounds — so the debt is carried explicitly.
    const finished = wonStage()
    finished.upgrades.rounds.push({
      round: 1,
      tick: 1800,
      offered: ['firepower', 'cover', 'rapid'],
      chosen: null,
    })

    const campaign = completeStage(createCampaignState('root-a'), finished)
    expect(campaign.owedUpgradeRounds).toBe(1)

    const state = enterNextStage(campaign).state()
    expect(state.upgrades.owedRounds).toBe(1)
    // It opens on the next accounting tick, with NO kills at all — a debt is not a threshold.
    const opened = resolveKillAccounting(state, noTransitions(state)).openedRound
    expect(opened).not.toBeNull()
    expect(state.upgrades.owedRounds).toBe(0)
    // And it did not consume this stage's own budget: the first threshold is still ahead.
    expect(state.upgrades.nextThresholdIndex).toBe(0)
  })

  it('leaves a first stage exactly as it was: no carry, no debt, no levels', () => {
    const state = createInitialBattleState('seed-a')
    expect(state.upgrades.owedRounds).toBe(0)
    expect(state.upgrades.nextThresholdIndex).toBe(0)
    expect(Object.values(state.upgrades.carriedLevels)).toEqual(new Array(CARD_POOL.length).fill(0))
    expect(offerableCards(state)).toEqual([...CARD_POOL])
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

  it('ends the campaign when the LAST stage is won, and not before', () => {
    // §5 stage 2: seven rows, so `complete` belongs to stage 7 alone. Winning any earlier stage
    // hands the squad on instead — which is the difference between a campaign and one battle.
    expect(nextStageIdOf(1)).toBe(2)
    expect(nextStageIdOf(7)).toBeNull()

    const early = completeStage(createCampaignState('root-a'), wonStage())
    expect(early.phase).toBe('stage-cleared')
    expect(early.end).toBeNull()
    expect(campaignOutcome(early)).toBeNull()

    const last = completeStage(
      { ...createCampaignState('root-a'), stageId: 7 },
      wonStage('relay-a', 7),
    )
    expect(last.phase).toBe('campaign-over')
    expect(last.end).toBe('complete')
    expect(campaignOutcome(last)).toBe('won')
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
    // The other half of the guard: a `stage-cleared` on the LAST stage is a state the relay cannot
    // produce (`completeStage` answers `campaign-over`/`complete` there), and if one ever reached
    // here it would be a loud failure rather than a campaign quietly restarted on stage 7.
    expect(() => advanceStage({ ...campaign, stageId: 7, phase: 'stage-cleared' })).toThrow(
      /unreachable/,
    )
  })

  it('advances to the next stage, on the next stage NUMBER and the derived seed', () => {
    // §3.2's happy path. Nothing above this line in the file could reach it while `STAGES` had one
    // row, so this is the first fixture that watches the stage number move.
    const cleared = completeStage(createCampaignState('root-a'), wonStage())
    expect(cleared.stageId).toBe(1)
    expect(cleared.phase).toBe('stage-cleared')

    const advanced = advanceStage(cleared)
    expect(advanced.stageId).toBe(2)
    expect(advanced.phase).toBe('in-stage')
    expect(advanced.end).toBeNull()
    // §1.1: advancing carries, it does not reset. The squad, the cards and the kills are the ones
    // `completeStage` folded in.
    expect(advanced.squad).toEqual(cleared.squad)
    expect(advanced.cardLevels).toEqual(cleared.cardLevels)
    expect(advanced.kills).toBe(cleared.kills)

    // §3.2: the stage's seed is derived from the root and the stage number. `stageSeed(root, 1)`
    // is the root itself, so THIS is the first derivation that actually happens in the relay.
    const battle = startStageBattle(advanced)
    expect(battle.state().rootSeed).toBe(stageSeed('root-a', 2))
    expect(battle.state().rootSeed).not.toBe('root-a')
    expect(battle.state().stageId).toBe(2)
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
    // §1.5: "스테이지를 이겼으나 생존자가 0명이면 캠페인은 거기서 끝난다." This clause had no
    // reachable case while stage 1 was the last stage — the campaign completed instead. With six
    // stages behind it, this is what a won stage 1 with an empty roster now answers.
    expect(campaign.end).toBe('no-survivors')
    expect(campaignOutcome(campaign)).toBe('lost')
  })

  it('completes rather than strands when the LAST stage is the one that leaves nobody', () => {
    // The ordering `transition.ts` states, and the only way to see it: winning the last stage is a
    // finished campaign even if it cost the last body, because there is no next stage for §1.5's
    // "분대가 없다" to be about.
    const finished = wonStage('relay-a', 7)
    kill(
      finished,
      finished.friendlies.map((unit) => unit.id),
    )

    const campaign = completeStage(
      { ...createCampaignState('root-a'), stageId: 7 },
      finished,
    )

    expect(campaign.squad).toBeNull()
    expect(campaign.end).toBe('complete')
    expect(campaignOutcome(campaign)).toBe('won')
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
        cardLevels: emptyLevels(),
        owedUpgradeRounds: 0,
      }),
    ).toThrow(/carried command unit 99/)
  })

  it('refuses an empty squad', () => {
    expect(() =>
      createInitialBattleState('seed-a', 1, {
        commandUnitId: 1,
        members: [],
        cardLevels: emptyLevels(),
        owedUpgradeRounds: 0,
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
        cardLevels: emptyLevels(),
        owedUpgradeRounds: 0,
      }),
    ).toThrow(/15 slots, got 16 soldiers/)
  })
})
