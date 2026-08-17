// The 냉각 감소, 아군 공격 and 적 공격 steps (see the step table in `index.ts`).
//
// §1.3 IS WHAT THIS FILE IS ABOUT, AND IT SAYS "NOTHING": "유닛은 이동 중에도 공격한다.
// 변위는 공격·cooldown에 영향을 주지 않으며 cooldown은 항상 감소한다." So neither pass
// consults a displacement, for either side. v6~v8 had the opposite rule — a friendly that
// moved this tick neither fired nor decremented — and closed the "constant motion is
// invulnerability" defect by taxing movement. v9 closes it with a speed relation instead
// (`MELEE_MOVE_SPEED > COMMANDER_MOVE_SPEED`, asserted in `constants.ts`), so the tax is
// gone: movement is positioning, and positioning is free.
//
// Nothing here applies damage. §1.16 keeps damage application in its own step, so the two
// attack passes RETURN what they resolved and mutate only the attacker's cooldown. That
// split is not tidiness:
//
//   * simultaneity — 16 friendlies can fire at one 1.0-HP melee in the same tick. If the
//     friendly pass applied damage as it went, the 3rd shot would find the target already
//     dead and the other 13 shots would silently vanish, so overkill (which I2 has to
//     exclude from its accounting) would be unmeasurable.
//   * `invulnerableTicks` (§1.11) and the `cover` card (§1.13) are DEFENDER-side
//     modifiers. They belong where damage lands, not where it is fired.
//
// So the interface to the damage step is a plain list of `DamageEvent`, described
// below, and it is a return value rather than a field on `BattleState` because of the
// no-scratch rule in `types.ts`.

import { MELEE_RANGE, SHOOTER_STANDOFF } from './constants'
import { enemyAttackIntervalOf, enemyDamageOf } from './enemy'
import { enemiesById, findEnemy, findFriendly, friendliesById } from './state'
import { attackDamageOf, attackIntervalOf } from './targeting'
import type { BattleState, DamageEvent } from './types'

export type { DamageCause, DamageEvent, DamageSide } from './types'

/**
 * The 냉각 감소 step — "모든 유닛, 무조건" (§1.16), which is §1.3's "cooldown은 항상
 * 감소한다" for both sides.
 *
 * The two loops are identical because the rule is now identical: no displacement test, no
 * per-side exception. The only remaining condition is `life === 'standing'` — a downed or
 * dead body has no weapon to warm up, and §1.5 lets a downed commander come back, so its
 * cooldown must not have been counting down while it lay there.
 *
 * It no longer matters whether this runs before or after movement, but §1.16 puts it after
 * and the loop keeps that order: it is the tick position the digest was recorded against.
 */
export function advanceCooldowns(state: BattleState): void {
  for (const unit of state.friendlies) {
    if (unit.life !== 'standing') continue
    if (unit.attackCooldown > 0) unit.attackCooldown -= 1
  }
  for (const enemy of state.enemies) {
    if (enemy.life !== 'standing') continue
    if (enemy.attackCooldown > 0) enemy.attackCooldown -= 1
  }
}

/**
 * The 아군 공격 step — "이동 중에도 발사한다" (§1.16's own note on this step).
 *
 * The target is whatever the 대상 선택 step chose this tick, so the range test is not
 * repeated: nothing has moved in between. §1.8's "후보가 없으면 그 tick에 공격하지 않고
 * cooldown도 소비하지 않는다" is the `targetId === null` branch — the cooldown is only
 * written when a shot actually happens.
 *
 * The three conditions below are the WHOLE gate: standing, cooled down, has a target.
 * Displacement is not one of them (§1.3).
 */
export function resolveFriendlyAttacks(state: BattleState): DamageEvent[] {
  const events: DamageEvent[] = []

  // Ascending id: the event order is part of what the damage step and the kill
  // accounting see, so it must not inherit array order.
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'standing') continue
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
 * The 적 공격 step.
 *
 * No displacement is consulted here either, and never was. What gates each class is §1.9's
 * own description of when it attacks:
 *
 *   melee   — inside contact range. It is FASTER than the command unit (§1.3), so the only
 *             thing that keeps it out of contact range is being killed on the way in.
 *   shooter — "standoff 구간이면 정지해 사격하며", so it fires from inside the band and
 *             only there: approaching and retreating cost it the shot. The band's upper
 *             bound is 0.95 x SHOOTER_RANGE, so being in the band implies being in range.
 *             It is SLOWER than every friendly, which §1.3 says is fine: it holds at
 *             standoff and has nobody to chase.
 *
 * Neither class tests sight, because §1.6 removed it from the game. What replaced it is
 * the range advantage: `SHOOTER_RANGE < SOLDIER_RANGE`, so a friendly standing in the gap
 * is outside the band the shooter needs in order to fire at all, and the shooter has to
 * spend ticks closing. That gap is the whole defensive mechanism now.
 *
 * The elite is skipped: its damage is the telegraph/impact cycle (§1.12), resolved in its
 * own step, and §1.12 states it deals no contact damage at all. §1.12 no longer re-checks
 * sight per target on impact either — there is no sight to re-check.
 */
export function resolveEnemyAttacks(state: BattleState): DamageEvent[] {
  const events: DamageEvent[] = []
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
    } else if (distance < standoffLow || distance > standoffHigh) {
      continue
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
