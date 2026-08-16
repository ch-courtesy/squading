import { createGameplaySimulation } from '../core/gameplay/simulation'
import type { BattleMode, GameInputEvent, GameState, Vec2 } from '../core/gameplay/types'
import type { GameRenderer } from '../renderers/contract'
import { loadGameplayRenderer } from '../renderers/registry'
import { createGameplayInputAdapter } from './gameplay-input'

const STEP_MS = 1000 / 30
const MAX_STEPS_PER_FRAME = 5
const STEP_EPSILON_MS = 0.001

const CLEARS_PERSISTENT_INPUT: readonly BattleMode[] = ['paused', 'awaiting-upgrade', 'won', 'lost']

type FrameRequester = (callback: FrameRequestCallback) => number
type FrameCanceller = (id: number) => void

export type GameplayControllerOptions = {
  readonly host: HTMLElement
  readonly seed: string
  readonly loadRenderer?: () => Promise<GameRenderer>
  readonly requestFrame?: FrameRequester
  readonly cancelFrame?: FrameCanceller
  readonly isVisible?: () => boolean
  readonly onError?: (error: Error) => void
}

export interface GameplayController {
  start(): Promise<void>
  beginBattle(): void
  subscribe(listener: (state: Readonly<GameState>) => void): () => void
  chooseUpgrade(index: 0 | 1 | 2): void
  togglePause(): void
  pointerDown(target: Vec2): void
  pointerMove(target: Vec2): void
  pointerEnd(): void
  restart(): void
  getState(): Readonly<GameState>
  dispose(): void
}

export function createGameplayController(options: GameplayControllerOptions): GameplayController {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const load = options.loadRenderer ?? loadGameplayRenderer
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden')

  const simulation = createGameplaySimulation({ seed: options.seed })
  let sequence = 0
  let renderer: GameRenderer | null = null
  let frameId: number | null = null
  let generation = 0
  let lastFrameAt: number | null = null
  let accumulatorMs = 0
  let previousMode: BattleMode = simulation.getState().mode
  const listeners = new Set<(state: Readonly<GameState>) => void>()

  const notify = (): void => {
    const state = simulation.getState()
    listeners.forEach((listener) => listener(state))
  }

  const syncModeTransition = (): void => {
    const mode = simulation.getState().mode
    if (mode === previousMode) return
    if (CLEARS_PERSISTENT_INPUT.includes(mode)) inputAdapter.clearPersistent()
    previousMode = mode
  }

  const enqueue = (event: GameInputEvent): void => {
    simulation.enqueue(event)
    syncModeTransition()
    notify()
  }

  const inputAdapter = createGameplayInputAdapter({
    getTick: () => simulation.getState().combatTick,
    getMode: () => simulation.getState().mode,
    emit: enqueue,
    nextSequence: () => sequence++,
  })

  const forcePauseIfRunning = (): void => {
    const state = simulation.getState()
    if (state.mode !== 'running') return
    enqueue({ applyTick: state.combatTick, sequence: sequence++, kind: 'toggle-pause' })
  }

  const onBlur = (): void => forcePauseIfRunning()
  const onVisibilityChange = (): void => {
    if (document.hidden) forcePauseIfRunning()
  }

  const onResize = (): void => {
    const token = generation
    try {
      if (renderer) renderer.resize(options.host.clientWidth, options.host.clientHeight, window.devicePixelRatio || 1)
    } catch (error) {
      fail(error, token)
    }
  }

  const fail = (error: unknown, token: number): void => {
    if (token !== generation) return
    const original = asError(error)
    stopActive()
    options.onError?.(original)
  }

  const stopActive = (): Error | null => {
    generation += 1
    if (frameId !== null) cancelFrame(frameId)
    frameId = null
    window.removeEventListener('resize', onResize)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    inputAdapter.dispose()
    const previous = renderer
    renderer = null
    return safeDispose(previous)
  }

  const renderFrame = (token: number, timestamp: number): void => {
    if (token !== generation || !renderer) return
    try {
      if (!isVisible()) {
        accumulatorMs = 0
        lastFrameAt = timestamp
        renderer.render(simulation.getSnapshot(), 0)
        notify()
        if (token === generation) frameId = requestFrame((next) => renderFrame(token, next))
        return
      }
      if (lastFrameAt !== null) {
        const durationMs = timestamp - lastFrameAt
        accumulatorMs += durationMs
        let steps = 0
        while (accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
          simulation.step()
          accumulatorMs -= STEP_MS
          steps += 1
        }
        if (steps === MAX_STEPS_PER_FRAME && accumulatorMs >= STEP_MS - STEP_EPSILON_MS) accumulatorMs = 0
      }
      lastFrameAt = timestamp
      syncModeTransition()
      renderer.render(simulation.getSnapshot(), interpolationAlpha(accumulatorMs))
      notify()
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
    let ownsLoadedRenderer = false
    try {
      loaded = await load()
      if (token !== generation) {
        safeDispose(loaded)
        return
      }
      renderer = loaded
      ownsLoadedRenderer = true
      await loaded.mount(options.host)
      if (token !== generation) return
      loaded.applyQuality('full')
      onResize()
      if (token !== generation) return
      window.addEventListener('resize', onResize)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onVisibilityChange)
      inputAdapter.attach()
      frameId = requestFrame((timestamp) => renderFrame(token, timestamp))
    } catch (error) {
      if (token !== generation) {
        if (!ownsLoadedRenderer) safeDispose(loaded)
        return
      }
      fail(error, token)
    }
  }

  return {
    start,
    beginBattle: () => {
      enqueue({ applyTick: 0, sequence: sequence++, kind: 'start-battle' })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    chooseUpgrade: (index) => {
      const state = simulation.getState()
      if (state.mode !== 'awaiting-upgrade') return
      enqueue({ applyTick: state.combatTick, sequence: sequence++, kind: 'choose-upgrade', index })
    },
    togglePause: () => {
      const state = simulation.getState()
      if (state.mode !== 'running' && state.mode !== 'paused') return
      enqueue({ applyTick: state.combatTick, sequence: sequence++, kind: 'toggle-pause' })
    },
    pointerDown: (target) => inputAdapter.pointerDown(target),
    pointerMove: (target) => inputAdapter.pointerMove(target),
    pointerEnd: () => inputAdapter.pointerEnd(),
    restart: () => {
      simulation.restart()
      sequence = 0
      lastFrameAt = null
      accumulatorMs = 0
      previousMode = simulation.getState().mode
      inputAdapter.clearPersistent()
      notify()
    },
    getState: () => simulation.getState(),
    dispose: () => {
      const cleanupError = stopActive()
      if (cleanupError) options.onError?.(cleanupError)
    },
  }
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

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function interpolationAlpha(accumulatorMs: number): number {
  if (!Number.isFinite(accumulatorMs)) return 0
  return Math.min(Math.max(accumulatorMs / STEP_MS, 0), 1 - Number.EPSILON)
}
