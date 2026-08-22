// The public face of the battle core (§6: "렌더러·셸·컨트롤러는 표시 전용 스냅샷과 공개
// command만 쓴다").
//
// One object that batch G's controller and batch F's headless harness can both drive, because
// §4.3 measures them against each other: "같은 seed·같은 입력 로그를 헤드리스 재생과 실시간
// 브라우저 재생에서 돌려 승패와 종료 tick이 일치해야 한다". That comparison only means
// anything if both are driving the same code, so this is the only entry point either of them
// gets, and it is six verbs wide: create, start, input, step, read, restart.
//
// IT IS DISPLAY-AGNOSTIC ON PURPOSE. No camera, no snapshot, no projection, no frame timing —
// `state()` hands back the authoritative state and batch G decides what to draw from it. A
// renderer projection here would put a display decision inside the module the digest walks.
//
// WHAT IT DOES NOT DO, AND CANNOT:
//
//   * IT DOES NOT DRIVE ITSELF. There is no loop, no `requestAnimationFrame`, no timer, no
//     clock of any kind — §1.17 forbids wall-clock in the rules, and a fixed-step driver is
//     the shell's job (`src/app` already has one for v1).
//   * IT CANNOT SEE A HIDDEN TAB. §1.1 stops the clock in `paused`, `awaiting-upgrade` AND
//     hidden; `advanceBattleTick` enforces the first two because they are modes it owns, and
//     the third is not a mode at all — it is a fact about a document. The honest statement is
//     that a hidden tab must not be STEPPED, and that only batch G can arrange it (pausing on
//     `visibilitychange`, or simply not stepping). Nothing in this file can check it, and this
//     comment is not pretending otherwise.

import { digestBattleState } from './digest'
import {
  BattleInputQueue,
  type BattleCommand,
  type PointerPhase,
} from './input'
import { FIRST_STAGE_ID, type StageId } from './stages'
import { createInitialBattleState } from './state'
import { advanceBattleTick, type TickResult } from './tick'
import type { BattleMode, BattleState, CarriedSquad, Vec2 } from './types'

/**
 * What a stage is, beyond its seed (campaign design §3.1, §1.1).
 *
 * Both fields DEFAULT to the campaign's first stage, so `createBattle(seed)` is exactly stage 1 of
 * campaign `seed` — which is what keeps every fixture, every recorded seed band and both §4.4
 * browser routes meaning the same run they meant before the campaign existed.
 */
export type BattleOptions = {
  readonly stageId?: StageId
  /** §1.1's relay. Null is a fresh 16 with drawn names (§1.14). */
  readonly carried?: CarriedSquad | null
}

export type Battle = {
  /** The root seed of the run in progress (§1.17). */
  seed(): string
  /**
   * The authoritative state (§1). Call it again after a `restart` — that replaces the object,
   * and a reference kept across one is a reference to the previous run.
   */
  state(): BattleState
  mode(): BattleMode
  /** §1.17's replay digest of the state as it stands. */
  digest(): string
  /** `ready` -> `running`. A no-op in any other mode, so a second call cannot restart a run. */
  start(): void
  /** §1.15: enqueue a command, or refuse it. Returns whether it was accepted. */
  enqueue(command: BattleCommand): boolean
  /** §1.15: a key going down, by `event.code`. */
  keyDown(code: string): boolean
  /** §1.15: a key coming up, by `event.code`. */
  keyUp(code: string): boolean
  /** §1.15: a pointer drag, as the world-space offset from the command unit to the target. */
  pointerDrag(offset: Vec2, phase: PointerPhase): boolean
  pointerRelease(): boolean
  /** Commands waiting for the next step. Zero at every tick boundary, by construction. */
  pendingInputCount(): number
  /** One tick of §1.16, or none if §1.1's clock gate refuses it. */
  step(): TickResult
  /**
   * A new run from the same seed, or from `seed` if one is given.
   *
   * The STAGE and the carried squad are the ones this battle was created with: restarting is
   * replaying this stage, not restarting the campaign. Campaign §1.4 gives no stage retry — the
   * campaign facade is what owns "start over", and it starts over at stage 1.
   */
  restart(seed?: string): void
}

export function createBattle(seed: string, options: BattleOptions = {}): Battle {
  const stageId = options.stageId ?? FIRST_STAGE_ID
  const carried = options.carried ?? null
  let rootSeed = seed
  let state = createInitialBattleState(rootSeed, stageId, carried)
  const queue = new BattleInputQueue()

  return {
    seed: () => rootSeed,
    state: () => state,
    mode: () => state.mode,
    digest: () => digestBattleState(state),

    start(): void {
      if (state.mode === 'ready') state.mode = 'running'
    },

    enqueue: (command) => queue.push(state, command),
    keyDown: (code) => queue.keyDown(state, code),
    keyUp: (code) => queue.keyUp(state, code),
    pointerDrag: (offset, phase) => queue.pointerDrag(state, offset, phase),
    pointerRelease: () => queue.pointerRelease(state),
    pendingInputCount: () => queue.size,

    step(): TickResult {
      // The queue's SOURCE goes in, not the commands it holds: `drain()` hands over both halves
      // of §1.15's "일시정지 진입 시 지속 입력을 해제한다" at once, and the reducer drives both —
      // which is what makes this facade one driver among equals rather than the only correct one.
      return advanceBattleTick(state, queue.drain())
    },

    restart(nextSeed?: string): void {
      rootSeed = nextSeed ?? rootSeed
      state = createInitialBattleState(rootSeed, stageId, carried)
      // Both halves again: pending commands from the finished run must not land on the new
      // one, and a key held through the restart must not survive as an axis nobody pressed.
      queue.reset()
    },
  }
}
