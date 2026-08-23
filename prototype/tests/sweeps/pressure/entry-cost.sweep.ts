// §1.10.1's floor, measured against the ONE clause it exists for.
//
//   PRESSURE_FLOOR=0.65 PRESSURE_ENTRY_OUT=artifacts/x.json \
//     npx vitest run --config tests/sweeps/pressure/pressure-floor.config.ts \
//     tests/sweeps/pressure/entry-cost.sweep.ts
//
// WHY IT EXISTS. Once §1.10.1 scales by the ENTERING count instead of the live one, the per-stage
// band cannot see the floor at all: all 448 of its runs open with a fresh sixteen, so the fraction
// is 1 in every one of them and `MIN_PRESSURE_FRACTION` multiplies nothing. Measured, not argued —
// the stage band at 0.3 and at 0.8 is identical to the stage band at 0.65 in every field of all
// 448 rows. The floor's whole domain is the relay, and the relay's own band is eight campaigns per
// policy, which is too coarse to tell one floor from another.
//
// So this file asks the floor's question directly, which is §1.10.1's sentence:
//
//     "분대가 작게 들어와도 유닛당 압력이 커지지는 않지만, 줄어든 만큼 그대로 줄지도 않는다 —
//      §2의 minPressureFraction이 바닥을 만든다. 사람을 잃는 것은 언제나 손해여야 한다."
//
// Two halves, and this measures both. The SAME stage is played by `skilled` on the fixed eight
// seeds by squads that walked in at sixteen, fourteen, twelve, ten, eight, six, four and two:
//
//   * "유닛당 압력이 커지지는 않는다" — a smaller entering squad must not meet a board that is
//     bigger PER BODY. Read off `damageTakenPerEnteringBody` not rising as the squad shrinks.
//   * "사람을 잃는 것은 언제나 손해여야 한다" — a smaller entering squad must do WORSE. Read off
//     the win count, which must not rise as the squad shrinks.
//
// A floor that fails the second half is the trap §1.10.1 names, and it is the only thing that can
// exclude a point of §2's `0.3~0.8` box from outside the box's own edges.
//
// A MEASUREMENT TOOL, not a regression test: it asserts only that the runs happened. Every number
// goes to `PRESSURE_ENTRY_OUT` and is argued about in the batch report. It changes no rule and no
// constant — the floor it plays at is `pressure-floor.config.ts`'s rewrite, not an edit to `src/`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createBattle } from '../../../src/core/battle/battle'
import { COMBAT_TICK_LIMIT, COMMANDER_HP, ROSTER_SIZE, SOLDIER_HP } from '../../../src/core/battle/constants'
import { COMMANDER_ID } from '../../../src/core/battle/state'
import { STAGES, type StageId } from '../../../src/core/battle/stages'
import type { CarriedSquad } from '../../../src/core/battle/types'
import { policyFactory } from '../../../src/core/harness/policy/policies'
import { POLICY_BAND_SEEDS } from '../../../src/core/harness/policy/run'
import { projectPolicyView } from '../../../src/core/harness/policy/view'

const STEP_BUDGET = COMBAT_TICK_LIMIT * 2
const OUT = process.env.PRESSURE_ENTRY_OUT ?? 'artifacts/pressure-entry-cost.json'
const STAGE_IDS: readonly StageId[] = STAGES.map((stage) => stage.id)

/** Entering sizes, from the full roster down to the smallest squad §1.5 lets open a stage. */
const ENTERING_SIZES = [16, 14, 12, 10, 8, 6, 4, 2] as const

/**
 * Campaign §1.1's relay, with `entering` bodies and nothing else carried.
 *
 * No cards and no prior kills: this file is about ONE axis, and a carried card deck would put
 * §1.13's upgrades in the same column as the entering count. Every body arrives at full hp, which
 * is what §1.1 v2 does at a real boundary.
 */
function squadOf(entering: number): CarriedSquad {
  const members = Array.from({ length: entering }, (_, index) => {
    const id = COMMANDER_ID + index
    const maxHp = id === COMMANDER_ID ? COMMANDER_HP : SOLDIER_HP
    return {
      id,
      role: id === COMMANDER_ID ? ('commander' as const) : ('soldier' as const),
      nameIndex: index,
      hp: maxHp,
      maxHp,
    }
  })
  return { commandUnitId: COMMANDER_ID, members, cards: [], priorKills: 0 }
}

type EntryRun = {
  stageId: StageId
  entering: number
  seed: string
  outcome: 'won' | 'lost'
  endTick: number
  kills: number
  standing: number
  damageTaken: number
  digest: string
}

function runEntry(stageId: StageId, entering: number, seed: string): EntryRun {
  // EVERY size goes through the relay, including the full sixteen, so the only thing that differs
  // between two rows is the entering count. A fresh roster would also draw §1.14's names, which is
  // a second difference in a file that is measuring one.
  const battle = createBattle(seed, { stageId, carried: squadOf(entering) })
  const policy = policyFactory('skilled')(seed)
  battle.start()

  let damageTaken = 0
  let steps = 0
  while (battle.mode() !== 'won' && battle.mode() !== 'lost') {
    if (steps >= STEP_BUDGET) {
      throw new Error(
        `pressure/entry: stage ${stageId} entering ${entering} on ${seed} did not decide in ` +
          `${STEP_BUDGET} steps (mode ${battle.mode()})`,
      )
    }
    for (const command of policy.decide(projectPolicyView(battle.state()))) battle.enqueue(command)
    const result = battle.step()
    if (result.ran) {
      for (const applied of result.damage.applied) {
        if (applied.event.side !== 'friendly') damageTaken += applied.dealt
      }
    }
    steps += 1
  }

  const state = battle.state()
  return {
    stageId,
    entering,
    seed,
    outcome: state.mode === 'won' ? 'won' : 'lost',
    endTick: state.combatTick,
    kills: state.stats.kills,
    standing: state.friendlies.filter((unit) => unit.life === 'standing').length,
    damageTaken,
    digest: battle.digest(),
  }
}

describe('§1.10.1 — what it costs to walk in short', () => {
  it(`runs ${STAGE_IDS.length} stages x ${ENTERING_SIZES.length} entering sizes x ${POLICY_BAND_SEEDS.length} seeds`, () => {
    const runs: EntryRun[] = []
    const startedAt = Date.now()

    for (const stageId of STAGE_IDS) {
      for (const entering of ENTERING_SIZES) {
        for (const seed of POLICY_BAND_SEEDS) runs.push(runEntry(stageId, entering, seed))
      }
    }

    const elapsedMs = Date.now() - startedAt
    expect(runs.length).toBe(STAGE_IDS.length * ENTERING_SIZES.length * POLICY_BAND_SEEDS.length)
    // The top row is the full squad, so every column below it is a comparison against `1`.
    expect(ENTERING_SIZES[0]).toBe(ROSTER_SIZE)

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      `${JSON.stringify(
        { stages: STAGE_IDS, entering: ENTERING_SIZES, seeds: POLICY_BAND_SEEDS, elapsedMs, runs },
        null,
        2,
      )}\n`,
    )
  })
})
