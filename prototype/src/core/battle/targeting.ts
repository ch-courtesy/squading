// §1.3's stop test and §1.8 target selection (§1.16 step 7).
//
// Two rules, and the order they run in is load-bearing:
//
//   §1.3 stop test — "그 tick의 실제 변위가 MOVE_EPSILON 이상이면". It reads
//                    `lastDisplacement`, which every movement rule in batch A writes,
//                    and NEVER `state.input`. A unit shoved against a wall has input
//                    but no displacement and may fire; a follower inside the settle
//                    dead-band has displacement exactly 0 and may fire (§1.4).
//   §1.8 selection — in range, then elite first, then nearest, then lowest id. There is
//                    NO sight filter: §1.6 removed cover, so "시야는 항상 통한다" and
//                    range is the only geometric test left. §1.16 keeps it at step 7,
//                    after movement, so an attack always uses a target picked from
//                    post-movement positions.
//
// Selection is NOT gated on the stop test. §1.16 step 7 has no displacement clause, and
// `targetId` is in the digest (§1.17): a moving unit still tracks what it would shoot, it
// just does not get to shoot it (step 8).

import {
  COMMANDER_ATTACK_INTERVAL,
  COMMANDER_DAMAGE,
  COMMANDER_RANGE,
  MOVE_EPSILON,
  SOLDIER_ATTACK_INTERVAL,
  SOLDIER_DAMAGE,
  SOLDIER_RANGE,
} from './constants'
import { advanceEnemyTargeting } from './enemy'
import { enemiesById } from './state'
import type { BattleState, EnemyUnit, FriendlyUnit } from './types'

/**
 * §1.3: "at or above MOVE_EPSILON" is movement, so stopped is strictly below it.
 *
 * Takes the displacement holder rather than the unit so that step 6 and step 8 cannot
 * disagree about what "stopped" means, and so the test is impossible to write against
 * the input by accident.
 */
export function isStopped(unit: { lastDisplacement: number }): boolean {
  return unit.lastDisplacement < MOVE_EPSILON
}

// The three weapon numbers, in one place each.
//
// `state` is a parameter on all three even though none of them reads it yet: §1.13's
// `firepower`, `rapid` and `marksman` cards all land exactly here, and batch E adding
// a parameter would otherwise touch every call site in steps 7 and 9.

export function attackRangeOf(_state: BattleState, unit: FriendlyUnit): number {
  return unit.role === 'commander' ? COMMANDER_RANGE : SOLDIER_RANGE
}

export function attackIntervalOf(_state: BattleState, unit: FriendlyUnit): number {
  return unit.role === 'commander' ? COMMANDER_ATTACK_INTERVAL : SOLDIER_ATTACK_INTERVAL
}

export function attackDamageOf(_state: BattleState, unit: FriendlyUnit): number {
  return unit.role === 'commander' ? COMMANDER_DAMAGE : SOLDIER_DAMAGE
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

export function selectFriendlyTargetId(state: BattleState, unit: FriendlyUnit): number | null {
  return selectFriendlyTargetIn(state, unit, enemiesById(state))
}

function selectFriendlyTargetIn(
  state: BattleState,
  unit: FriendlyUnit,
  enemies: readonly EnemyUnit[],
): number | null {
  const range = attackRangeOf(state, unit)
  let best: Ranked | null = null

  for (const enemy of enemies) {
    if (enemy.life !== 'standing') continue
    const distance = Math.hypot(
      enemy.position.x - unit.position.x,
      enemy.position.y - unit.position.y,
    )
    if (distance > range) continue
    const candidate: Ranked = { id: enemy.id, distance, elite: enemy.kind === 'elite' }
    if (best === null || outranks(candidate, best)) best = candidate
  }

  return best === null ? null : best.id
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
 * §1.16 step 7, whole: both sides pick their target.
 *
 * The two halves are different rules — friendlies rank enemies by §1.8, enemies claim
 * §1.9 slots — but they are one step, and running them together is what keeps them
 * from drifting apart in the tick loop.
 */
export function advanceTargeting(state: BattleState): void {
  advanceFriendlyTargeting(state)
  advanceEnemyTargeting(state)
}
