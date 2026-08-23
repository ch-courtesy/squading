// Tuning batch 3 — THE CAMPAIGN BAND under §1.1 v2's healing clause.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/campaign3-campaign-band.sweep.ts
//
// A MEASUREMENT TOOL, not a regression test. It asserts only that 64 campaigns ran; the numbers go
// to `CAMPAIGN3_CAMPAIGN_OUT` and are argued about in the batch report.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A NEW FILE RATHER THAN AN EDIT TO `campaign2-campaign-band.sweep.ts`
// ---------------------------------------------------------------------------
// Batch 2's file and its committed artifact are the RECORD of the measurement that forced §1.1 v2,
// and a batch that changes a rule and then overwrites the measurement the rule was argued from
// leaves nothing to compare against. So batch 2's file is untouched and this one runs beside it.
//
// It measures four things batch 2's could not, because until §1.1 v2 nothing survived stage 2 and
// every campaign-scope number was 0 against 0:
//
//   I5  (§3, campaign-scope per campaign §4) — a rescue actually COMPLETES. §3 measures it as
//       "tick 1800 이후 구조 완료가 시드당 평균 1회 이상"; `stats.rescues` is a count with no tick
//       on it, so this file watches the counter tick by tick and records the tick each completion
//       landed on. Campaign §4 moves the unit from the stage to the campaign ("스테이지마다 구조가
//       나오도록 강제하면 downed 빈도를 억지로 올려야 한다"), so the mean is per CAMPAIGN.
//   I6  (§3, campaign-scope per campaign §4) — "강화 4회차가 tick 2400 이전에 도달하고, 1회차가
//       tick 400 이전에는 오지 않는다". §1.2 puts the thresholds on the campaign's cumulative
//       kills, so every round is recorded with the stage it opened in and the tick inside it.
//   I13 — `skilled` vs `abandons-downed`, final survivors, gap >= 3. `finalSurvivors` is what that
//       is read off and batch 2 already recorded it; what was missing was campaigns that live long
//       enough for a loss to accumulate.
//   PER-LEG I2 — the roster hp a stage OPENED with and the damage actually taken during it. Under
//       §1.1 v2 the opening hp is the surviving roster's `maxHp` sum, which is the number that
//       makes "what does `vitality` do now" a measurement: the card raises the budget of every
//       stage rather than banking a buffer across seven.
//
// It drives `createCampaign` — the production facade, `finishStage` and `advance` included — so
// what it measures is the relay the shell plays and not a re-implementation of it. It changes no
// rule and no constant.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { COMBAT_TICK_LIMIT, type CardId } from '../../src/core/battle/constants'
import { STAGES, type StageId } from '../../src/core/battle/stages'
import { createCampaign } from '../../src/core/campaign/campaign'
import type { CampaignEnd } from '../../src/core/campaign/state'
import {
  POLICY_IDS,
  SKILLED_MODEL_IDS,
  policyFactory,
  type PolicyId,
} from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const OUT = process.env.CAMPAIGN3_CAMPAIGN_OUT ?? 'artifacts/campaign3-campaign-band.json'

/** §1.10's three windows, the same edges `campaign2-stage-band.sweep.ts` reads I2 through. */
const WINDOW_EDGES = [0, 900, 1800] as const

function windowIndexOf(tick: number): number {
  if (tick >= WINDOW_EDGES[2]) return 2
  if (tick >= WINDOW_EDGES[1]) return 1
  return 0
}

/** §1.13's round, as it happened: which stage opened it and at what tick inside that stage. */
type UpgradeRoundRecord = {
  round: number
  stageId: StageId
  tick: number
  chosen: CardId | null
}

type StageLeg = {
  stageId: StageId
  seed: string
  outcome: 'won' | 'lost'
  endTick: number
  kills: number
  /** Roster as the stage OPENED, and the three ways it could end. */
  entered: number
  standing: number
  downed: number
  dead: number
  /**
   * I2's denominator for this leg: the hp the roster actually opened the stage on. Under §1.1 v2
   * this equals `maxHpAtStart`; it is recorded separately anyway, because a relay that stopped
   * healing would show the two diverge here rather than in an argument.
   */
  hpAtStart: number
  maxHpAtStart: number
  /** I2's numerator: `applied.dealt`, so overkill is excluded and §1.11's revive is not in it. */
  damageTaken: number
  damageTakenByWindow: [number, number, number]
  damageDealt: number
  hpAtEnd: number
  maxHpAtEnd: number
  /** I5: every §1.11 rescue that COMPLETED in this stage, by the tick it completed on. */
  rescueTicks: number[]
  /** How many bodies went down at all, whether or not anyone came for them. */
  downEvents: number
  upgradeRounds: UpgradeRoundRecord[]
  cardsAfter: CardId[]
  campaignKillsAfter: number
}

type CampaignRun = {
  policy: PolicyId
  rootSeed: string
  /** The last stage that was PLAYED — 1 if the campaign died on the first one. */
  reached: StageId
  /** The last stage that was WON, or 0 if none was. */
  cleared: number
  end: CampaignEnd
  outcome: 'won' | 'lost'
  finalSurvivors: number
  totalKills: number
  cards: CardId[]
  fallenByStage: Record<string, number>
  digest: string
  legs: StageLeg[]
}

function runCampaign(policyId: PolicyId, rootSeed: string): CampaignRun {
  const campaign = createCampaign(rootSeed)
  const legs: StageLeg[] = []

  for (;;) {
    const battle = campaign.battle()
    const stageId = campaign.state().stageId
    // A fresh policy instance per stage: a policy is a player's habits, not a save file, and
    // `policyFactory(id)(seed)` is how every other harness in the tree builds one. The seed string
    // is byte-for-byte batch 2's, so a leg that plays the same plays identically.
    const policy = policyFactory(policyId)(`${rootSeed}:stage:${stageId}`)
    battle.start()

    const opening = battle.state()
    const entered = opening.friendlies.length
    let hpAtStart = 0
    let maxHpAtStart = 0
    for (const unit of opening.friendlies) {
      hpAtStart += unit.hp
      maxHpAtStart += unit.maxHp
    }

    let damageTaken = 0
    let damageDealt = 0
    const damageTakenByWindow: [number, number, number] = [0, 0, 0]
    const rescueTicks: number[] = []
    let downEvents = 0
    let steps = 0

    while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
      if (steps >= STEP_BUDGET) {
        throw new Error(
          `campaign3: ${policyId} on ${rootSeed} stage ${stageId} did not decide in ` +
            `${STEP_BUDGET} steps (mode ${battle.mode()})`,
        )
      }
      for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
      const result = battle.step()

      if (result.ran) {
        const window = windowIndexOf(result.tick)
        for (const applied of result.damage.applied) {
          if (applied.event.side === 'friendly') damageDealt += applied.dealt
          else {
            damageTaken += applied.dealt
            damageTakenByWindow[window] += applied.dealt
          }
        }
        // I5. `stats.rescues` is a count with no tick on it; `ResolvedTick.rescue` is the
        // completion itself, so the tick is the tick it resolved on and not a poll of a counter.
        if (result.rescue !== null) rescueTicks.push(result.tick)
        downEvents += result.transitions.friendlyDowns.length
      }
      steps += 1
    }

    const state = battle.state()
    let standing = 0
    let downed = 0
    let dead = 0
    let hpAtEnd = 0
    let maxHpAtEnd = 0
    for (const unit of state.friendlies) {
      if (unit.life === 'standing') {
        standing += 1
        hpAtEnd += unit.hp
        maxHpAtEnd += unit.maxHp
      } else if (unit.life === 'downed') downed += 1
      else dead += 1
    }

    const upgradeRounds: UpgradeRoundRecord[] = state.upgrades.rounds.map((round) => ({
      round: round.round,
      stageId,
      tick: round.tick,
      chosen: round.chosen,
    }))

    campaign.finishStage()
    const after = campaign.state()

    legs.push({
      stageId,
      seed: state.rootSeed,
      outcome: state.mode === 'won' ? 'won' : 'lost',
      endTick: state.combatTick,
      kills: state.stats.kills,
      entered,
      standing,
      downed,
      dead,
      hpAtStart,
      maxHpAtStart,
      damageTaken,
      damageTakenByWindow,
      damageDealt,
      hpAtEnd,
      maxHpAtEnd,
      rescueTicks,
      downEvents,
      upgradeRounds,
      cardsAfter: [...after.cards],
      campaignKillsAfter: after.kills,
    })

    if (after.phase !== 'stage-cleared') break
    campaign.advance()
  }

  const final = campaign.state()
  const fallenByStage: Record<string, number> = {}
  for (const casualty of final.fallen) {
    const key = String(casualty.stageId)
    fallenByStage[key] = (fallenByStage[key] ?? 0) + 1
  }

  const won = legs.filter((leg) => leg.outcome === 'won')

  return {
    policy: policyId,
    rootSeed,
    reached: final.stageId,
    cleared: won.length === 0 ? 0 : won[won.length - 1].stageId,
    end: final.end,
    outcome: final.end === 'complete' ? 'won' : 'lost',
    finalSurvivors: final.squad ? final.squad.members.length : 0,
    totalKills: final.kills,
    cards: [...final.cards],
    fallenByStage,
    digest: campaign.digest(),
    legs,
  }
}

describe('tuning batch 3 — the campaign band under §1.1 v2', () => {
  it(`plays ${ALL_POLICIES.length} policies x ${POLICY_BAND_SEEDS.length} seeds through the relay`, () => {
    const runs: CampaignRun[] = []
    const startedAt = Date.now()

    for (const policyId of ALL_POLICIES) {
      for (const seed of POLICY_BAND_SEEDS) runs.push(runCampaign(policyId, seed))
    }

    const elapsedMs = Date.now() - startedAt
    expect(runs.length).toBe(ALL_POLICIES.length * POLICY_BAND_SEEDS.length)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      `${JSON.stringify(
        {
          policies: ALL_POLICIES,
          seeds: POLICY_BAND_SEEDS,
          stageCount: STAGES.length,
          elapsedMs,
          runs,
        },
        null,
        2,
      )}\n`,
    )
    console.log(
      `[campaign3] ${runs.length} campaigns (${runs.reduce((total, run) => total + run.legs.length, 0)} stage legs) ` +
        `in ${(elapsedMs / 1000).toFixed(1)}s -> ${OUT}`,
    )
  })
})
