// §1.16 step 13 — downed/death transitions, then §1.5's reversion and succession.
//
// The ORDER inside the step is as much a rule as the transitions are:
//
//   1. friendlies at 0 hp go DOWNED. Not dead: §1.11 exists because a fallen body is a
//      decision, and a friendly only dies from its downed timer running out.
//   2. enemies at 0 hp die, and their ids and kinds are what step 14 counts (§1.13 excludes
//      the elite from the kill count, so the kind has to travel with the id).
//   3. downed timers advance, and a timer that reaches DOWNED_TICKS kills. A body that fell
//      in THIS tick is not charged a tick for it.
//   4. a rescue whose subject or object just vanished is cancelled, so no tick ever ends
//      holding a lock that cannot progress.
//   5. §1.5: the unconditional reversion, then the promotion loop.
//
// Steps 1 and 3 in that order are the whole reason §1.5's promotion cannot hand command to a
// body that fell in the same tick — the fall is already recorded when the search runs. Step 4
// before step 5 is what lets the cancel test read "the command unit is not standing" against
// the body that was actually performing the rescue.
//
// This step does NOT decide the run. `all-units-lost` is REPORTED here and adjudicated in
// step 16, where §1.16 puts the verdict and its priority against `elite-survived`; §1.5 is
// explicit that the commander's death alone is not a defeat.

import { DOWNED_TICKS } from './constants'
import { cancelRescue, cancelRescueIfBroken } from './rescue'
import { enemiesById, findFriendly, friendliesById } from './state'
import type { BattleState, EnemyKind, FriendlyUnit, Vec2 } from './types'

/** §1.13 counts kills but not the elite's, so step 14 needs the kind, not just the id. */
export type EnemyDeath = {
  id: number
  kind: EnemyKind
}

/**
 * What step 13 hands to step 14 (kill accounting and the upgrade thresholds) and to step 16.
 *
 * A return value rather than fields on `BattleState`: every entry is consumed inside the
 * same tick, and `types.ts` reserves the state for what a later tick reads. `stats.kills` is
 * step 14's to write — this step deliberately does not touch it, so that "which deaths
 * counted" stays one rule in one place.
 */
export type Step13Outcome = {
  /** Enemies that died this tick, ascending id. Step 14 counts the non-elite ones. */
  enemyDeaths: EnemyDeath[]
  /** Friendlies that went downed this tick, ascending id. */
  friendlyDowns: number[]
  /** Friendlies that died this tick, ascending id (downed timer expiry). */
  friendlyDeaths: number[]
  previousCommandUnitId: number
  commandUnitId: number
  commandUnitChanged: boolean
  /** §1.5: no standing soldier is left. Step 16 turns this into `all-units-lost`. */
  allUnitsLost: boolean
}

function distanceBetween(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * §1.5, exactly as written:
 *
 *   1) 원 지휘관이 기립이고 지휘 유닛이 원 지휘관이 아니면 → 지휘 유닛 = 원 지휘관
 *   2) while 지휘 유닛이 기립이 아니다: 기립 병사 중 지휘 유닛에 가장 가까운 1명
 *
 * Rule 1 is unconditional and first, which is what makes "복귀·승계 동시 발생 시 복귀 우선"
 * true: the acting commander falling in the same tick the original stands again sends command
 * home rather than to whichever third body happens to be nearest.
 *
 * Rule 2's candidate set is "기립 병사" — soldiers. That excludes the original commander,
 * which is safe rather than lossy: if the original commander were standing, rule 1 has
 * already given it command and the loop does not run at all.
 *
 * Returns true when the roster is gone (§1.5's `all-units-lost`).
 */
function resolveSuccession(state: BattleState): boolean {
  const original = findFriendly(state, state.originalCommanderId)
  if (original && original.life === 'standing' && state.commandUnitId !== original.id) {
    state.commandUnitId = original.id
  }

  // A loop, not an `if`: §1.5 writes it as one, and a hand-authored fixture can present a
  // command unit that is not standing with candidates that are. In tick order it iterates
  // at most twice, because the body it picks is standing by construction.
  //
  // The bound below is termination insurance, not a rule. §1.5's `while` only makes progress
  // because the candidate filter and the loop condition agree on what "기립" means; a change
  // that lets a non-standing body be picked turns the loop into a spin — which is exactly how
  // a mutation check on this function hung the test run instead of failing it. One pass per
  // body is more than the rule can ever need.
  for (let attempt = 0; attempt <= state.friendlies.length; attempt += 1) {
    const command = findFriendly(state, state.commandUnitId)
    if (command && command.life === 'standing') return false

    // Distance is measured from the fallen command unit — the body the player was driving.
    const from: Vec2 = command ? command.position : { x: 0, y: 0 }
    let best: FriendlyUnit | null = null
    let bestDistance = Infinity

    // Ascending id with a strict `<` is §1.5's "동률 시 id 오름차순".
    for (const unit of friendliesById(state)) {
      if (unit.role !== 'soldier') continue
      if (unit.life !== 'standing') continue
      const distance = distanceBetween(from, unit.position)
      if (distance < bestDistance) {
        best = unit
        bestDistance = distance
      }
    }

    // §1.5: "기립 병사가 없으면 → 패배 all-units-lost, 종료".
    if (!best) return true
    // Unreachable while the filter above requires "standing" and the condition at the top of
    // the loop tests the same thing; picking the current command unit again would mean the
    // roster cannot produce a standing one, which is the same answer as having no candidate.
    if (best.id === state.commandUnitId) return true
    state.commandUnitId = best.id
  }

  return true
}

/** §1.16 step 13, whole. */
export function resolveStep13Transitions(state: BattleState): Step13Outcome {
  const previousCommandUnitId = state.commandUnitId
  const friendlyDowns: number[] = []
  const friendlyDeaths: number[] = []
  const enemyDeaths: EnemyDeath[] = []

  // 1. Friendlies at 0 hp go downed.
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'standing') continue
    if (unit.hp > 0) continue
    unit.life = 'downed'
    unit.hp = 0
    unit.downedTicks = 0
    unit.targetId = null
    // The body stops where it fell; leaving a stale displacement would let §1.3 read a
    // corpse as "moving", which is in the digest even though nothing acts on it.
    unit.lastDisplacement = 0
    friendlyDowns.push(unit.id)
  }

  // 2. Enemies at 0 hp die. Slot released here, so step 7 of the next tick redistributes it.
  for (const enemy of enemiesById(state)) {
    if (enemy.life !== 'standing') continue
    if (enemy.hp > 0) continue
    enemy.life = 'dead'
    enemy.hp = 0
    enemy.deathTick = state.combatTick
    enemy.targetId = null
    enemy.contactSlotOwnerId = null
    enemy.lastDisplacement = 0
    enemyDeaths.push({ id: enemy.id, kind: enemy.kind })
  }

  // 3. Downed timers. `fellThisTick` is why a body downed above is not charged a tick for
  //    the tick it fell in: `downedTicks` is "how long it has been waiting", and it has been
  //    waiting zero ticks.
  const fellThisTick = new Set(friendlyDowns)
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'downed') continue
    if (fellThisTick.has(unit.id)) continue
    unit.downedTicks += 1
    if (unit.downedTicks < DOWNED_TICKS) continue
    unit.life = 'dead'
    unit.hp = 0
    unit.deathTick = state.combatTick
    unit.targetId = null
    friendlyDeaths.push(unit.id)
  }

  // 4. §1.11's two state-driven cancel conditions, at the moment this step creates them.
  cancelRescueIfBroken(state)

  // 5. §1.5.
  const allUnitsLost = resolveSuccession(state)
  const commandUnitChanged = state.commandUnitId !== previousCommandUnitId

  if (commandUnitChanged) {
    // §1.5: "유지 중인 이동 벡터는 승계 시 0으로 초기화한다. Space 유지 상태는 옮겨간다."
    // Without the reset the new body is in a moving state from its first tick, §1.11's lock
    // cannot establish, and the reason succession exists — going back for the body the player
    // was just driving — is unreachable. The reset applies to the reversion too: the original
    // commander comes back on its feet as still as any promoted soldier.
    state.input.move = { x: 0, y: 0 }
    // The performer of a lock is "지휘 유닛 자신"; if the body changed, the performer is gone.
    // Unreachable in tick order (the only reversion path is a rescue that already completed,
    // and a promotion is preceded by the cancel in step 4), and cheap insurance against a
    // stale lock freezing a body that never asked for one.
    if (state.rescue.active) cancelRescue(state)
  }

  return {
    enemyDeaths,
    friendlyDowns,
    friendlyDeaths,
    previousCommandUnitId,
    commandUnitId: state.commandUnitId,
    commandUnitChanged,
    allUnitsLost,
  }
}
