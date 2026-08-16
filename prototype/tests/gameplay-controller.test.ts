import { afterEach, describe, expect, test } from 'vitest'

import { createGameplayController } from '../src/app/gameplay-controller'
import { createGameplayInputAdapter } from '../src/app/gameplay-input'
import type { BattleMode, GameInputEvent } from '../src/core/gameplay/types'
import type { GameRenderer, QualityLevel } from '../src/renderers/contract'
import { loadGameplayRenderer } from '../src/renderers/registry'

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.innerHTML = ''
  restoreHidden()
})

describe('gameplay input adapter', () => {
  test('keeps Space held until keyup and never queues it while paused', async () => {
    const emitted: GameInputEvent[] = []
    let mode: BattleMode = 'running'
    const adapter = createGameplayInputAdapter({
      getTick: () => 12,
      getMode: () => mode,
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    expect(emitted.at(-1)).toMatchObject({ kind: 'set-rescue', held: true })
    const beforePause = emitted.length
    mode = 'paused'
    adapter.clearPersistent()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    expect(emitted).toHaveLength(beforePause)
    expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
  })

  test('uses keyboard axes over drag and clears drag on pointer end', async () => {
    const adapter = createGameplayInputAdapter({
      getTick: () => 12,
      getMode: () => 'running',
      emit: () => undefined,
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    adapter.pointerDown({ x: -1, y: 0 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(adapter.currentMovement()).toEqual({ x: 1, y: 0 })
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))
    adapter.pointerEnd()
    expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
  })

  test('normalizes diagonal WASD input and emits a single set-move per changed vector', () => {
    const emitted: GameInputEvent[] = []
    const adapter = createGameplayInputAdapter({
      getTick: () => 5,
      getMode: () => 'running',
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', repeat: true }))

    // Full-array assertion (not a filtered subset) proves no other event kind snuck in.
    expect(emitted).toHaveLength(2)
    expect(emitted.every((event) => event.kind === 'set-move')).toBe(true)
    const last = emitted[1] as Extract<GameInputEvent, { kind: 'set-move' }>
    expect(last).toMatchObject({ applyTick: 5, kind: 'set-move' })
    expect(last.x).toBeCloseTo(Math.SQRT1_2, 10)
    expect(last.y).toBeCloseTo(-Math.SQRT1_2, 10)
    expect(emitted[1].sequence).toBeGreaterThan(emitted[0].sequence)
  })

  test('emits switch-squad once on first Q/Tab keydown and ignores browser repeat', () => {
    const emitted: GameInputEvent[] = []
    const adapter = createGameplayInputAdapter({
      getTick: () => 1,
      getMode: () => 'running',
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    window.dispatchEvent(tabEvent)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', repeat: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))

    // Full-array assertion proves exactly two switch-squad events and nothing else.
    expect(emitted).toEqual([
      { applyTick: 1, sequence: expect.any(Number), kind: 'switch-squad' },
      { applyTick: 1, sequence: expect.any(Number), kind: 'switch-squad' },
    ])
    expect(tabEvent.defaultPrevented).toBe(true)
  })

  test('releases a movement key even when Shift/CapsLock changes its case between keydown and keyup', () => {
    const adapter = createGameplayInputAdapter({
      getTick: () => 1,
      getMode: () => 'running',
      emit: () => undefined,
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(adapter.currentMovement()).toEqual({ x: 1, y: 0 })
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'D', shiftKey: true }))
    expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
  })

  test('does not queue movement input while paused or awaiting-upgrade', () => {
    const emitted: GameInputEvent[] = []
    let mode: BattleMode = 'paused'
    const adapter = createGameplayInputAdapter({
      getTick: () => 3,
      getMode: () => mode,
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    expect(emitted).toEqual([])
    expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
    mode = 'awaiting-upgrade'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    expect(emitted).toEqual([])
    expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
  })

  test('does not queue switch-squad while paused or awaiting-upgrade', () => {
    const emitted: GameInputEvent[] = []
    let mode: BattleMode = 'paused'
    const adapter = createGameplayInputAdapter({
      getTick: () => 3,
      getMode: () => mode,
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    expect(emitted).toEqual([])
    mode = 'awaiting-upgrade'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(emitted).toEqual([])
  })

  test('does not queue switch-squad while the injected cooldown seam reports it is unavailable', () => {
    const emitted: GameInputEvent[] = []
    let canSwitch = false
    const adapter = createGameplayInputAdapter({
      getTick: () => 9,
      getMode: () => 'running',
      emit: (event) => emitted.push(event),
      canSwitch: () => canSwitch,
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    expect(emitted).toEqual([])
    canSwitch = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    expect(emitted).toEqual([{ applyTick: 9, sequence: expect.any(Number), kind: 'switch-squad' }])
  })

  test('only accepts 1/2/3 as choose-upgrade while awaiting-upgrade', () => {
    const emitted: GameInputEvent[] = []
    let mode: BattleMode = 'running'
    const adapter = createGameplayInputAdapter({
      getTick: () => 40,
      getMode: () => mode,
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
    expect(emitted).toHaveLength(0)
    mode = 'awaiting-upgrade'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))
    expect(emitted).toEqual([{ applyTick: 40, sequence: expect.any(Number), kind: 'choose-upgrade', index: 1 }])
  })

  test('toggles pause with Escape only while running or paused, and ignores it elsewhere', () => {
    const emitted: GameInputEvent[] = []
    let mode: BattleMode = 'awaiting-upgrade'
    const adapter = createGameplayInputAdapter({
      getTick: () => 7,
      getMode: () => mode,
      emit: (event) => emitted.push(event),
    })
    cleanups.push(() => adapter.dispose())
    adapter.attach()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(emitted).toHaveLength(0)
    mode = 'running'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(emitted).toEqual([{ applyTick: 7, sequence: expect.any(Number), kind: 'toggle-pause' }])
  })

  test('stops reacting to DOM events after dispose', () => {
    const emitted: GameInputEvent[] = []
    const adapter = createGameplayInputAdapter({
      getTick: () => 1,
      getMode: () => 'running',
      emit: (event) => emitted.push(event),
    })
    adapter.attach()
    adapter.dispose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
    expect(emitted).toHaveLength(0)
  })
})

describe('gameplay controller', () => {
  test('mounts the renderer, steps combat at a fixed 30Hz cadence, and renders each visible frame', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'controller-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    clock.frame(1000 / 30)
    clock.frame((1000 / 30) * 2)

    expect(renderer.calls[0]).toBe('mount')
    expect(renderer.calls).toContain('quality:full')
    expect(controller.getState().combatTick).toBe(2)
    expect(renderer.snapshots.length).toBeGreaterThanOrEqual(3)
  })

  test('caps combat steps at five ticks per frame and drops the overflow remainder', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'overload-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    clock.frame(1000)

    expect(controller.getState().combatTick).toBe(5)
    clock.frame(1000 + 34)
    expect(controller.getState().combatTick).toBe(6)
  })

  test('freezes combatTick while paused and resumes after togglePause', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'pause-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    clock.frame(1000 / 30)
    const tickBeforePause = controller.getState().combatTick
    controller.togglePause()
    expect(controller.getState().mode).toBe('paused')
    clock.frame((1000 / 30) * 5)
    expect(controller.getState().combatTick).toBe(tickBeforePause)
    controller.togglePause()
    expect(controller.getState().mode).toBe('running')
    clock.frame((1000 / 30) * 6)
    expect(controller.getState().combatTick).toBeGreaterThan(tickBeforePause)
  })

  test('freezes combatTick while the frame reports the tab is not visible', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    let visible = true
    const controller = createGameplayController({
      host,
      seed: 'hidden-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      isVisible: () => visible,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    visible = false
    clock.frame(5_000)
    const frozenTick = controller.getState().combatTick
    clock.frame(5_100)
    expect(controller.getState().combatTick).toBe(frozenTick)
  })

  test('routes real DOM keyboard input into the authoritative simulation input state', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'dom-input-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    clock.frame(1000 / 30)

    expect(controller.getState().input.move).toEqual({ x: 1, y: 0 })

    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))
    clock.frame((1000 / 30) * 2)
    expect(controller.getState().input.move).toEqual({ x: 0, y: 0 })
  })

  test('forces paused mode and clears held input on window blur, and does not auto-resume', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'blur-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
    clock.frame(1000 / 30)
    expect(controller.getState().input.move).toEqual({ x: 1, y: 0 })

    window.dispatchEvent(new Event('blur'))
    expect(controller.getState().mode).toBe('paused')
    expect(controller.getState().input.move).toEqual({ x: 0, y: 0 })

    clock.frame((1000 / 30) * 5)
    expect(controller.getState().mode).toBe('paused')
  })

  test('forces paused mode when the document hides and does not auto-resume when it becomes visible again', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'visibility-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)

    setHidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controller.getState().mode).toBe('paused')

    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(controller.getState().mode).toBe('paused')
  })

  test('applies choose-upgrade only while awaiting-upgrade', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'upgrade-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    expect(() => controller.chooseUpgrade(0)).not.toThrow()
    expect(controller.getState().upgrade.choice).toBeNull()
  })

  test('notifies subscribers on state changes and stops after unsubscribe', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'subscribe-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    const seen: number[] = []
    const unsubscribe = controller.subscribe((state) => seen.push(state.combatTick))
    controller.beginBattle()
    clock.frame(0)
    clock.frame(1000 / 30)
    unsubscribe()
    const countAfterUnsubscribe = seen.length
    clock.frame((1000 / 30) * 2)

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.length).toBe(countAfterUnsubscribe)
  })

  test('restart clears queued input and returns combat to tick zero at ready mode', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'restart-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    clock.frame(1000 / 30)
    expect(controller.getState().combatTick).toBeGreaterThan(0)

    controller.restart()

    expect(controller.getState().combatTick).toBe(0)
    expect(controller.getState().mode).toBe('ready')
  })

  test('disposes the renderer exactly once and is safe to call repeatedly', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'dispose-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })

    await controller.start()
    clock.frame(0)
    controller.dispose()
    controller.dispose()

    expect(renderer.calls.filter((call) => call === 'dispose')).toHaveLength(1)
    expect(clock.pendingCount).toBe(0)
  })

  test('disposes a renderer whose delayed mount resolves after controller disposal without adding a RAF loop', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const mounting = createDeferred<void>()
    renderer.mountDeferred = mounting
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'stale-mount-seed',
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

  test('contains a render exception, disposes the renderer, and reports it through the error boundary', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    renderer.throwOnRender = true
    const clock = new RafClock()
    let reported: Error | null = null
    const controller = createGameplayController({
      host,
      seed: 'render-error-seed',
      loadRenderer: async () => renderer,
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

  test('routes controller pointerDown/pointerMove/pointerEnd into the authoritative simulation input state', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'pointer-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    controller.pointerDown({ x: 0.5, y: -0.5 })
    clock.frame(34)
    expect(controller.getState().input.move).toEqual({ x: 0.5, y: -0.5 })

    controller.pointerMove({ x: -1, y: 0 })
    clock.frame(68)
    expect(controller.getState().input.move).toEqual({ x: -1, y: 0 })

    controller.pointerEnd()
    clock.frame(102)
    expect(controller.getState().input.move).toEqual({ x: 0, y: 0 })
  })

  test('does not enqueue a second switch-squad while the previous switch is still on cooldown', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const controller = createGameplayController({
      host,
      seed: 'switch-cooldown-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.beginBattle()
    clock.frame(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))
    clock.frame(1000 / 30)
    const activeAfterFirstSwitch = controller.getState().activeSquad
    expect(controller.getState().switchCooldown).toBeGreaterThan(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }))

    expect(controller.getState().pendingEvents).toHaveLength(0)
    expect(controller.getState().activeSquad).toBe(activeAfterFirstSwitch)
  })

  test('isolates a throwing subscriber from both the render loop and enqueue-triggered notifications', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    const clock = new RafClock()
    const errors: Error[] = []
    const controller = createGameplayController({
      host,
      seed: 'listener-error-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onError: (error) => errors.push(error),
    })
    cleanups.push(() => controller.dispose())

    await controller.start()
    controller.subscribe(() => {
      throw new Error('listener boom')
    })

    expect(() => controller.beginBattle()).not.toThrow()
    expect(() => clock.frame(0)).not.toThrow()
    expect(() => clock.frame(1000 / 30)).not.toThrow()

    expect(errors.filter((error) => error.message === 'listener boom').length).toBeGreaterThanOrEqual(2)
    expect(renderer.calls).not.toContain('dispose')
    expect(controller.getState().combatTick).toBe(1)
  })

  test('reports both the original render failure and a renderer dispose failure during error-boundary cleanup', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = new StubRenderer()
    renderer.throwOnRender = true
    renderer.throwOnDispose = true
    const clock = new RafClock()
    const errors: Error[] = []
    const controller = createGameplayController({
      host,
      seed: 'cleanup-error-seed',
      loadRenderer: async () => renderer,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      onError: (error) => errors.push(error),
    })

    await controller.start()

    expect(() => clock.frame(0)).not.toThrow()
    expect(errors.map((error) => error.message)).toEqual(['render failed', 'dispose failed'])
  })

  test('loads the Three hybrid renderer through the literal registry loader used as the default', async () => {
    const renderer = await loadGameplayRenderer()
    expect(renderer).toMatchObject({
      mount: expect.any(Function),
      render: expect.any(Function),
      resize: expect.any(Function),
      applyQuality: expect.any(Function),
      collectMetrics: expect.any(Function),
      dispose: expect.any(Function),
    })
  })
})

function restoreHidden(): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

class RafClock {
  time = 0
  private nextId = 1
  private callbacks = new Map<number, FrameRequestCallback>()

  requestFrame = (callback: FrameRequestCallback): number => {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    return id
  }

  cancelFrame = (id: number): void => {
    this.callbacks.delete(id)
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

class StubRenderer implements GameRenderer {
  readonly calls: string[] = []
  readonly snapshots: Parameters<GameRenderer['render']>[0][] = []
  throwOnRender = false
  throwOnDispose = false
  mountDeferred: ReturnType<typeof createDeferred<void>> | null = null
  private canvas: HTMLCanvasElement | null = null
  private disposed = false

  async mount(host: HTMLElement): Promise<void> {
    this.calls.push('mount')
    this.canvas = document.createElement('canvas')
    host.append(this.canvas)
    await this.mountDeferred?.promise
  }

  render(snapshot: Parameters<GameRenderer['render']>[0]): void {
    if (this.throwOnRender) throw new Error('render failed')
    this.calls.push(`render:${snapshot.tick}`)
    this.snapshots.push(snapshot)
  }

  resize(width: number, height: number, dpr: number): void {
    this.calls.push(`resize:${width}x${height}@${dpr}`)
  }

  applyQuality(level: QualityLevel): void {
    this.calls.push(`quality:${level}`)
  }

  collectMetrics() {
    return { drawCalls: null, textures: null, geometries: null }
  }

  dispose(): void {
    if (this.disposed) {
      this.calls.push('dispose-again')
      return
    }
    this.disposed = true
    this.calls.push('dispose')
    this.canvas?.remove()
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
