// §1.12 정예 — the arrival, the approach, and the telegraph / impact / cooldown cycle.
//
// The elite is an ordinary row in `enemies` with `kind: 'elite'` (§1.12, and see the argument
// on `EnemyKind` in `types.ts`); `state.elite` is its ATTACK CYCLE only. Everything in this
// file is written against that split, which is what makes "died mid-telegraph" a state the
// game can represent rather than a case to special-case away.
//
// Four decisions in here are not transcriptions. Each is argued where it is made, and all four
// are reported in the batch report as §1.12 ambiguities:
//
//   1. THE CYCLE RUNS FROM ARRIVAL, at any distance. §1.12 says "주기: 예고 → 착탄 → 냉각" and
//      says nothing about a range gate, so the elite starts telegraphing the tick it lands and
//      keeps shelling the command unit's position while it closes. A distance gate would be an
//      invented rule, and it would also invent a stretch of the run where the elite is on the
//      board and harmless.
//   2. THE BLAST DOES NOT TOUCH A DOWNED BODY (batch C's 6.6, left open on purpose). §1.9 keeps
//      enemies off downed friendlies so that §1.11's rescue stays a judgement, §1.12 gives the
//      blast no rule for finishing one off, and a downed body has no hp to lose — "damage" to
//      it could only mean an invented instant kill. So the impact collects STANDING friendlies.
//      The damage step drops events aimed at anything else anyway; this makes the intent
//      explicit rather than incidental.
//   3. THE APPROACH STOPS EXACTLY AT `ELITE_APPROACH_RANGE`, rather than overshooting into it on
//      the last step. §1.12 says "ELITE_APPROACH_RANGE에서 멈춘다" — at the range, not inside
//      it — and a hand-computable resting distance is what lets a fixture assert which of the
//      15 slots can answer back. There is no retreat: §1.12 gives the elite an approach and a
//      stop, and nothing else.
//   4. THE CAPS DO NOT GATE THE ARRIVAL. §1.10's two caps are stated over "새 요청" — spawn
//      requests — and §1.10's line about the elite is that it COUNTS towards them ("정예도 두
//      상한에 함께 센다"), i.e. it pushes ordinary supply into the backlog. An elite that could
//      be capped out of existence would make §1.12's win condition unreachable.
//
// §1.6 is visible here only by what is absent: no line of sight to check before the blast, no
// attenuation inside it, no terrain to route the approach around. The blast is a plain circle
// and the approach is a straight line.

import {
  ELITE_APPROACH_RANGE,
  ELITE_BLAST_RADIUS,
  ELITE_COOLDOWN_TICKS,
  ELITE_DAMAGE,
  ELITE_MOVE_SPEED,
  ELITE_SPAWN_TICK,
  ELITE_TELEGRAPH_TICKS,
} from './constants'
import { advanceEnemyMovement } from './enemy'
import { commandUnitOf, moveEnemyTowards, type EnemyMovementRule } from './movement'
import { drawSpawnPosition, resolveSpawnRequests } from './spawn'
import { ELITE_ID, createEnemy, eliteEnemy, friendliesById } from './state'
import type { BattleState, DamageEvent, EnemyUnit, FriendlyUnit, Vec2 } from './types'

function distanceBetween(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** The command unit, only if it is a body the elite can hunt and aim at. */
function livingCommandUnit(state: BattleState): FriendlyUnit | null {
  const command = commandUnitOf(state)
  return command && command.life === 'standing' ? command : null
}

/** The elite's row, only while it is alive. */
function livingElite(state: BattleState): EnemyUnit | null {
  const elite = eliteEnemy(state)
  return elite && elite.life === 'standing' ? elite : null
}

/**
 * §1.12: "`tick 1800`에 지휘 유닛에서 반경 `SPAWN_RADIUS` 위치에 등장한다."
 *
 * One `spawn` draw through `drawSpawnPosition`, which is §1.10's own placement function — the
 * same draw count and the same arena clamp, so the two arrivals cannot disagree about what a
 * spawn coordinate is.
 *
 * Idempotent, and gated on `elite.enemyId` rather than on the tick alone: the arrival is worth
 * exactly one draw for the whole run, and a loop that calls this twice on tick 1800 must not
 * shift the angle sequence for everything after it.
 */
export function resolveEliteArrival(state: BattleState): void {
  if (state.elite.enemyId !== null) return
  if (state.combatTick < ELITE_SPAWN_TICK) return
  const command = commandUnitOf(state)
  // Nothing to measure the radius from; the 승패 판정 is about to end this run anyway. The
  // stream stays where it is, exactly as `resolveSpawnRequests` leaves it in the same case.
  if (!command) return

  state.enemies.push(createEnemy(ELITE_ID, 'elite', drawSpawnPosition(state, command.position)))
  state.elite.enemyId = ELITE_ID
  state.elite.spawnTick = state.combatTick
}

/**
 * The whole of the 스폰 step: §1.10's requests first, then §1.12's arrival.
 *
 * The order is the point of composing them here. Both draw from `spawn`, and tick 1800 is a
 * tick on which both can happen, so "which angle is whose" has to be written down somewhere
 * that a reader will find — the alternative is a replay that depends on the order two calls
 * happen to appear in inside a tick loop.
 */
export function resolveEnemyArrivals(state: BattleState): void {
  resolveSpawnRequests(state)
  resolveEliteArrival(state)
}

/**
 * §1.12: "지휘 유닛을 향해 이동하며 `ELITE_APPROACH_RANGE`에서 멈춘다."
 *
 * The last step is clamped to the remaining approach, so the elite comes to rest exactly at the
 * range instead of somewhere inside it that depends on where it started. Coming to rest costs it
 * nothing and moving cost it nothing either: its blast is on the telegraph clock, and §1.3 has
 * no displacement rule for anyone.
 */
export function advanceEliteMovement(state: BattleState): void {
  const elite = livingElite(state)
  if (!elite) return

  const command = livingCommandUnit(state)
  if (!command) {
    elite.lastDisplacement = 0
    return
  }

  // Recorded so the digest and the renderer do not have to infer what the elite is hunting.
  // §1.9's slot passes skip `kind: 'elite'`, so this is the only rule that CHOOSES the elite's
  // target; `resolveTransitions` also writes the field, clearing it to null when the row dies,
  // which is a lifecycle reset rather than a second opinion about what the elite is hunting.
  elite.targetId = command.id

  const distance = distanceBetween(elite.position, command.position)
  const remaining = distance - ELITE_APPROACH_RANGE
  if (remaining <= 0) {
    elite.lastDisplacement = 0
    return
  }
  moveEnemyTowards(elite, command.position, Math.min(ELITE_MOVE_SPEED, remaining))
}

/**
 * The whole of the 추종·적 이동 step's enemy half: §1.9's two classes, then §1.12's elite.
 *
 * This is the `EnemyMovementRule` the tick loop hands to `advanceMovement`. Batch B's pass
 * deliberately skips `kind: 'elite'`, so composing the two here is what keeps "the elite moves"
 * from being something a caller has to remember.
 */
export const advanceAllEnemyMovement: EnemyMovementRule = (state: BattleState): void => {
  advanceEnemyMovement(state)
  advanceEliteMovement(state)
}

/**
 * §1.12: the cycle's state, cleared.
 *
 * Called at the moment the elite's row dies (`resolveTransitions`), because `state.elite` is the
 * attack cycle and a dead elite has none: leaving `attackPhase: 'telegraph'` and a
 * `telegraphCenter` behind would put a warning circle on screen for a body that is no longer
 * there, and would leave the digest describing a cycle that can never resolve. `enemyId` and
 * `spawnTick` are NOT cleared — they are the arrival record, and §1.17 wants it in the digest.
 */
export function clearEliteCycle(state: BattleState): void {
  state.elite.attackPhase = 'idle'
  state.elite.telegraphCenter = null
  state.elite.telegraphRemaining = 0
  state.elite.cooldownRemaining = 0
}

function startTelegraph(state: BattleState, center: Vec2): void {
  state.elite.attackPhase = 'telegraph'
  // §1.12: "예고 중심은 예고 시작 tick의 지휘 유닛 위치로 고정한다." A COPY, not the unit's own
  // position object: sharing it would make the centre follow the body that is supposed to be
  // able to run away from it, which is the entire dodge.
  state.elite.telegraphCenter = { x: center.x, y: center.y }
  state.elite.telegraphRemaining = ELITE_TELEGRAPH_TICKS
  state.elite.cooldownRemaining = 0
}

/**
 * §1.12: the impact — every STANDING friendly inside `ELITE_BLAST_RADIUS` of the frozen centre.
 *
 * Measured at IMPACT time, so a body that walked into the circle during the telegraph is hit
 * and a body that walked out is not; that is what makes the telegraph a dodge rather than a
 * pre-computed casualty list. Inclusive at the edge, like every other range test in the core.
 * No sight re-check per target (§1.6 removed sight) and no falloff — a circle and a fixed
 * amount, so nothing in here is random (§1.17).
 */
function impactEvents(state: BattleState, elite: EnemyUnit, center: Vec2): DamageEvent[] {
  const events: DamageEvent[] = []
  // Ascending id: the event order is what the damage step and I2's accounting see.
  for (const unit of friendliesById(state)) {
    if (unit.life !== 'standing') continue
    if (distanceBetween(unit.position, center) > ELITE_BLAST_RADIUS) continue
    events.push({
      side: 'enemy',
      attackerId: elite.id,
      targetId: unit.id,
      amount: ELITE_DAMAGE,
      cause: 'elite-blast',
    })
  }
  return events
}

/**
 * The 정예 예고·착탄 step: one tick of §1.12's cycle, returning the blast's damage events.
 *
 * The clock, written out because the ticks are a contract a fixture hand-counts:
 *
 *   start   the telegraph is set to `ELITE_TELEGRAPH_TICKS` and does NOT decrement on the tick
 *           it starts, so the impact lands exactly `ELITE_TELEGRAPH_TICKS` ticks later. The
 *           command unit gets that many movement steps to leave the circle — 54 x 0.115 = 6.21
 *           against a radius of 2.4 and a formation that trails 2.46.
 *   impact   the events are returned to the caller, which concatenates them onto the two attack
 *            passes' events for the damage step. The cooldown begins in the same tick.
 *   cooldown when it runs out, the next telegraph starts in the SAME tick, so a cycle is exactly
 *            `ELITE_TELEGRAPH_TICKS + ELITE_COOLDOWN_TICKS` ticks (54 + 56 = 110): an elite that
 *            arrives at 1800 impacts at 1854, 1964, 2074.
 *
 * A dead elite clears the cycle and fires nothing. An elite that dies in the same tick it
 * impacted keeps the impact: this step runs before the damage step, so it was alive when it
 * fired — which is precisely why `EliteState` is separate from the row's `life`.
 */
export function resolveEliteCycle(state: BattleState): DamageEvent[] {
  const elite = livingElite(state)
  if (!elite) {
    clearEliteCycle(state)
    return []
  }

  const command = livingCommandUnit(state)
  // No body to centre a telegraph on. The cycle freezes rather than firing at a remembered
  // position: §1.5's succession restores a standing command unit within the same tick it loses
  // one, so this is only reachable from a hand-authored fixture or from a run that is over.
  if (!command) return []

  if (state.elite.attackPhase === 'cooldown') {
    state.elite.cooldownRemaining -= 1
    if (state.elite.cooldownRemaining > 0) return []
    startTelegraph(state, command.position)
    return []
  }

  if (state.elite.attackPhase === 'telegraph') {
    state.elite.telegraphRemaining -= 1
    if (state.elite.telegraphRemaining > 0) return []

    // §1.12: "예고 중심은 예고 시작 tick의 지휘 유닛 위치로 고정한다." A telegraph that is
    // running WITHOUT a frozen centre is not a state this rule has an answer for, and the
    // tempting fallback — the command unit's LIVE position — is precisely the §1.12 violation
    // the telegraph fixtures exist to catch: it would land the blast on the body that spent 54
    // ticks dodging it, silently, with every test still green. `startTelegraph` is the only way
    // into this phase and it always sets the centre, so this throws instead.
    const center = state.elite.telegraphCenter
    if (!center) {
      throw new Error('battle/elite: a telegraph is resolving with no frozen centre (§1.12)')
    }
    const events = impactEvents(state, elite, center)
    state.elite.attackPhase = 'cooldown'
    state.elite.telegraphCenter = null
    state.elite.telegraphRemaining = 0
    state.elite.cooldownRemaining = ELITE_COOLDOWN_TICKS
    return events
  }

  startTelegraph(state, command.position)
  return []
}
