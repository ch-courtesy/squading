// How much §1.4.2's melee is actually used, and the one seed whose digest did not move.
//
// A MEASUREMENT TOOL, NOT A REGRESSION TEST (same status as the I9 sweep and the policy band
// beside it): it asserts only that the runs happened, and writes what it saw to `artifacts/`.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/melee-usage.sweep.ts
//
// WHY IT EXISTS. The digest pins in `tests/harness/policy-run.test.ts` say that
// `tactical-no-input`'s three runs come out of §1.4.2 with the SAME digest, end tick and kill
// count as the tree that has no §1.4.2 at all. That line is the kind of claim that reads as "the
// rule is inert", so what makes it not inert is measured here rather than argued.
//
// v13 CHANGED WHAT THIS FILE HAS TO SHOW. The clause fires the melee only against a `shooter` or
// the `elite` — classes that hold a standoff outside `COMMANDER_MELEE_RANGE` — so a policy that
// never walks anywhere lands NO swings, and identical digests are the expected outcome for it
// rather than a coincidence about one seed. What must still be true is that the rule pays out for
// the policies that DO walk in. Both halves are recorded below: the per-policy count, and the
// contrast between the policy that never moves and the one that stands on top of the enemy.

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

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
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

  it('shows the rule is not inert: nothing for the policy that never moves, plenty for the one that dives', () => {
    // The pair that makes the identical digests readable. `tactical-no-input` emits no command at
    // all, so it never crosses a shooter's standoff or the elite's approach range and lands zero
    // swings on any band seed — which is why its three pins are the pre-§1.4.2 tree's values.
    // `ignores-range` walks onto whatever it is fighting, so it collects swings on exactly the
    // two classes v13 admits. A run of this file where BOTH are zero would mean the rule had been
    // switched off rather than restricted.
    //
    // BEFORE v13 the same two totals over the eight band seeds were 192 and 179; after it they
    // are 0 and 25. The 192 were ALL on melee-class bodies that had walked into contact by
    // themselves, so the first number going to zero is the whole point of the clause; the second
    // staying non-zero is what says the melee still exists for a policy that walks in.
    const still = POLICY_BAND_SEEDS.map((seed) => drive('tactical-no-input', seed).melee)
    const dives = POLICY_BAND_SEEDS.map((seed) => drive('ignores-range', seed).melee)
    const lines = [
      `tactical-no-input swings per band seed: ${still.join(' ')} (total ${sum(still)})`,
      `ignores-range     swings per band seed: ${dives.join(' ')} (total ${sum(dives)})`,
    ]

    mkdirSync('artifacts', { recursive: true })
    writeFileSync('artifacts/melee-who-swings.txt', `${lines.join('\n')}\n`)
    expect(sum(still)).toBe(0)
    expect(sum(dives)).toBeGreaterThan(0)
  })
})
