// Batch E fixtures, part 1: §1.15 입력 — the queue between a device and `state.input`.
//
// Three things this file exists to hold still:
//
//   * movement is PERSISTENT AXIS STATE, not a per-tick impulse. §1.11's lock condition is
//     "그 tick의 이동 입력 벡터가 0", so the vector has to survive ticks in which nothing was
//     pressed, and the queue has to know which direction keys are still down in order to
//     rebuild it when one of them comes up.
//   * the rescue cancel is a movement KEYDOWN EVENT, which held state cannot express. The queue
//     is the only thing that can tell the two apart, and `RescueInputEvents` is where it says so.
//   * §1.15's "금지 상황의 입력은 queue에 넣지 않는다" is a property of ENQUEUE, not of apply:
//     a refused command leaves no trace at all, so a paused battle cannot accumulate a burst of
//     movement that lands the moment it resumes.

import { describe, expect, it } from 'vitest'

import { ARRIVE_EPSILON } from '../../src/core/battle/constants'
import {
  BattleInputQueue,
  MOVE_KEY_VECTORS,
  PAUSE_KEY_CODE,
  RESCUE_KEY_CODE,
  UPGRADE_KEY_CODES,
  applyBattleCommands,
  commandIsAllowed,
  type InputApplication,
} from '../../src/core/battle/input'
import { createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'

function running(seed = 'seed-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

function awaitingUpgrade(): BattleState {
  const state = running()
  state.upgrades.rounds.push({
    round: 1,
    tick: 10,
    offered: ['firepower', 'mobility', 'vitality'],
    chosen: null,
  })
  state.mode = 'awaiting-upgrade'
  return state
}

/**
 * Drain and apply, the way the reducer does it — BOTH halves.
 *
 * `applyBattleCommands` is the state half of §1.15's pause release and `queue.applied` is the
 * device half; a fixture that ran only the first would be pinning a path no driver takes, and
 * would go on passing while the queue remembered keys the battle had already forgotten.
 */
function apply(state: BattleState, queue: BattleInputQueue): InputApplication {
  const application = applyBattleCommands(state, queue.drain())
  queue.applied(application)
  return application
}

/** Enqueue, drain, apply — the whole path a device event takes into `state.input`. */
function press(state: BattleState, queue: BattleInputQueue, codes: string[]): void {
  for (const code of codes) queue.keyDown(state, code)
  apply(state, queue)
}

describe('§1.15 movement is persistent axis state', () => {
  it('holds the axis across ticks that carry no input at all', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)

    // Two ticks with an empty queue. A per-tick impulse model would zero the vector here,
    // and §1.11's lock would then establish under a key the player is still holding.
    apply(state, queue)
    apply(state, queue)
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)
  })

  it('sums the held direction keys and rebuilds the axis on release', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW', 'KeyD'])
    expect(state.input.move).toEqual({ x: 1, y: -1 })

    queue.keyUp(state, 'KeyW')
    apply(state, queue)
    expect(state.input.move).toEqual({ x: 1, y: 0 })

    queue.keyUp(state, 'KeyD')
    apply(state, queue)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('cancels opposite keys held together instead of picking a winner', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW', 'KeyS'])

    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('reads arrow keys and WASD as the same four directions, by code', () => {
    for (const [wasd, arrow] of [
      ['KeyW', 'ArrowUp'],
      ['KeyA', 'ArrowLeft'],
      ['KeyS', 'ArrowDown'],
      ['KeyD', 'ArrowRight'],
    ]) {
      expect(MOVE_KEY_VECTORS[arrow]).toEqual(MOVE_KEY_VECTORS[wasd])
    }
  })

  it('ignores an operating-system key repeat', () => {
    const state = running()
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, 'KeyW')).toBe(true)
    expect(queue.keyDown(state, 'KeyW')).toBe(false)
    expect(queue.keyDown(state, 'KeyW')).toBe(false)

    // A browser repeats `keydown` for as long as the key is down. Each repeat carries the
    // same axis, so the only things a repeat could add are an unbounded queue and a §1.11
    // cancel event per frame.
    expect(queue.size).toBe(1)
    expect(apply(state, queue).events.movementKeydown).toBe(true)
  })

  it('refuses a key it does not know, and says so', () => {
    const state = running()
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, 'KeyQ')).toBe(false)
    expect(queue.size).toBe(0)
  })

  it('refuses an Object.prototype name instead of reading it off the table', () => {
    // `MOVE_KEY_VECTORS` is an object, and every object answers to `toString`. Read without a
    // hasOwn guard, `MOVE_KEY_VECTORS['toString']` is a truthy FUNCTION: the code is accepted,
    // remembered as held, and summed as `undefined` — `state.input.move` becomes `{NaN, NaN}`,
    // which §1.17's digest normalizes to `null`. Two differently poisoned runs then hash the
    // same, which is the one thing the digest exists to make impossible.
    const state = running()
    const queue = new BattleInputQueue()

    for (const code of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(queue.keyDown(state, code)).toBe(false)
      expect(queue.keyUp(state, code)).toBe(false)
    }

    expect(queue.size).toBe(0)
    apply(state, queue)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('does not let an Object.prototype name poison an axis that is already held', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    queue.keyDown(state, 'valueOf')
    apply(state, queue)

    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)
    expect(Number.isNaN(state.input.move.x)).toBe(false)
    expect(Number.isNaN(state.input.move.y)).toBe(false)
  })
})

describe('§1.15 pointer drag', () => {
  it('clamps a drag shorter than ARRIVE_EPSILON to a zero vector', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: ARRIVE_EPSILON / 2, y: 0 }, 'down')
    apply(state, queue)

    // §1.15: "미세 변위로 진동하는 것을 막는다" — and it is also what makes §1.11's
    // zero-vector lock condition reachable with a pointer at all.
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('passes a drag at or beyond the epsilon through unchanged', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: 3, y: -4 }, 'down')
    apply(state, queue)

    expect(state.input.move).toEqual({ x: 3, y: -4 })
  })

  it('leaves a drag of exactly ARRIVE_EPSILON alone, because §1.15 says 미만', () => {
    const state = running()
    const queue = new BattleInputQueue()

    // The boundary itself, not a magnitude comfortably past it: `<` and `<=` differ on exactly
    // one value and this is it.
    queue.pointerDrag(state, { x: ARRIVE_EPSILON, y: 0 }, 'down')
    apply(state, queue)

    expect(state.input.move).toEqual({ x: ARRIVE_EPSILON, y: 0 })
  })

  it('refuses a drag that continues a pointer which never went down', () => {
    const state = running()
    const queue = new BattleInputQueue()

    // A `move` with no `down` behind it used to capture the axis silently and then suppress
    // every key until a `pointerRelease` that the driver had no reason to send.
    expect(queue.pointerDrag(state, { x: 4, y: 4 }, 'move')).toBe(false)
    expect(queue.size).toBe(0)

    expect(queue.keyDown(state, 'KeyD')).toBe(true)
    apply(state, queue)
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })

  it('returns the axis to the held keys when the pointer is released', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyD'])
    queue.pointerDrag(state, { x: 0, y: 5 }, 'down')
    apply(state, queue)
    expect(state.input.move).toEqual({ x: 0, y: 5 })

    queue.pointerRelease(state)
    apply(state, queue)
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })
})

describe('§1.11 / §1.15 the movement keydown event', () => {
  it('reports a keydown once, on the tick it was pressed', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'KeyW')
    expect(apply(state, queue).events.movementKeydown).toBe(true)

    // The key is STILL DOWN and the axis is still non-zero, but no event happened this tick.
    // §1.11's cancel must not fire again, or a rescue could never survive a held key.
    expect(apply(state, queue).events.movementKeydown).toBe(false)
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)
  })

  it('does not report a keyup as a keydown', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    queue.keyUp(state, 'KeyW')

    expect(apply(state, queue).events.movementKeydown).toBe(false)
  })

  it('reports a pointerdown as one, including the one clamped to zero', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: ARRIVE_EPSILON / 2, y: 0 }, 'down')
    const application = apply(state, queue)

    // §1.11 lists "이동 keydown/pointerdown" as one cancel condition, and the clamp is about
    // the VECTOR, not about whether the player decided to move.
    expect(application.events.movementKeydown).toBe(true)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('does not report a continued drag as a keydown', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: 1, y: 0 }, 'down')
    apply(state, queue)
    queue.pointerDrag(state, { x: 2, y: 0 }, 'move')

    expect(apply(state, queue).events.movementKeydown).toBe(false)
  })
})

describe('§1.15 rescue, upgrade and pause keys', () => {
  it('holds and releases Space', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, [RESCUE_KEY_CODE])
    expect(state.input.spaceHeld).toBe(true)

    queue.keyUp(state, RESCUE_KEY_CODE)
    apply(state, queue)
    expect(state.input.spaceHeld).toBe(false)
  })

  it('maps 1 2 3 onto the offered cards by position', () => {
    for (const [index, code] of UPGRADE_KEY_CODES.entries()) {
      const state = awaitingUpgrade()
      const queue = new BattleInputQueue()

      press(state, queue, [code])

      expect(state.upgrades.rounds[0].chosen).toBe(state.upgrades.rounds[0].offered[index])
      expect(state.mode).toBe('running')
    }
  })

  it('toggles pause with Escape and resumes with it', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, [PAUSE_KEY_CODE])
    expect(state.mode).toBe('paused')

    press(state, queue, [PAUSE_KEY_CODE])
    expect(state.mode).toBe('running')
  })

  it('releases held input on the way into pause', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW', RESCUE_KEY_CODE])
    expect(state.input.move).not.toEqual({ x: 0, y: 0 })

    press(state, queue, [PAUSE_KEY_CODE])

    // §1.15: "일시정지 진입 시 지속 입력을 해제하고". Both the state and the queue's memory of
    // which keys are down, or resuming would restore a vector the player never re-pressed.
    expect(state.input.move).toEqual({ x: 0, y: 0 })
    expect(state.input.spaceHeld).toBe(false)
    press(state, queue, [PAUSE_KEY_CODE])
    expect(state.mode).toBe('running')

    // The device half, read where it shows: `KeyW` is gone from the queue, so the next key the
    // player presses is the whole axis rather than that key plus a ghost.
    press(state, queue, ['KeyD'])
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })

  it('discards the movement and rescue events left in the same batch', () => {
    const state = running()
    const queue = new BattleInputQueue()

    // All three are legal at the moment they are enqueued — the pause has not been applied
    // yet — which is exactly the case §1.15's second clause is about.
    queue.keyDown(state, PAUSE_KEY_CODE)
    queue.keyDown(state, 'KeyW')
    queue.keyDown(state, RESCUE_KEY_CODE)
    const application = apply(state, queue)

    expect(state.mode).toBe('paused')
    expect(state.input.move).toEqual({ x: 0, y: 0 })
    expect(state.input.spaceHeld).toBe(false)
    expect(application.discarded).toBe(2)
    // And the discarded keydown must not reach §1.11's cancel either.
    expect(application.events.movementKeydown).toBe(false)
  })
})

describe('§1.15 forbidden inputs never enter the queue', () => {
  it('refuses movement and rescue while paused', () => {
    const state = running()
    state.mode = 'paused'
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, 'KeyW')).toBe(false)
    expect(queue.keyDown(state, RESCUE_KEY_CODE)).toBe(false)
    expect(queue.pointerDrag(state, { x: 1, y: 1 }, 'down')).toBe(false)
    expect(queue.size).toBe(0)
  })

  it('refuses movement and rescue while a card is waiting', () => {
    const state = awaitingUpgrade()
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, 'KeyW')).toBe(false)
    expect(queue.keyDown(state, RESCUE_KEY_CODE)).toBe(false)
    expect(queue.size).toBe(0)
  })

  it('refuses everything once the run has a verdict', () => {
    for (const mode of ['won', 'lost'] as const) {
      const state = running()
      state.mode = mode
      const queue = new BattleInputQueue()

      expect(queue.keyDown(state, 'KeyW')).toBe(false)
      expect(queue.keyDown(state, RESCUE_KEY_CODE)).toBe(false)
      expect(queue.keyDown(state, PAUSE_KEY_CODE)).toBe(false)
      expect(queue.keyDown(state, UPGRADE_KEY_CODES[0])).toBe(false)
      expect(queue.size).toBe(0)
    }
  })

  it('refuses a card key when no round is waiting for one', () => {
    const state = running()
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, UPGRADE_KEY_CODES[0])).toBe(false)
    expect(queue.size).toBe(0)
  })

  it('refuses pause while a card is waiting, and lets the card through', () => {
    const state = awaitingUpgrade()
    const queue = new BattleInputQueue()

    // §1.13 already stops the clock here, so a second stop has nothing to add and would need
    // a rule for which one Escape leaves. §1.15 does not write one; this is the reading that
    // needs no rule (see the report's §1 note).
    expect(queue.keyDown(state, PAUSE_KEY_CODE)).toBe(false)
    expect(queue.keyDown(state, UPGRADE_KEY_CODES[0])).toBe(true)
  })

  it('lets a card be chosen while paused without resuming the battle', () => {
    // THIS STATE IS NOT REACHABLE THROUGH THE QUEUE, and saying so is the point of the comment
    // rather than of a deletion. `paused` with a round still waiting needs an `Escape` that
    // §1.15 refuses under a card, or a tick that §1.1 will not run while paused. What it pins
    // is the seam BETWEEN two rules that are each reachable: `commandIsAllowed` admits a card
    // key in `paused`, and `chooseUpgradeCard` refuses to hand the battle back to `running`
    // from a mode it did not stop. If either changes, this hand-built state is where the
    // disagreement shows up first.
    const state = awaitingUpgrade()
    state.mode = 'paused'
    const queue = new BattleInputQueue()

    press(state, queue, [UPGRADE_KEY_CODES[1]])

    expect(state.upgrades.rounds[0].chosen).toBe(state.upgrades.rounds[0].offered[1])
    expect(state.mode).toBe('paused')
  })

  it('agrees with commandIsAllowed, which is the rule the queue applies', () => {
    const state = running()
    state.mode = 'paused'

    expect(commandIsAllowed(state, { kind: 'set-move', move: { x: 1, y: 0 }, keydown: true })).toBe(
      false,
    )
    expect(commandIsAllowed(state, { kind: 'toggle-pause' })).toBe(true)
  })
})

describe('§1.15 a release is refused in no mode at all', () => {
  it('lets a movement key come up while a card is waiting', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)

    // The card screen arrives with the key still down. Refusing the keyup here would leave the
    // axis pointing north under a hand that is no longer on the key — the state would be lying,
    // and §1.11's lock ("그 tick의 이동 입력 벡터가 0") would be unreachable until the player
    // pressed and released some OTHER direction.
    state.upgrades.rounds.push({
      round: 1,
      tick: 10,
      offered: ['firepower', 'mobility', 'vitality'],
      chosen: null,
    })
    state.mode = 'awaiting-upgrade'

    expect(queue.keyUp(state, 'KeyW')).toBe(true)
    apply(state, queue)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('lets Space come up while a card is waiting', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, [RESCUE_KEY_CODE])
    expect(state.input.spaceHeld).toBe(true)

    const awaiting = awaitingUpgrade()
    awaiting.input.spaceHeld = true
    expect(queue.keyUp(awaiting, RESCUE_KEY_CODE)).toBe(true)
    apply(awaiting, queue)

    // A rescue lock that establishes under a `Space` the player let go of is the same defect
    // wearing the other key.
    expect(awaiting.input.spaceHeld).toBe(false)
  })

  it('rebuilds the axis from the keys that are still down when one comes up mid-card', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW', 'KeyD'])
    state.upgrades.rounds.push({
      round: 1,
      tick: 10,
      offered: ['firepower', 'mobility', 'vitality'],
      chosen: null,
    })
    state.mode = 'awaiting-upgrade'

    expect(queue.keyUp(state, 'KeyW')).toBe(true)
    apply(state, queue)

    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })

  it('says so in the predicate, in every mode there is', () => {
    const release = { kind: 'set-move', move: { x: 0, y: 0 }, keydown: false } as const
    const spaceUp = { kind: 'set-rescue', held: false } as const
    const keyPress = { kind: 'set-move', move: { x: 0, y: -1 }, keydown: true } as const

    for (const mode of ['ready', 'running', 'paused', 'awaiting-upgrade', 'won', 'lost'] as const) {
      const state = running()
      state.mode = mode

      expect(commandIsAllowed(state, release)).toBe(true)
      expect(commandIsAllowed(state, spaceUp)).toBe(true)
      expect(commandIsAllowed(state, keyPress)).toBe(mode === 'running')
    }
  })
})

describe('§1.15 the reducer enforces the same rule the queue does', () => {
  it('refuses a forbidden command handed straight to applyBattleCommands', () => {
    // The queue is a fast path, not the enforcer. `advanceBattleTick` and `applyBattleCommands`
    // are both public, and batch F's policies build commands without going through a queue at
    // all — a rule that only one of three entry points holds is not a rule.
    for (const mode of ['ready', 'paused', 'awaiting-upgrade', 'won', 'lost'] as const) {
      const state = running()
      state.mode = mode

      const application = applyBattleCommands(state, [
        { kind: 'set-move', move: { x: 1, y: 0 }, keydown: true },
        { kind: 'set-rescue', held: true },
      ])

      expect(state.input.move).toEqual({ x: 0, y: 0 })
      expect(state.input.spaceHeld).toBe(false)
      expect(application.discarded).toBe(2)
      expect(application.events.movementKeydown).toBe(false)
    }
  })

  it('does not let a finished run take input at all', () => {
    const state = running()
    state.mode = 'won'

    applyBattleCommands(state, [{ kind: 'set-move', move: { x: -1, y: 1 }, keydown: true }])

    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('still takes a release through the reducer, in the modes that refuse a press', () => {
    const state = awaitingUpgrade()
    state.input.move = { x: 0, y: -1 }
    state.input.spaceHeld = true

    const application = applyBattleCommands(state, [
      { kind: 'set-move', move: { x: 0, y: 0 }, keydown: false },
      { kind: 'set-rescue', held: false },
    ])

    expect(state.input.move).toEqual({ x: 0, y: 0 })
    expect(state.input.spaceHeld).toBe(false)
    expect(application.discarded).toBe(0)
  })

  it('refuses a card key that names no offered card, rather than throwing at the reducer', () => {
    const state = awaitingUpgrade()

    const application = applyBattleCommands(state, [{ kind: 'choose-upgrade', slot: 9 }])

    expect(state.upgrades.rounds[0].chosen).toBeNull()
    expect(application.discarded).toBe(1)
  })
})

describe('§1.17 the queue is a deterministic FIFO', () => {
  it('applies commands in the order they were enqueued', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'KeyW')
    queue.keyDown(state, 'KeyD')
    queue.keyUp(state, 'KeyW')
    const drained = queue.drain()

    expect(drained.map((command) => command.kind)).toEqual(['set-move', 'set-move', 'set-move'])
    applyBattleCommands(state, drained)
    // Last write wins, and the last write is the keyup's rebuilt axis.
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })

  it('empties on drain, so no input state survives a tick outside the digest', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'KeyW')
    expect(queue.size).toBe(1)
    queue.drain()

    // §1.17's digest covers `state.input` but not the queue. The queue is only outside the
    // digest safely because it is EMPTY at every tick boundary; what does survive is the held
    // key set, which is a function of the input log prefix and nothing else.
    expect(queue.size).toBe(0)
    expect(queue.drain()).toEqual([])
  })
})
