// §1.9: the two enemy classes — targeting with slots, and movement.
//
// Three things in here are decisions rather than transcriptions, and each one is
// argued at the point it is made:
//
//   1. Enemy target selection is §1.9's, not §1.8's. §1.8 filters candidates to those
//      already in range; a melee whose whole job is to CLOSE would then never have a
//      target and never move. §1.8 also ranks "elite first", which is meaningless when
//      the candidates are friendlies. So enemies use §1.9's rule: nearest friendly
//      with a free slot, ties by ascending id.
//   2. A claimed slot is stable. §1.9 makes retargeting a consequence of not holding a
//      slot ("슬롯을 얻지 못한 근접형은 ... 재표적한다"), so an enemy that holds one
//      keeps it. Re-optimising every tick would make the whole enemy force swap
//      targets whenever the formation shifted by a centimetre.
//   3. There is no stuck counter and no tangential orbit. §1.6 removed cover: nothing
//      can block a shooter's line, so "시야를 잃은" is not a state a shooter can be in,
//      and nothing but the arena edge can stop a body, so §1.7's 30-tick retarget has no
//      trigger. Both are deleted rather than left inert — an inert rule is one a later
//      batch reintroduces by accident.
//
// The elite (§1.12) is skipped by both passes. It is an ordinary row in `enemies`, but
// its movement rule is its own ("지휘 유닛을 향해 이동하며 eliteApproachRange에서
// 멈춘다") and its attack is the telegraph cycle, not a contact or a shot. §1.8 still
// ranks it as a candidate for the friendly side, which is the only cross-cutting thing
// it needs from this batch.

import {
  MELEE_CONTACT_SLOTS_PER_FRIENDLY,
  SHOOTER_TARGET_SLOTS_PER_FRIENDLY,
} from './constants'
import { stageOf } from './stages'
import { moveEnemyTowards } from './movement'
import { enemiesById, findFriendly, friendliesById } from './state'
import type { BattleState, EnemyKind, EnemyUnit, FriendlyUnit, Vec2 } from './types'

/**
 * §1.9 movement speed by class, and the two are asymmetric ON PURPOSE (§1.3):
 *
 *   melee   — FASTER than the command unit, asserted per stage in `stages.ts`. This is what makes
 *             "run away in a straight line" lose ground every tick, and it is the reason
 *             §1.3 can let a unit fire while moving without handing out invulnerability.
 *   shooter — slower than every friendly, which §1.3 explicitly allows: "사수형은 더 느려도
 *             된다 — 멀리 서서 쏘는 역할이라 따라잡을 이유가 없다."
 */
export function enemyMoveSpeedOf(state: BattleState, enemy: EnemyUnit): number {
  const stage = stageOf(state)
  return enemy.kind === 'melee' ? stage.meleeMoveSpeed : stage.shooterMoveSpeed
}

/** The distance at which the class can attack: contact for melee, weapon for shooter. */
export function enemyAttackRangeOf(state: BattleState, enemy: EnemyUnit): number {
  const stage = stageOf(state)
  return enemy.kind === 'melee' ? stage.meleeRange : stage.shooterRange
}

export function enemyAttackIntervalOf(state: BattleState, enemy: EnemyUnit): number {
  const stage = stageOf(state)
  return enemy.kind === 'melee' ? stage.meleeAttackInterval : stage.shooterAttackInterval
}

export function enemyDamageOf(state: BattleState, enemy: EnemyUnit): number {
  const stage = stageOf(state)
  return enemy.kind === 'melee' ? stage.meleeDamage : stage.shooterDamage
}

/**
 * §1.9: one contact slot per friendly for melee, two target slots for shooters.
 *
 * NO `state` PARAMETER, and that is the deliberate half of this batch's split. The four class
 * numbers above are §2.2's "적 능력치" axis and became a stage's; these two are not a quantity
 * §2.2 lists at all — §1.9 states them as structure ("접촉 슬롯" one, "표적 슬롯" two), the same
 * way it states that the pools are separate. They stayed in `constants.ts`.
 *
 * The two are separate pools, because §1.9 names them separately ("접촉 슬롯" and
 * "표적 슬롯"): a friendly can be in contact with one melee while two shooters aim at
 * it. Sharing one pool would silently halve the shooter cap whenever a melee arrived.
 */
export function enemySlotCapacityOf(kind: EnemyKind): number {
  if (kind === 'melee') return MELEE_CONTACT_SLOTS_PER_FRIENDLY
  if (kind === 'shooter') return SHOOTER_TARGET_SLOTS_PER_FRIENDLY
  return 0
}

function distanceBetween(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/** Enemies that this batch owns: alive, and not the elite (§1.12). */
function activeEnemies(state: BattleState): EnemyUnit[] {
  return enemiesById(state).filter((enemy) => enemy.life === 'standing' && enemy.kind !== 'elite')
}

function targetOf(state: BattleState, enemy: EnemyUnit): FriendlyUnit | null {
  if (enemy.targetId === null) return null
  const target = findFriendly(state, enemy.targetId)
  // Downed friendlies are not targets: §1.5 and §1.11 both treat "기립" as the living
  // roster, and a downed body being shot at would make the rescue decision (§1.11) a
  // formality rather than a judgement.
  return target && target.life === 'standing' ? target : null
}

type SlotLedger = {
  melee: Map<number, number>
  shooter: Map<number, number>
}

function ledgerFor(ledger: SlotLedger, kind: EnemyKind): Map<number, number> {
  return kind === 'melee' ? ledger.melee : ledger.shooter
}

function claim(ledger: SlotLedger, enemy: EnemyUnit, friendlyId: number): void {
  const map = ledgerFor(ledger, enemy.kind)
  map.set(friendlyId, (map.get(friendlyId) ?? 0) + 1)
  enemy.targetId = friendlyId
  enemy.contactSlotOwnerId = friendlyId
}

function hasFreeSlot(ledger: SlotLedger, enemy: EnemyUnit, friendlyId: number): boolean {
  const map = ledgerFor(ledger, enemy.kind)
  return (map.get(friendlyId) ?? 0) < enemySlotCapacityOf(enemy.kind)
}

/**
 * §1.9: the enemy half of the 대상 선택 step.
 *
 * Two passes, both in ascending enemy id so the result cannot depend on the order the
 * spawn batch appended rows:
 *
 *   pass 1 — everyone who still legitimately holds a slot keeps it, and their claims
 *            are counted first. First come, first served.
 *   pass 2 — everyone else picks: nearest friendly with a free slot, ties by id.
 *
 * The fallback when every slot in the arena is taken is to target the nearest friendly
 * with NO slot (`contactSlotOwnerId: null`), which §1.9 now states outright.
 */
export function advanceEnemyTargeting(state: BattleState): void {
  const friendlies = friendliesById(state).filter((unit) => unit.life === 'standing')
  const ledger: SlotLedger = { melee: new Map(), shooter: new Map() }
  const pending: EnemyUnit[] = []

  for (const enemy of activeEnemies(state)) {
    const held = enemy.contactSlotOwnerId
    if (held === null || held !== enemy.targetId || targetOf(state, enemy) === null) {
      enemy.contactSlotOwnerId = null
      pending.push(enemy)
      continue
    }
    if (!hasFreeSlot(ledger, enemy, held)) {
      // Only reachable from a hand-authored fixture; counted anyway, because the
      // alternative is two enemies quietly sharing a one-deep slot.
      enemy.contactSlotOwnerId = null
      pending.push(enemy)
      continue
    }
    claim(ledger, enemy, held)
  }

  for (const enemy of pending) {
    let free: FriendlyUnit | null = null
    let freeDistance = Infinity
    let nearest: FriendlyUnit | null = null
    let nearestDistance = Infinity

    // Ascending id, strict `<`: §1.9's "동률 시 id".
    for (const friendly of friendlies) {
      const distance = distanceBetween(enemy.position, friendly.position)
      if (distance < nearestDistance) {
        nearest = friendly
        nearestDistance = distance
      }
      if (hasFreeSlot(ledger, enemy, friendly.id) && distance < freeDistance) {
        free = friendly
        freeDistance = distance
      }
    }

    if (free) {
      claim(ledger, enemy, free.id)
      continue
    }
    // §1.9: "아레나의 모든 슬롯이 찬 경우 그 적은 가장 가까운 아군을 대상으로 삼고 슬롯
    // 없이 정상 행동한다." There is no waiting state.
    enemy.targetId = nearest ? nearest.id : null
    enemy.contactSlotOwnerId = null
  }
}

/**
 * §1.9: "이번 tick은 움직이지 않기로 했다".
 *
 * Displacement exactly 0. Nothing in the core reads that number any more (§1.3 deleted the
 * one rule that did), so this records a fact rather than earning a shot: a shooter inside
 * the standoff band holds because §1.9 tells it to keep its distance, and it would fire
 * from there whether it had moved or not.
 */
function holdStill(enemy: EnemyUnit): void {
  enemy.lastDisplacement = 0
}

/**
 * The 추종·적 이동 step, enemy half: the `EnemyMovementRule` that step takes as an argument.
 *
 * Both the approach and the retreat go through `moveEnemyTowards`; a waypoint exactly
 * `speed` away turns "move in this direction" into "move towards this point" without a
 * second movement primitive. The shooter has exactly three states now — approach, hold,
 * retreat — because §1.6 deleted the fourth (orbit for an angle).
 *
 * Enemies pursue the target chosen by the PREVIOUS tick's 대상 선택, because §1.16 puts
 * selection after movement. §1.16 states that one-tick lag as an intended contract: the
 * ATTACK always uses a target chosen from post-movement positions.
 */
export function advanceEnemyMovement(state: BattleState): void {
  const stage = stageOf(state)
  const [standoffLow, standoffHigh] = stage.shooterStandoff

  for (const enemy of activeEnemies(state)) {
    const target = targetOf(state, enemy)
    if (!target) {
      holdStill(enemy)
      continue
    }

    const speed = enemyMoveSpeedOf(state, enemy)
    const distance = distanceBetween(enemy.position, target.position)

    if (enemy.kind === 'melee') {
      if (distance <= stage.meleeRange) holdStill(enemy)
      else moveEnemyTowards(state, enemy, target.position, speed)
      continue
    }

    if (distance > standoffHigh) {
      moveEnemyTowards(state, enemy, target.position, speed)
      continue
    }
    if (distance < standoffLow) {
      moveEnemyTowards(
        state,
        enemy,
        retreatWaypoint(enemy, target.position, distance, speed),
        speed,
      )
      continue
    }
    // Inside the band: hold, and shoot when the attack step runs. The whole third state.
    holdStill(enemy)
  }
}

function retreatWaypoint(enemy: EnemyUnit, target: Vec2, distance: number, speed: number): Vec2 {
  // distance 0 has no "away" — it is unreachable in play (a shooter retreats long
  // before it gets there) but must not produce NaN. +x is an arbitrary, deterministic
  // choice.
  const ux = distance === 0 ? 1 : (enemy.position.x - target.x) / distance
  const uy = distance === 0 ? 0 : (enemy.position.y - target.y) / distance
  return { x: enemy.position.x + ux * speed, y: enemy.position.y + uy * speed }
}

/**
 * §1.9/I1: is this enemy engaged — holding a contact slot, or a shooter inside its
 * standoff band?
 *
 * I1 measures "교전 중인 적이 0인 60틱 구간이 없다" and the harness (batch G) is the only
 * caller. It lives next to the movement rule so the measurement cannot drift from the
 * behaviour: the band test here is the same comparison `advanceEnemyMovement` uses to
 * decide to hold. (I1's wording still says "standoff 안에서 시야가 통하는 적"; the sight
 * half of that sentence is a v6 leftover — §1.6 removed sight, and it is reported.)
 */
export function isEnemyEngaged(state: BattleState, enemy: EnemyUnit): boolean {
  if (enemy.life !== 'standing') return false
  if (enemy.kind === 'elite') return false
  if (enemy.contactSlotOwnerId !== null && enemy.kind === 'melee') return true
  const target = targetOf(state, enemy)
  if (!target) return false
  const stage = stageOf(state)
  const distance = distanceBetween(enemy.position, target.position)
  if (enemy.kind === 'melee') return distance <= stage.meleeRange
  const [standoffLow, standoffHigh] = stage.shooterStandoff
  return distance >= standoffLow && distance <= standoffHigh
}
