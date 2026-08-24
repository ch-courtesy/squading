// Batch C fixtures, part 1: §1.10 spawning — the 스폰 step.
//
// Every tick, count and coordinate below is hand-computed from `constants.ts`, never read
// back off the implementation. The placeholder numbers this batch was written against:
//
//   SPAWN_RADIUS 13, ENGAGE_RADIUS 10, ABSOLUTE_ENEMY_CAP 60,
//   BACKLOG_SIZE 12, BACKLOG_DRAIN_PER_TICK 2,
//   phase 0 = { fromTick 0, engagedCap 14, requestInterval 12, melee:shooter 5:1 }
//   phase 1 = { fromTick 900, engagedCap 20, requestInterval 9, melee:shooter 3:1 }
//
// The assertions are written against the CONSTANTS rather than those literals wherever a
// tuning pass could legally move them, so that stage 2's sweep does not have to rewrite
// this file. Where a literal is load-bearing for the arithmetic (the 5:1 cycle) the test
// asserts the constant first, so a retune fails loudly instead of silently passing a
// different claim.

import { describe, expect, it } from 'vitest'

/** Every card at zero, the shape §1.13 v2 carries. */
function emptyCardLevels(): Record<CardId, number> {
  const levels = {} as Record<CardId, number>
  for (const card of CARD_POOL) levels[card] = 0
  return levels
}

import {
  COMMANDER_HP,
  MIN_PRESSURE_FRACTION,
  ROSTER_SIZE,
  SOLDIER_HP,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import {
  effectiveEngagedCapOf,
  effectiveRequestIntervalOf,
  engagedEnemyCount,
  enteringFriendlyCount,
  liveEnemyCount,
  pressureFractionOf,
  pressurePhaseAt,
  pressurePhaseIndexAt,
  resolveSpawnRequests,
  spawnKindForPhaseIndex,
} from '../../src/core/battle/spawn'
import { COMMANDER_ID, createEnemy, createInitialBattleState, findFriendly } from '../../src/core/battle/state'
import { CARD_POOL, type CardId } from '../../src/core/battle/constants'
import type { BattleState, EnemyKind, SpawnRequest, Vec2 } from '../../src/core/battle/types'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  absoluteEnemyCap: ABSOLUTE_ENEMY_CAP,
  backlogDrainPerTick: BACKLOG_DRAIN_PER_TICK,
  backlogSize: BACKLOG_SIZE,
  engageRadius: ENGAGE_RADIUS,
  pressurePhases: PRESSURE_PHASES,
  spawnRadius: SPAWN_RADIUS,
} = stageConfigOf(1)

function battle(): BattleState {
  const state = createInitialBattleState('seed-a')
  state.mode = 'running'
  return state
}

function commanderPosition(state: BattleState): Vec2 {
  const unit = findFriendly(state, COMMANDER_ID)
  if (!unit) throw new Error('fixture has no commander')
  return unit.position
}

function distance(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y)
}

/** `count` standing enemies at exactly `radius` from the command unit, along +x. */
function placeEnemies(state: BattleState, count: number, radius: number): void {
  const center = commanderPosition(state)
  for (let index = 0; index < count; index += 1) {
    state.enemies.push(createEnemy(state, 9000 + index, 'melee', { x: center.x + radius, y: center.y }))
  }
}

function request(sequence: number, kind: EnemyKind = 'melee'): SpawnRequest {
  return {
    id: 500 + sequence,
    kind,
    position: { x: 1 + sequence, y: 2 },
    requestedTick: 0,
    sequence,
  }
}

/**
 * A stage opened by `entering` bodies — campaign §1.1's relay, which is the only way a battle
 * begins with fewer than `ROSTER_SIZE`.
 *
 * Built through `CarriedSquad` rather than by deleting rows from a fresh roster, because the
 * question §1.10.1 asks is "how many walked in", and the relay is what makes that number anything
 * other than sixteen. Ids climb from `COMMANDER_ID`, which is also the carried command unit.
 */
function enteredWith(entering: number): BattleState {
  if (entering < 1 || entering > ROSTER_SIZE) {
    throw new Error(`fixture wanted an entering squad of ${entering}, which is not a squad`)
  }
  const members = Array.from({ length: entering }, (_, index) => {
    const id = COMMANDER_ID + index
    const maxHp = id === COMMANDER_ID ? COMMANDER_HP : SOLDIER_HP
    return { id, role: id === COMMANDER_ID ? ('commander' as const) : ('soldier' as const), nameIndex: index, hp: maxHp, maxHp }
  })
  const state = createInitialBattleState('seed-a', 1, {
    commandUnitId: COMMANDER_ID,
    members,
    cardLevels: emptyCardLevels(),
    owedUpgradeRounds: 0,
  })
  state.mode = 'running'
  // The whole premise of the derivation: a stage opens with everybody standing.
  expect(state.friendlies.filter((unit) => unit.life === 'standing')).toHaveLength(entering)
  return state
}

/**
 * Take `count` SOLDIERS off their feet, leaving the commander standing.
 *
 * The commander is left up on purpose: `resolveSpawnRequests` returns early with no command unit,
 * and §1.5's succession is a transition-step rule that these fixtures do not drive. Downing
 * soldiers is the smallest thing that moves the STANDING count — which, since the v14 fix, is the
 * count §1.10.1 must NOT be a function of.
 */
function fell(state: BattleState, count: number, life: 'downed' | 'dead' = 'downed'): void {
  let felled = 0
  for (const unit of state.friendlies) {
    if (felled >= count) break
    if (unit.id === COMMANDER_ID) continue
    // Only bodies that are still up: a second call must take a further `count` off their feet,
    // not re-fell the ones the first call already took.
    if (unit.life !== 'standing') continue
    unit.life = life
    unit.hp = 0
    felled += 1
  }
  if (felled !== count) throw new Error(`fixture wanted ${count} bodies down and found ${felled}`)
}

// ---------------------------------------------------------------------------
// §1.10.1 — pressure scales with the squad that ENTERED the stage (v14, fixed)
// ---------------------------------------------------------------------------
// Every number below is HAND-COMPUTED from `ROSTER_SIZE` 16, `MIN_PRESSURE_FRACTION` 0.65 and
// stage 1's phase 0 (`engagedCap` 14, `requestInterval` 9), and the four constants are asserted
// first so a retune fails loudly instead of silently passing a different claim:
//
//   entered 16 -> 16/16 = 1       -> cap ceil(14 x 1)      = 14, interval ceil(9 / 1)      =  9
//   entered 12 -> 12/16 = 0.75    -> cap ceil(14 x 0.75)   = 11, interval ceil(9 / 0.75)   = 12
//   entered 11 -> 11/16 = 0.6875  -> cap ceil(14 x 0.6875) = 10, interval ceil(9 / 0.6875) = 14
//   entered 10 -> 10/16 = 0.625   -> FLOORED to 0.65       -> the same 10 and 14
//   entered  8 ->  8/16 = 0.5     -> FLOORED to 0.65       -> the same 10 and 14
//   entered  2 ->  2/16 = 0.125   -> FLOORED to 0.65       -> the same 10 and 14
//
// The last row is the one that carries the floor: without it a two-body squad would face
// `ceil(14 x 0.125) = 2` enemies at `ceil(9 / 0.125) = 72` ticks apart, which is §1.10.1's trap
// written out — a stage that decelerates into a stalemate and a loss that stops being a cost.
//
// AND THE FIXTURE THAT MATTERS MOST IS THE ONE THAT ASSERTS NOTHING MOVES. The first form of v14
// read the LIVE standing count, and the measured result was I3 `0/8 -> 1~2/8` and I8 `0/8 ->
// 1~5/8` on every stage: the two policies that lose bodies fastest were handed a smaller board for
// losing them. So `fell()` appears below only inside tests that require the numbers NOT to change.

describe('§1.10.1 the pressure fraction', () => {
  it('is stated against the constants these fixtures hand-compute from', () => {
    expect(ROSTER_SIZE).toBe(16)
    expect(MIN_PRESSURE_FRACTION).toBe(0.65)
    expect(PRESSURE_PHASES[0].engagedCap).toBe(14)
    expect(PRESSURE_PHASES[0].requestInterval).toBe(9)
  })

  it('counts the bodies that OPENED the stage, commander included', () => {
    expect(enteringFriendlyCount(battle())).toBe(ROSTER_SIZE)
    expect(enteringFriendlyCount(enteredWith(12))).toBe(12)
    expect(enteringFriendlyCount(enteredWith(1))).toBe(1)
  })

  it('does not move when the squad is cut down mid-battle — the whole of the v14 fix', () => {
    // Casualties must buy nothing back. Downed and dead are checked separately so that a reader
    // of either life value cannot pass, and the commander is left standing so the run is still
    // one the spawn step would act on.
    const state = enteredWith(12)
    expect(enteringFriendlyCount(state)).toBe(12)
    expect(pressureFractionOf(state)).toBe(0.75)

    fell(state, 4, 'downed')
    expect(state.friendlies.filter((unit) => unit.life === 'standing')).toHaveLength(8)
    expect(enteringFriendlyCount(state)).toBe(12)
    expect(pressureFractionOf(state)).toBe(0.75)

    fell(state, 7, 'dead')
    expect(state.friendlies.filter((unit) => unit.life === 'standing')).toHaveLength(1)
    expect(enteringFriendlyCount(state)).toBe(12)
    expect(pressureFractionOf(state)).toBe(0.75)
  })

  it('tracks the entering squad above the floor and stops at it below', () => {
    expect(pressureFractionOf(battle())).toBe(1)
    expect(pressureFractionOf(enteredWith(12))).toBe(0.75)

    // 11/16 = 0.6875 is the last count above the floor; 10/16 = 0.625 is the first below it.
    expect(pressureFractionOf(enteredWith(11))).toBe(0.6875)
    expect(pressureFractionOf(enteredWith(10))).toBe(MIN_PRESSURE_FRACTION)

    // The floor, at the size where its absence would be loudest.
    const two = enteredWith(2)
    expect(pressureFractionOf(two)).toBe(MIN_PRESSURE_FRACTION)
    expect(pressureFractionOf(two)).toBeGreaterThan(2 / ROSTER_SIZE)
  })
})

describe('§1.10.1 the scaled cap and the scaled interval', () => {
  it('scales the engaged cap by the entering squad, floored', () => {
    const phase = PRESSURE_PHASES[0]

    expect(effectiveEngagedCapOf(battle(), phase)).toBe(14)
    expect(effectiveEngagedCapOf(enteredWith(12), phase)).toBe(11)
    expect(effectiveEngagedCapOf(enteredWith(11), phase)).toBe(10)
    expect(effectiveEngagedCapOf(enteredWith(8), phase)).toBe(10)

    // Without the floor this would be 2. The gap between 10 and 2 is the whole of the clause.
    const two = enteredWith(2)
    expect(effectiveEngagedCapOf(two, phase)).toBe(10)
    expect(effectiveEngagedCapOf(two, phase)).toBeGreaterThan(Math.ceil(phase.engagedCap * (2 / ROSTER_SIZE)))
  })

  it('divides the request interval by the same fraction, so a short squad waits longer', () => {
    const phase = PRESSURE_PHASES[0]

    expect(effectiveRequestIntervalOf(battle(), phase)).toBe(9)
    expect(effectiveRequestIntervalOf(enteredWith(12), phase)).toBe(12)
    expect(effectiveRequestIntervalOf(enteredWith(11), phase)).toBe(14)
    expect(effectiveRequestIntervalOf(enteredWith(8), phase)).toBe(14)

    // Without the floor this would be 72 — one request every two and a half seconds.
    const two = enteredWith(2)
    expect(effectiveRequestIntervalOf(two, phase)).toBe(14)
    expect(effectiveRequestIntervalOf(two, phase)).toBeLessThan(
      Math.ceil(phase.requestInterval / (2 / ROSTER_SIZE)),
    )
  })

  it('holds both numbers fixed for the whole battle, whatever happens to the squad', () => {
    // §1.10.1: "한 판 안에서 압력은 불변이다." Stated as the property rather than as two more
    // hand-computed rows, because the property is what the first form of v14 did not have.
    const phase = PRESSURE_PHASES[0]
    const state = enteredWith(14)
    const cap = effectiveEngagedCapOf(state, phase)
    const interval = effectiveRequestIntervalOf(state, phase)

    for (let down = 0; down < 13; down += 1) {
      fell(state, 1)
      expect(effectiveEngagedCapOf(state, phase)).toBe(cap)
      expect(effectiveRequestIntervalOf(state, phase)).toBe(interval)
    }
  })

  it('never lets a smaller squad meet a BIGGER board, whatever the entering count', () => {
    // §1.10.1: "비율은 1을 넘지 않는다." Every entering size from the full roster down to one body,
    // against the two numbers a full squad meets. A rule that inverted anywhere in that range
    // would be paying the campaign for arriving short.
    const phase = PRESSURE_PHASES[0]
    for (let entering = 1; entering <= ROSTER_SIZE; entering += 1) {
      const state = enteredWith(entering)
      expect(effectiveEngagedCapOf(state, phase)).toBeLessThanOrEqual(phase.engagedCap)
      expect(effectiveRequestIntervalOf(state, phase)).toBeGreaterThanOrEqual(phase.requestInterval)
    }
  })
})

describe('§1.10.1 the rule as the spawn step actually applies it', () => {
  it('backlogs at the SCALED cap, so a short squad fills the board four bodies sooner', () => {
    const phase = PRESSURE_PHASES[0]
    const state = enteredWith(8)

    // Ten bodies inside the radius: below the absolute 14 and AT the scaled 10.
    placeEnemies(state, 10, ENGAGE_RADIUS - 1)
    expect(engagedEnemyCount(state)).toBe(10)
    expect(engagedEnemyCount(state)).toBeLessThan(phase.engagedCap)

    resolveSpawnRequests(state)

    // Under the absolute cap this request would have spawned. It waits instead.
    expect(state.enemies).toHaveLength(10)
    expect(state.spawn.backlog).toHaveLength(1)
  })

  it('holds the backlog drain at the SCALED cap too, not only the tick’s own request', () => {
    const state = enteredWith(8)
    placeEnemies(state, 10, ENGAGE_RADIUS - 1)
    state.spawn.backlog = [request(0), request(1)]
    state.spawn.nextRequestSequence = 2
    state.spawn.lastRequestTick = 0
    state.combatTick = 1 // not a request tick at any interval this fixture can produce

    resolveSpawnRequests(state)

    expect(state.enemies).toHaveLength(10)
    expect(state.spawn.backlog.map((entry) => entry.sequence)).toEqual([0, 1])
  })

  it('waits the SCALED interval between requests', () => {
    const state = enteredWith(8)
    state.spawn.lastRequestTick = 0
    state.spawn.requestsInPhase = 1
    state.spawn.nextRequestSequence = 1

    // Tick 9 is the FULL squad's interval, and nothing happens on it.
    state.combatTick = PRESSURE_PHASES[0].requestInterval
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(0)
    expect(state.spawn.lastRequestTick).toBe(0)

    // Tick 13 is still short of 14.
    state.combatTick = 13
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(0)

    state.combatTick = 14
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(1)
    expect(state.spawn.lastRequestTick).toBe(14)
  })

  it('keeps the SAME interval after the squad is cut down — no request is bought by dying', () => {
    // The defect, driven through the step rather than through the helper: a full sixteen enters,
    // twelve go down, and the schedule stays on the sixteen-body 9. Under the live count the
    // interval would have become 14 and the request below would not have gone out.
    const state = battle()
    state.spawn.lastRequestTick = 0
    state.spawn.requestsInPhase = 1
    state.spawn.nextRequestSequence = 1
    fell(state, 12)

    state.combatTick = 8
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(0)

    state.combatTick = PRESSURE_PHASES[0].requestInterval
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(1)
    expect(state.spawn.lastRequestTick).toBe(PRESSURE_PHASES[0].requestInterval)
  })

  it('leaves the ABSOLUTE cap alone — §1.10 gives it a different job', () => {
    // §1.10's absolute cap exists to stop an unbounded pile accumulating while a player retreats,
    // which has nothing to do with how many friendlies walked in. A scaled absolute cap would
    // also make a short squad unable to hold the bodies already in transit toward it.
    const state = enteredWith(2)
    placeEnemies(state, ABSOLUTE_ENEMY_CAP, ENGAGE_RADIUS + 1)
    expect(liveEnemyCount(state)).toBe(ABSOLUTE_ENEMY_CAP)

    resolveSpawnRequests(state)

    expect(state.spawn.discardedByAbsoluteCap).toBe(1)
    expect(state.enemies).toHaveLength(ABSOLUTE_ENEMY_CAP)
  })
})

describe('§1.10 the request schedule and the phase-local split', () => {
  it('places the phase table on tick 0 and finds the phase for any tick', () => {
    // The curve is a stage number now (§2.2), so the reader takes the state it belongs to.
    const state = createInitialBattleState('seed-a')
    expect(PRESSURE_PHASES[0].fromTick).toBe(0)
    expect(pressurePhaseIndexAt(state, 0)).toBe(0)
    expect(pressurePhaseIndexAt(state, PRESSURE_PHASES[1].fromTick - 1)).toBe(0)
    expect(pressurePhaseIndexAt(state, PRESSURE_PHASES[1].fromTick)).toBe(1)
    expect(pressurePhaseIndexAt(state, PRESSURE_PHASES[2].fromTick)).toBe(2)
    expect(pressurePhaseIndexAt(state, 9999)).toBe(PRESSURE_PHASES.length - 1)
    // -1 is `lastRequestTick`'s "no request yet" value: it must not resolve to phase 0,
    // or the phase-local index would fail to reset on the very first request.
    expect(pressurePhaseIndexAt(state, -1)).toBe(-1)
  })

  it('splits melee and shooter by the phase-local index, not by a draw', () => {
    // The 5:1 cycle is what the arithmetic below counts on.
    expect([...PRESSURE_PHASES[0].meleeToShooter]).toEqual([5, 1])
    const phase = pressurePhaseAt(createInitialBattleState('seed-a'), 0)
    const kinds = Array.from({ length: 13 }, (_, index) => spawnKindForPhaseIndex(phase, index))
    expect(kinds).toEqual([
      'melee', 'melee', 'melee', 'melee', 'melee', 'shooter',
      'melee', 'melee', 'melee', 'melee', 'melee', 'shooter',
      'melee',
    ])
  })

  it('requests on tick 0 and then once per phase interval', () => {
    const state = battle()
    const interval = PRESSURE_PHASES[0].requestInterval

    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(1)
    expect(state.spawn.lastRequestTick).toBe(0)

    for (let tick = 1; tick < interval; tick += 1) {
      state.combatTick = tick
      resolveSpawnRequests(state)
      expect(state.enemies).toHaveLength(1)
    }

    state.combatTick = interval
    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(2)
    expect(state.spawn.lastRequestTick).toBe(interval)
  })

  it('spawns on the circle of SPAWN_RADIUS around the command unit at request time', () => {
    const state = battle()
    const center = { ...commanderPosition(state) }
    resolveSpawnRequests(state)
    // (28,16) +- 13 stays inside 0..56 x 0..32, so the arena clamp cannot fire here.
    expect(distance(center, state.enemies[0].position)).toBeCloseTo(SPAWN_RADIUS, 9)
    expect(state.enemies[0].id).toBe(101)
    expect(state.spawn.nextEnemyId).toBe(102)
  })

  it('resets the phase-local index when the phase changes', () => {
    const state = battle()
    const boundary = PRESSURE_PHASES[1].fromTick

    // The last request of phase 0, 12 ticks before the boundary.
    state.combatTick = boundary - 12
    resolveSpawnRequests(state)
    state.spawn.requestsInPhase = 5 // index 5 in phase 0 would be a shooter next
    state.enemies = []

    state.combatTick = boundary
    resolveSpawnRequests(state)
    // First request of phase 1 -> phase-local index 0 -> melee, and the counter restarts.
    expect(state.enemies).toHaveLength(1)
    expect(state.enemies[0].kind).toBe('melee')
    expect(state.spawn.requestsInPhase).toBe(1)
  })
})

describe('§1.10 the engagement-radius cap', () => {
  it('counts only enemies inside ENGAGE_RADIUS, so a retreating player does not stall spawning', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    // Six more bodies than the cap allows, all of them left behind outside the radius.
    placeEnemies(state, cap + 6, ENGAGE_RADIUS + 1)
    expect(engagedEnemyCount(state)).toBe(0)
    expect(liveEnemyCount(state)).toBe(cap + 6)

    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(cap + 7)
    expect(state.spawn.backlog).toHaveLength(0)
  })

  it('backlogs a request when the cap inside the radius is full', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    placeEnemies(state, cap, ENGAGE_RADIUS - 1)
    expect(engagedEnemyCount(state)).toBe(cap)

    resolveSpawnRequests(state)
    expect(state.enemies).toHaveLength(cap)
    expect(state.spawn.backlog).toHaveLength(1)
    expect(state.spawn.backlog[0].requestedTick).toBe(0)
    expect(state.spawn.discardedByAbsoluteCap).toBe(0)
    expect(state.spawn.discardedByBacklogOverflow).toBe(0)
  })

  it('counts the elite towards the engaged cap like any other enemy', () => {
    // §1.10: "정예도 두 상한에 함께 센다." The implementation filters on `life` and never looks
    // at `kind`, which is right — and which is exactly why this needs a fixture. Without one, a
    // plausible-looking `if (enemy.kind === 'elite') continue` in batch F passes the whole suite.
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    placeEnemies(state, cap - 1, ENGAGE_RADIUS - 1)
    const center = commanderPosition(state)
    state.enemies.push(createEnemy(state, 1000, 'elite', { x: center.x + 1, y: center.y }))

    expect(engagedEnemyCount(state)).toBe(cap)

    resolveSpawnRequests(state)

    // The elite is the body that filled the last place, so the request has to wait.
    expect(state.spawn.backlog).toHaveLength(1)
    expect(state.enemies).toHaveLength(cap)
  })

  it('counts the elite towards the absolute cap like any other enemy', () => {
    const state = battle()
    placeEnemies(state, ABSOLUTE_ENEMY_CAP - 1, ENGAGE_RADIUS + 1)
    const center = commanderPosition(state)
    state.enemies.push(createEnemy(state, 1000, 'elite', { x: center.x + ENGAGE_RADIUS + 1, y: center.y }))

    expect(liveEnemyCount(state)).toBe(ABSOLUTE_ENEMY_CAP)

    resolveSpawnRequests(state)

    expect(state.spawn.discardedByAbsoluteCap).toBe(1)
    expect(state.enemies).toHaveLength(ABSOLUTE_ENEMY_CAP)
    expect(state.spawn.backlog).toHaveLength(0)
  })

  it('does not count dead bodies towards either cap', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    placeEnemies(state, cap, ENGAGE_RADIUS - 1)
    for (const enemy of state.enemies) {
      enemy.life = 'dead'
      enemy.hp = 0
    }
    expect(engagedEnemyCount(state)).toBe(0)
    resolveSpawnRequests(state)
    expect(state.spawn.backlog).toHaveLength(0)
  })
})

describe('§1.10 the absolute cap', () => {
  it('discards the request and records it when the whole arena is at ABSOLUTE_ENEMY_CAP', () => {
    const state = battle()
    // Outside the engagement radius: the engaged cap is NOT what stops this one.
    placeEnemies(state, ABSOLUTE_ENEMY_CAP, ENGAGE_RADIUS + 1)
    const streamBefore = state.prng.spawn

    resolveSpawnRequests(state)

    expect(state.enemies).toHaveLength(ABSOLUTE_ENEMY_CAP)
    expect(state.spawn.backlog).toHaveLength(0)
    expect(state.spawn.discardedByAbsoluteCap).toBe(1)
    // The coordinate is fixed at request time (§1.10), so the request — and its single
    // `spawn` draw — exists before the cap can discard it. That makes the angle sequence a
    // function of the request SCHEDULE alone, never of how many enemies happen to be alive.
    expect(state.prng.spawn).not.toBe(streamBefore)
    expect(state.spawn.nextEnemyId).toBe(102)
    expect(state.spawn.lastRequestTick).toBe(0)
  })

  it('stops the backlog drain at the absolute cap instead of discarding the backlog', () => {
    const state = battle()
    placeEnemies(state, ABSOLUTE_ENEMY_CAP, ENGAGE_RADIUS + 1)
    state.spawn.backlog = [request(0), request(1)]
    state.spawn.nextRequestSequence = 2
    state.spawn.lastRequestTick = 0
    state.combatTick = 1

    resolveSpawnRequests(state)

    expect(state.enemies).toHaveLength(ABSOLUTE_ENEMY_CAP)
    expect(state.spawn.backlog.map((entry) => entry.sequence)).toEqual([0, 1])
    expect(state.spawn.discardedByBacklogOverflow).toBe(0)
  })
})

describe('§1.10 the backlog', () => {
  it('spawns a backlogged request at the coordinate fixed when it was requested', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    const requestCenter = { ...commanderPosition(state) }
    placeEnemies(state, cap, ENGAGE_RADIUS - 1)

    resolveSpawnRequests(state)
    expect(state.spawn.backlog).toHaveLength(1)
    const fixed = { ...state.spawn.backlog[0].position }
    expect(distance(requestCenter, fixed)).toBeCloseTo(SPAWN_RADIUS, 9)

    // The player kills the pack and walks a long way off before the backlog drains.
    for (const enemy of state.enemies) {
      enemy.life = 'dead'
      enemy.hp = 0
    }
    const commander = findFriendly(state, COMMANDER_ID)!
    commander.position = { x: 10, y: 10 }
    state.combatTick = 5 // not a request tick: interval 12, last request tick 0

    resolveSpawnRequests(state)

    const spawned = state.enemies[state.enemies.length - 1]
    expect(spawned.position).toEqual(fixed)
    expect(distance(requestCenter, spawned.position)).toBeCloseTo(SPAWN_RADIUS, 9)
    // The whole point: NOT re-derived from where the command unit now stands.
    expect(distance({ x: 10, y: 10 }, spawned.position)).not.toBeCloseTo(SPAWN_RADIUS, 3)
    expect(state.spawn.backlog).toHaveLength(0)
  })

  it('drains at most BACKLOG_DRAIN_PER_TICK per tick, oldest first', () => {
    const state = battle()
    state.spawn.backlog = [request(0), request(1), request(2), request(3), request(4)]
    state.spawn.nextRequestSequence = 5
    state.spawn.lastRequestTick = 0
    state.combatTick = 5 // not a request tick

    resolveSpawnRequests(state)

    expect(state.enemies).toHaveLength(BACKLOG_DRAIN_PER_TICK)
    expect(state.enemies.map((enemy) => enemy.id)).toEqual(
      Array.from({ length: BACKLOG_DRAIN_PER_TICK }, (_, index) => request(index).id),
    )
    expect(state.spawn.backlog).toHaveLength(5 - BACKLOG_DRAIN_PER_TICK)
    expect(state.spawn.backlog[0].sequence).toBe(BACKLOG_DRAIN_PER_TICK)
  })

  it('discards the oldest entry and records it when the backlog overflows', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    placeEnemies(state, cap, ENGAGE_RADIUS - 1)
    state.spawn.backlog = Array.from({ length: BACKLOG_SIZE }, (_, index) => request(index))
    state.spawn.nextRequestSequence = BACKLOG_SIZE

    resolveSpawnRequests(state)

    expect(state.spawn.backlog).toHaveLength(BACKLOG_SIZE)
    // Oldest (sequence 0) gone, the new request (sequence BACKLOG_SIZE) at the back.
    expect(state.spawn.backlog[0].sequence).toBe(1)
    expect(state.spawn.backlog[BACKLOG_SIZE - 1].sequence).toBe(BACKLOG_SIZE)
    expect(state.spawn.discardedByBacklogOverflow).toBe(1)
  })

  it('drains before it decides where a new request goes, so the queue stays in order', () => {
    const cap = PRESSURE_PHASES[0].engagedCap
    const state = battle()
    // One free place inside the radius and two entries waiting: the drain takes it, and
    // the tick's own request is the one that has to wait.
    placeEnemies(state, cap - 1, ENGAGE_RADIUS - 1)
    state.spawn.backlog = [request(0), request(1)]
    state.spawn.nextRequestSequence = 2
    // The backlogged coordinates are inside the radius, so a drained body counts at once.
    state.spawn.backlog[0].position = { ...commanderPosition(state) }
    state.spawn.backlog[1].position = { ...commanderPosition(state) }

    resolveSpawnRequests(state)

    expect(state.enemies).toHaveLength(cap)
    expect(state.enemies[state.enemies.length - 1].id).toBe(request(0).id)
    expect(state.spawn.backlog.map((entry) => entry.sequence)).toEqual([1, 2])
  })
})
