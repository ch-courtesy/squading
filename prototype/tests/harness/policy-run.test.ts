// The seed-band runner, and the two whole-run numbers this batch is allowed to pin.
//
// WHAT THE NUMBERS BELOW ARE. They are "this is what it is now", not "this is what it should
// be". §5 stage 0 put arbitrary placeholders in `constants.ts` and stages 2-8 are what replace
// them, so every end tick and kill count here is a fact about a point nobody has measured yet.
// A tuning pass that moves them is doing its job; a tuning pass that moves the DIGESTS in the
// first block without touching `BattleState` is not.

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { policyFactory, type Policy } from '../../src/core/harness/policy/policies'
import {
  POLICY_BAND_SEEDS,
  runPolicyBand,
  runPolicySeed,
} from '../../src/core/harness/policy/run'
import { projectPolicyView } from '../../src/core/harness/policy/view'

const THREE_SEEDS = ['seed-a', 'seed-b', 'seed-c'] as const

describe('§1.17 the runner reproduces the digests batch E recorded', () => {
  it('drives `tactical-no-input` to exactly the states batch E measured', () => {
    // Batch E ran the facade with the card choice and no other input — which is what §4.1 calls
    // `tactical-no-input` — and recorded these. They are the standing evidence that batch F added
    // no field to `BattleState` and no draw to a stream: either would move all three.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('tactical-no-input'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'won', endTick: 2017, kills: 178, standing: 16, digest: 'b4fea139' },
      { seed: 'seed-b', outcome: 'won', endTick: 2060, kills: 187, standing: 16, digest: '68378662' },
      { seed: 'seed-c', outcome: 'won', endTick: 2008, kills: 180, standing: 16, digest: 'a769c2fa' },
    ])
  })
})

describe('§4.1 `flees-always` on the three seeds', () => {
  it('records what pure flight does at the placeholder values', () => {
    // E0 measured a hand-assembled flight loop at 1925/171/16, 1995/182/16 and 1935/176/16 and
    // left it as this batch's regression target. These numbers are NOT those. The report for this
    // batch records the localization: a loop that flees the nearest NON-SHOOTER reproduces
    // seed-a and seed-c exactly and seed-b to the tick, so the difference is in the deleted
    // policy's reading of "가장 가까운 적", not in the reducer — which the digest block above
    // pins independently.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('flees-always'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'won', endTick: 1932, kills: 170, standing: 15, digest: '19a98b3b' },
      { seed: 'seed-b', outcome: 'won', endTick: 1995, kills: 181, standing: 16, digest: 'd8406125' },
      { seed: 'seed-c', outcome: 'won', endTick: 2040, kills: 185, standing: 16, digest: '1a56f90a' },
    ])
  })

  it('wins all three, which is I8 failing and is the tuning stage to fix, not this batch', () => {
    // §3 I8: "순수 도망은 이기지 못한다 — 승리 `0/8`". It is 3/3 here. Batch F measures; §5
    // stages 3 and 4 (spawn geometry and melee speed) are what close it, and E0 already wrote
    // down why: the melee needs ~490 ticks to cross `SPAWN_RADIUS`, and the squad shoots for all
    // of them.
    const band = runPolicyBand(policyFactory('flees-always'), THREE_SEEDS)
    expect(band.policyId).toBe('flees-always')
    expect(band.wins).toBe(3)
    expect(band.total).toBe(3)
  })
})

/**
 * Drive a policy through the facade for a bounded number of steps.
 *
 * `SeedResult` carries what §4.1's bands are counted from and no more, so anything else a fixture
 * wants to see — `stats.rescues` here — it reads off the state it drove.
 */
function driveFor(policy: Policy, battle: ReturnType<typeof createBattle>, steps: number): void {
  for (let step = 0; step < steps; step += 1) {
    if (battle.mode() === 'won' || battle.mode() === 'lost') return
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    battle.step()
  }
}

describe('§1.11 the rescue difference, driven through the real rules', () => {
  /**
   * A hand-authored down, because the placeholders do not produce one.
   *
   * Measured over the three seeds: `skilled` sees 0, 0 and 2 downed bodies in a whole run, and
   * the two on `seed-a` fall inside the last dozen ticks. There is nothing to rescue at these
   * values, which is a fact about §5 stage 2 (아군 HP × 적 피해) and not about the policy — so
   * the fixture makes the situation instead of waiting for one, and drives the real §1.11 lock,
   * the real damage step and the real facade over it.
   */
  function battleWithADownedSquadmate() {
    const battle = createBattle('seed-a')
    battle.start()
    const state = battle.state()
    const command = state.friendlies.find((unit) => unit.id === state.commandUnitId)!
    const victim = state.friendlies.find((unit) => unit.id !== state.commandUnitId)!
    victim.life = 'downed'
    victim.hp = 0
    victim.downedTicks = 0
    victim.position = { x: command.position.x + 3, y: command.position.y }
    return { battle, victimId: victim.id }
  }

  it('`skilled` walks over and completes the rescue', () => {
    const { battle, victimId } = battleWithADownedSquadmate()

    driveFor(policyFactory('skilled')('seed-a'), battle, 200)

    expect(battle.state().stats.rescues).toBe(1)
    const victim = battle.state().friendlies.find((unit) => unit.id === victimId)!
    expect(victim.life).toBe('standing')
    expect(victim.rescuedByIds).toEqual([battle.state().commandUnitId])
  })

  it('`abandons-downed` leaves the same body on the ground', () => {
    const { battle, victimId } = battleWithADownedSquadmate()

    driveFor(policyFactory('abandons-downed')('seed-a'), battle, 200)

    expect(battle.state().stats.rescues).toBe(0)
    expect(battle.state().friendlies.find((unit) => unit.id === victimId)!.life).toBe('downed')
  })
})

describe('the runner', () => {
  it('gives the same result twice for the same policy and seed', () => {
    expect(runPolicySeed(policyFactory('skilled'), 'seed-a')).toEqual(
      runPolicySeed(policyFactory('skilled'), 'seed-a'),
    )
  })

  it('aggregates a band without judging it', () => {
    const band = runPolicyBand(policyFactory('camps-in-place'), ['seed-a', 'seed-b'])

    expect(band.seeds.map((result) => result.seed)).toEqual(['seed-a', 'seed-b'])
    expect(band.wins).toBe(band.seeds.filter((result) => result.outcome === 'won').length)
    expect(band.total).toBe(2)
    // No verdict field: §4.1's bands are the invariant tests' business, not the runner's.
    expect(Object.keys(band).sort()).toEqual(['policyId', 'seeds', 'total', 'wins'])
  })

  it('names eight seeds and does not run them here', () => {
    expect(POLICY_BAND_SEEDS.length).toBe(8)
    expect(new Set(POLICY_BAND_SEEDS).size).toBe(8)
    expect(POLICY_BAND_SEEDS.slice(0, 3)).toEqual([...THREE_SEEDS])
  })

  it('fails loudly when a policy never answers the card screen', () => {
    // §1.1 stops the clock in `awaiting-upgrade`, so a policy that returns nothing there loops
    // forever at a constant tick. The budget is counted in STEPS for exactly that reason.
    const mute: Policy = { id: 'mute', decide: () => [] }

    expect(() => runPolicySeed(() => mute, 'seed-a')).toThrow(/did not decide/)
  })
})
