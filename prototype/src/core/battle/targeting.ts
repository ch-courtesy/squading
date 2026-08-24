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
  CHARGER_ATTACK_INTERVAL,
  CHARGER_DAMAGE,
  CHARGER_RANGE,
  CHARGE_DAMAGE,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_RANGE,
} from './constants'
import { advanceEnemyTargeting } from './enemy'
import { isChargerSlot } from './formation'
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

/** §1.2.1: a front-rank body, read off the slot §1.4 gave it. The commander is neither class. */
export function isCharger(state: BattleState, unit: FriendlyUnit): boolean {
  if (unit.role === 'commander') return false
  const assignment = state.slotAssignments.find((row) => row.unitId === unit.id)
  return isChargerSlot(assignment ? assignment.slotIndex : null)
}

export function attackRangeOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_RANGE
    : isCharger(state, unit) ? CHARGER_RANGE : SOLDIER_RANGE
  // §1.13 `사수`: additive, so the range advantage (§1.6) widens by the same metre for the
  // commander and for a soldier instead of scaling apart.
  return base + rangeBonusOf(state)
}

export function attackIntervalOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_ATTACK_INTERVAL
    : isCharger(state, unit) ? CHARGER_ATTACK_INTERVAL : SOLDIER_ATTACK_INTERVAL
  // §1.13 `연사`, rounded to whole ticks — see `tickDurationAfter`.
  return tickDurationAfter(base, attackIntervalMultiplierOf(state))
}

/**
 * §1.2.1: is this charger's blow a CHARGE, or the weak one it throws standing around?
 *
 * Two conditions, and each rules out one way of getting the strong blow for free.
 *
 * IT MOVED THIS TICK. `lastDisplacement` is written every tick by §1.16's movement row and has
 * sat in §1.17's digest all along — §1.3 recorded that no rule read it any more; this one does.
 * A still squad never charges: the enemies walk to IT, and §1.4's settle band parks the front
 * rank, so the displacement is zero and the blow is weak. That is what keeps §3's I3 and I10 at
 * zero, which v16's statline version could not do.
 *
 * AND THE PLAYER IS PUSHING INTO IT — the movement axis they are holding points at the body
 * being hit, not away from it.
 *
 * Movement alone is not enough, and that is the whole lesson of the two versions before this
 * one. FLEEING IS MOVEMENT: a run-away squad's front rank closes on whatever the leash drags
 * past, so "it moved" paid the charge to a policy §3 requires to lose, and I8 read 2 of 8. Then
 * gating on the commander being within its own range of the target zeroed every invariant but
 * starved the fixed route to 3 of 8, because a commander is rarely that close.
 *
 * `state.input.move` is what separates them, and it is the only thing that does: it is the
 * player's INTENT, before any of it has become position. Running away and pressing in are the
 * same displacement with opposite signs, and this reads the sign. No history and no new field —
 * §1.15's axis is already in the state and already in §1.17's digest.
 */
function isPressingCharge(state: BattleState, unit: FriendlyUnit): boolean {
  if (unit.lastDisplacement <= 0) return false
  if (unit.targetId === null) return false
  return isPressingIn(state)
}

/**
 * §1.2.1 and §1.4.1 v21's shared clause: is the PLAYER pressing into the fight this tick?
 *
 * Two conditions, and dropping either was measured to break a different invariant. See
 * `isPressingCharge` above for the full argument — it was written for the charge and §1.4.1 v21's
 * dodge needs exactly the same distinction, so it is one function and not two copies of one
 * paragraph. A second copy is how the two rules come to disagree about what "pressing" means.
 */
export function isPressingIn(state: BattleState): boolean {
  const command = state.friendlies.find((body) => body.id === state.commandUnitId)
  if (!command) return false
  // THE NEAREST LIVE ENEMY, not the one this body happens to be hitting. Backing off is a fact
  // about the FIGHT, not about one target: measured, testing against each charger's own target
  // let flight keep the charge on 3-4 of 8 seeds, because running from the enemy at your heels
  // is running toward some other one. §4.1's `flees-always` is defined as moving away from the
  // nearest enemy, so this is the same quantity the invariant is written in.
  let toward: { x: number; y: number } | null = null
  let nearest = Infinity
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue
    const dx = enemy.position.x - command.position.x
    const dy = enemy.position.y - command.position.y
    const distance = Math.hypot(dx, dy)
    if (distance >= nearest) continue
    nearest = distance
    toward = { x: dx, y: dy }
  }
  if (!toward) return false
  // TWO CLAUSES, and dropping either one was measured to break a different invariant.
  //
  // The axis must be HELD. A hand off the keys reads `(0, 0)`, whose dot with anything is 0 —
  // so a "not retreating" test alone counts standing there as not retreating, and I3 went to 4
  // of 8 on exactly that. Doing nothing is not a way of pressing.
  //
  // And it must not point AWAY. Strictly toward was tried and is too strict: a kiting player
  // circles the fight, which is sideways, and paying only for a head-on push starved the fixed
  // route to 1 of 8 while barely touching flight. Sideways keeps the charge; turning your back
  // gives it up, which is the difference between kiting and running.
  const axis = state.input.move
  if (axis.x === 0 && axis.y === 0) return false
  return axis.x * toward.x + axis.y * toward.y >= 0
}

export function attackDamageOf(state: BattleState, unit: FriendlyUnit): number {
  const base = unit.role === 'commander'
    ? COMMANDER_DAMAGE
    : isCharger(state, unit)
      ? (isPressingCharge(state, unit) ? CHARGE_DAMAGE : CHARGER_DAMAGE)
      : SOLDIER_DAMAGE
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
