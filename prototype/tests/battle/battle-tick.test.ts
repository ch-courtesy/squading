// Batch E fixtures, part 2: §1.16's order as one reducer, and §1.1's clock gate.
//
// Batches A–D built sixteen rules as sixteen functions and nothing composed them. Composition
// is not glue: §1.16's table names four things that no type in this project enforces, and each
// one is a rule that would go quietly missing.
//
//   * the 스폰 row must be `resolveEnemyArrivals` — the composer that also lands the elite —
//     and not `resolveSpawnRequests`, which is what a reader looking for "the spawn step" finds.
//   * the 추종·적 이동 row must pass `advanceAllEnemyMovement`, which adds §1.12's approach;
//     `advanceEnemyMovement` alone type-checks and leaves the elite standing where it landed.
//   * the 피해 적용 row takes the three attack sources CONCATENATED IN §1.16's ORDER. Any
//     permutation type-checks, and the difference shows up as who dies first.
//   * the 처치 집계 and 승패 판정 rows both read the 전이 row's RETURN VALUE. Calling
//     `resolveTransitions` a second time for the verdict also type-checks, and reports no
//     deaths, so the run never ends.
//
// The whole-battle run below fails on the first three, and the batch E report records the
// mutation output that proves each one bites. THE FOURTH IS CONDITIONAL AND THAT CONDITION IS
// WRITTEN DOWN TWICE. A second `resolveTransitions()` reports no deaths because the bodies are
// already dead by then, so the only tick that can catch it is one where the ELITE dies — and §5
// stage 2 has to tune `tactical-no-input` into a defeat, where no such tick exists. So the whole
// battle asserts the precondition of its own detector (it fails, rather than going quiet, the
// day the verdict flips), and a separate fixture kills the elite by hand so that row 16 keeps a
// detector which does not depend on the VERDICT. It is NOT balance-free: it drives the run to
// the elite's arrival and throws if the run decides first. Margin measured on all three seeds:
// 16/16 standing, 0 downed, at tick 1801. Breaking it takes a wipe of the whole squad before
// `ELITE_SPAWN_TICK`, and it would throw rather than pass quietly.

import { describe, expect, it } from 'vitest'

import {
  COMBAT_TICK_LIMIT,
  ELITE_APPROACH_RANGE,
  ELITE_SPAWN_TICK,
  RESCUE_RANGE,
} from '../../src/core/battle/constants'
import { digestBattleState } from '../../src/core/battle/digest'
import { BattleInputQueue, commandBatch } from '../../src/core/battle/input'
import type { BattleCommand } from '../../src/core/battle/input'
import { COMMANDER_ID, createInitialBattleState, findFriendly } from '../../src/core/battle/state'
import { advanceBattleTick } from '../../src/core/battle/tick'
import type { ResolvedTick } from '../../src/core/battle/tick'
import type { BattleMode, BattleState, DamageCause } from '../../src/core/battle/types'

const NO_COMMANDS: BattleCommand[] = []

/** The three producers of §1.16's damage list, as the rank they must appear in. */
const SOURCE_RANK: Readonly<Record<DamageCause, number>> = {
  'friendly-attack': 1,
  'melee-contact': 2,
  'shooter-shot': 2,
  'elite-blast': 3,
}

function running(seed = 'seed-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

/**
 * `state.mode` without the narrowing a `while (state.mode === ...)` leaves behind. The loop
 * below asks what the mode became AFTER a tick, which is exactly the question its own
 * condition has already convinced the compiler it knows the answer to.
 */
function modeOf(state: BattleState): BattleMode {
  return state.mode
}

function unit(state: BattleState, id: number) {
  const found = findFriendly(state, id)
  if (!found) throw new Error(`fixture has no friendly ${id}`)
  return found
}

function resolved(result: ReturnType<typeof advanceBattleTick>): ResolvedTick {
  if (!result.ran) throw new Error(`the tick did not run: mode ${result.mode}`)
  return result
}

describe('§1.1 the clock does not advance outside `running`', () => {
  it('refuses to run before the battle is started', () => {
    const state = createInitialBattleState('seed-a')

    const result = advanceBattleTick(state, commandBatch(NO_COMMANDS))

    expect(result.ran).toBe(false)
    expect(state.combatTick).toBe(0)
  })

  it('runs exactly one tick while running', () => {
    const state = running()

    const result = advanceBattleTick(state, commandBatch(NO_COMMANDS))

    expect(result.ran).toBe(true)
    expect(resolved(result).tick).toBe(0)
    expect(state.combatTick).toBe(1)
  })

  it.each(['paused', 'won', 'lost'] as const)('advances nothing while %s', (mode) => {
    const state = running()
    state.mode = mode
    const before = digestBattleState(state)

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(advanceBattleTick(state, commandBatch(NO_COMMANDS)).ran).toBe(false)
    }

    expect(state.combatTick).toBe(0)
    expect(digestBattleState(state)).toBe(before)
  })

  it('advances nothing while a card is waiting, and resumes on the choice', () => {
    // The failure batch D flagged as one a per-rule test cannot catch: every rule below is
    // correct on its own, and the run still burns its 90 seconds behind a card screen — or,
    // with the gate on the wrong side of the input application, chooses a card and skips the
    // tick it belonged to. Both need a LOOP to show up.
    const state = running()
    while (state.mode === 'running' && state.combatTick < COMBAT_TICK_LIMIT) {
      advanceBattleTick(state, commandBatch(NO_COMMANDS))
    }
    expect(state.mode).toBe('awaiting-upgrade')

    const stalled = digestBattleState(state)
    const stalledTick = state.combatTick
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect(advanceBattleTick(state, commandBatch(NO_COMMANDS)).ran).toBe(false)
    }
    expect(state.combatTick).toBe(stalledTick)
    expect(digestBattleState(state)).toBe(stalled)

    // The choice arrives on the same call that runs the tick it unblocked — the input
    // application is inside the reducer, ahead of the gate, so a resumed battle loses no tick.
    const result = advanceBattleTick(state, commandBatch([{ kind: 'choose-upgrade', slot: 1 }]))
    expect(result.ran).toBe(true)
    expect(state.combatTick).toBe(stalledTick + 1)
    expect(state.upgrades.rounds[0].chosen).toBe(state.upgrades.rounds[0].offered[0])
  })

  it('applies input even on a tick it refuses to run, so a pause can be lifted', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'Escape')
    expect(advanceBattleTick(state, queue.drain()).ran).toBe(false)
    expect(state.mode).toBe('paused')
    expect(state.combatTick).toBe(0)

    queue.keyDown(state, 'Escape')
    expect(advanceBattleTick(state, queue.drain()).ran).toBe(true)
    expect(state.combatTick).toBe(1)
  })
})

describe('§1.11 / §1.15 the reducer wires the movement keydown through', () => {
  function withDownedNeighbour(): BattleState {
    const state = running()
    const commander = unit(state, COMMANDER_ID)
    const casualty = unit(state, 2)
    casualty.life = 'downed'
    casualty.hp = 0
    casualty.position = { x: commander.position.x + RESCUE_RANGE / 2, y: commander.position.y }
    return state
  }

  it('establishes the lock on held Space with a zero axis', () => {
    const state = withDownedNeighbour()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'Space')
    advanceBattleTick(state, queue.drain())

    expect(state.rescue.active).toBe(true)
    expect(state.rescue.targetId).toBe(2)
  })

  it('keeps the lock across ticks in which nothing is pressed', () => {
    const state = withDownedNeighbour()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'Space')
    advanceBattleTick(state, queue.drain())
    advanceBattleTick(state, queue.drain())
    advanceBattleTick(state, queue.drain())

    expect(state.rescue.active).toBe(true)
    expect(state.rescue.progress).toBe(3)
  })

  it('cancels on a movement keydown and returns the progress to zero', () => {
    const state = withDownedNeighbour()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'Space')
    advanceBattleTick(state, queue.drain())
    advanceBattleTick(state, queue.drain())
    expect(state.rescue.progress).toBe(2)

    queue.keyDown(state, 'KeyW')
    advanceBattleTick(state, queue.drain())

    // §1.11's cancel is the EVENT, and the reducer is the only thing that can hand it over:
    // a loop that dropped the events argument would still compile if the argument had a
    // default, and this rescue would run to completion under a key the player pressed.
    expect(state.rescue.active).toBe(false)
    expect(state.rescue.progress).toBe(0)
  })

  it('does not cancel on the held axis of the ticks after that keydown', () => {
    const state = withDownedNeighbour()
    const queue = new BattleInputQueue()

    // The key goes down first, the rescue is attempted after: the axis is non-zero, so the
    // lock never establishes at all. That is §1.11's establishment rule, not its cancel.
    queue.keyDown(state, 'KeyW')
    queue.keyDown(state, 'Space')
    advanceBattleTick(state, queue.drain())
    expect(state.rescue.active).toBe(false)

    // Release the key. The axis is 0 again and no keydown happens, so the lock establishes on
    // that tick — and, because §1.16 puts 구조 진행 later in the same tick, it also earns its
    // first point of progress there — and then survives the following tick of held Space.
    queue.keyUp(state, 'KeyW')
    advanceBattleTick(state, queue.drain())
    advanceBattleTick(state, queue.drain())

    expect(state.rescue.active).toBe(true)
    expect(state.rescue.progress).toBe(2)
  })
})

/**
 * A TYPE-LEVEL fixture, and the only kind that can hold this rule.
 *
 * At 599de17 `advanceBattleTick(state, commandBatch(queue.drain()))` compiled clean and
 * reproduced the ghost axis exactly — measured `{ x: 1, y: -1 }` from `KeyW → Escape → Escape →
 * KeyD`. The state half of §1.15's pause release ran and the device half did not, because
 * `commandBatch`'s `applied` is a no-op while the queue behind the array still held `KeyW`.
 * Rejecting `queue.drain()` as a plain array was not enough: the compiler's own error pointed
 * at the one exported helper that would make it compile again.
 *
 * WHAT ASSERTS THIS IS `tsc`, NOT VITEST. Vitest never typechecks, so no runtime fixture can
 * fail on a line that no longer compiles. The assertion is the `@ts-expect-error` below, and the
 * thing that runs it is `tsc --noEmit` — the first command in `npm run build`. If the line ever
 * compiles again, the directive goes unused and the build fails on TS2578.
 *
 * Never called. It exists to be compiled.
 */
export function theRewrapTheQueueMustNotAccept(state: BattleState, queue: BattleInputQueue): void {
  // @ts-expect-error `queue.drain()` hands over the source — the commands AND the device-half
  // callback — and `commandBatch` takes an array. There is nothing left to re-wrap.
  advanceBattleTick(state, commandBatch(queue.drain()))
}

describe('§1.15 the reducer path releases a pause in full, device half included', () => {
  it('does not carry a held key across a pause when a queue drives the reducer directly', () => {
    // The facade is not the only sanctioned driver: `advanceBattleTick` and `BattleInputQueue`
    // are both public, and this pairing is the cheapest harness a batch F sweep can build. Until
    // the device half moved out of the facade, this path kept `KeyW` in the queue's held set
    // across the pause and the next press came out as `{1,-1}`.
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'KeyW')
    advanceBattleTick(state, queue.drain())
    expect(state.input.move).toEqual({ x: 0, y: -1 })

    queue.keyDown(state, 'Escape')
    expect(advanceBattleTick(state, queue.drain()).ran).toBe(false)
    expect(state.mode).toBe('paused')
    expect(state.input.move).toEqual({ x: 0, y: 0 })

    queue.keyDown(state, 'Escape')
    expect(advanceBattleTick(state, queue.drain()).ran).toBe(true)
    expect(state.mode).toBe('running')

    queue.keyDown(state, 'KeyD')
    advanceBattleTick(state, queue.drain())

    expect(state.input.move).toEqual({ x: 1, y: 0 })
  })

  it('refuses a forbidden command that reaches the reducer without a queue', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'Escape')
    advanceBattleTick(state, queue.drain())
    expect(state.mode).toBe('paused')

    const skipped = advanceBattleTick(
      state,
      commandBatch([{ kind: 'set-move', move: { x: 1, y: 0 }, keydown: true }]),
    )

    expect(skipped.ran).toBe(false)
    expect(skipped.input.discarded).toBe(1)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })
})

describe('§1.16 the verdict reads the transition row that actually ran', () => {
  it('claims the win on the tick the elite dies, without asking the state a second time', () => {
    // HAZARD 4b, on a fixture that does not depend on which VERDICT the balance sweep tunes the
    // run into. The whole-battle fixture below detects the second `resolveTransitions()` only
    // through an elite death, and §5 stage 2 has to make `tactical-no-input` lose. This one
    // kills the elite by hand, so row 16 keeps a detector after that.
    //
    // What it DOES depend on is the loop below reaching the arrival at all — measured margin,
    // all three seeds: 16/16 standing and 0 downed at tick 1801. A tune that ends the run before
    // `ELITE_SPAWN_TICK` breaks this fixture, and the `throw` two lines down is how it says so.
    const state = running('seed-a')
    while (state.elite.enemyId === null) {
      if (state.mode !== 'running' && state.mode !== 'awaiting-upgrade') {
        throw new Error(`the run ended at ${state.combatTick} before the elite arrived`)
      }
      if (state.combatTick > ELITE_SPAWN_TICK + 1) throw new Error('the elite never arrived')
      const commands: BattleCommand[] =
        state.mode === 'awaiting-upgrade' ? [{ kind: 'choose-upgrade', slot: 1 }] : NO_COMMANDS
      advanceBattleTick(state, commandBatch(commands))
    }

    const elite = state.enemies.find((enemy) => enemy.id === state.elite.enemyId)
    if (!elite) throw new Error('the elite id names no enemy')
    elite.hp = 0

    const tick = resolved(advanceBattleTick(state, commandBatch(NO_COMMANDS)))

    // A second `resolveTransitions()` for the verdict type-checks and reports no deaths at all —
    // the elite is already `dead` by then — so the run would carry on past its own victory.
    expect(tick.transitions.enemyDeaths.some((death) => death.kind === 'elite')).toBe(true)
    expect(state.mode).toBe('won')
    expect(state.result).toBe('won')
  })
})

/**
 * §4.1's `tactical-no-input`: nothing but the card choice, which is the one policy with no
 * player model in it. Returns everything the four hazards are judged on.
 */
function playToVerdict(seed: string) {
  const state = running(seed)

  const orderViolations: string[] = []
  const killMismatches: string[] = []
  const unclaimedWins: string[] = []
  const eliteDeathTicks: number[] = []
  const sourcesSeen = new Set<number>()
  let ticksOrderingFriendlyAgainstEnemy = 0
  let ticksOrderingBlastAgainstAnother = 0
  let ticksWithEliteAtApproachRange = 0
  let eliteDisplacement = 0

  while (state.mode === 'running' || state.mode === 'awaiting-upgrade') {
    if (state.combatTick > COMBAT_TICK_LIMIT) throw new Error('the run did not decide')

    const commands: BattleCommand[] =
      state.mode === 'awaiting-upgrade' ? [{ kind: 'choose-upgrade', slot: 1 }] : NO_COMMANDS
    const killsBefore = state.stats.kills
    const tick = resolved(advanceBattleTick(state, commandBatch(commands)))

    // HAZARD 3 — the damage list is the three sources concatenated in §1.16's order.
    let rank = 0
    const seen = new Set<number>()
    for (const event of tick.damageEvents) {
      const eventRank = SOURCE_RANK[event.cause]
      if (eventRank < rank) {
        orderViolations.push(`${tick.tick}: ${event.cause} after rank ${rank}`)
      }
      rank = Math.max(rank, eventRank)
      seen.add(eventRank)
      sourcesSeen.add(eventRank)
    }
    // An ordering check is vacuous on a tick with one source in it. These two count the ticks
    // on which it was not: one where the two attack passes met, one where the elite's impact
    // met either of them.
    if (seen.has(1) && seen.has(2)) ticksOrderingFriendlyAgainstEnemy += 1
    if (seen.has(3) && seen.size > 1) ticksOrderingBlastAgainstAnother += 1

    // HAZARD 4a — the kill accounting counts THIS tick's transitions, minus the elite.
    const nonEliteDeaths = tick.transitions.enemyDeaths.filter((death) => death.kind !== 'elite')
    if (
      tick.accounting.killsCounted !== nonEliteDeaths.length ||
      state.stats.kills - killsBefore !== nonEliteDeaths.length
    ) {
      killMismatches.push(`${tick.tick}: ${tick.accounting.killsCounted} vs ${nonEliteDeaths.length}`)
    }

    // HAZARD 4b — the verdict reads the same transitions: an elite death IS the win, this tick.
    if (tick.transitions.enemyDeaths.some((death) => death.kind === 'elite')) {
      eliteDeathTicks.push(tick.tick)
      if (modeOf(state) !== 'won') unclaimedWins.push(`${tick.tick}: mode ${modeOf(state)}`)
    }

    // HAZARD 2 — the elite is moved by the movement row, and stops at its approach range.
    const elite = state.enemies.find((enemy) => enemy.kind === 'elite')
    const command = findFriendly(state, state.commandUnitId)
    if (elite && command && elite.life === 'standing') {
      eliteDisplacement += elite.lastDisplacement
      const distance = Math.hypot(
        elite.position.x - command.position.x,
        elite.position.y - command.position.y,
      )
      if (Math.abs(distance - ELITE_APPROACH_RANGE) < 1e-9) ticksWithEliteAtApproachRange += 1
    }
  }

  return {
    state,
    orderViolations,
    killMismatches,
    unclaimedWins,
    eliteDeathTicks,
    sourcesSeen,
    ticksOrderingFriendlyAgainstEnemy,
    ticksOrderingBlastAgainstAnother,
    ticksWithEliteAtApproachRange,
    eliteDisplacement,
    standing: state.friendlies.filter((body) => body.life === 'standing').length,
  }
}

describe('§1.16 the reducer runs a whole battle to a verdict', () => {
  it('composes all sixteen rows, and holds the four the types do not', () => {
    const run = playToVerdict('seed-a')

    // The run DECIDES. This fixture also prescribes WHICH verdict, in the last assertion of the
    // fixture (`toBe('won')`, at the very bottom), and
    // that line is deliberate rather than an accident of what the balance happens to do today —
    // hazard 4b's alarm below needs the win. §5 stage 2 owns the tune and owns that line with it.
    expect(run.state.result).not.toBeNull()
    expect(run.state.combatTick).toBeLessThanOrEqual(COMBAT_TICK_LIMIT)

    // HAZARD 1: the arrival row landed the elite, on its own tick, on top of live spawning.
    // The assertion below it is deliberate: if a future tuning ends the run before 1800, this
    // fixture stops testing the arrival at all, and it must say so by failing rather than by
    // passing on an elite that never had a chance to arrive.
    expect(run.state.combatTick).toBeGreaterThan(ELITE_SPAWN_TICK)
    expect(run.state.elite.spawnTick).toBe(ELITE_SPAWN_TICK)
    expect(run.state.elite.enemyId).not.toBeNull()

    // HAZARD 2: it also MOVED, and came to rest exactly at §1.12's approach range against a
    // command unit that never moved.
    expect(run.eliteDisplacement).toBeGreaterThan(0)
    expect(run.ticksWithEliteAtApproachRange).toBeGreaterThan(0)

    // HAZARD 3: never out of §1.16's order — plus the three counters that say the check was
    // not vacuous. All three sources fired in this run, the two attack passes met on some
    // tick, and the elite's impact met at least one of them on some other. A run in which one
    // source never fires is a run in which dropping it from the list would pass unnoticed.
    expect(run.orderViolations).toEqual([])
    expect([...run.sourcesSeen].sort()).toEqual([1, 2, 3])
    expect(run.ticksOrderingFriendlyAgainstEnemy).toBeGreaterThan(0)
    // THE RANK-3 HALF IS TAKEN FROM A SECOND SEED, and §1.4.1 is why. While the fifteen were
    // pinned to slots the elite's impact caught twelve or thirteen bodies clumped inside the
    // frozen 2.4 circle, and one of `seed-a`'s two impacts shared its tick with a friendly
    // volley. Batch H scattered them onto the band — 4.5~5.0 from the elite instead of 2.46 from
    // the command unit — and on `seed-a` each impact then caught the command unit ALONE, so the
    // check was moved to `seed-b`, the nearest seed that was not vacuous.
    //
    // v11 MOVED IT BACK, and the assertion below is the re-measurement rather than the old
    // claim. The bearing rule spreads the fifteen AROUND the elite instead of onto one arc of
    // its ring, so `seed-a`'s impacts now catch bodies again: `run.ticksOrderingBlastAgainstAnother`
    // is 2 here where batch H measured 0. `seed-b` is kept as well — two seeds are a better
    // rank-3 witness than one — and both are asserted non-vacuous rather than pinned to a count,
    // because the count is a balance fact and §5 owns it.
    const blastRun = playToVerdict('seed-b')
    expect(blastRun.orderViolations).toEqual([])
    expect(blastRun.ticksOrderingBlastAgainstAnother).toBeGreaterThan(0)
    expect(run.ticksOrderingBlastAgainstAnother).toBeGreaterThan(0)

    // HAZARD 4: both consumers read the transition row's return value.
    expect(run.killMismatches).toEqual([])
    expect(run.unclaimedWins).toEqual([])

    // HAZARD 4b's SELF-ALARM, and it is the same shape as hazard 1's above. `unclaimedWins` is
    // the only thing in this run that can see a verdict built from a SECOND `resolveTransitions`
    // call, and it is filled in only on a tick where the elite dies. §5 stage 2 must make
    // `tactical-no-input` lose (I3); the day it does, `eliteDeathTicks` empties, this fixture
    // stops testing row 16, and every assertion above still passes.
    //
    // So it asserts the precondition of its own detector, and the second of the three lines
    // below IS A BALANCE CLAIM: it pins today's verdict. That is the price of the alarm, paid on
    // purpose — an alarm that will not name what it is watching cannot ring. §5 stage 2 must
    // REPLACE that line when it tunes `tactical-no-input` into a defeat, not delete it, and the
    // hand-killed-elite fixture above is what keeps row 16 covered while the replacement is
    // written.
    expect(run.eliteDeathTicks.length).toBeGreaterThan(0)
    expect(run.state.result).toBe('won')
    expect(run.eliteDeathTicks).toEqual([run.state.combatTick - 1])
  })

  it('replays the same seed to the same digest, and two seeds apart', () => {
    const first = playToVerdict('seed-a')
    const second = playToVerdict('seed-a')
    const other = playToVerdict('seed-b')

    expect(digestBattleState(second.state)).toBe(digestBattleState(first.state))
    expect(second.state.combatTick).toBe(first.state.combatTick)
    expect(digestBattleState(other.state)).not.toBe(digestBattleState(first.state))
  })
})
