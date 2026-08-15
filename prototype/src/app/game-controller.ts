import { createSimulation } from '../core/simulation'
import type { RenderSnapshot, SimulationConfig, SimulationInput, SimulationResult, Squad } from '../core/types'
import { FrameMetrics } from '../metrics/frame-metrics'
import { QualityLadder, type QualityState } from '../metrics/quality-ladder'
import { exportReport, type HudMetrics } from '../metrics/report'
import type { GameRenderer, QualityLevel, RendererKind } from '../renderers/contract'
import { loadRenderer as loadRegisteredRenderer } from '../renderers/registry'
import { createRendererBenchmark } from '../scenarios/renderer-benchmark'

const STEP_MS = 1000 / 30
const MAX_STEPS_PER_FRAME = 5
const STEP_EPSILON_MS = 0.001

type FrameRequester = (callback: FrameRequestCallback) => number
type FrameCanceller = (id: number) => void

export type GameMode = 'manual' | 'benchmark'

export type GameControllerOptions = {
  readonly host: HTMLElement
  readonly kind: RendererKind
  readonly mode: GameMode
  readonly config: SimulationConfig
  readonly loadRenderer?: (kind: RendererKind) => Promise<GameRenderer>
  readonly now?: () => number
  readonly requestFrame?: FrameRequester
  readonly cancelFrame?: FrameCanceller
  readonly onHud?: (metrics: HudMetrics) => void
  readonly onError?: (error: Error) => void
  readonly onState?: (result: SimulationResult) => void
  readonly isVisible?: () => boolean
}

export interface GameController {
  start(): Promise<void>
  switchRenderer(kind: RendererKind): Promise<void>
  applyQuality(level: QualityLevel): void
  getHud(): HudMetrics
  getQualityState(): QualityState
  exportReport(): string
  restart(): void
  setPointer(moveX: number, moveY: number): void
  getSnapshot(): RenderSnapshot
  getActiveSquad(): Squad
  getResult(): SimulationResult
  getRendererDiagnostics(): unknown
  advanceForDiagnostics(ticks: number): void
  requestSquadSwitch(): void
  dispose(): void
}

export function createGameController(options: GameControllerOptions): GameController {
  const now = options.now ?? (() => performance.now())
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const load = options.loadRenderer ?? loadRegisteredRenderer
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden')
  const benchmark = options.mode === 'benchmark' ? createRendererBenchmark(options.config) : null
  const pressed = new Set<string>()
  let requestedSquadSwitch = false
  let pointer: { x: number; y: number } | null = null
  let simulation = createSimulation(options.config)
  let activeKind = options.kind
  let renderer: GameRenderer | null = null
  let frameId: number | null = null
  let generation = 0
  let lastFrameAt: number | null = null
  let accumulatorMs = 0
  let loadStartedAtMs: number | null = null
  let loadMs = 0
  let loadCompleted = false
  let metrics = new FrameMetrics()
  let quality = new QualityLadder((level) => applyRendererQuality(level, generation))
  let diagnosticFreeze = false

  const onResize = () => {
    const token = generation
    try {
      if (renderer) renderer.resize(options.host.clientWidth, options.host.clientHeight, window.devicePixelRatio || 1)
    } catch (error) {
      fail(error, token)
    }
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (options.mode !== 'manual') return
    if (event.key === 'Tab' || isControlKey(event.key)) event.preventDefault()
    pressed.add(event.key)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' && event.key !== ' ') pressed.delete(event.key)
  }

  const resetSessionState = () => {
    metrics = new FrameMetrics()
    quality = new QualityLadder((level) => applyRendererQuality(level, generation))
    pressed.clear()
    requestedSquadSwitch = false
    pointer = null
    lastFrameAt = null
    accumulatorMs = 0
    loadStartedAtMs = now()
    loadMs = 0
    loadCompleted = false
  }

  const stopActive = (): Error | null => {
    generation += 1
    if (frameId !== null) cancelFrame(frameId)
    frameId = null
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp)
    const previous = renderer
    renderer = null
    return safeDispose(previous)
  }

  const fail = (error: unknown, token: number) => {
    if (token !== generation) return
    const original = asError(error)
    stopActive()
    options.onError?.(original)
  }

  const renderFrame = (token: number, timestamp: number) => {
    if (token !== generation || !renderer) return
    try {
      if (!isVisible()) {
        if (lastFrameAt !== null) metrics.recordFrame(Number.NaN, timestamp)
        accumulatorMs = 0
        lastFrameAt = timestamp
        renderer.render(simulation.getSnapshot(), 0)
        if (loadStartedAtMs !== null) {
          loadMs = Math.max(0, now() - loadStartedAtMs)
          loadStartedAtMs = null
          loadCompleted = true
        }
        options.onHud?.(getHud())
        if (token === generation) frameId = requestFrame((nextTimestamp) => renderFrame(token, nextTimestamp))
        return
      }
      if (lastFrameAt !== null) {
        const durationMs = timestamp - lastFrameAt
        accumulatorMs += durationMs
        let steps = 0
        while (!diagnosticFreeze && accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
          simulation.step(nextInput())
          accumulatorMs -= STEP_MS
          steps += 1
        }
        if (steps === MAX_STEPS_PER_FRAME && accumulatorMs >= STEP_MS - STEP_EPSILON_MS) {
          accumulatorMs = 0
          metrics.recordFrame(Number.NaN, timestamp)
          quality.observeFrame(Number.NaN, timestamp)
        } else {
          metrics.recordFrame(durationMs, timestamp)
          quality.observeFrame(durationMs, timestamp)
        }
      }
      lastFrameAt = timestamp
      renderer.render(simulation.getSnapshot(), interpolationAlpha(accumulatorMs))
      publishResult()
      if (loadStartedAtMs !== null) {
        loadMs = Math.max(0, now() - loadStartedAtMs)
        loadStartedAtMs = null
        loadCompleted = true
      }
      publishHud(timestamp)
      if (token === generation) frameId = requestFrame((nextTimestamp) => renderFrame(token, nextTimestamp))
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
    resetSessionState()
    const token = ++generation
    let loaded: GameRenderer | null = null
    let ownsLoadedRenderer = false
    try {
      loaded = await load(activeKind)
      if (token !== generation) {
        safeDispose(loaded)
        return
      }
      renderer = loaded
      ownsLoadedRenderer = true
      await loaded.mount(options.host)
      if (token !== generation) {
        return
      }
      loaded.applyQuality('full')
      onResize()
      if (token !== generation) return
      window.addEventListener('resize', onResize)
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('keyup', onKeyUp)
      frameId = requestFrame((timestamp) => renderFrame(token, timestamp))
    } catch (error) {
      if (token !== generation) {
        if (!ownsLoadedRenderer) safeDispose(loaded)
        return
      }
      fail(error, token)
    }
  }

  const switchRenderer = async (kind: RendererKind): Promise<void> => {
    activeKind = kind
    simulation = createSimulation(options.config)
    await start()
  }

  const applyRendererQuality = (level: QualityLevel, token: number) => {
    if (token !== generation || !renderer) return
    try {
      renderer.applyQuality(level)
    } catch (error) {
      fail(error, token)
    }
  }

  const nextInput = (): SimulationInput => {
    if (benchmark) return benchmark.inputLog.at(simulation.getSnapshot().tick)
    const keyMoveX = Number(pressed.has('d') || pressed.has('ArrowRight')) - Number(pressed.has('a') || pressed.has('ArrowLeft'))
    const keyMoveY = Number(pressed.has('s') || pressed.has('ArrowDown')) - Number(pressed.has('w') || pressed.has('ArrowUp'))
    return {
      moveX: keyMoveX || pointer?.x || 0,
      moveY: keyMoveY || pointer?.y || 0,
      switchSquad: consumePressed('Tab') || consumeRequestedSquadSwitch(),
      rescue: consumePressed(' '),
    }
  }

  const consumePressed = (key: string): boolean => {
    const present = pressed.has(key)
    pressed.delete(key)
    return present
  }

  const consumeRequestedSquadSwitch = (): boolean => {
    const requested = requestedSquadSwitch
    requestedSquadSwitch = false
    return requested
  }

  const getHud = (): HudMetrics => {
    const summary = metrics.summary(now())
    const snapshot = simulation.getSnapshot()
    const rendererMetrics = renderer?.collectMetrics() ?? { drawCalls: null, textures: null, geometries: null }
    return {
      fps: summary.fps,
      p95Ms: summary.p95Ms,
      loadMs,
      activeUnits: snapshot.units.filter((unit) => unit.state !== 'dead').length,
      drawCalls: rendererMetrics.drawCalls,
      textures: rendererMetrics.textures,
      geometries: rendererMetrics.geometries,
      qualityLevel: quality.state().level,
    }
  }

  const publishHud = (timestamp: number) => {
    const hud = getHud()
    quality.observe(hud.p95Ms, timestamp)
    options.onHud?.({ ...hud, qualityLevel: quality.state().level })
  }

  const publishResult = () => options.onState?.(simulation.result)

  return {
    start,
    switchRenderer,
    applyQuality: (level) => applyRendererQuality(level, generation),
    getHud,
    getQualityState: () => quality.state(),
    exportReport: () => {
      if (!loadCompleted) throw new Error('Renderer did not complete loading')
      return exportReport({ renderer: activeKind, mode: options.mode, metrics: getHud() })
    },
    restart: () => {
      simulation.restart()
      diagnosticFreeze = false
      lastFrameAt = null
      accumulatorMs = 0
      pressed.clear()
      requestedSquadSwitch = false
      pointer = null
      publishResult()
    },
    setPointer: (moveX, moveY) => {
      pointer = { x: clampPointer(moveX), y: clampPointer(moveY) }
    },
    getSnapshot: () => simulation.getSnapshot(),
    getActiveSquad: () => simulation.activeSquad,
    getResult: () => simulation.result,
    getRendererDiagnostics: () => {
      const diagnosticRenderer = renderer as (GameRenderer & { getDiagnostics?: () => unknown }) | null
      return diagnosticRenderer?.getDiagnostics?.() ?? null
    },
    advanceForDiagnostics: (ticks) => {
      const safeTicks = Math.max(0, Math.min(Math.floor(ticks), 5_000))
      diagnosticFreeze = true
      accumulatorMs = 0
      simulation.restart()
      for (let index = 0; index < safeTicks; index += 1) simulation.step(nextInput())
      renderer?.render(simulation.getSnapshot(), 0)
      publishResult()
      publishHud(now())
    },
    requestSquadSwitch: () => {
      requestedSquadSwitch = true
    },
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

function isControlKey(key: string): boolean {
  return ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)
}

function interpolationAlpha(accumulatorMs: number): number {
  if (!Number.isFinite(accumulatorMs)) return 0
  return Math.min(Math.max(accumulatorMs / STEP_MS, 0), 1 - Number.EPSILON)
}

function clampPointer(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
}
