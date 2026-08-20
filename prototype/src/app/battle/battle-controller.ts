// The v2 driver: wall-clock frames in, §1.1's fixed 30 Hz steps out (§6, batch G).
//
// ---------------------------------------------------------------------------
// WHICH ENTRY POINT IT DRIVES, AND WHY IT MATTERS
// ---------------------------------------------------------------------------
// `createBattle` — the facade in `core/battle/battle.ts`, and nothing else. §4.3 compares a
// headless replay against a real-time browser one, and that comparison only means anything
// if both are driving the same object: batch F's `runPolicySeed` drives `createBattle`, so
// this drives `createBattle`. It never calls `advanceBattleTick` itself, and in particular it
// never writes `commandBatch(queue.drain().drain())` — the spelling that compiles while
// dropping the device half of §1.15's pause release.
//
// ---------------------------------------------------------------------------
// WHAT IT GIVES THE SHELL
// ---------------------------------------------------------------------------
// `hud()` and `snapshot()` — the two projections — plus §1.15's public commands. THIS FILE IS
// THE ONLY PLACE `battle.state()` IS CALLED, and every call hands the result straight to a
// projection without reading a field off it. The shell has no way to reach `BattleState` at
// all, which is the boundary §6 asks for and the one v1 lost.
//
// ---------------------------------------------------------------------------
// HIDDEN TABS (§1.1, §1.15)
// ---------------------------------------------------------------------------
// "hidden은 mode가 아니다": the core advances only when it is asked to, and not asking is this
// file's job. Two things do it, and they are different. `isVisible()` gates the STEP — a hidden
// frame draws and notifies but never calls `battle.step()`, and it drops the accumulator so the
// backlog is not paid out on the way back. `visibilitychange` and `blur` additionally enqueue a
// pause, so a player who tabbed away comes back to a stopped battle rather than to whatever the
// enemies did next. Nothing under `src/core` can see either signal, and no core test can catch
// a driver that gets this wrong; `tests/app/battle-controller.test.ts` and §4.4's browser gate
// are what stand there instead.

import { createBattle, type Battle } from '../../core/battle/battle'
import type { PointerPhase } from '../../core/battle/input'
import type { Vec2 } from '../../core/battle/types'
import type { ResolvedTick } from '../../core/battle/tick'
import { projectBattleHud, type BattleHud } from '../../core/battle-view/hud'
import { BATTLE_TICKS_PER_SECOND, projectBattleSnapshot } from '../../core/battle-view/snapshot'
import type { RenderSnapshot } from '../../core/types'
import type { GameRenderer } from '../../renderers/contract'
import { loadBattleRenderer } from '../../renderers/registry'
import { applyBattleInput, type BattleInputEvent, type RecordedInput } from './battle-replay'

/** §1.1's step, in wall-clock milliseconds. */
export const STEP_MS = 1000 / BATTLE_TICKS_PER_SECOND

/**
 * How much of a stall one frame may pay off.
 *
 * A frame that has been away for a second must not run thirty ticks and hand the player a
 * battle that already happened. The remainder is dropped rather than banked.
 */
export const MAX_STEPS_PER_FRAME = 5

/**
 * The slack on the step comparison, and it is not cosmetic.
 *
 * `STEP_MS` is 33.333..., which binary floating point cannot hold, so a run of frames that are
 * each exactly one step long accumulates a deficit: ten of them sum to a hair UNDER ten steps
 * and the tenth tick never fires. Measured on this suite before the slack existed — 29 ticks
 * from a full second at 60 Hz, and 9 from ten one-step frames. A thousandth of a millisecond is
 * far below any real frame time and far above the error.
 */
const STEP_EPSILON_MS = 0.001
const STEP_THRESHOLD_MS = STEP_MS - STEP_EPSILON_MS

/**
 * How many frames of CPU timing are kept for §4.3.
 *
 * Its scenario is the FINAL 300 ticks, and a 60 Hz display draws two frames per 30 Hz tick — so
 * 600 would be the exact minimum and any dropped frame would cut into the window. 2000 leaves
 * room and still bounds the array.
 */
const FRAME_SAMPLE_LIMIT = 2000

/**
 * One frame's CPU cost, in milliseconds, against the tick it left the battle on.
 *
 * `ms` is the whole frame callback, which is the number §4.3 budgets. The four phase fields
 * split it, because a bare maximum cannot be acted on: batch G measured a 181 ms worst frame
 * and could not say whether it was simulation, projection, draw or HUD, and "add more geometry
 * next to an unexplained number" is the one move that turns an unknown into a regression. The
 * phases are measured with the same clock and sum to slightly less than `ms` (the sample push
 * and the loop bookkeeping are outside them).
 */
export type FrameSample = {
  tick: number
  ms: number
  /** How many `battle.step()` calls this frame ran — 0 to `MAX_STEPS_PER_FRAME`. */
  steps: number
  /** Time inside `battle.step()`: the authority's own tick cost. */
  sim: number
  /** Time building the `RenderSnapshot` the renderer is handed. */
  project: number
  /** Time inside `renderer.render()`. */
  draw: number
  /** Time inside `notify()`: the HUD projection and the DOM writes that follow it. */
  hud: number
}

type FrameRequester = (callback: FrameRequestCallback) => number
type FrameCanceller = (id: number) => void

export type BattleControllerOptions = {
  readonly host: HTMLElement
  readonly seed: string
  readonly loadRenderer?: () => Promise<GameRenderer>
  readonly requestFrame?: FrameRequester
  readonly cancelFrame?: FrameCanceller
  readonly isVisible?: () => boolean
  readonly now?: () => number
  readonly onError?: (error: Error) => void
}

export interface BattleController {
  start(): Promise<void>
  /** §1.15 has no "start" command: `ready -> running` is the facade's own verb. */
  begin(): void
  restart(seed?: string): void
  subscribe(listener: (hud: BattleHud) => void): () => void
  hud(): BattleHud
  snapshot(): RenderSnapshot
  seed(): string
  /** §1.17's digest of the run as it stands, for §4.3's comparison. */
  digest(): string
  keyDown(code: string): void
  keyUp(code: string): void
  pointerDrag(offset: Vec2, phase: PointerPhase): void
  pointerRelease(): void
  chooseUpgrade(slot: number): void
  togglePause(): void
  /** Every input the battle accepted, in order, tagged by step (§4.3). */
  inputLog(): readonly RecordedInput[]
  /** How many times `step()` has been called on this run — the replay's loop bound. */
  stepCount(): number
  frameSamples(): readonly FrameSample[]
  dispose(): void
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function safeDispose(renderer: GameRenderer | null): Error | null {
  if (!renderer) return null
  try {
    renderer.dispose()
    return null
  } catch (error) {
    return asError(error)
  }
}

function interpolationAlpha(accumulatorMs: number): number {
  if (!Number.isFinite(accumulatorMs)) return 0
  return Math.min(Math.max(accumulatorMs / STEP_MS, 0), 1 - Number.EPSILON)
}

export function createBattleController(options: BattleControllerOptions): BattleController {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const load = options.loadRenderer ?? loadBattleRenderer
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden')
  const now = options.now ?? (() => performance.now())

  let battle: Battle = createBattle(options.seed)
  let renderer: GameRenderer | null = null
  let frameId: number | null = null
  let generation = 0
  let lastFrameAt: number | null = null
  let accumulatorMs = 0
  let steps = 0
  let inputLog: RecordedInput[] = []
  let frameSamples: FrameSample[] = []
  const listeners = new Set<(hud: BattleHud) => void>()

  /**
   * The ticks THIS FRAME ran, waiting to be projected (§액션 피드백).
   *
   * A blow is an event and `BattleState` holds no events — §1.17's no-scratch rule reserves the
   * state for what a later tick reads, and one "attacks this tick" field would invalidate all
   * three seed digests. `battle.step()` already hands its whole derived tick back, so the frame
   * loop keeps them here and the projection turns them into `RenderActionEvent`s. This is a
   * DISPLAY path: nothing is written back, and `src/core/battle` is untouched by all of it.
   *
   * It is DRAINED by `snapshot()` rather than merely overwritten, and that is the difference
   * between an animation and a repeat. A frame's events belong to that frame's draw; a snapshot
   * read from outside the loop — a test, the capture harness, a shell reading the board — is a
   * read of where things ARE, and handing it a backlog of blows would play each of them twice.
   */
  let pendingTicks: ResolvedTick[] = []

  // The one place the authoritative state is read, and it is read only to project it.
  const hud = (): BattleHud => projectBattleHud(battle.state())
  const snapshot = (): RenderSnapshot => {
    const ticks = pendingTicks
    pendingTicks = []
    return projectBattleSnapshot(battle.state(), ticks)
  }

  const notify = (): void => {
    const view = hud()
    listeners.forEach((listener) => {
      try {
        listener(view)
      } catch (error) {
        options.onError?.(asError(error))
      }
    })
  }

  /**
   * Push one input at the battle and, if §1.15 accepted it, write it into §4.3's log.
   *
   * The log records what was ACCEPTED, not what the player did with their hands: a replay
   * feeds these back through the same verbs against the same states, so an input refused here
   * would be refused there too — and recording it would make the two runs disagree about the
   * queue's held-key set, which is the one piece of device state a replay has to rebuild.
   */
  const send = (event: BattleInputEvent): void => {
    if (!applyBattleInput(battle, event)) return
    inputLog.push({ step: steps, event })
  }

  const stopActive = (): Error | null => {
    generation += 1
    if (frameId !== null) cancelFrame(frameId)
    frameId = null
    window.removeEventListener('resize', onResize)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    const previous = renderer
    renderer = null
    return safeDispose(previous)
  }

  const fail = (error: unknown, token: number): void => {
    if (token !== generation) return
    const original = asError(error)
    const cleanupError = stopActive()
    options.onError?.(original)
    if (cleanupError) options.onError?.(cleanupError)
  }

  function onResize(): void {
    const token = generation
    try {
      renderer?.resize(
        options.host.clientWidth,
        options.host.clientHeight,
        window.devicePixelRatio || 1,
      )
    } catch (error) {
      fail(error, token)
    }
  }

  const pauseIfRunning = (): void => {
    if (battle.mode() !== 'running') return
    send({ kind: 'command', command: { kind: 'toggle-pause' } })
    notify()
  }

  function onBlur(): void {
    pauseIfRunning()
  }

  function onVisibilityChange(): void {
    if (document.hidden) pauseIfRunning()
  }

  /** The phase timings of the frame being drawn right now, reset at its head. */
  let phase = { steps: 0, sim: 0, project: 0, draw: 0, hud: 0 }

  const recordFrame = (startedAt: number): void => {
    frameSamples.push({
      tick: battle.state().combatTick,
      ms: now() - startedAt,
      steps: phase.steps,
      sim: phase.sim,
      project: phase.project,
      draw: phase.draw,
      hud: phase.hud,
    })
    if (frameSamples.length > FRAME_SAMPLE_LIMIT) frameSamples.shift()
  }

  /** `renderer.render(snapshot(), alpha)`, with the projection and the draw timed apart. */
  const drawFrame = (alpha: number): void => {
    const beforeProject = now()
    const view = snapshot()
    const beforeDraw = now()
    phase.project = beforeDraw - beforeProject
    renderer!.render(view, alpha)
    phase.draw = now() - beforeDraw
  }

  const notifyTimed = (): void => {
    const beforeHud = now()
    notify()
    phase.hud = now() - beforeHud
  }

  const renderFrame = (token: number, timestamp: number): void => {
    if (token !== generation || !renderer) return
    const startedAt = now()
    phase = { steps: 0, sim: 0, project: 0, draw: 0, hud: 0 }
    try {
      // §1.15: hidden is not a mode, so the core cannot refuse this — not asking is the whole
      // enforcement. The accumulator is dropped with it, so nothing is owed on return.
      if (!isVisible()) {
        accumulatorMs = 0
        lastFrameAt = timestamp
        // Nothing was stepped, so nothing happened to report — and the last visible frame's
        // blows must not be replayed into this one.
        pendingTicks = []
        drawFrame(0)
        notifyTimed()
        recordFrame(startedAt)
        if (token === generation) frameId = requestFrame((next) => renderFrame(token, next))
        return
      }
      if (lastFrameAt !== null) {
        accumulatorMs += timestamp - lastFrameAt
        let ran = 0
        const beforeSim = now()
        while (accumulatorMs >= STEP_THRESHOLD_MS && ran < MAX_STEPS_PER_FRAME) {
          // EVERY tick that ran contributes, in the order it ran. Three ticks in one frame is
          // the measured normal here, and keeping only the last would delete two thirds of a
          // volley — every one of them a shot the player fired and never saw.
          const result = battle.step()
          if (result.ran) pendingTicks.push(result)
          steps += 1
          accumulatorMs -= STEP_MS
          ran += 1
        }
        if (ran === MAX_STEPS_PER_FRAME && accumulatorMs >= STEP_THRESHOLD_MS) accumulatorMs = 0
        phase.steps = ran
        phase.sim = now() - beforeSim
      }
      lastFrameAt = timestamp
      drawFrame(interpolationAlpha(accumulatorMs))
      notifyTimed()
      recordFrame(startedAt)
      if (token === generation) frameId = requestFrame((next) => renderFrame(token, next))
    } catch (error) {
      fail(error, token)
    }
  }

  const start = async (): Promise<void> => {
    const cleanupError = stopActive()
    if (cleanupError) {
      options.onError?.(cleanupError)
      return
    }
    lastFrameAt = null
    accumulatorMs = 0
    const token = ++generation
    let loaded: GameRenderer | null = null
    let owned = false
    try {
      loaded = await load()
      if (token !== generation) {
        safeDispose(loaded)
        return
      }
      renderer = loaded
      owned = true
      await loaded.mount(options.host)
      if (token !== generation) return
      loaded.applyQuality('full')
      onResize()
      if (token !== generation) return
      // PRIME THE RENDERER BEFORE THE LOOP, and this is a measured fix rather than a
      // precaution. The diorama renderer builds every procedural asset it owns — board and
      // frame textures, the merged miniature bodies, the terrain surround, the board decals,
      // the particle pools — on the FIRST snapshot it is handed, and the draw that follows is
      // where every shader in the scene compiles and every texture uploads. Batch J measured
      // that first call at 99-112 ms (41.8 ms of it construction, the rest the first draw)
      // against §4.3's 20 ms frame ceiling. Inside the loop it was the battle's opening frame,
      // and the sim then caught up three ticks at once. Here it is part of the load the player
      // is already waiting through, and no frame carries it.
      //
      // It is not free — the wait before the first frame is the same length — but it is no
      // longer a frame, and it is no longer a stutter after the battle has started.
      loaded.render(snapshot(), 0)
      if (token !== generation) return
      window.addEventListener('resize', onResize)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onVisibilityChange)
      frameId = requestFrame((timestamp) => renderFrame(token, timestamp))
    } catch (error) {
      if (token !== generation) {
        if (!owned) safeDispose(loaded)
        return
      }
      fail(error, token)
    }
  }

  return {
    start,
    begin(): void {
      battle.start()
      notify()
    },
    restart(seed?: string): void {
      battle.restart(seed)
      steps = 0
      inputLog = []
      frameSamples = []
      // The finished run's last frame must not animate on the new run's first one.
      pendingTicks = []
      lastFrameAt = null
      accumulatorMs = 0
      notify()
    },
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hud,
    snapshot,
    seed: () => battle.seed(),
    digest: () => battle.digest(),
    keyDown(code: string): void {
      send({ kind: 'keyDown', code })
      notify()
    },
    keyUp(code: string): void {
      send({ kind: 'keyUp', code })
      notify()
    },
    pointerDrag(offset, phase): void {
      send({ kind: 'pointerDrag', offset: { x: offset.x, y: offset.y }, phase })
      notify()
    },
    pointerRelease(): void {
      send({ kind: 'pointerRelease' })
      notify()
    },
    chooseUpgrade(slot: number): void {
      send({ kind: 'command', command: { kind: 'choose-upgrade', slot } })
      notify()
    },
    togglePause(): void {
      send({ kind: 'command', command: { kind: 'toggle-pause' } })
      notify()
    },
    inputLog: () => inputLog,
    stepCount: () => steps,
    frameSamples: () => frameSamples,
    dispose(): void {
      const cleanupError = stopActive()
      if (cleanupError) options.onError?.(cleanupError)
    },
  }
}
