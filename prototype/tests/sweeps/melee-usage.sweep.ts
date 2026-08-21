// How much §1.4.2's melee is actually used, and the one seed whose digest did not move.
//
// A MEASUREMENT TOOL, NOT A REGRESSION TEST (same status as the I9 sweep and the policy band
// beside it): it asserts only that the runs happened, and writes what it saw to `artifacts/`.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/melee-usage.sweep.ts
//
// WHY IT EXISTS. Batch N's digest pins in `tests/harness/policy-run.test.ts` say that
// `tactical-no-input` on `seed-b` came out of the melee change with the SAME digest, end tick and
// kill count as before it. That line is the kind of claim that reads as "the rule is inert", so
// the two things which make it not inert are measured here rather than argued: every policy on
// every band seed lands melee blows, and `seed-b`'s run visibly DIVERGES on the tick after its
// first swing before re-converging.

import { mkdirSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { POLICY_IDS, SKILLED_MODEL_IDS, policyFactory, type PolicyId } from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]
/** `COMBAT_TICK_LIMIT` x 2, the same budget `runPolicySeed` uses. */
const STEP_BUDGET = 5400

type Run = {
  melee: number
  shots: number
  endTick: number
  digest: string
  meleeTicks: number[]
  samples: string[]
}

/** Drive one policy over one seed, counting the two friendly causes apart. */
function drive(id: PolicyId, seed: string, sampleAt: readonly number[] = []): Run {
  const battle = createBattle(seed)
  const policy = policyFactory(id)(seed)
  battle.start()
  const run: Run = { melee: 0, shots: 0, endTick: 0, digest: '', meleeTicks: [], samples: [] }
  let steps = 0

  while (battle.mode() !== 'won' && battle.mode() !== 'lost' && steps < STEP_BUDGET) {
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    const result = battle.step()
    if (result.ran) {
      for (const blow of result.damageEvents) {
        if (blow.cause === 'friendly-melee') {
          run.melee += 1
          run.meleeTicks.push(result.tick)
        } else if (blow.cause === 'friendly-attack') run.shots += 1
      }
    }
    const tick = battle.state().combatTick
    if (sampleAt.includes(tick)) run.samples.push(`tick ${tick} = ${battle.digest()}`)
    steps += 1
  }

  run.endTick = battle.state().combatTick
  run.digest = battle.digest()
  return run
}

describe('§1.4.2 melee usage', () => {
  it('counts melee blows against ranged blows for every policy on every band seed', () => {
    const lines = ['| policy | melee / (melee + shots), one column per band seed |', '|---|---|']
    let runs = 0

    for (const id of ALL_POLICIES) {
      const cells = POLICY_BAND_SEEDS.map((seed) => {
        const run = drive(id, seed)
        runs += 1
        return `${run.melee}/${run.melee + run.shots}`
      })
      lines.push(`| ${id} | ${cells.join(' ')} |`)
    }

    mkdirSync('artifacts', { recursive: true })
    writeFileSync('artifacts/melee-count.md', `${lines.join('\n')}\n`)
    expect(runs).toBe(ALL_POLICIES.length * POLICY_BAND_SEEDS.length)
  })

  it('shows `seed-b` diverging on the tick after its first swing and re-converging', () => {
    // The four later samples are what the identical end digest is made of: if the run had gone
    // on differing, the pin in `policy-run.test.ts` could not read the same as batch I's.
    const run = drive('tactical-no-input', 'seed-b', [1286, 1300, 1500, 1800, 2100])
    const lines = [
      `melee blows: ${run.melee} at ticks ${run.meleeTicks.join(', ')}`,
      `end tick ${run.endTick}, digest ${run.digest}`,
      ...run.samples,
      '',
      'Batch I (no melee rule) at the same sample points: tick 1286 = f3a565d4, 1300 = 44eb1b1d,',
      '1500 = 9ad9ac30, 1800 = f8e231a9, 2100 = b22c7788, end 2190 = 91fc34fe. Only 1286 differs.',
    ]

    mkdirSync('artifacts', { recursive: true })
    writeFileSync('artifacts/melee-seed-b-convergence.txt', `${lines.join('\n')}\n`)
    expect(run.melee).toBeGreaterThan(0)
  })
})
