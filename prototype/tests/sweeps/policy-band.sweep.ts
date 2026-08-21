// The eight-policy band, over §4.1's eight seeds, printed as a table.
//
// A MEASUREMENT TOOL, NOT A REGRESSION TEST — same status as the I9 sweep beside it, and for
// the same reason: it asserts nothing about balance, because §5 stages 2-8 are what own the
// balance and every constant it runs against is still a `PLACEHOLDER`. It exists so that a
// batch which changes a RULE can say what the change did to §4.1's bands instead of guessing.
//
//   npx vitest run --config vitest.sweep.config.ts tests/sweeps/policy-band.sweep.ts
//
// The one assertion is that the run happened at all (8 x 8 results). Everything else is
// printed, and the batch report is where it is argued about.
//
// §4.1's six policies plus §3's two `skilled` player models is where "eight policies" comes
// from; §4.1's own seed band (`POLICY_BAND_SEEDS`) is where the eight seeds come from.

import { mkdirSync, writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { POLICY_IDS, SKILLED_MODEL_IDS, policyFactory, type PolicyId } from '../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS, runPolicyBand } from '../../src/core/harness/policy/run'

const ALL_POLICIES: readonly PolicyId[] = [...POLICY_IDS, ...SKILLED_MODEL_IDS]

/** §4.1 and §3's requirement column, quoted so the table reads without the spec open. */
const REQUIREMENT: Readonly<Record<PolicyId, string>> = {
  'tactical-no-input': 'I3 wins 0/8',
  'flees-always': 'I8 wins 0/8',
  'camps-in-place': 'I10 wins <=2/8',
  skilled: 'wins >=6/8',
  'ignores-range': 'I4 wins <=2/8',
  'abandons-downed': 'I13 wins <=2/8',
  'skilled-conservative': 'both models >=6/8',
  'skilled-aggressive': 'both models >=6/8',
}

describe('§4.1 the eight-policy band', () => {
  it('runs every policy over every band seed and prints the table', () => {
    const lines = [
      '| policy | wins | end ticks | kills | standing | requirement |',
      '|---|---:|---|---|---|---|',
    ]
    let measured = 0

    for (const id of ALL_POLICIES) {
      const band = runPolicyBand(policyFactory(id), POLICY_BAND_SEEDS)
      measured += band.seeds.length
      lines.push(
        `| ${id} | ${band.wins}/${band.total} | ${band.seeds.map((seed) => seed.endTick).join(' ')} | ` +
          `${band.seeds.map((seed) => seed.kills).join(' ')} | ` +
          `${band.seeds.map((seed) => seed.standing).join(' ')} | ${REQUIREMENT[id]} |`,
      )
    }

    // Written to a file rather than only logged: a console line can be swallowed by a reporter
    // or a shell filter, and this table is the evidence a batch report quotes.
    mkdirSync('artifacts', { recursive: true })
    writeFileSync('artifacts/policy-band.md', `${lines.join('\n')}\n`)
    console.log(`\n${lines.join('\n')}\n`)
    expect(measured).toBe(ALL_POLICIES.length * POLICY_BAND_SEEDS.length)
  })
})
