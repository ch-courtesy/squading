// §1.15 입력 — the queue between a device and `state.input`.
//
// The whole module is display-agnostic: it takes `event.code` strings and world-space
// offsets, never a DOM event, a canvas or a camera. Batch G wires real listeners to
// `keyDown`/`keyUp`/`pointerDrag`; the headless harness (batch F) enqueues the same commands
// from a log. Both drive the identical path, which is what §4.3 asks for ("같은 seed·같은
// 입력 로그를 헤드리스 재생과 실시간 브라우저 재생에서" agreeing).
//
// Four shapes here are rules, not conveniences:
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
//   3. A FORBIDDEN INPUT IS NEVER QUEUED, AND IS REFUSED AGAIN WHEN IT IS APPLIED. §1.15:
//      "금지 상황의 입력은 queue에 넣지 않는다." The enqueue filter is the half that clause names
//      and the reason it is worth having: refusing only at apply time would let a paused battle
//      bank a burst of movement that all lands on resume. But the queue is a FAST PATH, not the
//      enforcer — `advanceBattleTick` and `applyBattleCommands` are public too, and batch F's
//      policies build commands without a queue anywhere near them. So `applyBattleCommands`
//      runs the same predicate over the batch it is handed. Both answers come from
//      `commandIsAllowed`, so asking twice cannot disagree.
//   4. A RELEASE IS NOT A FORBIDDEN INPUT WHILE THE RUN CAN STILL CONTINUE. §1.15's 금지 상황
//      gates the START of an input. Refusing a `keyup` does not stop the player from having let go
//      of the key; it only makes `state.input` claim they did not, and §1.11's lock condition
//      ("그 tick의 이동 입력 벡터가 0") is then unreachable for as long as the phantom axis lasts.
//      That reason reaches `ready`, `running`, `paused` and `awaiting-upgrade`, and stops at the
//      verdict: a `won` or `lost` run has no play left to run on a false axis, so a release there
//      is only a write that moves §1.17's digest, and it is refused like a press
//      (`runCanContinue`). Two more places drop a release: the same-tick pause clause below,
//      because those commands were built from a held-key set the pause has already thrown away,
//      and a vector that is not finite (`isFiniteVector`).
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
import { chooseUpgradeCard, pendingUpgradeRound } from './upgrades'
import type { BattleMode, BattleState, Vec2 } from './types'

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

/**
 * The table lookup, and the ONLY way this module is allowed to read it.
 *
 * `MOVE_KEY_VECTORS` is an object, and every object answers to `toString`, `constructor`,
 * `valueOf` and `hasOwnProperty`. A bare `MOVE_KEY_VECTORS[code]` therefore says "yes, that is a
 * movement key" for four strings this game has never heard of, and the vector it hands back is a
 * FUNCTION: `sumHeldKeys` adds `undefined` to the axis and `state.input.move` becomes
 * `{NaN, NaN}`, which §1.17's digest normalizes to `null` — so two states corrupted in different
 * ways hash to the same value, which is the one thing the digest exists to prevent.
 *
 * `event.code` never produces those strings, but the queue is a public seam: batch F replays
 * serialized input logs through it and batch G feeds it whatever the DOM hands over.
 */
function moveVectorFor(code: string): Vec2 | null {
  return Object.hasOwn(MOVE_KEY_VECTORS, code) ? MOVE_KEY_VECTORS[code] : null
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
 * A movement vector the digest can tell apart from another one.
 *
 * §1.17 normalizes to 6 decimals and every non-finite number normalizes to `null`, so
 * `{NaN, NaN}`, `{Infinity, Infinity}` and `{-Infinity, NaN}` are ONE digest — two states
 * corrupted in different ways would hash the same, which is the collision the digest exists to
 * rule out. The core never computes these numbers: `sumHeldKeys` adds table entries and
 * `pointerDrag` is handed browser coordinates, and batch F builds `set-move` by hand from a
 * serialized log. Refusing the command is where that stops, because past here the axis is held
 * state and the next tick reads it as if the core had chosen it.
 */
function isFiniteVector(vector: Vec2): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y)
}

/**
 * The modes §1.15's release clause holds in — the ones a run can still continue from.
 *
 * The clause is there so a key the player let go of cannot stay held over the play that FOLLOWS.
 * `won` and `lost` have no play that follows, so the harm it prevents does not exist there, and
 * what is left is a write into `state.input` on a run that has already produced its verdict —
 * §1.17's digest moves under it. §4.3 compares a headless replay against a browser one BY digest,
 * and a trailing keyup that only one side sends is exactly the divergence it is looking for.
 */
function runCanContinue(mode: BattleMode): boolean {
  return mode !== 'won' && mode !== 'lost'
}

/**
 * §1.15's 금지 상황, as one predicate — plus the one well-formedness check a command carries.
 *
 * Exported because the queue is not the only enqueuer — batch F's policy harness and batch G's
 * controller both build commands, and a second copy of this rule is a second place for it to
 * drift. It is also what `applyBattleCommands` re-checks, so the three public entry points
 * (`Battle.step`, `advanceBattleTick`, `applyBattleCommands`) answer with one rule and not three.
 *
 * THE RULE GATES THE START OF AN INPUT, NOT ITS END (§1.15). A release — `keyup`, `Space` up, a
 * pointer coming off — is accepted in `ready`, `running`, `paused` and `awaiting-upgrade`.
 * Refusing one does not un-press the key; it makes `state.input` say a key is held that the
 * player let go of, and §1.11's lock ("그 tick의 이동 입력 벡터가 0") then cannot be satisfied at
 * all. In the command vocabulary that is `keydown === false` on a `set-move` and
 * `held === false` on a `set-rescue`. `won` and `lost` are the exception and `runCanContinue`
 * says why: there is no later tick to lie to there, only a digest to move.
 *
 * A CONTINUED POINTER DRAG WEARS THE SAME SHAPE, and is admitted on the same terms, which is
 * sound rather than an oversight: `pointerDrag` refuses a `'move'` with no pointer already down
 * (see it), and §1.15's pause release forgets the pointer along with the keys — so the only
 * `'move'` that survives into a non-`running` mode is one continuing a pointer that went down
 * while the battle was running, which is a held input and not a new one.
 *
 * The readings §1.15 does not write out, and why each is the one that needs no further rule:
 *
 *   * `ready` STARTS nothing, and still takes the news that a key came up: the run that follows
 *     would otherwise begin holding it.
 *   * `won` and `lost` take NOTHING — not a press and not a release. See `runCanContinue`.
 *   * a card key needs a round WAITING for a card, in any mode. §1.13's `chooseUpgradeCard`
 *     already refuses to un-pause a paused battle, so "choose while paused" is representable
 *     and harmless; a key that maps to no offered card is not.
 *   * `Escape` is refused while a card is waiting. §1.13 has already stopped the clock there,
 *     so a second stop adds nothing and would need a rule for which state Escape leaves —
 *     §1.15 does not write one. See the batch E report's §1 note.
 *
 * THE VECTOR CHECK IS NOT A MODE RULE and it lives here anyway, because this is the one gate all
 * three public entry points already share (`isFiniteVector` says what it costs to skip it). A
 * second home for it would be a second place for it to drift, which is the argument that put
 * §1.15's 금지 상황 here in the first place.
 */
export function commandIsAllowed(state: Readonly<BattleState>, command: BattleCommand): boolean {
  switch (command.kind) {
    case 'set-move':
      if (!isFiniteVector(command.move)) return false
      return state.mode === 'running' || (!command.keydown && runCanContinue(state.mode))
    case 'set-rescue':
      return state.mode === 'running' || (!command.held && runCanContinue(state.mode))
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
  /** §1.15: how many commands of this batch were refused, by either clause below. */
  discarded: number
  /**
   * True when a `toggle-pause` in this batch ENTERED pause — whether or not a later one in the
   * same batch resumed out of it. Sticky on purpose: what the pause released does not come back
   * just because the battle is running again by the end of the batch, and the driver's device
   * state has to be cleared on the strength of the pause having happened at all.
   */
  pauseEntered: boolean
}

/**
 * Where a tick's commands come from, and where the news of applying them goes back to.
 *
 * Two methods rather than one array, because §1.15's pause release has TWO halves and a driver
 * that carries one without the other is the defect: `applyBattleCommands` zeroes `state.input`,
 * and whoever owns the device state has to forget which keys are down, or the next keyup
 * rebuilds an axis out of keys the paused game already threw away. The state half is the
 * reducer's and the device half is the source's, so the reducer takes a source and calls both.
 *
 * WHAT THE TYPE ACTUALLY BUYS, stated exactly, because the overstatement it replaces is what
 * made the hole look safe: `advanceBattleTick` refuses a raw `BattleCommand[]`, and
 * `BattleInputQueue.drain()` hands back one of these rather than an array, so neither of the two
 * spellings a driver reaches for first can lose the device half. It is NOT unrepresentable —
 * `commandBatch(queue.drain().drain())` type-checks and strands the queue exactly as before, and
 * so does an inline `{ drain: () => …, applied: () => {} }`. Nothing in this project catches
 * either. A driver that owns device state must hand over the source that owns it, and the type
 * makes that the easy path rather than the only one.
 */
export type BattleCommandSource = {
  /** This tick's commands, oldest first. The source holds none afterwards. */
  drain(): readonly BattleCommand[]
  /** What applying them did, in the same tick, before the clock gate has had its say. */
  applied(application: InputApplication): void
}

/**
 * A hand-built batch as a source, for a fixture or a policy that has no device behind it.
 *
 * `applied` IS A NO-OP, AND THAT IS ONLY SAFE WHEN NOTHING BEHIND THE ARRAY REMEMBERS ANYTHING.
 * An array does not own device state, but it can have come out of something that does: the
 * spelling this comment used to bless — wrapping a live queue's commands — left `applied` doing
 * nothing while the queue went on holding `KeyW` across a pause, which is the ghost axis
 * `{ x: 1, y: -1 }` that §1.15's release exists to prevent. `BattleInputQueue.drain()` now hands
 * back a source rather than an array, so that particular wrapping no longer compiles; nothing
 * checks the general case, and nothing can. USE THIS FOR COMMANDS YOU WROTE OUT BY HAND. If a
 * device is behind them, hand over the source the device owns.
 */
export function commandBatch(commands: readonly BattleCommand[]): BattleCommandSource {
  let pending: readonly BattleCommand[] = commands
  return {
    drain(): readonly BattleCommand[] {
      const drained = pending
      pending = []
      return drained
    },
    applied(): void {},
  }
}

/**
 * The 입력 적용 row of §1.16's table (the table lives in `index.ts`).
 *
 * Commands apply in queue order, first to last, and the last writer wins — which is why the
 * queue may enqueue a `set-move` per key event without collapsing them: three events in one
 * tick leave the axis at the third one's value, which is the axis the player is actually
 * holding.
 *
 * TWO CLAUSES REFUSE A COMMAND HERE, and they are different rules:
 *
 *   * §1.15's second pause clause, the `pauseEntered` branch: once a pause has been applied, the
 *     movement and rescue commands still sitting behind it in the SAME batch are dropped — every
 *     one of them, releases included. They were built from a held-key set the pause has since
 *     released, so applying one would rebuild the axis the pause just took away.
 *   * §1.15's 금지 상황, re-checked against the state as it stands. The queue already refused
 *     these at enqueue; this is the copy that holds for the OTHER two public entry points, which
 *     have no queue in front of them. Both readings come from `commandIsAllowed`.
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
    if (!commandIsAllowed(state, command)) {
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
        // Unreachable: `commandIsAllowed` above has already refused a slot with no round behind
        // it. Kept as the assertion that the two never drift — `chooseUpgradeCard`'s own
        // argument is that a drifted mapping must fail where it is wrong rather than pick a card.
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
    const vector = moveVectorFor(code)
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
 *
 * It MAKES a `BattleCommandSource` — `drain()` — and that is how it reaches `advanceBattleTick`:
 * owning device state is exactly what makes §1.15's pause release have a second half, so the
 * value that carries this tick's commands is the value that carries the callback clearing it.
 */
export class BattleInputQueue {
  private pending: BattleCommand[] = []
  private heldMoveKeys = new Set<string>()
  private pointerOffset: Vec2 | null = null

  /**
   * The queue's two halves, bound together in one value: this tick's commands, and what to do
   * with the news of having applied them.
   *
   * It is a private field and `drain()` is the only way to a reference, so the halves are handed
   * over together or not at all. `applied` is §1.15's device side of the pause release —
   * `applyBattleCommands` zeroed `state.input`, and this forgets which keys were down so that
   * resuming cannot rebuild an axis out of them. It fires on `pauseEntered` whether or not a
   * later `toggle-pause` in the same batch resumed the battle: the pause happened, and the
   * movement commands behind it in that batch were discarded on the same grounds.
   */
  private readonly source: BattleCommandSource = {
    drain: (): readonly BattleCommand[] => {
      const drained = this.pending
      this.pending = []
      return drained
    },
    applied: (application: InputApplication): void => {
      if (application.pauseEntered) this.clearHeld()
    },
  }

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
   * use — including every name `Object.prototype` answers to, which is what `moveVectorFor`
   * is for — and for a code §1.15 forbids right now. The caller cannot tell the two apart, and
   * does not need to: both mean "nothing was queued".
   */
  keyDown(state: Readonly<BattleState>, code: string): boolean {
    const vector = moveVectorFor(code)
    if (vector) {
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

  /**
   * A key coming up. Only movement and `Space` have a release; the rest are edge-triggered.
   *
   * Built the same way round as `keyDown`: the held set is not touched until the command is
   * accepted. The asymmetry that used to be here — delete first, ask afterwards — is what made
   * a refused keyup leave the game holding a key nobody was pressing.
   */
  keyUp(state: Readonly<BattleState>, code: string): boolean {
    const vector = moveVectorFor(code)
    if (vector) {
      if (!this.heldMoveKeys.has(code)) return false
      const held = new Set(this.heldMoveKeys)
      held.delete(code)
      const accepted = this.push(state, {
        kind: 'set-move',
        move: this.pointerOffset ?? sumHeldKeys(held),
        keydown: false,
      })
      if (accepted) this.heldMoveKeys = held
      return accepted
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
   *
   * A `'move'` needs a pointer that is already down. A driver that sends one out of nowhere used
   * to capture the axis silently and then suppress every key until a `pointerRelease` it had no
   * reason to send; refusing it is also what keeps a drag from re-establishing an axis that
   * §1.15's pause release has just cleared, since the release forgets the pointer too.
   */
  pointerDrag(state: Readonly<BattleState>, offset: Vec2, phase: PointerPhase): boolean {
    if (phase === 'move' && this.pointerOffset === null) return false
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
   * let the next keyup rebuild an axis out of keys the paused game already forgot. `applied` is
   * what joins them on a pause; this is also called directly on a restart, where the whole run
   * goes rather than one pause.
   */
  clearHeld(): void {
    this.heldMoveKeys.clear()
    this.pointerOffset = null
  }

  /**
   * The queue as this tick's source: hand the result straight to `advanceBattleTick`.
   *
   * IT RETURNS THE SOURCE AND NOT THE COMMANDS, and that is the whole rule. An earlier shape had
   * this return `BattleCommand[]`, so `advanceBattleTick(state, queue.drain())` was a type error
   * — and the repair the compiler's message pointed at was `commandBatch(queue.drain())`, which
   * compiled, kept the state half, dropped the device half, and reproduced the ghost axis
   * `{ x: 1, y: -1 }` measured on `KeyW → Escape → Escape → KeyD`. The obvious spelling being
   * rejected is what made the wrong one look like the fix. Now the obvious spelling IS the fix,
   * and `commandBatch` no longer accepts what this hands back.
   *
   * The queue is still empty after the returned source is drained, and the source reads
   * `pending` when it is asked rather than when it is made — so taking one early and enqueueing
   * afterwards loses nothing.
   *
   * WHAT THIS DOES NOT DO: make the two halves unreachable apart. `queue.drain().drain()` is
   * still an array, and `commandBatch` will still take it. Nothing here or anywhere else catches
   * that; what is gone is the ONE-WORD spelling that a compiler error used to recommend.
   */
  drain(): BattleCommandSource {
    return this.source
  }

  /** Drop pending commands without applying them, for a restart. */
  reset(): void {
    this.pending = []
    this.clearHeld()
  }
}
