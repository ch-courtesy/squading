import { afterEach, describe, expect, test } from 'vitest'

import { createGameController } from '../src/app/game-controller'
import type { GameRenderer, QualityLevel } from '../src/renderers/contract'
import { loadRenderer } from '../src/renderers/registry'

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.innerHTML = ''
})

describe('renderer contract', () => {
  test('mounts, renders, resizes, applies quality, and disposes a renderer exactly once', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'contract-seed', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    window.dispatchEvent(new Event('resize'))
    controller.applyQuality('reduced-particles')
    controller.dispose()
    controller.dispose()

    expect(renderer.calls).toEqual([
      'mount',
      'quality:full',
      'resize:0x0@1',
      'render:0',
      'resize:0x0@1',
      'quality:reduced-particles',
      'dispose',
    ])
    expect(host.querySelectorAll('canvas')).toHaveLength(0)
    expect(renderer.resizeEventsAfterDispose).toBe(0)
  })

  test('passes snapshot arrays to renderers in ascending ID order', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'stable-order', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    clock.frame(500)

    expect(renderer.snapshots.every((snapshot) => isAscending(snapshot.units.map((unit) => unit.id)))).toBe(true)
    expect(renderer.snapshots.every((snapshot) => isAscending(snapshot.projectiles.map((projectile) => projectile.id)))).toBe(true)
    expect(renderer.snapshots.every((snapshot) => isAscending(snapshot.effects.map((effect) => effect.id)))).toBe(true)
  })

  test('passes finite interpolation alpha from the fixed-step remainder on visible RAF frames', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'interpolation', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    clock.frame(50)

    expect(renderer.alphas[0]).toBe(0)
    expect(renderer.alphas[1]).toBeCloseTo(0.5, 12)
    expect(renderer.alphas.every((alpha) => Number.isFinite(alpha) && alpha >= 0 && alpha < 1)).toBe(true)
  })

  test('disposes a renderer whose delayed mount resolves after controller disposal without adding a RAF loop', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const mounting = createDeferred<void>()
    renderer.mountDeferred = mounting
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'late-mount', enemyCount: 100 },
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })

    const start = controller.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(renderer.calls).toEqual(['mount'])
    controller.dispose()
    mounting.resolve()
    await start

    expect(renderer.calls).toEqual(['mount', 'dispose'])
    expect(clock.pendingCount).toBe(0)
  })

  test('loads only the selected renderer through the registry loader boundary', async () => {
    const selected = new DomFakeRenderer()
    const calls: string[] = []

    const renderer = await loadRenderer('hybrid', {
      '2d': async () => {
        calls.push('2d')
        return new DomFakeRenderer()
      },
      hybrid: async () => {
        calls.push('hybrid')
        return selected
      },
      '3d': async () => {
        calls.push('3d')
        return new DomFakeRenderer()
      },
    })

    expect(renderer).toBe(selected)
    expect(calls).toEqual(['hybrid'])
  })

  test('switching renderer disposes the old renderer and restarts the same seed at tick zero', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const first = new DomFakeRenderer()
    const second = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'restart-same-seed', enemyCount: 100 },
      loadRenderer: async (kind) => (kind === '2d' ? first : second),
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    clock.frame(100)
    await controller.switchRenderer('hybrid')
    clock.frame(101)

    expect(first.calls).toContain('dispose')
    expect(second.snapshots[0]?.tick).toBe(0)
    expect(second.snapshots[0]).toEqual(first.snapshots[0])
  })

  test('contains renderer frame failures, disposes resources, and reports the error boundary event', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.throwOnRender = true
    const clock = new RafClock()
    let reported: Error | null = null
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'frame-error', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onError: (error) => {
        reported = error
      },
    })

    await controller.start()

    expect(() => clock.frame(0)).not.toThrow()
    expect(reported).toHaveProperty('message', 'render failed')
    expect(renderer.calls).toContain('dispose')
  })

  test('excludes an overloaded frame itself once when the five-tick cap discards its elapsed time', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    const hudSamples: Array<{ p95Ms: number; fps: number }> = []
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'overloaded-frame', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onHud: (metrics) => hudSamples.push(metrics),
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    clock.frame(200)

    expect(hudSamples.at(-1)).toMatchObject({ p95Ms: 0, fps: 0 })
  })

  test('marks hidden-tab frame time invalid and excludes it from p95 and quality input', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    let visible = true
    const hudSamples: Array<{ p95Ms: number; fps: number }> = []
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'hidden-tab', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      isVisible: () => visible,
      onHud: (metrics) => hudSamples.push(metrics),
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    visible = false
    clock.frame(3_000)
    visible = true
    clock.frame(3_016)

    expect(hudSamples.at(-1)).toMatchObject({ p95Ms: 16, fps: 62.5 })
    expect(controller.getQualityState()).toMatchObject({ level: 'full' })
  })

  test('disposes a renderer that resolves after its controller was disposed without mounting it', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const late = new DomFakeRenderer()
    const deferred = createDeferred<GameRenderer>()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'late-load', enemyCount: 100 },
      loadRenderer: () => deferred.promise,
    })

    const start = controller.start()
    controller.dispose()
    deferred.resolve(late)
    await start

    expect(late.calls).toEqual(['dispose'])
    expect(host.querySelector('canvas')).toBeNull()
  })

  test('cleans a first renderer that resolves after a later start owns the controller', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const first = createDeferred<GameRenderer>()
    const second = new DomFakeRenderer()
    let loadCount = 0
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'later-start', enemyCount: 100 },
      loadRenderer: () => (loadCount++ === 0 ? first.promise : Promise.resolve(second)),
    })
    const initialStart = controller.start()
    await controller.start()
    first.resolve(new DomFakeRenderer())
    await initialStart

    expect(second.calls).toContain('mount')
    expect(host.querySelectorAll('canvas')).toHaveLength(1)
  })

  test('does not let a dispatched stale RAF callback render or schedule after a renderer switch', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const first = new DomFakeRenderer()
    const second = new DomFakeRenderer()
    const clock = new RafClock({ retainCancelledCallbacks: true })
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'stale-raf', enemyCount: 100 },
      loadRenderer: async (kind) => (kind === '2d' ? first : second),
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    await controller.switchRenderer('hybrid')
    clock.frame(1)

    expect(first.renderCount).toBe(1)
    expect(second.renderCount).toBe(1)
    expect(clock.pendingCount).toBe(1)
  })

  test('leaves an existing host canvas untouched and performs no controller resize after dispose', async () => {
    const host = document.createElement('div')
    const existingCanvas = document.createElement('canvas')
    host.append(existingCanvas)
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'preserve-canvas', enemyCount: 100 },
      loadRenderer: async () => renderer,
    })

    await controller.start()
    controller.dispose()
    const resizeCallsBefore = renderer.calls.filter((call) => call.startsWith('resize:')).length
    window.dispatchEvent(new Event('resize'))

    expect(host.contains(existingCanvas)).toBe(true)
    expect(renderer.calls.filter((call) => call.startsWith('resize:'))).toHaveLength(resizeCallsBefore)
  })

  test('resets metrics, quality, pressed input, and report values for a switched renderer', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const first = new DomFakeRenderer()
    const second = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'clean-switch', enemyCount: 100 },
      loadRenderer: async (kind) => (kind === '2d' ? first : second),
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)
    clock.frame(40)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    await controller.switchRenderer('hybrid')
    clock.frame(100)

    expect(second.qualityLevels).toEqual(['full'])
    expect(controller.getHud()).toMatchObject({ fps: 0, p95Ms: 0, qualityLevel: 'full' })
    expect(JSON.parse(controller.exportReport())).toMatchObject({ renderer: 'hybrid', metrics: { qualityLevel: 'full' } })
    expect(second.snapshots[0]?.tick).toBe(0)
  })

  test('reports a resize failure even when renderer dispose throws without masking the original error', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.throwOnDispose = true
    const clock = new RafClock()
    const errors: Error[] = []
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'cleanup-error', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onError: (error) => errors.push(error),
    })

    await controller.start()
    renderer.throwOnResize = true
    window.dispatchEvent(new Event('resize'))

    expect(errors.map((error) => error.message)).toEqual(['resize failed'])
  })

  test('reports an apply-quality failure even when cleanup dispose throws without masking the original error', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.throwOnDispose = true
    const errors: Error[] = []
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'quality-error', enemyCount: 100 },
      loadRenderer: async () => renderer,
      onError: (error) => errors.push(error),
    })

    await controller.start()
    renderer.throwOnQuality = true
    controller.applyQuality('reduced-particles')

    expect(errors.map((error) => error.message)).toEqual(['quality failed'])
  })

  test('measures load through the first successful render rather than loader resolution', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'load-timing', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(40)

    expect(controller.getHud().loadMs).toBe(40)
  })

  test('does not export a successful load measurement after initial render fails', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.throwOnRender = true
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'failed-load', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onError: () => undefined,
    })

    await controller.start()
    clock.frame(40)

    expect(() => controller.exportReport()).toThrow('Renderer did not complete loading')
  })

  test('loads the implemented hybrid renderer through its literal dynamic-loader boundary', async () => {
    const renderer = await loadRenderer('hybrid')
    expect(renderer).toMatchObject({
      mount: expect.any(Function),
      render: expect.any(Function),
      resize: expect.any(Function),
      applyQuality: expect.any(Function),
      collectMetrics: expect.any(Function),
      dispose: expect.any(Function),
    })
  })

  test('collects textures and geometries alongside draw calls for HUD and exported report metrics', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.rendererMetrics = { drawCalls: 4, textures: 7, geometries: 3 }
    const clock = new RafClock()
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'resource-metrics', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)

    expect(controller.getHud()).toMatchObject({ drawCalls: 4, textures: 7, geometries: 3 })
    expect(JSON.parse(controller.exportReport()).metrics).toMatchObject({ textures: 7, geometries: 3 })
  })

  test('collects renderer metrics once per published HUD frame and keeps its fields atomic', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new DomFakeRenderer()
    renderer.mutatingMetrics = true
    const clock = new RafClock()
    const huds: Array<{ drawCalls: number | null; textures: number | null; geometries: number | null }> = []
    const controller = createGameController({
      host,
      kind: '2d',
      mode: 'manual',
      config: { seed: 'atomic-metrics', enemyCount: 100 },
      loadRenderer: async () => renderer,
      now: () => clock.time,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onHud: (hud) => huds.push(hud),
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    clock.frame(0)

    expect(renderer.collectMetricsCount).toBe(1)
    expect(huds).toEqual([{ drawCalls: 1, textures: 101, geometries: 201, fps: 0, p95Ms: 0, loadMs: 0, activeUnits: 118, qualityLevel: 'full' }])
  })
})

function isAscending(ids: readonly number[]): boolean {
  return ids.every((id, index) => index === 0 || ids[index - 1] <= id)
}

class RafClock {
  time = 0
  private nextId = 1
  private callbacks = new Map<number, FrameRequestCallback>()

  constructor(private readonly options: { retainCancelledCallbacks?: boolean } = {}) {}

  requestFrame = (callback: FrameRequestCallback): number => {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    return id
  }

  cancelFrame = (id: number): void => {
    if (!this.options.retainCancelledCallbacks) this.callbacks.delete(id)
  }

  frame(time: number): void {
    this.time = time
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    callbacks.forEach((callback) => callback(time))
  }

  get pendingCount(): number {
    return this.callbacks.size
  }
}

class DomFakeRenderer implements GameRenderer {
  readonly calls: string[] = []
  readonly snapshots: Parameters<GameRenderer['render']>[0][] = []
  resizeEventsAfterDispose = 0
  throwOnRender = false
  throwOnResize = false
  throwOnDispose = false
  throwOnQuality = false
  renderCount = 0
  readonly qualityLevels: QualityLevel[] = []
  readonly alphas: number[] = []
  mountDeferred: ReturnType<typeof createDeferred<void>> | null = null
  rendererMetrics = { drawCalls: 4, textures: null as number | null, geometries: null as number | null }
  collectMetricsCount = 0
  mutatingMetrics = false
  private canvas: HTMLCanvasElement | null = null
  private disposed = false
  private listener = () => {
    if (this.disposed) this.resizeEventsAfterDispose += 1
  }

  async mount(host: HTMLElement): Promise<void> {
    this.calls.push('mount')
    this.canvas = document.createElement('canvas')
    host.append(this.canvas)
    window.addEventListener('resize', this.listener)
    await this.mountDeferred?.promise
  }

  render(snapshot: Parameters<GameRenderer['render']>[0], alpha: number): void {
    if (this.throwOnRender) throw new Error('render failed')
    this.calls.push(`render:${snapshot.tick}`)
    this.renderCount += 1
    this.alphas.push(alpha)
    this.snapshots.push(snapshot)
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.throwOnResize) throw new Error('resize failed')
    this.calls.push(`resize:${width}x${height}@${dpr}`)
  }

  applyQuality(level: QualityLevel): void {
    if (this.throwOnQuality) throw new Error('quality failed')
    this.qualityLevels.push(level)
    this.calls.push(`quality:${level}`)
  }

  collectMetrics() {
    this.collectMetricsCount += 1
    if (this.mutatingMetrics) {
      return {
        drawCalls: this.collectMetricsCount,
        textures: 100 + this.collectMetricsCount,
        geometries: 200 + this.collectMetricsCount,
      }
    }
    return this.rendererMetrics
  }

  dispose(): void {
    if (this.disposed) {
      this.calls.push('dispose-again')
      return
    }
    this.disposed = true
    this.calls.push('dispose')
    this.canvas?.remove()
    window.removeEventListener('resize', this.listener)
    if (this.throwOnDispose) throw new Error('dispose failed')
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
