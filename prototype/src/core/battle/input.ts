// §1.15 입력 — the queue between a device and `state.input`.
//
// The whole module is display-agnostic: it takes `event.code` strings and world-space
// offsets, never a DOM event, a canvas or a camera. Batch G wires real listeners to
// `keyDown`/`keyUp`/`pointerDrag`; the headless harness (batch F) enqueues the same commands
// from a log. Both drive the identical path, which is what §4.3 asks for ("같은 seed·같은
// 입력 로그를 헤드리스 재생과 실시간 브라우저 재생에서" agreeing).
//
// Three shapes here are rules, not conveniences:
//
//   1. MOVEMENT IS HELD AXIS STATE. `state.input.move` survives ticks with no input, because
//      §1.11's lock condition reads "그 tick의 이동 입력 벡터가 0" — a per-tick impulse would
//      be 0 on every tick the player did not press anything, and the lock would establish
//      under a key that is still down.
//   2. THE RESCUE CANCEL IS AN EVENT. §1.11 cancels on "이동 keydown/pointerdown", which held
//      state cannot express: the axis looks the same on the tick a key goes down and on the
//      hundred ticks after it. `applyBattleCommands` returns `RescueInputEvents` for exactly
//      the one tick in question, and `resolveRescueLock` takes it as a required argument
//      (`rescue.ts` says why).
//   3. A FORBIDDEN INPUT IS NEVER QUEUED. §1.15: "금지 상황의 입력은 queue에 넣지 않는다."
//      Refusing at APPLY time instead would still be correct for one tick and wrong for the
//      run: a paused battle would bank a burst of movement that all lands on resume.
//
// WHAT IS NOT IN THE DIGEST, AND WHY THAT IS SOUND: the queue and its held-key set are not
// part of `BattleState` (see the no-scratch rule in `types.ts`), so §1.17's digest does not
// cover them. The queue is empty at every tick boundary — `drain` is total, and the tick
// reducer drains before it does anything else — so nothing pending can survive into a replay.
// The held-key set does survive, and it is a pure function of the input log's prefix: a replay
// that starts at tick 0 and feeds the same log rebuilds it exactly. A replay that starts from
// a digest alone does NOT, and there is no such replay in this project.

import { ARRIVE_EPSILON } from './constants'
import type { RescueInputEvents } from './rescue'
import { pendingUpgradeRound } from './upgrades'
import { chooseUpgradeCard } from './upgrades'
import type { BattleState, Vec2 } from './types'

/**
 * §1.15's four inputs, as the commands a tick applies.
 *
 * `set-move` carries the WHOLE axis rather than a delta: the queue owns which keys are down,
 * so the command is already the answer and applying it twice is the same as applying it once.
 * `keydown` is the §1.11 event flag riding along — it is a property of the ACT, not of the
 * vector, which is why a pointerdown clamped to `{0,0}` still carries it.
 */
export type BattleCommand =
  | { kind: 'set-move'; move: Vec2; keydown: boolean }
  | { kind: 'set-rescue'; held: boolean }
  /** 1-based, matching the `1` `2` `3` keys and the offered card at that position. */
  | { kind: 'choose-upgrade'; slot: number }
  | { kind: 'toggle-pause' }

/**
 * §1.15: "모든 키는 `event.code`로 판정한다. IME 활성 상태에서도 동작해야 한다."
 *
 * `code` is the physical key, so a Hangul or Kana IME — which rewrites `key`, never `code` —
 * cannot silence movement. That is the whole reason the table is keyed this way.
 *
 * THE SIGN CONVENTION IS A DECISION, NOT A RULE. §1.15 names the keys and §1.1 gives the arena
 * `0..56 x 0..32`, but neither says which way `W` points. `-y` is up, i.e. y grows downward,
 * matching the screen convention the existing renderers already use. The core only needs the
 * mapping to be FIXED (a replay of the same log has to move the same way); batch G has to point
 * its camera to agree with it, and that is the seam, not this line.
 */
export const MOVE_KEY_VECTORS: Readonly<Record<string, Vec2>> = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}

/** §1.15: 구조 `Space` 유지. */
export const RESCUE_KEY_CODE = 'Space'
/** §1.15: 강화 `1` `2` `3`, in offered order. */
export const UPGRADE_KEY_CODES: readonly string[] = ['Digit1', 'Digit2', 'Digit3']
/** §1.15: 일시정지 `Escape`. */
export const PAUSE_KEY_CODE = 'Escape'

/** A pointer that has just gone down is §1.11's "pointerdown"; a drag that continues is not. */
export type PointerPhase = 'down' | 'move'

/**
 * §1.15's 금지 상황, as one predicate.
 *
 * Exported because the queue is not the only enqueuer — batch F's policy harness and batch G's
 * controller both build commands, and a second copy of this rule is a second place for it to
 * drift.
 *
 * The readings §1.15 does not write out, and why each is the one that needs no further rule:
 *
 *   * `ready`, `won`, `lost` take nothing. A run that has not begun or has ended has no input.
 *   * a card key needs a round WAITING for a card, in any mode. §1.13's `chooseUpgradeCard`
 *     already refuses to un-pause a paused battle, so "choose while paused" is representable
 *     and harmless; a key that maps to no offered card is not.
 *   * `Escape` is refused while a card is waiting. §1.13 has already stopped the clock there,
 *     so a second stop adds nothing and would need a rule for which state Escape leaves —
 *     §1.15 does not write one. See the batch E report's §1 note.
 */
export function commandIsAllowed(state: Readonly<BattleState>, command: BattleCommand): boolean {
  switch (command.kind) {
    case 'set-move':
    case 'set-rescue':
      return state.mode === 'running'
    case 'choose-upgrade': {
      if (state.mode !== 'running' && state.mode !== 'paused' && state.mode !== 'awaiting-upgrade') {
        return false
      }
      const round = pendingUpgradeRound(state)
      return round !== null && command.slot >= 1 && command.slot <= round.offered.length
    }
    case 'toggle-pause':
      return state.mode === 'running' || state.mode === 'paused'
  }
}

/** §1.15: "일시정지 진입 시 지속 입력을 해제하고". */
function releaseHeldInput(state: BattleState): void {
  state.input.move = { x: 0, y: 0 }
  state.input.spaceHeld = false
}

/**
 * What one tick's batch of commands did, beyond writing `state.input`.
 *
 * A return value, not a field: `types.ts` reserves `BattleState` for what a LATER tick reads,
 * and every field here is consumed inside the same tick.
 */
export type InputApplication = {
  /** §1.11's one-tick cancel event, for the rescue lock. */
  events: RescueInputEvents
  /** §1.15: how many movement/rescue commands the pause in this batch threw away. */
  discarded: number
  /** True when a `toggle-pause` in this batch was the one that ENTERED pause. */
  pauseEntered: boolean
}

/**
 * The 입력 적용 row of §1.16's table (the table lives in `index.ts`).
 *
 * Commands apply in queue order, first to last, and the last writer wins — which is why the
 * queue may enqueue a `set-move` per key event without collapsing them: three events in one
 * tick leave the axis at the third one's value, which is the axis the player is actually
 * holding.
 *
 * §1.15's second pause clause is the `pauseEntered` branch: once a pause has been applied,
 * the movement and rescue commands still sitting behind it in the SAME batch are dropped,
 * because they were legal when they were enqueued and are not any more.
 */
export function applyBattleCommands(
  state: BattleState,
  commands: readonly BattleCommand[],
): InputApplication {
  let movementKeydown = false
  let discarded = 0
  let pauseEntered = false

  for (const command of commands) {
    if (pauseEntered && (command.kind === 'set-move' || command.kind === 'set-rescue')) {
      discarded += 1
      continue
    }

    switch (command.kind) {
      case 'set-move':
        state.input.move = { x: command.move.x, y: command.move.y }
        if (command.keydown) movementKeydown = true
        break
      case 'set-rescue':
        state.input.spaceHeld = command.held
        break
      case 'choose-upgrade': {
        const round = pendingUpgradeRound(state)
        // Unreachable through the queue, which refuses the key when no round waits. Throwing
        // rather than ignoring is `chooseUpgradeCard`'s own argument: a drifted mapping must
        // fail where it is wrong.
        if (!round) throw new Error('battle/input: no upgrade round is waiting for a choice (§1.13)')
        chooseUpgradeCard(state, round.offered[command.slot - 1])
        break
      }
      case 'toggle-pause':
        if (state.mode === 'running') {
          state.mode = 'paused'
          releaseHeldInput(state)
          pauseEntered = true
        } else if (state.mode === 'paused') {
          state.mode = 'running'
        }
        break
    }
  }

  return { events: { movementKeydown }, discarded, pauseEntered }
}

function sumHeldKeys(held: ReadonlySet<string>): Vec2 {
  let x = 0
  let y = 0
  for (const code of held) {
    const vector = MOVE_KEY_VECTORS[code]
    if (!vector) continue
    x += vector.x
    y += vector.y
  }
  // Opposite keys cancel to exactly 0, which §1.11's lock condition tests for.
  return { x, y }
}

/**
 * §1.15's queue: device events in, `BattleCommand`s out, one drain per tick.
 *
 * It owns the two pieces of device state the axis is derived from — which direction keys are
 * down, and where a pointer is dragging to — because neither belongs in `BattleState` (the
 * no-scratch rule) and neither can be recovered from `state.input.move` alone: `{0,0}` is both
 * "nothing is held" and "W and S are held together".
 *
 * The pointer OVERRIDES the keys while it is down. §1.15 lists them as alternative ways to
 * steer and does not compose them; adding them would let a held key drag the pointer's target
 * off the point the player is actually pointing at.
 */
export class BattleInputQueue {
  private pending: BattleCommand[] = []
  private heldMoveKeys = new Set<string>()
  private pointerOffset: Vec2 | null = null

  get size(): number {
    return this.pending.length
  }

  /** Enqueue a command if §1.15 allows it here. Returns whether it was accepted. */
  push(state: Readonly<BattleState>, command: BattleCommand): boolean {
    if (!commandIsAllowed(state, command)) return false
    this.pending.push(command)
    return true
  }

  /**
   * A key going down, by `event.code` (§1.15). Returns false for a code this game does not
   * use and for a code §1.15 forbids right now — the caller cannot tell the two apart, and
   * does not need to: both mean "nothing was queued".
   */
  keyDown(state: Readonly<BattleState>, code: string): boolean {
    if (MOVE_KEY_VECTORS[code]) {
      if (this.heldMoveKeys.has(code)) {
        // A key repeat. The axis is unchanged, but §1.11 gets no second cancel event out of
        // the operating system holding a key down for the player.
        return false
      }
      const held = new Set(this.heldMoveKeys)
      held.add(code)
      const accepted = this.push(state, {
        kind: 'set-move',
        move: this.pointerOffset ?? sumHeldKeys(held),
        keydown: true,
      })
      // A refused key is not remembered: §1.15 releases held input on the way into pause, and
      // a key the game never saw go down must not be able to come back up into an axis.
      if (accepted) this.heldMoveKeys = held
      return accepted
    }

    if (code === RESCUE_KEY_CODE) return this.push(state, { kind: 'set-rescue', held: true })

    const slot = UPGRADE_KEY_CODES.indexOf(code)
    if (slot >= 0) return this.push(state, { kind: 'choose-upgrade', slot: slot + 1 })

    if (code === PAUSE_KEY_CODE) return this.push(state, { kind: 'toggle-pause' })

    return false
  }

  /** A key coming up. Only movement and `Space` have a release; the rest are edge-triggered. */
  keyUp(state: Readonly<BattleState>, code: string): boolean {
    if (MOVE_KEY_VECTORS[code]) {
      if (!this.heldMoveKeys.delete(code)) return false
      return this.push(state, {
        kind: 'set-move',
        move: this.pointerOffset ?? sumHeldKeys(this.heldMoveKeys),
        keydown: false,
      })
    }
    if (code === RESCUE_KEY_CODE) return this.push(state, { kind: 'set-rescue', held: false })
    return false
  }

  /**
   * A pointer drag, as the WORLD-SPACE offset from the command unit to the drag target.
   *
   * §1.15: "포인터 드래그로 목표까지 거리가 `ARRIVE_EPSILON` 미만이면 이동 입력을 `0`으로
   * 클램프한다." The clamp is on the VECTOR only — a `down` still reports §1.11's pointerdown,
   * because the player did decide to move even if the target is under their own feet.
   *
   * The offset is not normalized here: `advanceCommandUnit` normalizes whatever it is given,
   * so a magnitude carries no meaning and inventing one would be a second speed rule.
   */
  pointerDrag(state: Readonly<BattleState>, offset: Vec2, phase: PointerPhase): boolean {
    const clamped =
      Math.hypot(offset.x, offset.y) < ARRIVE_EPSILON ? { x: 0, y: 0 } : { x: offset.x, y: offset.y }
    const accepted = this.push(state, {
      kind: 'set-move',
      move: clamped,
      keydown: phase === 'down',
    })
    if (accepted) this.pointerOffset = clamped
    return accepted
  }

  /** The pointer comes up: the axis falls back to whatever keys are still held. */
  pointerRelease(state: Readonly<BattleState>): boolean {
    if (this.pointerOffset === null) return false
    this.pointerOffset = null
    return this.push(state, {
      kind: 'set-move',
      move: sumHeldKeys(this.heldMoveKeys),
      keydown: false,
    })
  }

  /**
   * §1.15's "지속 입력을 해제" for the DEVICE side — the state side is `applyBattleCommands`'s.
   *
   * Both halves are needed and they live in different places: clearing only `state.input` would
   * let the next keyup rebuild an axis out of keys the paused game already forgot.
   */
  clearHeld(): void {
    this.heldMoveKeys.clear()
    this.pointerOffset = null
  }

  /** Everything enqueued since the last drain, oldest first, and the queue is empty after. */
  drain(): BattleCommand[] {
    const drained = this.pending
    this.pending = []
    return drained
  }

  /** Drop pending commands without applying them, for a restart. */
  reset(): void {
    this.pending = []
    this.clearHeld()
  }
}
