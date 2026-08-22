// Campaign stage 0 (§5 stage 0) — the RUN OUTCOME recorder.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/campaign0-outcomes.sweep.ts
//
// A MEASUREMENT TOOL, not a regression test. Stage 0 moves the stage axes out of
// `constants.ts` and into `stages.ts`, and puts `stageId` on `BattleState`. That last part moves
// EVERY digest, so the digest cannot be the evidence that behaviour held. What can be is the
// run's outcome, which this file records for all eight policies over 32 seeds:
//
//   * the verdict, the end tick, the kill count and the standing count;
//   * the WHOLE `damageEvents` sequence — order, `attackerId`, `targetId`, `amount`, `cause` —
//     folded into one FNV-1a hash per run, with the count and the per-cause tallies beside it so
//     a mismatch says something more than "different";
//   * the tick each §1.13 upgrade round opened on, and the card chosen;
//   * §1.12's arrival tick and the tick the elite's row went `dead`.
//
// It writes everything to `CAMPAIGN0_OUT` (default `artifacts/campaign0-outcomes.json`) so the
// same file can be dropped into a tree at `b59b14a` and the two JSONs diffed. It imports nothing
// that stage 0 adds, so it compiles on both sides.
//
// It changes no rule and no constant.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { COMBAT_TICK_LIMIT } from '../../src/core/battle/constants'
import {
  POLICY_IDS,
  SKILLED_MODEL_IDS,
  policyFactory,
  type PolicyId,
} from '../../src/core/harness/policy/policies'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
const STEP_BUDGET = COMBAT_TICK_LIMIT * 2

const OUT = process.env.CAMPAIGN0_OUT ?? 'artifacts/campaign0-outcomes.json'
const SEED_COUNT = Number(process.env.CAMPAIGN0_SEEDS ?? '32')

/**
 * 32 seeds, named deterministically so both trees draw the same set.
 *
 * The first eight are §4.1's band (`POLICY_BAND_SEEDS`), spelled out rather than imported so the
 * list here is the whole list and a reader does not have to open a second file to know what ran.
 */
function seedList(count: number): string[] {
  const band = ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e', 'seed-f', 'seed-g', 'seed-h']
  const seeds: string[] = []
  for (let index = 0; index < count; index += 1) {
    seeds.push(index < band.length ? band[index] : `seed-${index}`)
  }
  return seeds
}

/** The same FNV-1a `digest.ts` uses, over the damage stream instead of over the state. */
function fnv1a(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

type RunRecord = {
  policy: string
  seed: string
  outcome: 'won' | 'lost'
  endTick: number
  kills: number
  standing: number
  /** §1.17's digest. Recorded so the report can SHOW it moving, not to compare behaviour with. */
  digest: string
  damageEventCount: number
  /** One hash over the whole ordered stream: `tick|side|attacker|target|amount|cause` per row. */
  damageEventsHash: string
  causeTally: Record<string, { blows: number; amount: string }>
  upgradeRounds: { round: number; tick: number; offered: string[]; chosen: string | null }[]
  eliteArrivalTick: number | null
  eliteDeathTick: number | null
}

function runOne(policyId: PolicyId, seed: string): RunRecord {
  const battle = createBattle(seed)
  const policy = policyFactory(policyId)(seed)

  battle.start()

  const lines: string[] = []
  const causeTally: Record<string, { blows: number; amount: number }> = {}
  let damageEventCount = 0
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `campaign0: ${policyId} on ${seed} did not decide in ${STEP_BUDGET} steps ` +
          `(mode ${battle.mode()}, tick ${battle.state().combatTick})`,
      )
    }
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    const result = battle.step()
    if (result.ran) {
      for (const event of result.damageEvents) {
        damageEventCount += 1
        lines.push(
          `${result.tick}|${event.side}|${event.attackerId}|${event.targetId}|` +
            `${event.amount.toFixed(6)}|${event.cause}`,
        )
        const row = (causeTally[event.cause] ??= { blows: 0, amount: 0 })
        row.blows += 1
        row.amount += event.amount
      }
    }
    steps += 1
  }

  const state = battle.state()
  let standing = 0
  for (const unit of state.friendlies) {
    if (unit.life === 'standing') standing += 1
  }

  const elite = state.enemies.find((enemy) => enemy.kind === 'elite') ?? null

  const tally: RunRecord['causeTally'] = {}
  for (const cause of Object.keys(causeTally).sort()) {
    tally[cause] = { blows: causeTally[cause].blows, amount: causeTally[cause].amount.toFixed(6) }
  }

  return {
    policy: policyId,
    seed,
    outcome: state.mode === 'won' ? 'won' : 'lost',
    endTick: state.combatTick,
    kills: state.stats.kills,
    standing,
    digest: battle.digest(),
    damageEventCount,
    damageEventsHash: fnv1a(lines.join('\n')),
    causeTally: tally,
    upgradeRounds: state.upgrades.rounds.map((round) => ({
      round: round.round,
      tick: round.tick,
      offered: [...round.offered],
      chosen: round.chosen,
    })),
    eliteArrivalTick: state.elite.spawnTick,
    eliteDeathTick: elite ? elite.deathTick : null,
  }
}

describe('campaign stage 0 — run outcomes', () => {
  it(`records ${SEED_COUNT} seeds x every policy`, () => {
    const seeds = seedList(SEED_COUNT)
    const runs: RunRecord[] = []

    for (const policyId of ALL_POLICIES) {
      for (const seed of seeds) runs.push(runOne(policyId, seed))
    }

    expect(runs.length).toBe(ALL_POLICIES.length * seeds.length)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, `${JSON.stringify({ policies: ALL_POLICIES, seeds, runs }, null, 2)}\n`)
  })
})
