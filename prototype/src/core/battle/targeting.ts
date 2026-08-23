// §1.8 target selection, and the three friendly weapon numbers it reads.
//
// One rule: in range, then elite first, then nearest, then lowest id. There is NO sight
// filter — §1.6 removed cover, so "시야는 항상 통한다" and range is the only geometric test
// left. §1.16 runs selection after movement, so an attack always uses a target picked from
// post-movement positions.
//
// THERE IS NO DISPLACEMENT TEST IN THIS FILE ANY MORE. v6~v8 kept `isStopped` here, and both
// the cooldown pass and the friendly attack pass consulted it: a unit that had moved this
// tick neither fired nor cooled down. §1.3 (v9) reverses that — "변위는 공격·cooldown에
// 영향을 주지 않으며 cooldown은 항상 감소한다" — and closes the defect the rule existed for
// from the other end, by making the melee faster than the command unit
// (`MELEE_MOVE_SPEED > COMMANDER_MOVE_SPEED`, asserted in `constants.ts`). Nothing in the
// core reads a displacement to decide anything now; if a later batch wants to gate a rule on
// motion, it is adding a rule, not restoring one.

import {
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_MELEE_DAMAGE,
  COMMANDER_MELEE_INTERVAL,
  COMMANDER_RANGE,
  SKIRMISHER_ATTACK_INTERVAL,
  SKIRMISHER_DAMAGE,
  SKIRMISHER_RANGE,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_RANGE,
} from './constants'
import { advanceEnemyTargeting } from './enemy'
import { isSkirmisherSlot } from './formation'
import { enemiesById } from './state'
import {
  attackIntervalMultiplierOf,
  firepowerMultiplierOf,
  rangeBonusOf,
  tickDurationAfter,
} from './upgrades'
import type { BattleState, EnemyUnit, FriendlyUnit, Vec2 } from './types'

// The three weapon numbers, in one place each.
//
// `state` is a parameter on all three because §1.13's `marksman`, `rapid` and `firepower` land
// exactly here and nowhere else. Each reads the card through `upgrades.ts`, which derives it
// from `state.upgrades.rounds[].chosen` — there is no stored multiplier, and no field was added
// to `BattleState` for any of it.

/**
 * §1.2.1: which class a soldier is, read off the slot §1.4 gave it.
 *
 * The commander is neither, and a standing soldier with no slot — §1.5's displaced original
 * commander — is a rifleman, because a body with no place in the front rank is not holding it.
 */
export function isSkirmisher(state: BattleState, unit: FriendlyUnit): boolean {
  if (unit.role === 'commander') return false
  const assignment = state.slotAssignments.find((row) => row.unitId === unit.id)
  return isSkirmisherSlot(assignment ? assignment.slotIndex : null)
}

export function attackRangeOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_RANGE
    : isSkirmisher(state, unit) ? SKIRMISHER_RANGE : SOLDIER_RANGE
  // §1.13 `사수`: additive, so the range advantage (§1.6) widens by the same metre for the
  // commander and for a soldier instead of scaling apart.
  return base + rangeBonusOf(state)
}

export function attackIntervalOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_ATTACK_INTERVAL
    : isSkirmisher(state, unit) ? SKIRMISHER_ATTACK_INTERVAL : SOLDIER_ATTACK_INTERVAL
  // §1.13 `연사`, rounded to whole ticks — see `tickDurationAfter`.
  return tickDurationAfter(base, attackIntervalMultiplierOf(state))
}

export function attackDamageOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_DAMAGE
    : isSkirmisher(state, unit) ? SKIRMISHER_DAMAGE : SOLDIER_DAMAGE
  // §1.13 `화력`. Attacker-side, so it is baked into the event's `amount` (§1.16) and the
  // defender-side `cover` multiplier composes with it where damage is applied.
  return base * firepowerMultiplierOf(state)
}

/**
 * §1.4.2's two melee numbers, next to the three they replace when the command unit is close.
 *
 * WHAT THE CARDS DO TO THEM, and it is a decision rather than a reading: §1.13's `firepower` and
 * `연사` compose with the melee exactly as they compose with the shot, through the same two
 * functions in `upgrades.ts`. The alternative — raw constants — would make the melee the one
 * attack in the game that upgrades cannot touch, which no section says and which would quietly
 * invert the trade as the run went on (a fully upgraded rifle would out-damage the swing that
 * §1.4.2 requires to be stronger).
 *
 * `사수` (range) is the exception and is deliberately NOT applied. It is §1.6's card — it widens
 * the range advantage — and adding it to the melee envelope would let the player buy a longer
 * reach for the attack whose whole cost is having to be close.
 *
 * There is no `unit` parameter. §1.4.2 gives the melee to the COMMAND UNIT, and the caller is
 * what tests that; the numbers themselves are the commander's whichever body is holding the
 * command. `COMMANDER_MELEE_DAMAGE > COMMANDER_DAMAGE > SOLDIER_DAMAGE` and
 * `COMMANDER_MELEE_INTERVAL <= COMMANDER_ATTACK_INTERVAL < SOLDIER_ATTACK_INTERVAL` hold at the
 * anchors, so a promoted soldier's swing is stronger and faster than its own rifle too.
 */
export function meleeDamageOf(state: BattleState): number {
  return COMMANDER_MELEE_DAMAGE * firepowerMultiplierOf(state)
}

export function meleeIntervalOf(state: BattleState): number {
  return tickDurationAfter(COMMANDER_MELEE_INTERVAL, attackIntervalMultiplierOf(state))
}

type Ranked = {
  id: number
  distance: number
  elite: boolean
}

/**
 * §1.8: "정예 우선 → 최근접 → id 오름차순".
 *
 * The elite is ranked by its `kind`, not by being a special entity — it is an ordinary
 * row in `enemies` (§1.12) and this comparison is the only place its priority exists.
 */
function outranks(candidate: Ranked, best: Ranked): boolean {
  if (candidate.elite !== best.elite) return candidate.elite
  // Strict `<`, walked in ascending id order, is §1.8's id tie-break.
  return candidate.distance < best.distance
}

/**
 * §1.8's ORDER, with the candidate test left to the caller.
 *
 * Two rules rank enemies by "정예 우선 → 최근접 → id 오름차순" and they disagree about which
 * bodies are candidates at all: the attack (below) admits what is inside the unit's own range,
 * and §1.4.1's leash admits what is inside `LEASH_RADIUS` OF THE COMMAND UNIT, which is a test
 * about a body the unit is not. Only the admission differs, so only the admission is a
 * parameter — the ordering itself exists once, here, and `movement.ts` calls this rather than
 * writing §1.8 out a second time where the two could drift apart.
 *
 * `enemies` must already be in ascending id order (`enemiesById`); that ordering is what makes
 * the strict `<` above into §1.8's id tie-break, and this function does not re-sort.
 */
export function selectRankedEnemyId(
  from: Vec2,
  enemies: readonly EnemyUnit[],
  admits: (enemy: EnemyUnit, distance: number) => boolean,
): number | null {
  let best: Ranked | null = null

  for (const enemy of enemies) {
    if (enemy.life !== 'standing') continue
    const distance = Math.hypot(enemy.position.x - from.x, enemy.position.y - from.y)
    if (!admits(enemy, distance)) continue
    const candidate: Ranked = { id: enemy.id, distance, elite: enemy.kind === 'elite' }
    if (best === null || outranks(candidate, best)) best = candidate
  }

  return best === null ? null : best.id
}

export function selectFriendlyTargetId(state: BattleState, unit: FriendlyUnit): number | null {
  return selectFriendlyTargetIn(state, unit, enemiesById(state))
}

function selectFriendlyTargetIn(
  state: BattleState,
  unit: FriendlyUnit,
  enemies: readonly EnemyUnit[],
): number | null {
  const range = attackRangeOf(state, unit)
  return selectRankedEnemyId(unit.position, enemies, (_enemy, distance) => distance <= range)
}

/** §1.8 for every standing friendly. */
export function advanceFriendlyTargeting(state: BattleState): void {
  // `enemiesById` sorts, so the ascending-id tie-break holds no matter what order the
  // spawn batch appended rows in; hoisted because it is the same list for all 16.
  const enemies = enemiesById(state)

  for (const unit of state.friendlies) {
    if (unit.life !== 'standing') {
      unit.targetId = null
      continue
    }
    unit.targetId = selectFriendlyTargetIn(state, unit, enemies)
  }
}

/**
 * The whole of the 대상 선택 step: both sides pick their target.
 *
 * The two halves are different rules — friendlies rank enemies by §1.8, enemies claim
 * §1.9 slots — but they are one step, and running them together is what keeps them
 * from drifting apart in the tick loop.
 */
export function advanceTargeting(state: BattleState): void {
  advanceFriendlyTargeting(state)
  advanceEnemyTargeting(state)
}
