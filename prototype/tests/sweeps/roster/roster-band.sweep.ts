// THE ROSTER SWEEP — does growing the squad make the seven-stage campaign completable?
//
//   SWEEP_ROSTER_SIZE=32 npx vitest run --config tests/sweeps/roster/roster-sweep.config.ts
//
// A MEASUREMENT TOOL, not a regression test. It asserts only that the runs happened; the numbers
// go to `SWEEP_OUT_DIR` and are argued about in `roster-sweep-report.md`. It adopts nothing: no
// roster size is chosen here, no stage value is tuned here, no policy is touched (§3 freezes
// `skilled` for the duration of a sweep), and `src/` is not edited — see `roster-sweep.config.ts`
// for how `ROSTER_SIZE` and `FORMATION_SLOTS` move without it.
//
// ---------------------------------------------------------------------------
// THE TWO BANDS, AND WHY BOTH
// ---------------------------------------------------------------------------
//   THE CAMPAIGN BAND (8 policies x 8 seeds, relay) is the question the user asked: does a bigger
//   squad finish seven stages? It is `campaign3-campaign-band.sweep.ts`'s driver, kept
//   field-for-field so the ROSTER_SIZE=16 row can be diffed against that batch's committed
//   artifact. Anything that differs at 16 is scaffolding, not roster.
//
//   THE PER-STAGE BAND (8 policies x 8 seeds x 7 stages, FRESH roster each) is the question the
//   prediction turns on. A relay leg confounds the stage with the six before it; a fresh-roster
//   leg does not, so I2/I3/I8/I10 and §2.4's monotonicity are read here.
//
// PER-STAGE RETENTION is recorded in BOTH and they mean different things. In the relay it is
// "entering bodies -> leaving bodies" along one campaign, which is what compounds into a final
// survivor count. In the per-stage band it is the same ratio for a squad that always enters at
// full size, which is what isolates whether the ratio is scale-invariant. The controller's
// prediction is that both are ~0.52 at every roster size.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../../src/core/battle/battle'
import { COMBAT_TICK_LIMIT, ROSTER_SIZE, type CardId } from '../../../src/core/battle/constants'
import { FORMATION_MAX_SLOT_RADIUS, FORMATION_SLOTS } from '../../../src/core/battle/formation'
import { STAGES, type StageId } from '../../../src/core/battle/stages'
import { createCampaign } from '../../../src/core/campaign/campaign'
import type { CampaignEnd } from '../../../src/core/campaign/state'
import {
  POLICY_IDS,
  SKILLED_MODEL_IDS,
  policyFactory,
  type PolicyId,
} from '../../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../../src/core/harness/policy/run'
import { projectPolicyView } from '../../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id)
const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const SCHEME = process.env.SWEEP_FORMATION_SCHEME ?? 'wide'
const OUT_DIR = process.env.SWEEP_OUT_DIR ?? 'artifacts/roster'
const TAG = `${ROSTER_SIZE}-${SCHEME}`

/** §1.10's three windows, the same edges every previous band read I2 through. */
const WINDOW_EDGES = [0, 900, 1800] as const

function windowIndexOf(tick: number): number {
  if (tick >= WINDOW_EDGES[2]) return 2
  if (tick >= WINDOW_EDGES[1]) return 1
  return 0
}

/** The scaffolding's own fingerprint, written into every artifact so no row is size-ambiguous. */
const SCAFFOLD = {
  rosterSize: ROSTER_SIZE,
  formationScheme: SCHEME,
  slotCount: FORMATION_SLOTS.length,
  maxSlotRadius: FORMATION_MAX_SLOT_RADIUS,
}

type Tally = {
  entered: number
  standing: number
  downed: number
  dead: number
  hpAtStart: number
  maxHpAtStart: number
  damageTaken: number
  damageTakenByWindow: [number, number, number]
  damageDealt: number
  endTick: number
  kills: number
  downEvents: number
  rescues: number
}

type Driven = Tally & { outcome: 'won' | 'lost'; upgradeRounds: number[]; cards: CardId[] }

/**
 * Play one battle to its end under one policy, and tally it.
 *
 * Shared by both bands on purpose: a relay leg and a fresh-roster run differ only in how the
 * battle was BUILT, and giving them two drivers is how the two bands would drift apart.
 */
function drive(
  battle: ReturnType<typeof createBattle>,
  policyId: PolicyId,
  policySeed: string,
  label: string,
): Driven {
  const policy = policyFactory(policyId)(policySeed)
  battle.start()

  const opening = battle.state()
  let hpAtStart = 0
  let maxHpAtStart = 0
  for (const unit of opening.friendlies) {
    hpAtStart += unit.hp
    maxHpAtStart += unit.maxHp
  }

  let damageTaken = 0
  let damageDealt = 0
  const damageTakenByWindow: [number, number, number] = [0, 0, 0]
  let downEvents = 0
  let rescues = 0
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(`roster sweep: ${label} did not decide in ${STEP_BUDGET} steps`)
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
      if (result.rescue !== null) rescues += 1
      downEvents += result.transitions.friendlyDowns.length
    }
    steps += 1
  }

  const state = battle.state()
  let standing = 0
  let downed = 0
  let dead = 0
  for (const unit of state.friendlies) {
    if (unit.life === 'standing') standing += 1
    else if (unit.life === 'downed') downed += 1
    else dead += 1
  }

  return {
    outcome: state.mode === 'won' ? 'won' : 'lost',
    entered: opening.friendlies.length,
    standing,
    downed,
    dead,
    hpAtStart,
    maxHpAtStart,
    damageTaken,
    damageTakenByWindow,
    damageDealt,
    endTick: state.combatTick,
    kills: state.stats.kills,
    downEvents,
    rescues,
    upgradeRounds: state.upgrades.rounds.map((round) => round.tick),
    cards: state.upgrades.rounds
      .map((round) => round.chosen)
      .filter((card): card is CardId => card !== null),
  }
}

// ---------------------------------------------------------------------------
// BAND 1 — the campaign relay
// ---------------------------------------------------------------------------

type StageLeg = Driven & { stageId: StageId }

type CampaignRun = {
  policy: PolicyId
  rootSeed: string
  reached: StageId
  cleared: number
  end: CampaignEnd
  finalSurvivors: number
  totalKills: number
  digest: string
  legs: StageLeg[]
}

function runCampaign(policyId: PolicyId, rootSeed: string): CampaignRun {
  const campaign = createCampaign(rootSeed)
  const legs: StageLeg[] = []

  for (;;) {
    const stageId = campaign.state().stageId
    // A fresh policy instance per stage — a policy is a player's habits, not a save file — and the
    // seed string is byte-for-byte batch 3's, so a leg that plays the same plays identically.
    const leg = drive(
      campaign.battle(),
      policyId,
      `${rootSeed}:stage:${stageId}`,
      `${policyId}/${rootSeed}/stage ${stageId}`,
    )
    legs.push({ ...leg, stageId })
    campaign.finishStage()
    if (campaign.state().phase !== 'stage-cleared') break
    campaign.advance()
  }

  const final = campaign.state()
  const won = legs.filter((leg) => leg.outcome === 'won')
  return {
    policy: policyId,
    rootSeed,
    reached: final.stageId,
    cleared: won.length === 0 ? 0 : won[won.length - 1].stageId,
    end: final.end,
    finalSurvivors: final.squad ? final.squad.members.length : 0,
    totalKills: final.kills,
    digest: campaign.digest(),
    legs,
  }
}

// ---------------------------------------------------------------------------
// BAND 2 — the per-stage band, fresh roster every run
// ---------------------------------------------------------------------------

type StageRun = Driven & { policy: PolicyId; seed: string; stageId: StageId }

function runStage(policyId: PolicyId, seed: string, stageId: StageId): StageRun {
  const leg = drive(
    createBattle(seed, { stageId }),
    policyId,
    seed,
    `${policyId}/${seed}/stage ${stageId} (fresh)`,
  )
  return { ...leg, policy: policyId, seed, stageId }
}

describe(`roster sweep — ROSTER_SIZE ${ROSTER_SIZE}, formation '${SCHEME}'`, () => {
  it('plays the campaign band', () => {
    const runs: CampaignRun[] = []
    const startedAt = Date.now()
    for (const policyId of ALL_POLICIES) {
      for (const seed of POLICY_BAND_SEEDS) runs.push(runCampaign(policyId, seed))
    }
    const elapsedMs = Date.now() - startedAt
    expect(runs.length).toBe(ALL_POLICIES.length * POLICY_BAND_SEEDS.length)

    mkdirSync(OUT_DIR, { recursive: true })
    const out = join(OUT_DIR, `campaign-${TAG}.json`)
    writeFileSync(
      out,
      `${JSON.stringify(
        { scaffold: SCAFFOLD, policies: ALL_POLICIES, seeds: POLICY_BAND_SEEDS, elapsedMs, runs },
        null,
        2,
      )}\n`,
    )
    console.log(
      `[roster ${TAG}] ${runs.length} campaigns (${runs.reduce((total, run) => total + run.legs.length, 0)} legs) ` +
        `in ${(elapsedMs / 1000).toFixed(1)}s -> ${out}`,
    )
  })

  it('plays the per-stage band', () => {
    const runs: StageRun[] = []
    const startedAt = Date.now()
    for (const stageId of STAGE_IDS) {
      for (const policyId of ALL_POLICIES) {
        for (const seed of POLICY_BAND_SEEDS) runs.push(runStage(policyId, seed, stageId))
      }
    }
    const elapsedMs = Date.now() - startedAt
    expect(runs.length).toBe(STAGE_IDS.length * ALL_POLICIES.length * POLICY_BAND_SEEDS.length)

    mkdirSync(OUT_DIR, { recursive: true })
    const out = join(OUT_DIR, `stage-${TAG}.json`)
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          scaffold: SCAFFOLD,
          policies: ALL_POLICIES,
          seeds: POLICY_BAND_SEEDS,
          stages: STAGE_IDS,
          elapsedMs,
          runs,
        },
        null,
        2,
      )}\n`,
    )
    console.log(
      `[roster ${TAG}] ${runs.length} fresh-roster stage runs in ${(elapsedMs / 1000).toFixed(1)}s -> ${out}`,
    )
  })
})
