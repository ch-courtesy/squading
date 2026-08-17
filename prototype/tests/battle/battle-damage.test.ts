// Batch C fixtures, part 3: §1.16 피해 적용 — the damage step.
//
// The damage step is the only place hp moves, and the only place that can see an overkill. I2's
// accounting excludes overkill and rescue revivals from its numerator, so "how much of what
// was fired actually landed" has to be a number this step returns, not something a later
// pass tries to reconstruct from hp.

import { describe, expect, it } from 'vitest'

import {
  COMMANDER_DAMAGE,
  COMMANDER_HP,
  MELEE_HP,
  SOLDIER_DAMAGE,
  SOLDIER_HP,
} from '../../src/core/battle/constants'
import { applyDamage, damageTakenMultiplierOf } from '../../src/core/battle/damage'
import { COMMANDER_ID, createEnemy, createInitialBattleState, findEnemy, findFriendly } from '../../src/core/battle/state'
import { digestBattleState } from '../../src/core/battle/digest'
import { resolveTransitions } from '../../src/core/battle/transitions'
import type { BattleState, DamageEvent } from '../../src/core/battle/types'

function battle(): BattleState {
  const state = createInitialBattleState('seed-a')
  state.mode = 'running'
  state.enemies = [createEnemy(101, 'melee', { x: 29, y: 16 })]
  return state
}

function friendlyShot(attackerId: number, targetId: number, amount: number): DamageEvent {
  return { side: 'friendly', attackerId, targetId, amount, cause: 'friendly-attack' }
}

function enemyShot(attackerId: number, targetId: number, amount: number): DamageEvent {
  return { side: 'enemy', attackerId, targetId, amount, cause: 'melee-contact' }
}

describe("§1.16 피해 적용 (damage application)", () => {
  it('applies the attacker-side amount to the other side, unchanged', () => {
    const state = battle()
    const outcome = applyDamage(state, [
      friendlyShot(COMMANDER_ID, 101, COMMANDER_DAMAGE),
      enemyShot(101, COMMANDER_ID, 0.045),
    ])

    expect(findEnemy(state, 101)?.hp).toBeCloseTo(MELEE_HP - COMMANDER_DAMAGE, 12)
    expect(findFriendly(state, COMMANDER_ID)?.hp).toBeCloseTo(COMMANDER_HP - 0.045, 12)
    expect(outcome.damageToEnemies).toBeCloseTo(COMMANDER_DAMAGE, 12)
    expect(outcome.damageToFriendlies).toBeCloseTo(0.045, 12)
    expect(outcome.overkill).toBe(0)
    // The defender-side multiplier is the `cover` card's seam (§1.13) and is 1 until then.
    expect(damageTakenMultiplierOf(state, findFriendly(state, COMMANDER_ID)!)).toBe(1)
  })

  it('lets every simultaneous event land and reports the overkill', () => {
    const state = battle()
    // Five shots of 0.2 exactly finish a 1.0-HP melee; the sixth is pure overkill, and
    // §1.16 keeps the body standing until the transition step, so all six are resolvable.
    const events = Array.from({ length: 6 }, (_, index) =>
      friendlyShot(COMMANDER_ID + index, 101, COMMANDER_DAMAGE),
    )

    const outcome = applyDamage(state, events)

    expect(findEnemy(state, 101)?.hp).toBe(0)
    expect(findEnemy(state, 101)?.life).toBe('standing')
    expect(outcome.applied).toHaveLength(6)
    expect(outcome.damageToEnemies).toBeCloseTo(MELEE_HP, 12)
    expect(outcome.overkill).toBeCloseTo(COMMANDER_DAMAGE, 12)
    expect(outcome.applied[5]).toMatchObject({ dealt: 0 })
    expect(outcome.applied[5].overkill).toBeCloseTo(COMMANDER_DAMAGE, 12)
  })

  it("leaves no floating-point residue that would let a finished body survive the transition step", () => {
    // 1.0 / 0.20 is exactly five shots on paper. In binary floating point the fifth leaves
    // 5.55e-17 behind, the transition step's `hp > 0` reads that as a survivor, the kill lands
    // interval late and §1.13's thresholds drift — while the digest, normalized to 6 decimals
    // (§1.1), records the body at 0 hp the whole time.
    expect(MELEE_HP / COMMANDER_DAMAGE).toBe(5)
    const state = battle()

    for (let shot = 0; shot < 5; shot += 1) {
      applyDamage(state, [friendlyShot(COMMANDER_ID, 101, COMMANDER_DAMAGE)])
    }

    expect(findEnemy(state, 101)?.hp).toBe(0)
    expect(resolveTransitions(state).enemyDeaths).toEqual([{ id: 101, kind: 'melee' }])
  })

  it('floors hp at zero rather than letting it go negative', () => {
    const state = battle()
    applyDamage(state, [friendlyShot(COMMANDER_ID, 101, MELEE_HP * 10)])
    expect(findEnemy(state, 101)?.hp).toBe(0)
  })

  it('drops an event aimed at a body that is no longer standing', () => {
    const state = battle()
    const soldier = findFriendly(state, 2)!
    soldier.life = 'downed'
    soldier.hp = 0
    findEnemy(state, 101)!.life = 'dead'

    const outcome = applyDamage(state, [
      friendlyShot(COMMANDER_ID, 101, COMMANDER_DAMAGE),
      enemyShot(101, soldier.id, SOLDIER_DAMAGE),
      enemyShot(101, 999, SOLDIER_DAMAGE),
    ])

    expect(outcome.applied).toHaveLength(0)
    expect(soldier.hp).toBe(0)
  })

  it('is deterministic and consumes no randomness', () => {
    const left = battle()
    const right = battle()
    const events = [friendlyShot(COMMANDER_ID, 101, COMMANDER_DAMAGE), enemyShot(101, 2, SOLDIER_HP)]

    applyDamage(left, events)
    applyDamage(right, events)

    expect(digestBattleState(right)).toBe(digestBattleState(left))
    expect(left.prng).toEqual(createInitialBattleState('seed-a').prng)
  })
})
