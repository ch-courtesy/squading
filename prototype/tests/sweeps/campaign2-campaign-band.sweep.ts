// Campaign stage 2 (§5 stage 2) — THE CAMPAIGN BAND. Is the relay survivable, and where do runs die?
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/campaign2-campaign-band.sweep.ts
//
// A MEASUREMENT TOOL, not a regression test. It asserts only that 56 campaigns ran; the numbers go
// to `CAMPAIGN2_CAMPAIGN_OUT` and are argued about in the batch report.
//
// ---------------------------------------------------------------------------
// A DIFFERENT QUESTION FROM THE FILE BESIDE IT
// ---------------------------------------------------------------------------
// `campaign2-stage-band.sweep.ts` gives every stage a fresh sixteen and asks whether the stage is
// hard. This file gives the squad ONE roster for the whole campaign and asks whether the RELAY is
// survivable — how far a policy gets, what it costs, and whether §6's casualty spiral wins. The
// two cannot be derived from each other: a stage that a fresh squad clears 8/8 can be the stage a
// relayed squad dies on, and that difference is the campaign.
//
// ---------------------------------------------------------------------------
// THE TWO CLAIMS THIS FILE TESTS FOR THE FIRST TIME
// ---------------------------------------------------------------------------
// I13 (§4: "구조 포기 손해", `skilled` vs `abandons-downed`, a final survivor gap >= 3). In a
// SINGLE battle the two policies produced digests identical character for character — nobody ever
// went down, so there was nothing to abandon. The campaign design's §4 claims carry-over is what
// makes the gap real. This file measures the gap; it does not assume it.
//
// §6's casualty spiral: "`skilled`가 스테이지 5부터 급락하면 나선이 이긴 것이다." The per-stage
// column of `reached` below is what that sentence is read off.
//
// It drives `createCampaign` — the production facade, `finishStage` and `advance` included — so
// what it measures is the relay the shell plays and not a re-implementation of it.

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
const OUT = process.env.CAMPAIGN2_CAMPAIGN_OUT ?? 'artifacts/campaign2-campaign-band.json'

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
  /** §1.1: hp does not refill, so these say what the relay is actually carrying. */
  hpAtEnd: number
  maxHpAtEnd: number
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
    // `policyFactory(id)(seed)` is how every other harness in the tree builds one.
    const policy = policyFactory(policyId)(`${rootSeed}:stage:${stageId}`)
    battle.start()

    const entered = battle.state().friendlies.length
    let steps = 0
    while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
      if (steps >= STEP_BUDGET) {
        throw new Error(
          `campaign2/campaign: ${policyId} on ${rootSeed} stage ${stageId} did not decide in ` +
            `${STEP_BUDGET} steps (mode ${battle.mode()})`,
        )
      }
      for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
      battle.step()
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
      hpAtEnd,
      maxHpAtEnd,
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

describe('campaign stage 2 — the campaign band', () => {
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
      `[campaign2] ${runs.length} campaigns (${runs.reduce((total, run) => total + run.legs.length, 0)} stage legs) ` +
        `in ${(elapsedMs / 1000).toFixed(1)}s -> ${OUT}`,
    )
  })
})
