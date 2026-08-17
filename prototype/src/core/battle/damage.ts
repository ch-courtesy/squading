// §1.16 피해 적용 — the damage step (see the step table in `index.ts`).
//
// `resolveFriendlyAttacks`, `resolveEnemyAttacks` and the elite impact resolve who shot whom and
// for how much; this is the only step that moves hp. Everything defender-side lives here and
// nowhere else:
//
//   * §1.11's invulnerability window, which absorbs a hit whole rather than reducing it;
//   * §1.13's `cover` card, which is damage TAKEN reduction — it is the one card whose name
//     survived §1.6 and it never had anything to do with terrain. It lands in
//     `damageTakenMultiplierOf`, which reads the chosen cards out of `upgrades.ts`.
//
// Simultaneity is the reason this is a separate step at all. Sixteen friendlies can fire at
// one 1.0-HP melee in the same tick, and §1.16 keeps the body alive until `resolveTransitions`,
// so all sixteen events resolve: the first five kill it and the other eleven are overkill. I2
// excludes overkill from its accounting, so the excess has to be a number this step
// RETURNS. Nothing here transitions a body — a target at 0 hp is still `standing` when this
// step ends, and `resolveTransitions` is what reads that.
//
// The returned totals are derived values, not state (the no-scratch rule in `types.ts`): the
// harness that measures I2 consumes them for the tick it asked for and keeps its own sums.
//
// The return value is also how §1.11's hit freeze works. §1.16 puts 구조 진행 immediately after
// this step, precisely so that "그 tick에 지휘 유닛이 피해를 입었는가" can be answered from
// `DamageOutcome` in the same tick instead of from a flag carried across one. `dealtToUnit` is
// that read, and it lives here rather than in `rescue.ts` because it is a question about this
// step's output.
//
// THERE IS NO EXPORTED EMPTY `DamageOutcome`, on purpose. `applyDamage(state, [])` is the only
// way to obtain one, so the type makes it impossible to feed the rescue step without having run
// the damage step — which is also the step where the invulnerability window burns down. A
// convenient `NO_DAMAGE` constant would have handed callers exactly the skip this module's own
// header warns about.

import { HP_EPSILON } from './constants'
import { findEnemy, findFriendly } from './state'
import { damageTakenMultiplierFromCards } from './upgrades'
import type { BattleState, DamageEvent, EnemyUnit, FriendlyUnit } from './types'

/** One event's fate, in the order the events were given. */
export type AppliedDamage = {
  event: DamageEvent
  /** The amount after defender-side modifiers — 0 when the invulnerability window ate it. */
  scaled: number
  /** The part of `scaled` that actually came off hp. */
  dealt: number
  /** `scaled - dealt`: the part that had no hp left to take. */
  overkill: number
  /** §1.11: the whole event was absorbed by the post-rescue invulnerability window. */
  absorbed: boolean
}

export type DamageOutcome = {
  applied: AppliedDamage[]
  /** I2's numerator: hp actually removed from friendlies, overkill and absorbs excluded. */
  damageToFriendlies: number
  damageToEnemies: number
  overkill: number
  /** §1.11: what the invulnerability window refused, at attacker-side value. */
  absorbedByInvulnerability: number
}

/**
 * §1.13's `cover` card: the multiplier on damage a friendly TAKES.
 *
 * A separate function from the invulnerability test on purpose — a multiplier composes with
 * other multipliers, while §1.11's window is absolute. The unit is a parameter even though the
 * card is squad-wide: a per-body defender modifier (a downed body, a revived one) would land
 * here and nowhere else.
 */
export function damageTakenMultiplierOf(state: BattleState, _unit: FriendlyUnit): number {
  return damageTakenMultiplierFromCards(state)
}

function targetOf(state: BattleState, event: DamageEvent): FriendlyUnit | EnemyUnit | null {
  // `side` is the ATTACKER's side (§1.16): v6 has no friendly fire, so the target is always
  // on the other one.
  return event.side === 'friendly'
    ? findEnemy(state, event.targetId)
    : findFriendly(state, event.targetId)
}

/**
 * How much hp this damage step actually took off one unit — §1.11's "피격" test.
 *
 * Only real hp loss counts: an event the invulnerability window absorbed is not a 피격 in any
 * sense the player can see, and `dealt` is already 0 for it. Overkill is excluded for the same
 * reason it is excluded from I2 — it was never taken.
 */
export function dealtToUnit(outcome: Readonly<DamageOutcome>, unitId: number): number {
  let total = 0
  for (const entry of outcome.applied) {
    if (entry.event.targetId !== unitId) continue
    // `side` is the attacker's side, so an enemy-side event is one aimed AT a friendly.
    if (entry.event.side !== 'enemy') continue
    total += entry.dealt
  }
  return total
}

/**
 * The whole step. The event list is the concatenation of the friendly attacks, the enemy attacks
 * and the elite impact, in that order, and it is applied in that order.
 */
export function applyDamage(
  state: BattleState,
  events: readonly DamageEvent[],
): DamageOutcome {
  const applied: AppliedDamage[] = []
  let damageToFriendlies = 0
  let damageToEnemies = 0
  let overkill = 0
  let absorbedByInvulnerability = 0

  for (const event of events) {
    const target = targetOf(state, event)
    // A body that is already downed or dead takes nothing. §1.9 keeps enemies off downed
    // friendlies in the first place, so this catches the stale event — an attacker that
    // fired at something a previous tick already took off the board.
    if (!target || target.life !== 'standing') continue

    let scaled = event.amount
    let absorbed = false

    if (event.side === 'enemy') {
      const friendly = target as FriendlyUnit
      scaled = event.amount * damageTakenMultiplierOf(state, friendly)
      if (friendly.invulnerableTicks > 0) {
        // §1.11: "일정 tick 동안 피해를 받지 않는다" — the window is absolute, not a
        // reduction, so the whole event is recorded as absorbed rather than as 0 damage.
        scaled = 0
        absorbed = true
        absorbedByInvulnerability += event.amount
      }
    }

    const dealt = Math.min(scaled, target.hp)
    const wasted = scaled - dealt
    const remaining = target.hp - dealt
    // §1.1's HP_EPSILON. Five commander shots of 0.20 leave 5.55e-17 against a 1.0-HP melee in
    // binary floating point, and without this snap that melee survives `resolveTransitions` and
    // takes another attack interval to die — with the digest recording it at 0 hp the whole time.
    target.hp = remaining < HP_EPSILON ? 0 : remaining

    if (event.side === 'friendly') damageToEnemies += dealt
    else damageToFriendlies += dealt
    overkill += wasted

    applied.push({ event, scaled, dealt, overkill: wasted, absorbed })
  }

  // §1.11: the window burns down once per damage step. A rescue that completes THIS tick does so
  // in `advanceRescueProgress`, which runs after this function returns, so the window it grants
  // covers the next RESCUE_INVULNERABLE_TICKS damage steps and none of this one — which costs the
  // revived body nothing, because it was still downed while this step ran and a downed body takes
  // nothing.
  for (const unit of state.friendlies) {
    if (unit.invulnerableTicks > 0) unit.invulnerableTicks -= 1
  }

  return { applied, damageToFriendlies, damageToEnemies, overkill, absorbedByInvulnerability }
}
