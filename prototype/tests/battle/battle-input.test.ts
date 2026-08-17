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

/** Enqueue, drain, apply — the whole path a device event takes into `state.input`. */
function press(state: BattleState, queue: BattleInputQueue, codes: string[]): void {
  for (const code of codes) queue.keyDown(state, code)
  applyBattleCommands(state, queue.drain())
}

describe('§1.15 movement is persistent axis state', () => {
  it('holds the axis across ticks that carry no input at all', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)

    // Two ticks with an empty queue. A per-tick impulse model would zero the vector here,
    // and §1.11's lock would then establish under a key the player is still holding.
    applyBattleCommands(state, queue.drain())
    applyBattleCommands(state, queue.drain())
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)
  })

  it('sums the held direction keys and rebuilds the axis on release', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW', 'KeyD'])
    expect(state.input.move).toEqual({ x: 1, y: -1 })

    queue.keyUp(state, 'KeyW')
    applyBattleCommands(state, queue.drain())
    expect(state.input.move).toEqual({ x: 1, y: 0 })

    queue.keyUp(state, 'KeyD')
    applyBattleCommands(state, queue.drain())
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
    expect(applyBattleCommands(state, queue.drain()).events.movementKeydown).toBe(true)
  })

  it('refuses a key it does not know, and says so', () => {
    const state = running()
    const queue = new BattleInputQueue()

    expect(queue.keyDown(state, 'KeyQ')).toBe(false)
    expect(queue.size).toBe(0)
  })
})

describe('§1.15 pointer drag', () => {
  it('clamps a drag shorter than ARRIVE_EPSILON to a zero vector', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: ARRIVE_EPSILON / 2, y: 0 }, 'down')
    applyBattleCommands(state, queue.drain())

    // §1.15: "미세 변위로 진동하는 것을 막는다" — and it is also what makes §1.11's
    // zero-vector lock condition reachable with a pointer at all.
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('passes a drag at or beyond the epsilon through unchanged', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: 3, y: -4 }, 'down')
    applyBattleCommands(state, queue.drain())

    expect(state.input.move).toEqual({ x: 3, y: -4 })
  })

  it('returns the axis to the held keys when the pointer is released', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyD'])
    queue.pointerDrag(state, { x: 0, y: 5 }, 'down')
    applyBattleCommands(state, queue.drain())
    expect(state.input.move).toEqual({ x: 0, y: 5 })

    queue.pointerRelease(state)
    applyBattleCommands(state, queue.drain())
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyD)
  })
})

describe('§1.11 / §1.15 the movement keydown event', () => {
  it('reports a keydown once, on the tick it was pressed', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.keyDown(state, 'KeyW')
    expect(applyBattleCommands(state, queue.drain()).events.movementKeydown).toBe(true)

    // The key is STILL DOWN and the axis is still non-zero, but no event happened this tick.
    // §1.11's cancel must not fire again, or a rescue could never survive a held key.
    expect(applyBattleCommands(state, queue.drain()).events.movementKeydown).toBe(false)
    expect(state.input.move).toEqual(MOVE_KEY_VECTORS.KeyW)
  })

  it('does not report a keyup as a keydown', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, ['KeyW'])
    queue.keyUp(state, 'KeyW')

    expect(applyBattleCommands(state, queue.drain()).events.movementKeydown).toBe(false)
  })

  it('reports a pointerdown as one, including the one clamped to zero', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: ARRIVE_EPSILON / 2, y: 0 }, 'down')
    const application = applyBattleCommands(state, queue.drain())

    // §1.11 lists "이동 keydown/pointerdown" as one cancel condition, and the clamp is about
    // the VECTOR, not about whether the player decided to move.
    expect(application.events.movementKeydown).toBe(true)
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('does not report a continued drag as a keydown', () => {
    const state = running()
    const queue = new BattleInputQueue()

    queue.pointerDrag(state, { x: 1, y: 0 }, 'down')
    applyBattleCommands(state, queue.drain())
    queue.pointerDrag(state, { x: 2, y: 0 }, 'move')

    expect(applyBattleCommands(state, queue.drain()).events.movementKeydown).toBe(false)
  })
})

describe('§1.15 rescue, upgrade and pause keys', () => {
  it('holds and releases Space', () => {
    const state = running()
    const queue = new BattleInputQueue()

    press(state, queue, [RESCUE_KEY_CODE])
    expect(state.input.spaceHeld).toBe(true)

    queue.keyUp(state, RESCUE_KEY_CODE)
    applyBattleCommands(state, queue.drain())
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
    applyBattleCommands(state, queue.drain())
    expect(state.input.move).toEqual({ x: 0, y: 0 })
  })

  it('discards the movement and rescue events left in the same batch', () => {
    const state = running()
    const queue = new BattleInputQueue()

    // All three are legal at the moment they are enqueued — the pause has not been applied
    // yet — which is exactly the case §1.15's second clause is about.
    queue.keyDown(state, PAUSE_KEY_CODE)
    queue.keyDown(state, 'KeyW')
    queue.keyDown(state, RESCUE_KEY_CODE)
    const application = applyBattleCommands(state, queue.drain())

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
