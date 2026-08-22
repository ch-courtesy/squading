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
    // they moved to. This batch moves them TWICE more inside itself — once when it changes
    // `PRESSURE_PHASES` (9/7/5) and once when it raises `LEASH_RADIUS` (8.0 -> 10.0) — and the
    // lines below carry the last of the three. The ones quoted above are the history.
    //
    // THE OUTCOMES MOVED WITH THEM, and that is the balance change and not a reducer change:
    // `tactical-no-input` now LOSES on all three seeds. §3 I3 requires exactly that ("정지 플레이는
    // 전멸한다 — 승리 0/8") and it was 3/3 through batch H, so the direction is the spec's. It is
    // 0/3 here, not 0/8, and this batch did not run the other five seeds for it.
    //
    // WHAT THEY STILL PIN, and it is the reason they are here rather than deleted: no field was
    // added to `BattleState` and no draw to a stream. A moved digest cannot prove that on its
    // own — `tests/battle/battle-state.test.ts` is what proves it, by pinning the top-level key
    // set, every nested object's key set, both row types and the three stream names, and none of
    // those four pins was touched by this batch. These three lines are the OTHER half: they say
    // that whatever moved, it moved once and reproducibly.
    //
    // §1.4.2 (batch N) MOVED TWO OF THE THREE. The command unit now swings inside
    // `COMMANDER_MELEE_RANGE` for `COMMANDER_MELEE_DAMAGE` on `COMMANDER_MELEE_INTERVAL`, and a
    // policy that never moves still gets swung at: the melees walk into contact by themselves.
    // Batch I's values were 1653/159/`8f30c06d`, 2190/228/`91fc34fe` and 1719/170/`334b1763`.
    //
    // `seed-b` DID NOT MOVE, and that is measured rather than assumed. Its `tactical-no-input`
    // run lands exactly three melee blows (ticks 1285, 1442, 1694 — the rest of the run has
    // nothing inside 1.2). The digest DOES diverge on the tick after the first one — `397dc51f`
    // against batch I's `f3a565d4` at tick 1286 — and is back to `44eb1b1d` on both sides by
    // 1300, so the run re-converges instead of never differing: the heavier blow was spent on a
    // body that died in that tick either way, and the shorter cooldown had run out with nothing
    // in range to spend it on. Four sampled digests along the rest of the run (1300, 1500, 1800,
    // 2100) agree on both sides. The identical line below is therefore a fact about this seed,
    // not evidence that the rule is inert — the other two seeds and `flees-always`'s three all
    // moved, and `tests/sweeps/melee-usage.sweep.ts` measures melee blows in 62 of the 64
    // policy-by-seed runs (the two exceptions are `flees-always` on `seed-f` and `seed-h`, which
    // land none at all).
    //
    // §1.4.2's v13 CLAUSE MOVED THEM BACK — all three, to batch I's values EXACTLY. That is not a
    // revert of the rule; it is what the rule now says about this policy. v13 fires the melee only
    // when the §1.8 target is a `shooter` or the `elite`, and `tactical-no-input` never walks
    // anywhere, so it almost never crosses `SHOOTER_STANDOFF` low (2.70) or `ELITE_APPROACH_RANGE`
    // (4.5) to reach one. Measured: 0 swings over §4.1's eight band seeds and 1 over a 32-seed
    // extension, against 192 and 595 before the clause — every one of which had landed on a
    // melee-class body that walked to it (`i4-inversion-diagnosis.md` §2). A policy that gives up
    // nothing now gets nothing, so these three runs are bit-identical to the tree that has no
    // §1.4.2 at all. The equality with batch I is the strongest statement available that the
    // clause removed exactly the free half and nothing else — and it is not the rule going inert,
    // which `tests/sweeps/melee-usage.sweep.ts` measures on the other side.
    //
    // CAMPAIGN STAGE 0 MOVED ALL THREE DIGESTS AND NOTHING ELSE. `BattleState` gained ONE field —
    // `stageId` — and §1.17's digest walks the whole object, so every recorded digest on this
    // branch is void by construction. The other four columns are the evidence that only the
    // digest moved: `1653/159/0`, `2190/228/0` and `1719/170/0` are character for character what
    // stood here before, and the batch report carries the full outcome comparison (eight policies
    // x 32 seeds, `damageEvents` stream hashes included) that this line is three rows of. The
    // previous digests were `8f30c06d`, `91fc34fe` and `334b1763`.
    //
    // CAMPAIGN STAGE 1 MOVED ALL THREE AGAIN, AND AGAIN ONLY THE DIGESTS. `BattleState` gained the
    // relay's two fields — `stats.priorKills` and `upgrades.carriedCards` — and `schemaVersion`
    // went 2 -> 3 with them, so every hash on this branch is void by construction for the third
    // time. The other four columns are the evidence that only the hash moved: `1653/159/0`,
    // `2190/228/0` and `1719/170/0`, character for character. That is what a batch which changes
    // only what a battle STARTS HOLDING must leave behind — these runs carry nothing, so both new
    // fields are `0` and `[]` all the way through, and the offer filter that reads the second one
    // removes nothing from a pool it has never taken a card out of.
    // The previous digests were `9fa23f60`, `bf98a149` and `699a5f76`.
    //
    // TUNING BATCH 1 MOVED EVERY COLUMN, AND THIS TIME THAT IS THE POINT. The four batches above
    // moved only the hash and said so; this one moved stage 1's `spawnRadius` 13.0 -> 14.0 and
    // `engageRadius` 10.0 -> 11.0, which is a different fight, so the ticks and the kills had to
    // move with the digest. `1653/159/0`, `2190/228/0` and `1719/170/0` at digests `d304b421`,
    // `b5a643bc` and `43979b33` are what stood here before. All three still lose, which is what
    // this fixture is for; the batch report carries the eight-seed band the values were chosen on.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('tactical-no-input'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'lost', endTick: 1575, kills: 145, standing: 0, digest: '038d64de' },
      { seed: 'seed-b', outcome: 'lost', endTick: 2185, kills: 220, standing: 0, digest: 'f4ced7d8' },
      { seed: 'seed-c', outcome: 'lost', endTick: 1731, kills: 165, standing: 0, digest: '1b349b23' },
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
    // first block, and `PRESSURE_PHASES` then `LEASH_RADIUS` moved them twice more inside the
    // same batch.
    // §1.4.2 (batch N) MOVED ALL THREE. Batch I's values were 1563/147/`d8f816f6`,
    // 2204/225/`ffddc7d9` and 2083/225/`e79eb3e9`. A policy that runs from the nearest enemy
    // still ends up inside `COMMANDER_MELEE_RANGE` — §1.3's whole point is that it cannot get
    // away — so the melee lands on it too (38, 3 and 20 blows on the three seeds).
    //
    // §1.4.2's v13 CLAUSE MOVED THEM AGAIN, AND TWO OF THE THREE ARE BATCH I'S VALUES EXACTLY.
    // `seed-a` and `seed-b` are back to `d8f816f6` and `ffddc7d9`: on those two, every swing the
    // rule used to pay out landed on a melee-class body that had run the command unit down, so
    // with the class clause the policy lands none at all and the run is bit-identical to the tree
    // without §1.4.2. `seed-c` is NOT batch I's — flight backs the command unit into shooters and
    // the elite often enough on this seed for some swings to survive the clause, so it is its own
    // third value. Two identical and one not is the shape the clause predicts: the melee stops
    // being free without being switched off.
    //
    // CAMPAIGN STAGE 0 MOVED ALL THREE DIGESTS AND NOTHING ELSE, for the reason written above the
    // block before this one: `stageId` joined `BattleState`. `1563/147/0`, `2204/225/0` and
    // `2099/230/0` are unchanged. The previous digests were `d8f816f6`, `ffddc7d9` and `991977cd`.
    //
    // CAMPAIGN STAGE 1 MOVED ALL THREE AGAIN, for the reason written above the block before this
    // one. `1563/147/0`, `2204/225/0` and `2099/230/0` are unchanged; the previous digests were
    // `0eac8f2f`, `426086e8` and `77adaf5a`.
    //
    // TUNING BATCH 1 MOVED EVERY COLUMN. Stage 1's `spawnRadius` went 13.0 -> 14.0 and its
    // `engageRadius` 10.0 -> 11.0, and that pair is the one thing on the whole eight-seed band
    // that took `flees-always` from 1/8 to 0/8 while `skilled` went 7/8 to 8/8 — so it is a
    // different fight for this policy above all, and the ticks moved with the digests.
    // `1563/147/0`, `2204/225/0` and `2099/230/0` at `6a811778`, `4dbbc065` and `0cd5f95b` are
    // what stood here before. Flight lasts LONGER on all three now (1763, 2235, 1955 against
    // 1563, 2204, 2099 — two up, one down) and still loses all three, which is the shape a spawn
    // ring further out gives it: more distance to buy, and no more able to buy it.
    expect(THREE_SEEDS.map((seed) => runPolicySeed(policyFactory('flees-always'), seed))).toEqual([
      { seed: 'seed-a', outcome: 'lost', endTick: 1763, kills: 162, standing: 0, digest: '6ad10ffa' },
      { seed: 'seed-b', outcome: 'lost', endTick: 2235, kills: 229, standing: 0, digest: '23c5b84b' },
      { seed: 'seed-c', outcome: 'lost', endTick: 1955, kills: 191, standing: 0, digest: '88336953' },
    ])
  })

  it('now wins NONE of the three, which is I8 holding on these three seeds', () => {
    // §3 I8: "순수 도망은 이기지 못한다 — 승리 `0/8`". It was 3/3 through batch H. Batch I's two
    // balance edits — `PRESSURE_PHASES` 12/9/7 -> 9/7/5, then `LEASH_RADIUS` 8.0 -> 10.0, both
    // made for §1.4.1's sake and neither aimed at I8 — took it to 1/3 and then to 0/3.
    //
    // THAT IS NOT I8 SATISFIED. I8 is measured over EIGHT seeds and this runs three, and §5 stage
    // 4 is the stage that owns it; three seeds cannot distinguish "the invariant holds" from "the
    // three seeds this branch has always used happen to lose". What the line below is, is the
    // measurement: on the seeds this file has records for, pure flight stopped winning.
    const band = runPolicyBand(policyFactory('flees-always'), THREE_SEEDS)
    expect(band.policyId).toBe('flees-always')
    expect(band.wins).toBe(0)
    expect(band.total).toBe(3)
  })

  it('counts wins by counting them, which a band of zero cannot show on its own', () => {
    // A ZERO IS NOT A MEASUREMENT OF A COUNTER. While `flees-always` was 3/3 the assertion above
    // was the only thing standing on `runPolicyBand`'s win arithmetic, and it pinned a non-zero.
    // Now that it pins 0, `wins: results.filter(...).length -> wins: 0` passes it — measured, not
    // reasoned: `scripts/mutate.mjs`'s "count no wins" went from caught to MISSED the moment the
    // band above reached 0.
    //
    // So the non-vacuity comes from a second policy that still wins. `skilled` is 3/3 on these
    // three seeds at batch I's values, which is also what §4.1 asks of it (`>= 6/8`).
    const skilled = runPolicyBand(policyFactory('skilled'), THREE_SEEDS)
    expect(skilled.policyId).toBe('skilled')
    expect(skilled.wins).toBe(3)
    expect(skilled.total).toBe(3)
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
