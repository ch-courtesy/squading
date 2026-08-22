// §5 stage 2: the seven-stage table, and what §2.3 says each row is FOR.
//
// ---------------------------------------------------------------------------
// WHY THESE FIXTURES PIN RELATIONS AND NOT NUMBERS
// ---------------------------------------------------------------------------
// Every value in `STAGES` is a placeholder and §5 stage 4 owns them all. A fixture that pinned
// `stageConfigOf(4).shooterRange === 4.9` would fail the moment the tuning stage did its job, so
// the tuning stage would edit the fixture — and a fixture that is edited to match the code it
// checks has stopped checking anything.
//
// What §2.3 actually asserts is not a set of numbers. It is a set of RELATIONS: "stage 4 has a
// higher shooter share than stage 1", "stage 3's bodies are the weakest", "stage 5's board is the
// one that opened". Those survive tuning, and they are what is below. A table §5 stage 4 has
// rebalanced still has to make every one of them true, or it has stopped being §2.3's campaign.
//
// ---------------------------------------------------------------------------
// AND THE MUTATION CAMPAIGN STAGE 0 RECORDED AS MISSED
// ---------------------------------------------------------------------------
// `scripts/mutate.mjs` carries "look the stage up by position instead of by id". With one row in
// the table it was unfalsifiable and was recorded MISSED with that reason written down. Every
// comparison in this file reads TWO ids and expects them to differ, so the mutation dies here.
// This file is in `TARGET_TESTS` for exactly that reason.
//
// It pins no balance. It asserts nothing about who wins.

import { describe, expect, it } from 'vitest'

import { SOLDIER_RANGE } from '../../src/core/battle/constants'
import { STAGES, stageConfigOf, type StageConfig } from '../../src/core/battle/stages'

/** §1.10's ratio as the fraction of requests that are shooters. */
function shooterShare(stage: StageConfig, phase: number): number {
  const [melee, shooter] = stage.pressurePhases[phase].meleeToShooter
  return shooter / (melee + shooter)
}

const ALL = STAGES

describe('the table is seven distinct stages, looked up by id', () => {
  it('has one row per §2.3 stage, in play order', () => {
    expect(ALL.map((stage) => stage.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('answers each id with ITS row and not with the first one', () => {
    // The whole of §3.1: "설정은 순수 표에서 유도한다". Every id gives back its own row, and no
    // two rows are the same object — which is the sentence a positional lookup makes false.
    for (const stage of ALL) expect(stageConfigOf(stage.id).id).toBe(stage.id)
    expect(stageConfigOf(4)).not.toBe(stageConfigOf(1))
    expect(stageConfigOf(7)).not.toEqual(stageConfigOf(1))
  })

  it('throws for an id the table has no row for, rather than substituting one', () => {
    expect(() => stageConfigOf(8 as never)).toThrow(/no stage with id 8/)
  })

  it('is a pure table: the same id gives the same frozen row every time', () => {
    expect(stageConfigOf(5)).toBe(stageConfigOf(5))
  })

  it('gives every pair of stages a different configuration', () => {
    // Not "different somewhere" as a slogan — the JSON of each row, compared pairwise. Two rows
    // that matched would be one stage played twice under two numbers.
    const shapes = ALL.map((stage) => JSON.stringify(stage))
    expect(new Set(shapes).size).toBe(ALL.length)
  })
})

describe('§2.3: each stage is dominated by the axis it is named for', () => {
  it('1 빨강 — the highest melee share of any stage in the opening phase', () => {
    const first = shooterShare(stageConfigOf(1), 0)
    for (const stage of ALL) {
      if (stage.id === 1) continue
      expect(shooterShare(stage, 0), `stage ${stage.id} opens no less melee-heavy than stage 1`)
        .toBeGreaterThan(first)
    }
  })

  it('2 주황 — spawn density: strictly shorter request intervals than stage 1, in every phase', () => {
    const one = stageConfigOf(1)
    const two = stageConfigOf(2)
    expect(two.pressurePhases).toHaveLength(one.pressurePhases.length)
    for (let phase = 0; phase < one.pressurePhases.length; phase += 1) {
      expect(two.pressurePhases[phase].requestInterval).toBeLessThan(
        one.pressurePhases[phase].requestInterval,
      )
      expect(two.pressurePhases[phase].engagedCap).toBeGreaterThan(
        one.pressurePhases[phase].engagedCap,
      )
    }
    expect(two.absoluteEnemyCap).toBeGreaterThan(one.absoluteEnemyCap)
    // And the density is the ONLY axis: the bodies arriving are stage 1's bodies. That is what
    // makes stage 2 a measurement of density rather than of density plus five other things.
    expect(two.meleeHp).toBe(one.meleeHp)
    expect(two.shooterHp).toBe(one.shooterHp)
    expect(two.shooterRange).toBe(one.shooterRange)
    expect(two.meleeDamage).toBe(one.meleeDamage)
  })

  it('3 노랑 — many weak: the weakest bodies in the table, behind the highest engaged caps', () => {
    const three = stageConfigOf(3)
    for (const stage of ALL) {
      if (stage.id === 3) continue
      // "개체 HP ↓" — and this half is against the WHOLE table, because being the weakest is what
      // makes stage 3 the stage it is. Nothing else in the campaign is allowed to tie it.
      expect(three.meleeHp, `stage ${stage.id}`).toBeLessThan(stage.meleeHp)
      expect(three.shooterHp, `stage ${stage.id}`).toBeLessThan(stage.shooterHp)
      // "상한 ↑" — against every stage EXCEPT the seventh. §2.3 makes stage 7 "모든 축이 최댓값
      // 근처", so it is the one row entitled to sit beside stage 3 on a cap; what it does not take
      // is the hp floor above, which is why the weakness half is the unqualified one.
      if (stage.id === 7) continue
      for (let phase = 0; phase < three.pressurePhases.length; phase += 1) {
        expect(
          three.pressurePhases[phase].engagedCap,
          `stage ${stage.id} phase ${phase}`,
        ).toBeGreaterThan(stage.pressurePhases[phase].engagedCap)
      }
    }
  })

  it('4 초록 — the highest shooter share in the table, in EVERY phase', () => {
    const four = stageConfigOf(4)
    for (let phase = 0; phase < four.pressurePhases.length; phase += 1) {
      for (const stage of ALL) {
        if (stage.id === 4) continue
        expect(
          shooterShare(four, phase),
          `stage ${stage.id} phase ${phase} is at least as shooter-heavy as stage 4`,
        ).toBeGreaterThan(shooterShare(stage, phase))
      }
    }
    // §2.3's own emphasis: stage 4 is where the range judgement is FORCED, so it is measured
    // against stage 1 by name as well as against the table.
    expect(shooterShare(four, 0)).toBeGreaterThan(shooterShare(stageConfigOf(1), 0))
  })

  it('4 초록 — and the smallest range advantage in the table, §1.6 intact', () => {
    const four = stageConfigOf(4)
    for (const stage of ALL) {
      if (stage.id === 4) continue
      expect(four.rangeAdvantage, `stage ${stage.id}`).toBeLessThan(stage.rangeAdvantage)
    }
    // §1.6 is a rule and not an axis: the band shrinks, it never inverts. The module asserts this
    // at import for every row; here it is stated where stage 4's identity is, because stage 4 is
    // the row that could take it past the edge.
    expect(four.rangeAdvantage).toBeGreaterThan(0)
    expect(four.shooterRange).toBeLessThan(SOLDIER_RANGE)
    expect(four.rangeAdvantage).toBe(SOLDIER_RANGE - four.shooterRange)
  })

  it('5 파랑 — the board opens and the leash does not follow it', () => {
    const one = stageConfigOf(1)
    const five = stageConfigOf(5)
    expect(five.arenaWidth * five.arenaHeight).toBeGreaterThan(one.arenaWidth * one.arenaHeight)
    // "리쉬 상대적 축소" — smaller against the board, and here smaller outright as well.
    expect(five.leashRadius).toBeLessThan(one.leashRadius)
    expect(five.leashRadius / five.arenaWidth).toBeLessThan(one.leashRadius / one.arenaWidth)
  })

  it('6 남색 — the elite arrives sooner, warns for less time and covers more ground', () => {
    const six = stageConfigOf(6)
    for (const stage of ALL) {
      if (stage.id >= 6) continue
      expect(six.eliteTelegraphTicks, `stage ${stage.id}`).toBeLessThan(stage.eliteTelegraphTicks)
      expect(six.eliteCooldownTicks, `stage ${stage.id}`).toBeLessThan(stage.eliteCooldownTicks)
      expect(six.eliteBlastRadius, `stage ${stage.id}`).toBeGreaterThan(stage.eliteBlastRadius)
      expect(six.eliteSpawnTick, `stage ${stage.id}`).toBeLessThanOrEqual(stage.eliteSpawnTick)
    }
  })

  it('7 보라 — the largest population and the toughest elite in the table', () => {
    const seven = stageConfigOf(7)
    for (const stage of ALL) {
      if (stage.id === 7) continue
      expect(seven.absoluteEnemyCap, `stage ${stage.id}`).toBeGreaterThan(stage.absoluteEnemyCap)
      expect(seven.eliteHp, `stage ${stage.id}`).toBeGreaterThan(stage.eliteHp)
      expect(seven.eliteBlastRadius, `stage ${stage.id}`).toBeGreaterThan(stage.eliteBlastRadius)
      for (let phase = 0; phase < seven.pressurePhases.length; phase += 1) {
        expect(
          seven.pressurePhases[phase].requestInterval,
          `stage ${stage.id} phase ${phase}`,
        ).toBeLessThan(stage.pressurePhases[phase].requestInterval)
      }
    }
  })

  it('ramps the elite every stage, so one axis rises across the whole campaign', () => {
    for (let index = 1; index < ALL.length; index += 1) {
      expect(ALL[index].eliteHp, `stage ${ALL[index].id}`).toBeGreaterThan(ALL[index - 1].eliteHp)
    }
  })
})

describe('stage 1 is the run every recorded band was measured on', () => {
  it('is unchanged by §5 stage 2, value for value', () => {
    // The recorded bands, the browser routes and eleven fixtures that read `stageConfigOf(1)` all
    // name stage 1. This is the one row in the table that is pinned by NUMBER, and it is pinned
    // because the numbers themselves are the thing being preserved.
    expect(stageConfigOf(1)).toEqual({
      id: 1,
      arenaWidth: 56,
      arenaHeight: 32,
      leashRadius: 10.0,
      meleeHp: 1.0,
      meleeMoveSpeed: 0.14,
      meleeRange: 0.75,
      meleeAttackInterval: 15,
      meleeDamage: 0.045,
      shooterHp: 0.8,
      shooterMoveSpeed: 0.06,
      shooterRange: 4.5,
      shooterAttackInterval: 30,
      shooterDamage: 0.035,
      shooterStandoff: [0.6 * 4.5, 0.95 * 4.5],
      rangeAdvantage: SOLDIER_RANGE - 4.5,
      spawnRadius: 13.0,
      engageRadius: 10.0,
      absoluteEnemyCap: 60,
      backlogSize: 12,
      backlogDrainPerTick: 2,
      pressurePhases: [
        { fromTick: 0, engagedCap: 14, requestInterval: 9, meleeToShooter: [5, 1] },
        { fromTick: 900, engagedCap: 20, requestInterval: 7, meleeToShooter: [3, 1] },
        { fromTick: 1800, engagedCap: 26, requestInterval: 5, meleeToShooter: [2, 1] },
      ],
      eliteSpawnTick: 1800,
      eliteHp: 22.0,
      eliteMoveSpeed: 0.1,
      eliteApproachRange: 4.5,
      eliteTelegraphTicks: 54,
      eliteCooldownTicks: 56,
      eliteBlastRadius: 2.4,
      eliteDamage: 0.4,
    })
  })
})
