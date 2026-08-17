// §1.11 rescue — the 구조 lock 판정 and 구조 진행 steps (see the step table in `index.ts`).
//
// Three things in here are decisions, and each is argued where it is made.
//
// 1. THE LOCK IS A STATE, THE CANCEL IS AN EVENT. §1.11's establishment test reads the
//    HELD movement vector ("그 tick의 이동 입력 벡터가 0"), while its cancel test reads a
//    movement KEYDOWN ("lock 유지 중 이동 keydown/pointerdown 이벤트 발생"). v5 used held
//    state for both, and the note in §1.11 records what that cost: holding W while walking
//    onto a body meant the lock was cancelled on the very tick it was established, so
//    rescue was impossible in principle. The event therefore cannot be read off
//    `state.input` — a held vector is still non-zero on the tick after the keydown — so it
//    arrives as an argument, `RescueInputEvents`, which the input layer (§1.15) fills in
//    and which nothing later in the tick reads. That is also why it is not a field: the
//    no-scratch rule in `types.ts` reserves `BattleState` for what a LATER tick needs.
//
// 2. THE HIT FREEZE IS SAME-TICK, AND THE STEP ORDER IS WHAT MAKES IT SO. §1.11 says progress
//    neither advances nor rolls back on a tick in which the PERFORMER — "지휘 유닛(구조
//    수행자)" — took damage. That is only answerable if progress is decided after damage, so
//    §1.16 places 피해 적용 immediately before 구조 진행 and states that reason in its table.
//    `advanceRescueProgress` therefore takes `applyDamage`'s `DamageOutcome` as an argument and
//    reads the hit out of it; there is no flag on `BattleState` and no one-tick lag. An
//    earlier draft of this batch had both, because the table then put 구조 진행 before the
//    attacks, and the rule was unimplementable as written from there.
//
//    The argument is required rather than defaulted: a tick loop that forgets to thread the
//    damage through would silently make the rescue immune to fire, which is precisely the
//    tension §1.11 exists to create. And there is no exported empty outcome to hand it —
//    `applyDamage(state, [])` is the only way to make one, so the type also forbids skipping
//    the damage step, which is where the invulnerability window burns down.
//
// 3. RANGE IS TESTED ONLY AT ESTABLISHMENT. §1.11's cancel list does not include "the
//    target went out of range", and it does not need to: the performer is frozen for the
//    whole lock (`advanceCommandUnit` refuses to move while `rescue.active`) and a downed body
//    does not
//    move at all, so the distance that was inside `RESCUE_RANGE` at establishment is the
//    same distance every tick after it. Adding a range cancel would be inventing a rule.

import {
  RESCUE_INVULNERABLE_TICKS,
  RESCUE_RANGE,
  RESCUE_REVIVE_FRACTION,
  RESCUE_TICKS,
} from './constants'
import { dealtToUnit, type DamageOutcome } from './damage'
import { commandUnitOf } from './movement'
import { findFriendly, friendliesById } from './state'
import { rescueTicksMultiplierOf, tickDurationAfter } from './upgrades'
import type { BattleState, FriendlyUnit } from './types'

/**
 * The one-tick input events §1.11 needs, as opposed to the held state in `state.input`.
 *
 * `movementKeydown` covers §1.11's "이동 keydown/pointerdown": one flag, because the rule
 * treats a key press and a pointer press as the same act of deciding to move.
 */
export type RescueInputEvents = {
  movementKeydown: boolean
}

/**
 * A tick with no fresh input events — the explicit way to say "nothing was pressed".
 *
 * It is a value a caller has to NAME, never a default on the parameter. A default would let a
 * tick loop that never wires the input queue's keydown through still compile, and the only
 * symptom would be that §1.11's movement cancel quietly stops existing: the player moves and
 * the rescue keeps going. Same argument as `advanceRescueProgress`'s required damage argument.
 */
export const NO_RESCUE_INPUT_EVENTS: RescueInputEvents = { movementKeydown: false }

/**
 * How many ticks of held Space a rescue takes.
 *
 * §1.13's `firstaid` card (x0.7 duration) lands exactly here and nowhere else — the same seam
 * shape `attackIntervalOf` uses for `rapid`, and rounded to whole ticks for the same reason
 * (`tickDurationAfter`): the progress counter advances by 1 per tick.
 */
export function rescueTicksOf(state: BattleState): number {
  return tickDurationAfter(RESCUE_TICKS, rescueTicksMultiplierOf(state))
}

function distanceBetween(from: FriendlyUnit, to: FriendlyUnit): number {
  return Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y)
}

/** §1.11's priority: 원 지휘관 → `downedTicks` ascending → id ascending. */
function outranks(state: BattleState, candidate: FriendlyUnit, best: FriendlyUnit): boolean {
  const candidateIsOriginal = candidate.id === state.originalCommanderId
  const bestIsOriginal = best.id === state.originalCommanderId
  if (candidateIsOriginal !== bestIsOriginal) return candidateIsOriginal
  if (candidate.downedTicks !== best.downedTicks) return candidate.downedTicks < best.downedTicks
  // Walked in ascending id, so this is unreachable; written out because the tie-break is
  // part of the rule and a future reordering of the walk must not silently change it.
  return candidate.id < best.id
}

/**
 * §1.11: the downed friendly the command unit would rescue, or null.
 *
 * Exported because it is half of the lock condition ("후보 존재") and because the renderer
 * (batch G) has to show the player which body Space would pick up.
 */
export function rescueCandidateId(state: BattleState): number | null {
  const command = commandUnitOf(state)
  if (!command || command.life !== 'standing') return null

  let best: FriendlyUnit | null = null
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'downed') continue
    if (distanceBetween(command, unit) > RESCUE_RANGE) continue
    if (best === null || outranks(state, unit, best)) best = unit
  }
  return best === null ? null : best.id
}

/** §1.11: "취소 시 진행도는 0으로 되돌린다." */
export function cancelRescue(state: BattleState): void {
  state.rescue.active = false
  state.rescue.targetId = null
  state.rescue.progress = 0
}

/**
 * The two cancel conditions that are facts about the state rather than input events:
 * the performer is no longer a standing command unit, or the target is no longer a body
 * that can be picked up.
 *
 * `resolveRescueLock` tests them, because they can become true between two ticks, and
 * `resolveTransitions` tests them again at the moment it makes them true — so that no tick ever
 * ENDS holding a lock that has already lost its subject or its object.
 */
export function rescueLockIsBroken(state: BattleState): boolean {
  if (!state.rescue.active) return false
  const command = commandUnitOf(state)
  if (!command || command.life !== 'standing') return true
  if (state.rescue.targetId === null) return true
  const target = findFriendly(state, state.rescue.targetId)
  return !target || target.life !== 'downed'
}

/** `resolveTransitions` uses this to keep the invariant above without duplicating conditions. */
export function cancelRescueIfBroken(state: BattleState): void {
  if (rescueLockIsBroken(state)) cancelRescue(state)
}

/**
 * §1.16 구조 lock 판정 — establish, hold or cancel the rescue lock.
 *
 * Before `advanceCommandUnit`, which is what makes "lock이 성립한 tick부터 지휘 유닛은
 * 이동하지 않는다" true without a special case: `advanceCommandUnit` reads `rescue.active`
 * and the flag is already set when it runs. (An earlier draft of §1.11 named the wrong two
 * positions for the lock and for movement, contradicting §1.16's own table; the spec now
 * agrees with the table, and the table is in `index.ts`.)
 */
export function resolveRescueLock(state: BattleState, events: RescueInputEvents): void {
  if (state.rescue.active) {
    // §1.11's cancel list, in order: Space released, movement keydown, target gone,
    // performer down. A merely HELD movement vector is not on it — see note 1 above.
    if (!state.input.spaceHeld || events.movementKeydown) {
      cancelRescue(state)
      return
    }
    cancelRescueIfBroken(state)
    return
  }

  // §1.11's three establishment conditions.
  if (!state.input.spaceHeld) return
  if (state.input.move.x !== 0 || state.input.move.y !== 0) return
  const candidateId = rescueCandidateId(state)
  if (candidateId === null) return

  state.rescue.active = true
  state.rescue.targetId = candidateId
  state.rescue.progress = 0
}

/** What the progress step hands back when a rescue finishes; §1.14's record is on the unit itself. */
export type RescueCompletion = {
  targetId: number
  rescuerId: number
}

/**
 * §1.16 구조 진행 — one tick of rescue progress, and the revival when it completes.
 *
 * Takes `applyDamage`'s result, because §1.11's freeze is a question about THIS tick's damage:
 * "그 tick에 지휘 유닛(구조 수행자)이 피해를 입었으면 진행도가 증가하지 않으며 감소하지도
 * 않는다." Frozen means frozen in place — the progress already earned is kept, so a rescue
 * under intermittent fire is slow rather than impossible.
 *
 * §1.11: "완료 시 대상은 최대 HP의 50%로 복귀하고 일정 tick 동안 피해를 받지 않는다." The
 * revival is `maxHp x RESCUE_REVIVE_FRACTION` and nothing else: the v1 review found a
 * `vigor`-boosted rescue reviving at 62.5% because the fraction had been taken against a
 * stored base instead of the live maximum.
 */
export function advanceRescueProgress(
  state: BattleState,
  damage: Readonly<DamageOutcome>,
): RescueCompletion | null {
  if (!state.rescue.active) return null

  const command = commandUnitOf(state)
  const target = state.rescue.targetId === null ? null : findFriendly(state, state.rescue.targetId)
  // `resolveRescueLock` and `resolveTransitions` both cancel a broken lock, so this is unreachable in a real tick
  // order; it must not advance progress against a missing subject in a hand-authored one.
  if (!command || !target) return null

  // A lethal hit needs no special case: it froze progress here, and `resolveTransitions` downs the body and
  // cancels the lock a moment later.
  if (dealtToUnit(damage, command.id) > 0) return null

  state.rescue.progress += 1
  if (state.rescue.progress < rescueTicksOf(state)) return null

  target.life = 'standing'
  target.hp = target.maxHp * RESCUE_REVIVE_FRACTION
  target.downedTicks = 0
  target.deathTick = null
  target.invulnerableTicks = RESCUE_INVULNERABLE_TICKS
  // §1.14: "구조된 이름 ← 구조자 이름", in rescue order, so this list is appended to and
  // never sorted.
  target.rescuedByIds = [...target.rescuedByIds, command.id]
  state.stats.rescues += 1
  cancelRescue(state)

  return { targetId: target.id, rescuerId: command.id }
}
