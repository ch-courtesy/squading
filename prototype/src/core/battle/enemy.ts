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
//   3. A deliberate hold is not "stuck". §1.7's 30-tick rule counts ticks of *failed*
//      movement, which is why batch A advances the counter inside `moveEnemyTowards`
//      and nowhere else. A melee standing in contact and a shooter holding inside the
//      standoff band both have displacement 0 *by design*; charging that against §1.7
//      would make every shooter throw away its target every 30 ticks — which for the
//      current placeholder is exactly its attack interval.
//
// The elite (§1.12) is skipped by both passes. It is an ordinary row in `enemies`, but
// its movement rule is its own ("지휘 유닛을 향해 이동하며 ELITE_APPROACH_RANGE에서
// 멈춘다") and its attack is the telegraph cycle, not a contact or a shot. §1.8 still
// ranks it as a candidate for the friendly side, which is the only cross-cutting thing
// it needs from this batch.

import type { Rect } from '../gameplay/geometry'
import {
  ENEMY_STUCK_TICKS,
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
import { hasBattleSight } from './sight'
import { enemiesById, findFriendly, friendliesById, movementBlockers, sightBlockers } from './state'
import type { BattleState, EnemyKind, EnemyUnit, FriendlyUnit, Vec2 } from './types'

/**
 * Resolution of the tangential search in §1.9 ("회전 방향은 목표 시야까지 각거리가 짧은
 * 쪽을 고른다").
 *
 * These are structural, not balance: they set how finely the shorter arc is measured,
 * not how strong anything is, so they are not in `constants.ts` with the harness's
 * numbers. 5 degrees x 36 steps covers the full +/-180 degrees, and the search stops at
 * the first step where either direction sees the target, so the common case costs one
 * or two probes rather than 72.
 */
const ORBIT_PROBE_STEP = Math.PI / 36
const ORBIT_PROBE_STEPS = 36

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
 * §1.9 + §1.7: the enemy half of step 7.
 *
 * Two passes, both in ascending enemy id so the result cannot depend on the order the
 * spawn batch appended rows:
 *
 *   pass 1 — everyone who still legitimately holds a slot keeps it, and their claims
 *            are counted first. First come, first served.
 *   pass 2 — everyone else picks: nearest friendly with a free slot, ties by id.
 *
 * The fallback when every slot in the arena is taken is to target the nearest friendly
 * with NO slot (`contactSlotOwnerId: null`). §1.9 says "슬롯 없이 대기하는 상태는
 * 존재하지 않는다" — there is no waiting state — and with 16 friendlies and a cap of 26
 * engaged enemies the pools genuinely can fill, so the alternative would be an enemy
 * with no target at all. That is an interpretation; it is reported.
 */
export function advanceEnemyTargeting(state: BattleState): void {
  const friendlies = friendliesById(state).filter((unit) => unit.life === 'standing')
  const ledger: SlotLedger = { melee: new Map(), shooter: new Map() }
  const pending: EnemyUnit[] = []

  for (const enemy of activeEnemies(state)) {
    // §1.7: 30 consecutive zero-displacement ticks. The counter is reset here rather
    // than left at 30, or the retarget would fire again on every following tick and
    // the enemy would rotate through targets forever.
    if (enemy.zeroDisplacementTicks >= ENEMY_STUCK_TICKS) {
      if (enemy.targetId !== null) enemy.excludedTargetId = enemy.targetId
      enemy.zeroDisplacementTicks = 0
      enemy.targetId = null
      enemy.contactSlotOwnerId = null
      pending.push(enemy)
      continue
    }

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
    let open: FriendlyUnit | null = null
    let openDistance = Infinity
    let anyone: FriendlyUnit | null = null
    let anyoneDistance = Infinity

    // Ascending id, strict `<`: §1.9's "동률 시 id".
    for (const friendly of friendlies) {
      const distance = distanceBetween(enemy.position, friendly.position)
      if (distance < anyoneDistance) {
        anyone = friendly
        anyoneDistance = distance
      }
      if (friendly.id === enemy.excludedTargetId) continue
      if (distance < openDistance) {
        open = friendly
        openDistance = distance
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
    // No slot anywhere, or nothing but the target this enemy just gave up on.
    const fallback = open ?? anyone
    enemy.targetId = fallback ? fallback.id : null
    enemy.contactSlotOwnerId = null
  }
}

/**
 * §1.9 shooter, sight lost: which way around the target is the shorter arc to sight.
 *
 * `+1` is counter-clockwise, `-1` clockwise. Probes sit on the circle the shooter is
 * already on, so the search asks the one question §1.9 asks — "각거리" to sight, not
 * distance — and both directions are tested at each step so the FIRST step that works
 * decides. An exact tie (a symmetric wall, dead ahead) resolves counter-clockwise;
 * §1.9 does not name a tie-break and a determinstic one is required.
 */
export function shooterOrbitDirection(
  enemy: EnemyUnit,
  target: Vec2,
  blockers: readonly Rect[],
): 1 | -1 {
  const radius = distanceBetween(enemy.position, target)
  if (radius === 0) return 1
  const base = Math.atan2(enemy.position.y - target.y, enemy.position.x - target.x)

  for (let step = 1; step <= ORBIT_PROBE_STEPS; step += 1) {
    const offset = step * ORBIT_PROBE_STEP
    const counterClockwise = probeHasSight(target, radius, base + offset, blockers)
    const clockwise = probeHasSight(target, radius, base - offset, blockers)
    if (counterClockwise) return 1
    if (clockwise) return -1
  }
  return 1
}

function probeHasSight(target: Vec2, radius: number, angle: number, blockers: readonly Rect[]): boolean {
  const x = target.x + radius * Math.cos(angle)
  const y = target.y + radius * Math.sin(angle)
  return hasBattleSight(x, y, target.x, target.y, blockers)
}

/**
 * §1.9: "이번 tick은 움직이지 않기로 했다".
 *
 * Displacement exactly 0 — a shooter holding station is the enemy mirror of §1.4's
 * settle dead-band — and the stuck counter is cleared, because this tick was a choice,
 * not a failure (see the header).
 */
function holdStill(enemy: EnemyUnit): void {
  enemy.lastDisplacement = 0
  enemy.zeroDisplacementTicks = 0
}

/**
 * §1.16 step 5, enemy half: the `EnemyMovementRule` batch A left as an argument.
 *
 * Everything moves through `moveEnemyTowards`, including the retreat and the orbit,
 * which is what keeps §1.7's sliding and its stuck counter uniform across the three
 * behaviours. A waypoint exactly `speed` away turns "move in this direction" into
 * "move towards this point" without a second movement primitive.
 *
 * Enemies pursue the target chosen by the PREVIOUS tick's step 7, because §1.16 puts
 * selection at step 7 and movement at step 5. That one-tick lag is the spec's, and it
 * is what "이동 뒤여야 엄폐 반응에 지연이 없다" buys: the ATTACK always uses a target
 * chosen from post-movement positions.
 */
export function advanceEnemyMovement(state: BattleState): void {
  const movement = movementBlockers(state)
  const sight = sightBlockers(state)
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
      else moveEnemyTowards(enemy, target.position, speed, movement)
      continue
    }

    if (distance > standoffHigh) {
      moveEnemyTowards(enemy, target.position, speed, movement)
      continue
    }
    if (distance < standoffLow) {
      moveEnemyTowards(enemy, retreatWaypoint(enemy, target.position, distance, speed), speed, movement)
      continue
    }
    // Inside the band. This is the only place a shooter stands still, and §1.9 gives it
    // exactly one reason not to: it cannot see the target.
    if (hasBattleSight(enemy.position.x, enemy.position.y, target.position.x, target.position.y, sight)) {
      holdStill(enemy)
      continue
    }
    moveEnemyTowards(enemy, orbitWaypoint(enemy, target.position, distance, speed, sight), speed, movement)
  }
}

function retreatWaypoint(enemy: EnemyUnit, target: Vec2, distance: number, speed: number): Vec2 {
  // distance 0 has no "away" — it is unreachable in play (a shooter retreats long
  // before it gets there) but must not produce NaN. +x is the arbitrary, deterministic
  // choice, matching §1.6's `-x, +x, ...` axis ordering having a first entry at all.
  const ux = distance === 0 ? 1 : (enemy.position.x - target.x) / distance
  const uy = distance === 0 ? 0 : (enemy.position.y - target.y) / distance
  return { x: enemy.position.x + ux * speed, y: enemy.position.y + uy * speed }
}

function orbitWaypoint(
  enemy: EnemyUnit,
  target: Vec2,
  distance: number,
  speed: number,
  blockers: readonly Rect[],
): Vec2 {
  if (distance === 0) return retreatWaypoint(enemy, target, distance, speed)
  const direction = shooterOrbitDirection(enemy, target, blockers)
  const ux = (enemy.position.x - target.x) / distance
  const uy = (enemy.position.y - target.y) / distance
  // Perpendicular to the radial: counter-clockwise is (-uy, ux). §1.9 spends the WHOLE
  // move speed on the tangent, so the waypoint is one full step along it.
  const tx = -uy * direction
  const ty = ux * direction
  return { x: enemy.position.x + tx * speed, y: enemy.position.y + ty * speed }
}

/**
 * I7's denominator and numerator in one predicate: this shooter's cooldown is ready and
 * a friendly is inside `SHOOTER_RANGE`, but no friendly in range is visible.
 *
 * §3 measures "거부된 기회" as a fraction of ticks, and the harness (batch G) is the
 * only caller. It lives here because it has to agree with what the shooter itself
 * calls sight — a second, subtly different implementation in the harness would report a
 * ratio the game does not actually play.
 */
export function shooterSightDenied(state: BattleState, enemy: EnemyUnit): boolean {
  if (enemy.kind !== 'shooter' || enemy.life !== 'standing') return false
  if (enemy.attackCooldown > 0) return false
  const blockers = sightBlockers(state)
  let inRange = false
  for (const friendly of friendliesById(state)) {
    if (friendly.life !== 'standing') continue
    if (distanceBetween(enemy.position, friendly.position) > SHOOTER_RANGE) continue
    inRange = true
    if (
      hasBattleSight(
        enemy.position.x,
        enemy.position.y,
        friendly.position.x,
        friendly.position.y,
        blockers,
      )
    ) {
      return false
    }
  }
  return inRange
}
