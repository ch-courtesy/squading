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

describe('§1.17 the runner reproduces the digests batch H recorded', () => {
  it('drives `tactical-no-input` to exactly the states batch H measured', () => {
    // Batch E ran the facade with the card choice and no other input — which is what §4.1 calls
    // `tactical-no-input` — and recorded 2017/178/`b4fea139`, 2060/187/`68378662` and
    // 2008/180/`a769c2fa`. §1.4.1 (batch H) MOVED ALL THREE, on purpose: the soldiers stopped
    // being pinned to slots, so every position in the digest is a different number from the tick
    // the first enemy came inside `LEASH_RADIUS`. The spec commit that introduced §1.4.1 said
    // these would move, and batch H measured 2018/164/16/`74e89375`, 2005/167/16/`a6d977a4` and
    // 2295/206/15/`7a3382f0`.
    //
    // v11 (batch I) MOVED THEM AGAIN, for a narrower reason of the same kind: the engagement goal
    // point gained a BEARING, so an engaged soldier stands somewhere batch H did not put it from
    // the first tick anything is engaged at all. The values below are the measurement of where
    // they moved to. This batch moves them a SECOND time when it changes `PRESSURE_PHASES`, and
    // the lines below carry the later measurement — the ones quoted above are the history.
    //
    // WHAT THEY STILL PIN, and it is the reason they are here rather than deleted: no field was
    // added to `BattleState` and no draw to a stream. A moved digest cannot prove that on its
    // own — `tests/battle/battle-state.test.ts` is what proves it, by pinning the top-level key
    // set, every nested object's key set, both row types and the three stream names, and none of
    // those four pins was touched by this batch. These three lines are the OTHER half: they say
    // that whatever moved, it moved once and reproducibly.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('tactical-no-input'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'won', endTick: 2003, kills: 176, standing: 14, digest: '7fe29e15' },
      { seed: 'seed-b', outcome: 'won', endTick: 2114, kills: 197, standing: 16, digest: 'b68bf65a' },
      { seed: 'seed-c', outcome: 'won', endTick: 1976, kills: 176, standing: 15, digest: '9d56385e' },
    ])
  })
})

describe('§4.1 `flees-always` on the three seeds', () => {
  it('records what pure flight does at the placeholder values', () => {
    // E0 measured a hand-assembled flight loop at 1925/171/16, 1995/182/16 and 1935/176/16 and
    // left it as this batch's regression target. These numbers are NOT those. The report for this
    // batch records the localization: a loop that flees the nearest NON-SHOOTER reproduces
    // seed-a and seed-c exactly and seed-b to the tick and the survivor count, which puts the
    // difference in the deleted policy's reading of "가장 가까운 적" rather than in the reducer —
    // and the digest block above pins the reducer independently of that argument.
    //
    // ONE KILL IS NOT ACCOUNTED FOR, and this comment does not pretend otherwise. `seed-b` comes
    // out at 181 against the baseline's 182 under EVERY reading measured — the shipped one, the
    // nearest non-shooter, and melee-only — including the two that reproduce the other two seeds
    // to the tick, the kill and the survivor. The loop that produced the baseline is deleted, so
    // there is nothing left to re-run against it. Five of the six numbers are localized; this one
    // is an unexplained residual.
    //
    // AND THE LOCALIZATION ITSELF IS THE WEAKEST INFERENCE IN THIS FILE. `battle-e0-report.md:25`
    // describes E0's own loop as moving away from "최근접 생존 적" — no kind filter, which is the
    // reading SHIPPED here, and the shipped reading does not reproduce E0. So "the deleted
    // policy's reading of 가장 가까운 적" is in tension with E0's own prose about that policy. It
    // stands as a localization and not as a proof; what pins the reducer is the digest block
    // above, which does not depend on this argument at all.
    //
    // BATCH H MOVED THESE TOO, for §1.4.1's reason and not for a new one. The batch F values
    // were 1932/170/15/`19a98b3b`, 1995/181/16/`d8406125` and 2040/185/16/`1a56f90a`; the
    // localization argument above is about the DELETED E0 loop and is untouched by the move —
    // it was already an argument about numbers this batch has now superseded, and nothing below
    // re-derives it. Batch H's own values were 2069/161/9/`03d32a9b`, 1961/175/16/`7f093e81` and
    // 1983/176/16/`e005f02e`; v11's bearing moved them again, for the reason recorded above the
    // first block, and `PRESSURE_PHASES` moves them a second time inside the same batch.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('flees-always'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'won', endTick: 1996, kills: 178, standing: 14, digest: '2f25a62e' },
      { seed: 'seed-b', outcome: 'won', endTick: 2071, kills: 187, standing: 15, digest: '0c388455' },
      { seed: 'seed-c', outcome: 'won', endTick: 1999, kills: 178, standing: 12, digest: 'e2b8a0a3' },
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
   * Re-measured after §1.4.1 (batch H), over all EIGHT band seeds: `skilled` now takes ZERO
   * bodies down on every one of them, completes no rescue and sends no `set-rescue`. Batch F
   * measured 2, 0 and 0 over the first three seeds, with both of `seed-a`'s inside the last dozen
   * ticks; the leash moved that to 0 everywhere, which is a fact about balance and belongs in the
   * §5 record, not a fact about the policy. `tactical-no-input` is the one that produces downs
   * now — 0/0/1/0/7/0/0/1 over the eight seeds, all of them after tick 1995.
   *
   * There is nothing to rescue at these values, which is a fact about §5 stage 2 (아군 HP × 적
   * 피해) and not about the policy — so the fixture makes the situation instead of waiting for
   * one, and drives the real §1.11 lock, the real damage step and the real facade over it.
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
