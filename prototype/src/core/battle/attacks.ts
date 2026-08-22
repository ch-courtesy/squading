// The 냉각 감소, 아군 공격 and 적 공격 steps (see the step table in `index.ts`).
//
// §1.3 IS WHAT THIS FILE IS ABOUT, AND IT SAYS "NOTHING": "유닛은 이동 중에도 공격한다.
// 변위는 공격·cooldown에 영향을 주지 않으며 cooldown은 항상 감소한다." So neither pass
// consults a displacement, for either side. v6~v8 had the opposite rule — a friendly that
// moved this tick neither fired nor decremented — and closed the "constant motion is
// invulnerability" defect by taxing movement. v9 closes it with a speed relation instead
// (`meleeMoveSpeed > COMMANDER_MOVE_SPEED`, asserted per stage in `stages.ts`), so the tax is
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
//
// §1.4.2 (batch N) LANDS IN THE FRIENDLY PASS AND NOWHERE ELSE. The command unit swings at a
// `shooter` or the `elite` inside `COMMANDER_MELEE_RANGE` (v13) and shoots in every other case;
// `isCommandMeleeStrike` is the whole of that decision, and the pass composes it into the one blow
// it was already resolving. No state field, no stream, no §1.16 row — see that function's own
// comment for why each of the three is possible at all.

import { COMMANDER_MELEE_RANGE } from './constants'
import { stageOf } from './stages'
import { enemyAttackIntervalOf, enemyDamageOf } from './enemy'
import { enemiesById, findEnemy, findFriendly, friendliesById } from './state'
import { attackDamageOf, attackIntervalOf, meleeDamageOf, meleeIntervalOf } from './targeting'
import type { BattleState, DamageEvent, EnemyUnit, FriendlyUnit } from './types'

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
 * §1.4.2: is THIS blow, by THIS unit, against THIS target, a melee?
 *
 * THE WHOLE RULE IS THIS FUNCTION, and it is four lines because §1.4.2 asked for four lines:
 * no new `BattleState` field, no new PRNG stream, no new step in §1.16. "지금 근접 거리인가" is
 * derived every tick from two positions the movement step has already written, exactly the way
 * §1.4.1 derives "am I engaging" — the no-scratch rule in `types.ts` is why both are derived
 * rather than stored.
 *
 * WHICH TARGET IT ASKS ABOUT, because §1.4.2 admits two readings and this is the one shipped.
 * "COMMANDER_MELEE_RANGE 안에 §1.8 순위의 대상이 있으면 근접으로 친다" is read as a test on the
 * target §1.8 ALREADY CHOSE — the `unit.targetId` the 대상 선택 step wrote — and not as a second
 * ranking pass over whatever is inside the melee range. §1.4.2 says the melee is DECIDED inside the friendly-attack
 * step and that §1.16 gains no row, and a second ranking pass would be the 대상 선택 step run
 * twice. The readings differ in one situation and only one: an elite between the two ranges
 * outranks a nearer body inside the melee range (§1.8 puts 정예 first), so the command unit
 * shoots the elite rather than swinging at whatever is standing on top of it.
 * `tests/battle/battle-combat.test.ts` pins that case as the fixture that separates them.
 *
 * ONLY THE COMMAND UNIT. Not "the body whose role is commander" — §1.5 lets a soldier hold the
 * command, and §1.4.2 attaches the melee to the 지휘 유닛 throughout. §1.4.2's "병사는 갖지
 * 않는다" is the `state.commandUnitId` test: fifteen of the sixteen fail it every tick.
 *
 * ONLY AGAINST A TARGET WHOSE OWN CLASS HOLDS DISTANCE (v13). §1.4.2: "근접은 §1.8이 고른
 * 대상이 `shooter` 또는 `elite`일 때만 나간다. 근접형(`melee`)에게는 기존 사거리 공격으로
 * 친다." v12 had no such clause and claimed the melee was bought with §1.6's range advantage;
 * `i4-inversion-diagnosis.md` measured that claim false. §1.3 REQUIRES
 * `meleeMoveSpeed > COMMANDER_MOVE_SPEED`, so a melee-class enemy closes on the command unit
 * whatever the command unit does — 93.4 % of `skilled`'s swings and 100 % of `camps-in-place`'s
 * landed on bodies that arrived by themselves, and the two policies that never move swung three
 * times as often per run as `skilled`. Nothing was given up, so nothing was traded.
 *
 * A shooter holds `shooterStandoff` low `2.70` and the elite holds `eliteApproachRange 4.5`,
 * both far outside `COMMANDER_MELEE_RANGE 1.2`. Neither will close that gap, so every swing that
 * survives this test is one the PLAYER walked into — and walking there means standing inside
 * the stage's `shooterRange`, which is what makes §1.4.2's own sentence true.
 *
 * The test is written positively (`shooter` or `elite`) rather than as `!== 'melee'` because
 * §1.4.2's word is "만" — a class the campaign's stage 4 adds later is outside the rule until
 * some later batch puts it inside on purpose.
 */
export function isCommandMeleeStrike(
  state: BattleState,
  unit: FriendlyUnit,
  target: EnemyUnit,
): boolean {
  if (unit.id !== state.commandUnitId) return false
  if (target.kind !== 'shooter' && target.kind !== 'elite') return false
  const distance = Math.hypot(
    target.position.x - unit.position.x,
    target.position.y - unit.position.y,
  )
  // `<=`, the same closed boundary §1.8 admits a candidate with.
  return distance <= COMMANDER_MELEE_RANGE
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
 * Displacement is not one of them (§1.3) — including for the melee, which is a test of WHERE
 * the unit is and never of whether it got there this tick.
 *
 * §1.4.2 (batch N) IS DECIDED HERE AND NOWHERE ELSE. It changes which of two weapons the one
 * blow this unit was already going to land is made of — its `amount`, its `cause` and the
 * cooldown it books — and it changes nothing about whether the blow happens. That is what
 * "근접은 아군 공격 단계 안에서 결정되며 새 단계가 아니다" costs in code: one branch, no row.
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

    const melee = isCommandMeleeStrike(state, unit, target)
    events.push({
      side: 'friendly',
      attackerId: unit.id,
      targetId: target.id,
      amount: melee ? meleeDamageOf(state) : attackDamageOf(state, unit),
      cause: melee ? 'friendly-melee' : 'friendly-attack',
    })
    unit.attackCooldown = melee ? meleeIntervalOf(state) : attackIntervalOf(state, unit)
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
 *             bound is 0.95 x the stage's `shooterRange`, so being in the band implies being in
 *             range.
 *             It is SLOWER than every friendly, which §1.3 says is fine: it holds at
 *             standoff and has nobody to chase.
 *
 * Neither class tests sight, because §1.6 removed it from the game. What replaced it is
 * the range advantage: `shooterRange < SOLDIER_RANGE`, so a friendly standing in the gap
 * is outside the band the shooter needs in order to fire at all, and the shooter has to
 * spend ticks closing. That gap is the whole defensive mechanism now.
 *
 * The elite is skipped: its damage is the telegraph/impact cycle (§1.12), resolved in its
 * own step, and §1.12 states it deals no contact damage at all. §1.12 no longer re-checks
 * sight per target on impact either — there is no sight to re-check.
 */
export function resolveEnemyAttacks(state: BattleState): DamageEvent[] {
  const events: DamageEvent[] = []
  const stage = stageOf(state)
  const [standoffLow, standoffHigh] = stage.shooterStandoff

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
      if (distance > stage.meleeRange) continue
    } else if (distance < standoffLow || distance > standoffHigh) {
      continue
    }

    events.push({
      side: 'enemy',
      attackerId: enemy.id,
      targetId: target.id,
      amount: enemyDamageOf(state, enemy),
      cause: enemy.kind === 'melee' ? 'melee-contact' : 'shooter-shot',
    })
    enemy.attackCooldown = enemyAttackIntervalOf(state, enemy)
  }

  return events
}
