// §1.16 step 12 — damage application.
//
// Steps 9, 10 and 11 resolve who shot whom and for how much; this is the only step that
// moves hp. Everything defender-side lives here and nowhere else:
//
//   * §1.11's invulnerability window, which absorbs a hit whole rather than reducing it;
//   * §1.13's `cover` card, which is damage TAKEN reduction — it is the one card whose name
//     survived §1.6 and it never had anything to do with terrain. Its seam is
//     `damageTakenMultiplierOf`, which batch E fills in.
//
// Simultaneity is the reason this is a separate step at all. Sixteen friendlies can fire at
// one 1.0-HP melee in the same tick, and §1.16 keeps the body alive until step 13, so all
// sixteen events resolve: the first five kill it and the other eleven are overkill. I2
// excludes overkill from its accounting, so the excess has to be a number this step
// RETURNS. Nothing here transitions a body — a target at 0 hp is still `standing` when this
// step ends, and step 13 is what reads that.
//
// The returned totals are derived values, not state (the no-scratch rule in `types.ts`): the
// harness that measures I2 consumes them for the tick it asked for and keeps its own sums.

import { HP_EPSILON } from './constants'
import { findEnemy, findFriendly } from './state'
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

export type Step12Outcome = {
  applied: AppliedDamage[]
  /** I2's numerator: hp actually removed from friendlies, overkill and absorbs excluded. */
  damageToFriendlies: number
  damageToEnemies: number
  overkill: number
  /** §1.11: what the invulnerability window refused, at attacker-side value. */
  absorbedByInvulnerability: number
}

/**
 * §1.13's `cover` card seam: the multiplier on damage a friendly TAKES.
 *
 * 1 until batch E, and a separate function from the invulnerability test on purpose — a
 * multiplier composes with other multipliers, while §1.11's window is absolute.
 */
export function damageTakenMultiplierOf(_state: BattleState, _unit: FriendlyUnit): number {
  return 1
}

function targetOf(state: BattleState, event: DamageEvent): FriendlyUnit | EnemyUnit | null {
  // `side` is the ATTACKER's side (§1.16): v6 has no friendly fire, so the target is always
  // on the other one.
  return event.side === 'friendly'
    ? findEnemy(state, event.targetId)
    : findFriendly(state, event.targetId)
}

/**
 * §1.16 step 12, whole. The event list is the concatenation of steps 9, 10 and 11 in that
 * order, and it is applied in that order.
 */
export function applyStep12Damage(
  state: BattleState,
  events: readonly DamageEvent[],
): Step12Outcome {
  const applied: AppliedDamage[] = []
  let damageToFriendlies = 0
  let damageToEnemies = 0
  let overkill = 0
  let absorbedByInvulnerability = 0

  for (const event of events) {
    const target = targetOf(state, event)
    // A body that is already downed or dead takes nothing. §1.9 keeps enemies off downed
    // friendlies in the first place, so this catches the stale event — an attacker that
    // fired at something step 13 of a previous tick already took off the board.
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
    // §1.1's HP_EPSILON. Five commander shots of 0.20 leave 5.55e-17 against a 1.0-HP melee
    // in binary floating point, and without this snap that melee survives step 13 and takes
    // another attack interval to die — with the digest recording it at 0 hp the whole time.
    target.hp = remaining < HP_EPSILON ? 0 : remaining

    if (event.side === 'friendly') damageToEnemies += dealt
    else damageToFriendlies += dealt
    overkill += wasted

    // §1.11's hit freeze. The rescuer is the command unit, and only real hp loss counts:
    // an event the invulnerability window absorbed is not a 피격 in any sense the player
    // can see. Consumed by the NEXT step 8 — see note 2 in `rescue.ts`.
    if (event.side === 'enemy' && dealt > 0 && state.rescue.active && target.id === state.commandUnitId) {
      state.rescue.hitPending = true
    }

    applied.push({ event, scaled, dealt, overkill: wasted, absorbed })
  }

  // §1.11: the window burns down once per damage step, including the step of the tick the
  // rescue completed in — step 8 runs before step 12, so a rescue finished this tick is
  // already protected here, and the window is exactly RESCUE_INVULNERABLE_TICKS damage
  // steps long counting that one.
  for (const unit of state.friendlies) {
    if (unit.invulnerableTicks > 0) unit.invulnerableTicks -= 1
  }

  return { applied, damageToFriendlies, damageToEnemies, overkill, absorbedByInvulnerability }
}
