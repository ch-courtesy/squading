// §1.10 spawning — §1.16 step 2.
//
// One request per phase interval, one enemy per request, and three separate gates that a
// request can die or wait on. The order the gates run in is the rule, so it is written out
// here rather than left implicit in the control flow below:
//
//   1. the backlog drains FIRST, up to `BACKLOG_DRAIN_PER_TICK`. A request that has been
//      waiting outranks the one this tick just made; if the tick's own request could jump
//      the queue whenever a place opened, the stored coordinates of the older entries would
//      go stale for as long as pressure lasted.
//   2. the tick's request is BUILT unconditionally once the interval has elapsed — its id,
//      its kind and its coordinate (one `spawn` draw) are all fixed at request time, per
//      §1.10's closing line. Only then is it routed.
//   3. routing: at `ABSOLUTE_ENEMY_CAP` it is discarded and counted; at the phase's
//      `engagedCap` — measured ONLY inside `ENGAGE_RADIUS` — it goes to the backlog; else
//      it becomes an enemy immediately.
//
// WHY THE REQUEST IS BUILT BEFORE IT IS ROUTED. It makes the `spawn` stream position and
// `nextEnemyId` functions of the request SCHEDULE alone — of the tick, never of how many
// enemies happen to be alive or where the player has walked. Deciding first and drawing
// second would couple the angle sequence to the live count, so two runs that diverge by a
// single kill would draw different angles from then on, and no fixture could hand-compute a
// coordinate. The cost is that a discarded request burns an id and a draw; ids only have to
// be unique, and the draw is the price of the property.
//
// WHY THE ENGAGED CAP IS MEASURED, NOT TRACKED. §1.10 caps "지휘 유닛 반경 ENGAGE_RADIUS
// 이내의 적", which changes every time the player moves, so it cannot be a counter — it is
// recomputed at every gate, including between two drains inside one tick, because a
// backlogged body can land inside the radius the moment it spawns (its coordinate was
// fixed when the player stood somewhere else).
//
// There is no re-draw and no terrain discard: §1.6 left the arena empty, so the only
// adjustment a coordinate gets is the arena clamp (§1.7).

import {
  ABSOLUTE_ENEMY_CAP,
  BACKLOG_DRAIN_PER_TICK,
  BACKLOG_SIZE,
  ENGAGE_RADIUS,
  PRESSURE_PHASES,
  SPAWN_RADIUS,
  type PressurePhase,
} from './constants'
import { clampToArena, commandUnitOf } from './movement'
import { createEnemy } from './state'
import { nextStreamRange } from './streams'
import type { BattleState, EnemyKind, SpawnRequest, Vec2 } from './types'

const TAU = Math.PI * 2

/**
 * The index of the pressure phase a tick falls in, or `-1` for a negative tick.
 *
 * `-1` is not a defensive flourish: `spawn.lastRequestTick` starts at `-1` ("no request
 * yet"), and the phase-local index resets whenever the phase of the last request differs
 * from the phase of this one. If tick `-1` resolved to phase 0 the counter would not reset
 * on the first request of a run and the melee:shooter cycle would start mid-stride.
 */
export function pressurePhaseIndexAt(tick: number): number {
  let index = -1
  for (let candidate = 0; candidate < PRESSURE_PHASES.length; candidate += 1) {
    if (tick >= PRESSURE_PHASES[candidate].fromTick) index = candidate
  }
  return index
}

export function pressurePhaseAt(tick: number): PressurePhase {
  const index = pressurePhaseIndexAt(tick)
  return PRESSURE_PHASES[index < 0 ? 0 : index]
}

/**
 * §1.10's "구간별 근접:사수 비율", resolved from the phase-local request index.
 *
 * A ratio of integer weights, walked as a cycle: 5:1 gives melee, melee, melee, melee,
 * melee, shooter and repeats. No draw is involved — §1.17 puts the `spawn` stream behind
 * the ANGLE only, and a random class would make the composition of a wave unpredictable in
 * exactly the dimension the pressure curve is supposed to control.
 */
export function spawnKindForPhaseIndex(phase: PressurePhase, index: number): EnemyKind {
  const [melee, shooter] = phase.meleeToShooter
  const cycle = melee + shooter
  return index % cycle < melee ? 'melee' : 'shooter'
}

function distanceBetween(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/**
 * §1.10: the live cap's population — standing enemies within `ENGAGE_RADIUS` of the
 * command unit.
 *
 * The elite counts. It is an enemy (§1.12 gives it a row in `enemies`), it occupies the
 * player's attention like one, and excluding it would let the pressure curve run at full
 * strength on top of the fight the run is actually about.
 */
export function engagedEnemyCount(state: BattleState): number {
  const command = commandUnitOf(state)
  if (!command) return 0
  let count = 0
  for (const enemy of state.enemies) {
    if (enemy.life !== 'standing') continue
    if (distanceBetween(command.position, enemy.position) > ENGAGE_RADIUS) continue
    count += 1
  }
  return count
}

/** §1.10: the absolute cap's population — every standing enemy, engaged or in transit. */
export function liveEnemyCount(state: BattleState): number {
  let count = 0
  for (const enemy of state.enemies) {
    if (enemy.life === 'standing') count += 1
  }
  return count
}

/**
 * One `spawn` draw for the angle, `SPAWN_RADIUS` for the distance, then the arena clamp.
 *
 * Exported because §1.12 places the elite by the same rule ("반경 SPAWN_RADIUS 위치에
 * 등장한다. 각도는 spawn draw 1회에 아레나 클램프만"), and two copies of it would be two
 * chances to disagree about the draw count.
 */
export function drawSpawnPosition(state: BattleState, center: Vec2): Vec2 {
  const angle = nextStreamRange(state.prng, 'spawn', 0, TAU)
  return clampToArena(center.x + Math.cos(angle) * SPAWN_RADIUS, center.y + Math.sin(angle) * SPAWN_RADIUS)
}

function spawnFromRequest(state: BattleState, request: SpawnRequest): void {
  // Requests are created and drained in ascending id order, so appending keeps
  // `state.enemies` sorted; `enemiesById` is still what every rule reads.
  state.enemies.push(createEnemy(request.id, request.kind, request.position))
}

/**
 * §1.10: "tick당 최대 BACKLOG_DRAIN_PER_TICK기 소비하며".
 *
 * Both caps are re-tested before every single drain. The absolute cap STOPS the drain
 * rather than discarding the entry: §1.10 gives the backlog exactly one discard rule
 * (oldest-first on overflow) and gives the absolute cap authority over "새 요청" only, so an
 * entry already in the queue waits for room instead of quietly evaporating.
 */
function drainBacklog(state: BattleState): void {
  const phase = pressurePhaseAt(state.combatTick)
  let drained = 0

  while (drained < BACKLOG_DRAIN_PER_TICK && state.spawn.backlog.length > 0) {
    if (liveEnemyCount(state) >= ABSOLUTE_ENEMY_CAP) return
    if (engagedEnemyCount(state) >= phase.engagedCap) return
    const request = state.spawn.backlog.shift()
    if (!request) return
    spawnFromRequest(state, request)
    drained += 1
  }
}

function intervalElapsed(state: BattleState, phase: PressurePhase): boolean {
  const last = state.spawn.lastRequestTick
  // `< 0` is the first request of a run: it goes out on the first tick that runs, so the
  // schedule is `0, interval, 2 x interval, ...` and a fixture can hand-count it.
  return last < 0 || state.combatTick - last >= phase.requestInterval
}

function buildRequest(state: BattleState, center: Vec2, phase: PressurePhase): SpawnRequest {
  const phaseIndex = pressurePhaseIndexAt(state.combatTick)
  const lastPhaseIndex = pressurePhaseIndexAt(state.spawn.lastRequestTick)
  // §1.10's ratio is per phase, so the index it walks is phase-local. Derived from the
  // phase of the LAST request rather than kept as a second field: one counter plus the
  // comparison is one thing to keep true, and the intervals (<= 12) are far shorter than
  // the phases (900), so "a whole phase with no request" is not a state the game reaches.
  const localIndex = phaseIndex === lastPhaseIndex ? state.spawn.requestsInPhase : 0

  const request: SpawnRequest = {
    id: state.spawn.nextEnemyId,
    kind: spawnKindForPhaseIndex(phase, localIndex),
    // §1.10: "backlog는 요청 tick에 확정한 좌표를 저장한다" — the draw happens HERE, at
    // request time, whatever becomes of the request afterwards.
    position: drawSpawnPosition(state, center),
    requestedTick: state.combatTick,
    sequence: state.spawn.nextRequestSequence,
  }

  state.spawn.nextEnemyId += 1
  state.spawn.nextRequestSequence += 1
  state.spawn.lastRequestTick = state.combatTick
  state.spawn.requestsInPhase = localIndex + 1

  return request
}

function pushToBacklog(state: BattleState, request: SpawnRequest): void {
  state.spawn.backlog.push(request)
  // §1.10: "총량이 BACKLOG_SIZE를 넘으면 오래된 것부터 폐기한다(수를 digest에 기록)."
  while (state.spawn.backlog.length > BACKLOG_SIZE) {
    state.spawn.backlog.shift()
    state.spawn.discardedByBacklogOverflow += 1
  }
}

/**
 * §1.16 step 2 — the whole of §1.10.
 *
 * Returns nothing on purpose: every observable outcome (the new rows, the backlog, both
 * discard counters) is in the state and therefore in the digest, which is where §1.10 asks
 * for the discard accounting to be.
 *
 * §1.12's elite arrival is NOT here. It is a separate body on a fixed tick with its own id,
 * and batch F composes it after this call so that the draw order inside tick 1800 is
 * something a reader can see written down.
 */
export function resolveStep2Spawn(state: BattleState): void {
  const command = commandUnitOf(state)
  // No command unit means the roster is gone and step 16 is about to end the run. Taking a
  // draw here would move the stream on a tick whose state is already terminal.
  if (!command) return

  drainBacklog(state)

  const phase = pressurePhaseAt(state.combatTick)
  if (!intervalElapsed(state, phase)) return

  const request = buildRequest(state, command.position, phase)

  if (liveEnemyCount(state) >= ABSOLUTE_ENEMY_CAP) {
    // §1.10: without this the engagement radius empties as the player retreats, spawning
    // accumulates without bound, and the whole accumulation arrives the moment they stop.
    state.spawn.discardedByAbsoluteCap += 1
    return
  }

  if (engagedEnemyCount(state) >= phase.engagedCap) {
    pushToBacklog(state, request)
    return
  }

  spawnFromRequest(state, request)
}
