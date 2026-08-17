// §1.16 steps 6, 9 and 10: the cooldown pass, friendly attacks, enemy attacks.
//
// Nothing here applies damage. §1.16 keeps damage application in its own step (step 12
// in the spec's table) and this batch does not own it, so steps 9 and 10 RETURN what
// they resolved and mutate only the attacker's cooldown. That split is not tidiness:
//
//   * simultaneity — 16 friendlies can fire at one 1.0-HP melee in the same tick. If
//     step 9 applied damage as it went, the 3rd shot would find the target already
//     dead and the other 13 shots would silently vanish, so overkill (which I2 has to
//     exclude from its accounting) would be unmeasurable.
//   * `invulnerableTicks` (§1.11) and the `cover` card (§1.13) are DEFENDER-side
//     modifiers. They belong where damage lands, not where it is fired.
//
// So the interface to the damage step is a plain list of `DamageEvent`, described
// below, and it is a return value rather than a field on `BattleState` because of the
// no-scratch rule in `types.ts`.

import {
  MELEE_RANGE,
  SHOOTER_STANDOFF,
} from './constants'
import { enemyAttackIntervalOf, enemyDamageOf } from './enemy'
import { hasBattleSight } from './sight'
import { enemiesById, findEnemy, findFriendly, friendliesById, sightBlockers } from './state'
import { attackDamageOf, attackIntervalOf, isStopped } from './targeting'
import type { BattleState, DamageEvent } from './types'

export type { DamageCause, DamageEvent, DamageSide } from './types'

/**
 * §1.16 step 6 — the cooldown pass.
 *
 * For friendlies this is half of §1.3: "이번 tick 변위 < MOVE_EPSILON인 유닛만". The
 * freeze is the part v5 lacked, and it is the whole reason the redesign works — without
 * it, stopping for one tick per attack interval keeps ~100% of firepower (see
 * `tests/battle/battle-combat.test.ts`, which reproduces the v5 number next to the v6
 * one). It must run after movement, since the displacement is what it reads.
 *
 * Enemies decrement unconditionally: §1.3 closes with "적에게는 적용하지 않는다". §1.16's
 * step-6 line says "유닛만", which read alone would cover enemies too; §1.3 is the more
 * specific statement and it is the one with a stated reason, so it wins. It also has to:
 * a melee that could not warm up while closing would need `MELEE_ATTACK_INTERVAL` extra
 * ticks in contact before its first swing.
 */
export function advanceStep6Cooldowns(state: BattleState): void {
  for (const unit of state.friendlies) {
    if (unit.life !== 'standing') continue
    if (!isStopped(unit)) continue
    if (unit.attackCooldown > 0) unit.attackCooldown -= 1
  }
  for (const enemy of state.enemies) {
    if (enemy.life !== 'standing') continue
    if (enemy.attackCooldown > 0) enemy.attackCooldown -= 1
  }
}

/**
 * §1.16 step 9 — friendly attacks, "변위 < MOVE_EPSILON인 유닛만".
 *
 * The target is whatever step 7 chose this tick, so the range and sight tests are not
 * repeated: nothing has moved in between. §1.8's "후보가 없으면 그 tick에 공격하지 않고
 * cooldown도 소비하지 않는다" is the `targetId === null` branch — the cooldown is only
 * written when a shot actually happens.
 */
export function resolveStep9FriendlyAttacks(state: BattleState): DamageEvent[] {
  const events: DamageEvent[] = []

  // Ascending id: the event order is part of what the damage step and the kill
  // accounting (§1.16 step 14) see, so it must not inherit array order.
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'standing') continue
    if (!isStopped(unit)) continue
    if (unit.attackCooldown > 0) continue
    if (unit.targetId === null) continue
    const target = findEnemy(state, unit.targetId)
    if (!target || target.life !== 'standing') continue

    events.push({
      side: 'friendly',
      attackerId: unit.id,
      targetId: target.id,
      amount: attackDamageOf(state, unit),
      cause: 'friendly-attack',
    })
    unit.attackCooldown = attackIntervalOf(state, unit)
  }

  return events
}

/**
 * §1.16 step 10 — enemy attacks.
 *
 * §1.3 does not apply, so an enemy's displacement is never consulted here. What gates
 * each class is §1.9's own description of when it attacks:
 *
 *   melee   — inside contact range. Sight is NOT required: contact is physical, and
 *             requiring it would let a melee hold in contact behind a corner forever
 *             without attacking, which is a frozen body I1 would report as a supply
 *             problem. At `MELEE_RANGE` 0.75 the two bodies are closer than the
 *             narrowest authored rectangle anyway.
 *   shooter — "standoff 구간이면 정지해 사격하며", so it fires from inside the band and
 *             only there: approaching and retreating cost it the shot, and §1.9's
 *             "시야를 잃으면 사격하지 않고" is the sight test. The band's upper bound is
 *             0.95 x SHOOTER_RANGE, so being in the band implies being in range.
 *
 * The elite is skipped: its damage is the telegraph/impact cycle (§1.12), which is
 * step 11 and a later batch, and §1.12 states it deals no contact damage at all.
 */
export function resolveStep10EnemyAttacks(state: BattleState): DamageEvent[] {
  const events: DamageEvent[] = []
  const blockers = sightBlockers(state)
  const [standoffLow, standoffHigh] = SHOOTER_STANDOFF

  for (const enemy of enemiesById(state)) {
    if (enemy.life !== 'standing') continue
    if (enemy.kind === 'elite') continue
    if (enemy.attackCooldown > 0) continue
    if (enemy.targetId === null) continue
    const target = findFriendly(state, enemy.targetId)
    if (!target || target.life !== 'standing') continue

    const distance = Math.hypot(
      target.position.x - enemy.position.x,
      target.position.y - enemy.position.y,
    )

    if (enemy.kind === 'melee') {
      if (distance > MELEE_RANGE) continue
    } else {
      if (distance < standoffLow || distance > standoffHigh) continue
      if (
        !hasBattleSight(
          enemy.position.x,
          enemy.position.y,
          target.position.x,
          target.position.y,
          blockers,
        )
      ) {
        continue
      }
    }

    events.push({
      side: 'enemy',
      attackerId: enemy.id,
      targetId: target.id,
      amount: enemyDamageOf(enemy),
      cause: enemy.kind === 'melee' ? 'melee-contact' : 'shooter-shot',
    })
    enemy.attackCooldown = enemyAttackIntervalOf(enemy)
  }

  return events
}
