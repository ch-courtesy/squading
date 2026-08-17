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
// its movement rule is its own ("지휘 유닛을 향해 이동하며 ELITE_APPROACH_RANGE에서
// 멈춘다") and its attack is the telegraph cycle, not a contact or a shot. §1.8 still
// ranks it as a candidate for the friendly side, which is the only cross-cutting thing
// it needs from this batch.

import {
  MELEE_ATTACK_INTERVAL,
  MELEE_CONTACT_SLOTS_PER_FRIENDLY,
  MELEE_DAMAGE,
  MELEE_MOVE_SPEED,
  MELEE_RANGE,
  SHOOTER_ATTACK_INTERVAL,
  SHOOTER_DAMAGE,
  SHOOTER_MOVE_SPEED,
  SHOOTER_RANGE,
  SHOOTER_STANDOFF,
  SHOOTER_TARGET_SLOTS_PER_FRIENDLY,
} from './constants'
import { moveEnemyTowards } from './movement'
import { enemiesById, findFriendly, friendliesById } from './state'
import type { BattleState, EnemyKind, EnemyUnit, FriendlyUnit, Vec2 } from './types'

export function enemyMoveSpeedOf(enemy: EnemyUnit): number {
  return enemy.kind === 'melee' ? MELEE_MOVE_SPEED : SHOOTER_MOVE_SPEED
}

/** The distance at which the class can attack: contact for melee, weapon for shooter. */
export function enemyAttackRangeOf(enemy: EnemyUnit): number {
  return enemy.kind === 'melee' ? MELEE_RANGE : SHOOTER_RANGE
}

export function enemyAttackIntervalOf(enemy: EnemyUnit): number {
  return enemy.kind === 'melee' ? MELEE_ATTACK_INTERVAL : SHOOTER_ATTACK_INTERVAL
}

export function enemyDamageOf(enemy: EnemyUnit): number {
  return enemy.kind === 'melee' ? MELEE_DAMAGE : SHOOTER_DAMAGE
}

/**
 * §1.9: one contact slot per friendly for melee, two target slots for shooters.
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
 * §1.9: the enemy half of step 7.
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
 * Displacement exactly 0 — a shooter holding station inside the standoff band is the
 * enemy mirror of §1.4's settle dead-band. Note that §1.3 does not apply to enemies, so
 * unlike a friendly, an enemy does not need to hold still in order to shoot; the shooter
 * holds because §1.9 tells it to keep its distance, not to earn its shot.
 */
function holdStill(enemy: EnemyUnit): void {
  enemy.lastDisplacement = 0
}

/**
 * §1.16 step 5, enemy half: the `EnemyMovementRule` that step 5 takes as an argument.
 *
 * Both the approach and the retreat go through `moveEnemyTowards`; a waypoint exactly
 * `speed` away turns "move in this direction" into "move towards this point" without a
 * second movement primitive. The shooter has exactly three states now — approach, hold,
 * retreat — because §1.6 deleted the fourth (orbit for an angle).
 *
 * Enemies pursue the target chosen by the PREVIOUS tick's step 7, because §1.16 puts
 * selection at step 7 and movement at step 5. §1.16 states that one-tick lag as an
 * intended contract: the ATTACK always uses a target chosen from post-movement positions.
 */
export function advanceEnemyMovement(state: BattleState): void {
  const [standoffLow, standoffHigh] = SHOOTER_STANDOFF

  for (const enemy of activeEnemies(state)) {
    const target = targetOf(state, enemy)
    if (!target) {
      holdStill(enemy)
      continue
    }

    const speed = enemyMoveSpeedOf(enemy)
    const distance = distanceBetween(enemy.position, target.position)

    if (enemy.kind === 'melee') {
      if (distance <= MELEE_RANGE) holdStill(enemy)
      else moveEnemyTowards(enemy, target.position, speed)
      continue
    }

    if (distance > standoffHigh) {
      moveEnemyTowards(enemy, target.position, speed)
      continue
    }
    if (distance < standoffLow) {
      moveEnemyTowards(enemy, retreatWaypoint(enemy, target.position, distance, speed), speed)
      continue
    }
    // Inside the band: hold and shoot (step 10). This is the whole of the third state.
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
  const distance = distanceBetween(enemy.position, target.position)
  if (enemy.kind === 'melee') return distance <= MELEE_RANGE
  const [standoffLow, standoffHigh] = SHOOTER_STANDOFF
  return distance >= standoffLow && distance <= standoffHigh
}
