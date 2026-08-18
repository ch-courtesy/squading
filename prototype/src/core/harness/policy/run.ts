// The seed-band runner (batch F): one policy, one seed, one verdict.
//
// IT AGGREGATES AND IT DOES NOT JUDGE. §4.1 states a band per policy ("승리 `0/8`",
// "`>=6/8`"), and whether a band is met is a claim an invariant test makes about these numbers —
// not something the runner decides. So there is no `passed` field here and no threshold: the
// runner counts wins out of N and stops.
//
// It drives the facade (`createBattle`) and nothing else, which is the only way §4.3's
// comparison means anything: "같은 seed·같은 입력 로그를 헤드리스 재생과 실시간 브라우저
// 재생에서 돌려 승패와 종료 tick이 일치해야 한다" is a comparison of two drivers of the SAME
// object. A runner that assembled the reducer by hand would be measuring a third thing.

import { COMBAT_TICK_LIMIT } from '../../battle/constants'
import { createBattle } from '../../battle/battle'
import type { PolicyFactory } from './policies'
import { projectPolicyView } from './view'

/** §1.16's two terminal verdicts. A run always reaches one — §1.12's timeout guarantees it. */
export type PolicyOutcome = 'won' | 'lost'

export type SeedResult = {
  seed: string
  outcome: PolicyOutcome
  /** `combatTick` at the verdict. §1.1's clock, so paused and card-screen steps are not in it. */
  endTick: number
  /** §1.13's counter, which excludes the elite. */
  kills: number
  /** Friendlies still standing at the verdict; downed and dead bodies are not counted. */
  standing: number
  /** §1.17's digest of the finished state. */
  digest: string
}

export type BandResult = {
  policyId: string
  seeds: readonly SeedResult[]
  wins: number
  total: number
}

/**
 * §4.1's eight seeds, in one place.
 *
 * The first three are the seeds every measurement on this branch has used, so a band run and the
 * `flees-always` regression in `tests/harness/policy-run.test.ts` share their inputs.
 *
 * BATCH F DOES NOT RUN THIS BAND. The balance values in `constants.ts` are §5 stage 0
 * placeholders and no invariant holds at them yet — a recorded band here would be a record of an
 * arbitrary point. §5 stages 2-8 run it.
 */
export const POLICY_BAND_SEEDS: readonly string[] = [
  'seed-a',
  'seed-b',
  'seed-c',
  'seed-d',
  'seed-e',
  'seed-f',
  'seed-g',
  'seed-h',
]

/**
 * The step budget, which is not the tick limit.
 *
 * §1.1 stops the clock in `paused` and `awaiting-upgrade`, so a step is not always a tick: a
 * policy that never answers the card screen would loop forever at a constant `combatTick`. The
 * budget makes that a loud failure with the mode in the message rather than a hung test run.
 */
const STEP_BUDGET = COMBAT_TICK_LIMIT * 2

export function runPolicySeed(policyFactory: PolicyFactory, seed: string): SeedResult {
  const battle = createBattle(seed)
  const policy = policyFactory(seed)

  battle.start()

  let steps = 0
  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `harness/policy: ${policy.id} on ${seed} did not decide in ${STEP_BUDGET} steps ` +
          `(mode ${battle.mode()}, tick ${battle.state().combatTick})`,
      )
    }
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    battle.step()
    steps += 1
  }

  const state = battle.state()
  let standing = 0
  for (const unit of state.friendlies) {
    if (unit.life === 'standing') standing += 1
  }

  return {
    seed,
    // `mode` is one of the two terminal values here — the loop above cannot leave otherwise.
    outcome: state.mode === 'won' ? 'won' : 'lost',
    endTick: state.combatTick,
    kills: state.stats.kills,
    standing,
    digest: battle.digest(),
  }
}

export function runPolicyBand(
  policyFactory: PolicyFactory,
  seeds: readonly string[],
): BandResult {
  const results = seeds.map((seed) => runPolicySeed(policyFactory, seed))
  // The id is a property of the policy and not of the seed, so any instance answers for the band.
  const policyId = policyFactory('').id
  return {
    policyId,
    seeds: results,
    wins: results.filter((result) => result.outcome === 'won').length,
    total: results.length,
  }
}
