// Batch E fixtures, part 3: the public facade and §1.17's determinism, end to end.
//
// §4.3 requires a headless replay and a real browser to agree on the verdict and the end tick
// from the same seed and the same input log. That is only checkable if BOTH are driving the
// same thing, so the facade is the thing: `createBattle` takes a seed, takes input, steps,
// reports state and digest, and restarts. Batch G's controller and batch F's harness get
// nothing else and need nothing else.
//
// The input log below is not a formality. A log of nothing would exercise the one path where
// `state.input` never changes, and every §1.15 rule — held axis, the keydown event, the pause
// clause, the card keys — would be free to be wrong.

import { describe, expect, it } from 'vitest'

import { COMBAT_TICK_LIMIT } from '../../src/core/battle/constants'
import { createBattle, type Battle } from '../../src/core/battle/battle'
import { digestBattleState } from '../../src/core/battle/digest'
import { createInitialBattleState } from '../../src/core/battle/state'

/**
 * One entry of an input log: what to do BEFORE the step at this index.
 *
 * Indexed by STEP, not by `combatTick`. A paused step advances no clock (§1.1), so the two
 * disagree the moment the log contains an `Escape` — and a log that is replayed by step index
 * is exactly what a recorder attached to the controller can produce.
 */
type LogEntry = { step: number; act: (battle: Battle) => void }

const CHECKPOINTS = [1, 100, 400, 900, 1500, 1800, 2000]

/** §4.1's `tactical-no-input`, as a log: the card choice and nothing else. */
function cardOnlyLog(): LogEntry[] {
  return []
}

/** A log that touches every §1.15 input: axis, Space, pause and the card keys. */
function scriptedLog(): LogEntry[] {
  return [
    { step: 0, act: (battle) => battle.keyDown('KeyD') },
    { step: 40, act: (battle) => battle.keyDown('KeyS') },
    { step: 90, act: (battle) => battle.keyUp('KeyD') },
    { step: 120, act: (battle) => battle.keyDown('Space') },
    { step: 150, act: (battle) => battle.keyUp('KeyS') },
    { step: 300, act: (battle) => battle.keyDown('Escape') },
    // Two steps that run no tick at all, which both replays must skip identically.
    { step: 303, act: (battle) => battle.keyDown('Escape') },
    { step: 400, act: (battle) => battle.pointerDrag({ x: -6, y: -3 }, 'down') },
    { step: 500, act: (battle) => battle.pointerRelease() },
    { step: 700, act: (battle) => battle.keyUp('Space') },
    { step: 900, act: (battle) => battle.keyDown('ArrowUp') },
    { step: 1400, act: (battle) => battle.keyUp('ArrowUp') },
  ]
}

type Replay = {
  battle: Battle
  checkpoints: string[]
  steps: number
  emptyQueueAtEveryBoundary: boolean
}

/**
 * Drive a battle from a seed and a log to its verdict, taking a digest at each checkpoint.
 *
 * `cardSlot` is the only decision the driver makes on its own: a battle in
 * `awaiting-upgrade` advances nothing (§1.1), so a log that never answers the card screen
 * would stall rather than replay.
 */
function replay(seed: string, log: LogEntry[], cardSlot = 1): Replay {
  const battle = createBattle(seed)
  battle.start()

  const byStep = new Map(log.map((entry) => [entry.step, entry.act]))
  const checkpoints: string[] = []
  let emptyQueueAtEveryBoundary = true
  let steps = 0

  while (battle.mode() === 'running' || battle.mode() === 'paused' || battle.mode() === 'awaiting-upgrade') {
    if (steps > COMBAT_TICK_LIMIT * 2) throw new Error('the replay did not decide')

    byStep.get(steps)?.(battle)
    if (battle.mode() === 'awaiting-upgrade') battle.enqueue({ kind: 'choose-upgrade', slot: cardSlot })

    battle.step()
    if (battle.pendingInputCount() !== 0) emptyQueueAtEveryBoundary = false
    if (CHECKPOINTS.includes(steps)) checkpoints.push(battle.digest())
    steps += 1
  }

  checkpoints.push(battle.digest())
  return { battle, checkpoints, steps, emptyQueueAtEveryBoundary }
}

describe('the facade', () => {
  it('starts from a seed at the initial digest and does not tick until it is started', () => {
    const battle = createBattle('seed-a')

    expect(battle.digest()).toBe(digestBattleState(createInitialBattleState('seed-a')))
    expect(battle.mode()).toBe('ready')
    expect(battle.step().ran).toBe(false)
    expect(battle.state().combatTick).toBe(0)

    battle.start()
    expect(battle.step().ran).toBe(true)
    expect(battle.state().combatTick).toBe(1)
  })

  it('restarts to exactly the initial digest', () => {
    const battle = createBattle('seed-a')
    const initial = battle.digest()

    battle.start()
    for (let step = 0; step < 200; step += 1) battle.step()
    battle.keyDown('KeyW')
    expect(battle.digest()).not.toBe(initial)

    battle.restart()

    // §4.4's 완주 asks for a restart after a finished run, and §1.17 makes "the same" mean the
    // digest: the streams, the names, the roster and the held input all go back, or the second
    // run of a session is not the same game as the first.
    expect(battle.digest()).toBe(initial)
    expect(battle.mode()).toBe('ready')
    expect(battle.pendingInputCount()).toBe(0)
  })

  it('restarts onto a different seed when it is given one', () => {
    const battle = createBattle('seed-a')

    battle.restart('seed-b')

    expect(battle.seed()).toBe('seed-b')
    expect(battle.digest()).toBe(digestBattleState(createInitialBattleState('seed-b')))
  })

  it('drops queued input on restart instead of carrying it into the new run', () => {
    const battle = createBattle('seed-a')
    battle.start()
    battle.keyDown('KeyW')
    expect(battle.pendingInputCount()).toBe(1)

    battle.restart()
    battle.start()
    battle.step()

    expect(battle.state().input.move).toEqual({ x: 0, y: 0 })
  })

  it('forgets which keys are held when a pause releases them', () => {
    const battle = createBattle('seed-a')
    battle.start()
    battle.keyDown('KeyW')
    battle.step()
    expect(battle.state().input.move).not.toEqual({ x: 0, y: 0 })

    battle.keyDown('Escape')
    battle.step()
    battle.keyDown('Escape')
    battle.step()

    expect(battle.mode()).toBe('running')
    expect(battle.state().input.move).toEqual({ x: 0, y: 0 })

    // And the queue's own memory went with it. This is the half that only shows up one key
    // later: the axis is rebuilt from the keys the queue believes are down, so a `KeyW` that
    // survived the pause would ride along on the next press the player makes.
    battle.keyDown('KeyD')
    battle.step()
    expect(battle.state().input.move).toEqual({ x: 1, y: 0 })
  })

  it('releases the pause in full even when the same batch resumes out of it', () => {
    const battle = createBattle('seed-a')
    battle.start()
    battle.keyDown('KeyW')
    battle.step()
    expect(battle.state().input.move).toEqual({ x: 0, y: -1 })

    // Two `Escape`s and a direction key inside ONE batch. The battle ends the batch `running`,
    // and the release still stands: the pause WAS entered, and the movement command behind it
    // was built from a held-key set the pause has since thrown away. Applying it would rebuild
    // the very axis §1.15 had just released, so it is discarded and the player re-presses.
    battle.keyDown('Escape')
    battle.keyDown('Escape')
    battle.keyDown('KeyD')
    battle.step()

    expect(battle.mode()).toBe('running')
    expect(battle.state().input.move).toEqual({ x: 0, y: 0 })

    // And `KeyW` is gone from the queue too, so the re-press is the whole axis and not `KeyW`
    // riding along on it.
    battle.keyDown('KeyD')
    battle.step()
    expect(battle.state().input.move).toEqual({ x: 1, y: 0 })
  })

  it('lets a held key go up at the card screen instead of walking on without it', () => {
    const battle = createBattle('seed-a')
    battle.start()
    expect(battle.keyDown('KeyW')).toBe(true)
    expect(battle.keyDown('Space')).toBe(true)
    battle.step()
    expect(battle.state().input.move).toEqual({ x: 0, y: -1 })
    expect(battle.state().input.spaceHeld).toBe(true)

    while (battle.mode() === 'running') {
      if (battle.state().combatTick > COMBAT_TICK_LIMIT) throw new Error('no card screen came')
      battle.step()
    }
    expect(battle.mode()).toBe('awaiting-upgrade')

    // §1.13 guarantees four of these screens a run, and the player is very likely holding a
    // direction key at each one. A refused keyup leaves the commander walking north with
    // nothing pressed, and no `Space` release can reach `state.input` either.
    expect(battle.keyUp('KeyW')).toBe(true)
    expect(battle.keyUp('Space')).toBe(true)
    battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
    battle.step()

    expect(battle.state().input.move).toEqual({ x: 0, y: 0 })
    expect(battle.state().input.spaceHeld).toBe(false)

    for (let step = 0; step < 30; step += 1) battle.step()
    expect(battle.state().input.move).toEqual({ x: 0, y: 0 })
  })
})

describe('§1.17 / §4.2 the same seed and the same log replay identically', () => {
  it('agrees at every checkpoint of a whole battle, with an input log', () => {
    const first = replay('seed-a', scriptedLog())
    const second = replay('seed-a', scriptedLog())

    expect(second.checkpoints).toEqual(first.checkpoints)
    expect(second.steps).toBe(first.steps)
    expect(second.battle.state().combatTick).toBe(first.battle.state().combatTick)
    expect(second.battle.state().result).toBe(first.battle.state().result)
    // The checkpoints have to be checkpoints OF something: a run that ended on tick 3 would
    // make the comparison above true and empty.
    expect(first.checkpoints.length).toBe(CHECKPOINTS.length + 1)
    expect(first.battle.state().result).not.toBeNull()
  })

  it('agrees on the card-only log too, which is the harness policy with no player model', () => {
    const first = replay('seed-a', cardOnlyLog())
    const second = replay('seed-a', cardOnlyLog())

    expect(second.checkpoints).toEqual(first.checkpoints)
    expect(second.steps).toBe(first.steps)
  })

  it('replays the same way after a restart of the same instance', () => {
    const battle = createBattle('seed-a')
    const fresh = replay('seed-a', scriptedLog())

    battle.start()
    for (let step = 0; step < 50; step += 1) battle.step()
    battle.restart()

    const again = replay(battle.seed(), scriptedLog())
    expect(again.checkpoints).toEqual(fresh.checkpoints)
  })

  it('diverges on a different log, so the agreement above is not vacuous', () => {
    const scripted = replay('seed-a', scriptedLog())
    const cardOnly = replay('seed-a', cardOnlyLog())
    const otherCard = replay('seed-a', cardOnlyLog(), 2)

    expect(scripted.checkpoints).not.toEqual(cardOnly.checkpoints)
    // Only the card differs here, so this is the log's own influence and not the movement's.
    expect(otherCard.checkpoints).not.toEqual(cardOnly.checkpoints)
  })

  it('diverges on a different seed', () => {
    expect(replay('seed-b', scriptedLog()).checkpoints).not.toEqual(
      replay('seed-a', scriptedLog()).checkpoints,
    )
  })

  it('leaves no input pending at any tick boundary', () => {
    const run = replay('seed-a', scriptedLog())

    // This is what makes it sound for the digest to ignore the queue (§1.17 covers
    // `state.input`, not the queue): nothing pending ever survives a step, so a digest plus
    // the remaining log is the whole future.
    expect(run.emptyQueueAtEveryBoundary).toBe(true)
  })
})
