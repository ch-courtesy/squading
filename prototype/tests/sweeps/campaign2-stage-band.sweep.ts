// Campaign stage 2 (§5 stage 2) — THE PER-STAGE BAND. Does each of the seven stages stand alone?
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/campaign2-stage-band.sweep.ts
//
// A MEASUREMENT TOOL, not a regression test. It asserts only that 448 runs happened; every number
// it produces is written to `CAMPAIGN2_STAGE_OUT` and argued about in the batch report. §5 stage 4
// owns the balance and every value in `STAGES` is still a placeholder, so a threshold asserted
// here would be a threshold asserted against an arbitrary point.
//
// ---------------------------------------------------------------------------
// WHY A FRESH ROSTER PER STAGE, WHEN THE CAMPAIGN IS A RELAY
// ---------------------------------------------------------------------------
// This file asks whether STAGE 5 IS HARDER THAN STAGE 4, and that question has an answer only if
// the two are played by the same squad. A relay run confounds the stage's numbers with whatever
// the previous six stages cost — a stage 7 played by four wounded bodies measures the casualty
// spiral, not stage 7. So each of the 448 runs is `createBattle(seed, { stageId })`: sixteen fresh
// bodies, full hp, no cards.
//
// `campaign2-campaign-band.sweep.ts` beside it asks the OTHER question — whether the relay is
// survivable — and neither file substitutes for the other.
//
// THE SAME EIGHT SEEDS ON EVERY STAGE, on purpose: a seed fixes the name draw and the spawn angle
// sequence, so holding it fixed across the seven stages means the difference between two rows of
// the table is the stage's NUMBERS and nothing else.
//
// ---------------------------------------------------------------------------
// WHAT IT MEASURES BESIDES THE VERDICT
// ---------------------------------------------------------------------------
//   I1  (§3) no 60-tick window with nothing engaged — recorded as the LONGEST run of consecutive
//       ticks with zero engaged enemies. "Engaged" is operationalised here as: a standing enemy
//       that holds a §1.4.2 contact slot, or that lies within the attack range of some standing
//       friendly. §3 says "접촉 슬롯을 점유했거나 standoff 구간 안에 있는 적" and does not name a
//       function; this is that sentence, spelled out so the number can be read.
//   I2  cumulative friendly damage taken as a fraction of the initial roster hp, and the same
//       fraction inside each of §1.10's three pressure windows (0-899, 900-1799, 1800+).
//       `applied.dealt` is what actually came off a body, so overkill is already excluded, and
//       §1.11's rescue restoration is not a damage event so it is not in the sum either.
//   I3/I8/I10  read off the win counts of `tactical-no-input`, `flees-always`, `camps-in-place`.
//   I4  read off `skilled` vs `ignores-range` — damage gap AND win bands together, per §3's "피해만
//       벌어지고 둘 다 이기면 실패다". §4 of the campaign design makes it MANDATORY at stage 4.
//
// AND THE ARENA PROBE, because stages 5-7 open the board to 84x48 while `COMMANDER_START` stays at
// {28, 16}: per run, how close the command unit ever came to each wall, and how many ticks the
// §1.7 clamp actually bit on. That is what turns "the squad no longer starts in the centre" from
// an assertion into a measurement.
//
// It changes no rule and no constant.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { COMBAT_TICK_LIMIT } from '../../src/core/battle/constants'
import { STAGES, stageConfigOf, type StageId } from '../../src/core/battle/stages'
import { attackRangeOf } from '../../src/core/battle/targeting'
import type { BattleState } from '../../src/core/battle/types'
import {
  POLICY_IDS,
  SKILLED_MODEL_IDS,
  policyFactory,
  type PolicyId,
} from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id)
const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const OUT = process.env.CAMPAIGN2_STAGE_OUT ?? 'artifacts/campaign2-stage-band.json'

/** §1.10's three windows, which are the phase boundaries at every stage in the table. */
const WINDOW_EDGES = [0, 900, 1800] as const

function windowIndexOf(tick: number): number {
  if (tick >= WINDOW_EDGES[2]) return 2
  if (tick >= WINDOW_EDGES[1]) return 1
  return 0
}

/** I1's engaged set, spelled out — see the header. */
function engagedEnemies(state: BattleState): number {
  let engaged = 0
  for (const enemy of state.enemies) {
    if (enemy.life !== 'standing') continue
    if (enemy.contactSlotOwnerId !== null) {
      engaged += 1
      continue
    }
    for (const unit of state.friendlies) {
      if (unit.life !== 'standing') continue
      const distance = Math.hypot(
        enemy.position.x - unit.position.x,
        enemy.position.y - unit.position.y,
      )
      if (distance <= attackRangeOf(state, unit)) {
        engaged += 1
        break
      }
    }
  }
  return engaged
}

type StageRun = {
  policy: PolicyId
  seed: string
  stageId: StageId
  outcome: 'won' | 'lost'
  endTick: number
  kills: number
  standing: number
  downed: number
  dead: number
  digest: string
  /** I2's numerator and denominator, kept apart so the report can show both. */
  rosterHp: number
  damageTaken: number
  damageTakenByWindow: [number, number, number]
  damageDealt: number
  /** I1: the longest stretch of consecutive ticks with nothing engaged. */
  longestIdleRun: number
  meanEngaged: number
  /** The arena probe. */
  commandMinX: number
  commandMaxX: number
  commandMinY: number
  commandMaxY: number
  clampedTicks: number
  eliteArrivalTick: number | null
  eliteDeathTick: number | null
}

function runStage(policyId: PolicyId, seed: string, stageId: StageId): StageRun {
  const stage = stageConfigOf(stageId)
  const battle = createBattle(seed, { stageId })
  const policy = policyFactory(policyId)(seed)
  battle.start()

  const rosterHp = battle.state().friendlies.reduce((total, unit) => total + unit.hp, 0)

  let damageTaken = 0
  let damageDealt = 0
  const damageTakenByWindow: [number, number, number] = [0, 0, 0]
  let longestIdleRun = 0
  let idleRun = 0
  let engagedTotal = 0
  let ticks = 0
  let clampedTicks = 0
  let commandMinX = Infinity
  let commandMaxX = -Infinity
  let commandMinY = Infinity
  let commandMaxY = -Infinity
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `campaign2/stage: ${policyId} on ${seed} stage ${stageId} did not decide in ` +
          `${STEP_BUDGET} steps (mode ${battle.mode()}, tick ${battle.state().combatTick})`,
      )
    }
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    const result = battle.step()

    if (result.ran) {
      const state = battle.state()
      const window = windowIndexOf(result.tick)
      for (const applied of result.damage.applied) {
        if (applied.event.side === 'friendly') damageDealt += applied.dealt
        else {
          damageTaken += applied.dealt
          damageTakenByWindow[window] += applied.dealt
        }
      }

      const engaged = engagedEnemies(state)
      engagedTotal += engaged
      ticks += 1
      if (engaged === 0) {
        idleRun += 1
        if (idleRun > longestIdleRun) longestIdleRun = idleRun
      } else idleRun = 0

      const command = state.friendlies.find((unit) => unit.id === state.commandUnitId)
      if (command && command.life === 'standing') {
        const { x, y } = command.position
        if (x < commandMinX) commandMinX = x
        if (x > commandMaxX) commandMaxX = x
        if (y < commandMinY) commandMinY = y
        if (y > commandMaxY) commandMaxY = y
        // §1.7's clamp bit this tick if the body is sitting exactly on a wall.
        if (x <= 0 || y <= 0 || x >= stage.arenaWidth || y >= stage.arenaHeight) clampedTicks += 1
      }
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
  const elite = state.enemies.find((enemy) => enemy.kind === 'elite') ?? null

  return {
    policy: policyId,
    seed,
    stageId,
    outcome: state.mode === 'won' ? 'won' : 'lost',
    endTick: state.combatTick,
    kills: state.stats.kills,
    standing,
    downed,
    dead,
    digest: battle.digest(),
    rosterHp,
    damageTaken,
    damageTakenByWindow,
    damageDealt,
    longestIdleRun,
    meanEngaged: ticks === 0 ? 0 : engagedTotal / ticks,
    commandMinX: commandMinX === Infinity ? Number.NaN : commandMinX,
    commandMaxX: commandMaxX === -Infinity ? Number.NaN : commandMaxX,
    commandMinY: commandMinY === Infinity ? Number.NaN : commandMinY,
    commandMaxY: commandMaxY === -Infinity ? Number.NaN : commandMaxY,
    clampedTicks,
    eliteArrivalTick: state.elite.spawnTick,
    eliteDeathTick: elite ? elite.deathTick : null,
  }
}

describe('campaign stage 2 — the per-stage band', () => {
  it(`runs ${ALL_POLICIES.length} policies x ${POLICY_BAND_SEEDS.length} seeds x ${STAGE_IDS.length} stages`, () => {
    const runs: StageRun[] = []
    const startedAt = Date.now()

    for (const stageId of STAGE_IDS) {
      for (const policyId of ALL_POLICIES) {
        for (const seed of POLICY_BAND_SEEDS) runs.push(runStage(policyId, seed, stageId))
      }
    }

    const elapsedMs = Date.now() - startedAt
    expect(runs.length).toBe(ALL_POLICIES.length * POLICY_BAND_SEEDS.length * STAGE_IDS.length)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      `${JSON.stringify(
        { policies: ALL_POLICIES, seeds: POLICY_BAND_SEEDS, stages: STAGE_IDS, elapsedMs, runs },
        null,
        2,
      )}\n`,
    )
    console.log(`[campaign2] ${runs.length} stage runs in ${(elapsedMs / 1000).toFixed(1)}s -> ${OUT}`)
  })
})
