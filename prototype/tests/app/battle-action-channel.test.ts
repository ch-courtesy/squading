import { beforeEach, describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { BATTLE_TICKS_PER_SECOND } from '../../src/core/battle-view/snapshot'
import { createBattleController } from '../../src/app/battle/battle-controller'
import type { GameRenderer, RendererMetrics } from '../../src/renderers/contract'
import type { RenderSnapshot } from '../../src/core/types'

/**
 * The half of the channel the projection cannot test: a BROWSER FRAME is not a tick.
 *
 * Measured on this project's own frame samples, three simulation ticks routinely land inside one
 * rendered frame, and the controller is the only place that knows which ticks those were. So the
 * question "what happens to the events of ticks that share a frame" is answered here, and the
 * answer is ALL OF THEM, in tick order — which is exactly the assertion a "last tick wins"
 * implementation fails.
 */
const STEP_MS = 1000 / BATTLE_TICKS_PER_SECOND

function recordingRenderer(): GameRenderer & { snapshots: RenderSnapshot[] } {
  return {
    snapshots: [],
    mount: async () => {},
    render(snapshot: RenderSnapshot): void {
      this.snapshots.push(snapshot)
    },
    resize: () => {},
    applyQuality: () => {},
    collectMetrics: (): RendererMetrics => ({ drawCalls: null, textures: null, geometries: null }),
    dispose: () => {},
  }
}

type Harness = {
  renderer: GameRenderer & { snapshots: RenderSnapshot[] }
  frame(deltaMs: number): void
  visible: { value: boolean }
  controller: ReturnType<typeof createBattleController>
}

async function started(seed = 'channel-a'): Promise<Harness> {
  const host = document.createElement('div')
  document.body.append(host)
  const renderer = recordingRenderer()
  const visible = { value: true }
  let pending: FrameRequestCallback | null = null
  let clock = 0

  const controller = createBattleController({
    host,
    seed,
    loadRenderer: async () => renderer,
    requestFrame: (callback) => {
      pending = callback
      return 1
    },
    cancelFrame: () => {
      pending = null
    },
    isVisible: () => visible.value,
    now: () => clock,
  })
  await controller.start()
  controller.begin()
  const frame = (deltaMs: number): void => {
    clock += deltaMs
    const callback = pending
    pending = null
    callback?.(clock)
  }
  frame(0)
  return { renderer, frame, visible, controller }
}

/** The action events of the frames drawn so far, oldest first. */
function drawn(test: Harness): readonly (readonly { kind: string; tick: number }[])[] {
  return test.renderer.snapshots.map((snapshot) => snapshot.actionEvents ?? [])
}

describe('the v2 controller carries this frame\'s ticks to the renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('publishes an account on every frame, even the priming one before the loop starts', async () => {
    const test = await started()
    // `start()` primes the renderer with one render before any tick has run. It must still
    // carry the array, or the renderer spends its first frame guessing.
    expect(test.renderer.snapshots.length).toBeGreaterThan(0)
    expect(test.renderer.snapshots[0]!.actionEvents).toEqual([])
  })

  it('reports nothing for a frame too short to run a tick', async () => {
    const test = await started()
    const before = test.renderer.snapshots.length
    test.frame(STEP_MS / 3)
    const events = drawn(test).slice(before)
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual([])
  })

  it('reports every tick of a frame that ran three of them, and nothing from the frame before', async () => {
    const test = await started()
    // Run far enough in for the two sides to be inside each other's range, so a three-tick
    // frame is actually carrying blows rather than an empty board.
    for (let index = 0; index < 400; index += 1) test.frame(STEP_MS)
    const busy = test.renderer.snapshots.filter((snapshot) => (snapshot.actionEvents?.length ?? 0) > 0)
    expect(busy.length).toBeGreaterThan(10)

    const before = test.renderer.snapshots.length
    test.frame(STEP_MS * 3)
    const frame = test.renderer.snapshots[before]!
    expect(frame.actionEvents).toBeDefined()
    const ticks = new Set(frame.actionEvents!.map((event) => event.tick))
    // Whatever landed, it came from at most the three ticks this frame ran, and it is ordered.
    expect(ticks.size).toBeLessThanOrEqual(3)
    const order = frame.actionEvents!.map((event) => event.tick)
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(frame.tick - 3)
      expect(tick).toBeLessThan(frame.tick)
    }
  })

  it('loses not one blow across a whole run, however the ticks fall into frames', async () => {
    // THE NON-VACUITY GATE. The same seed is stepped twice: once through the controller at three
    // ticks a frame, once tick by tick through the authority directly. The controller path must
    // account for exactly as many blows as the authority resolved — a dropped frame's worth, a
    // merge, or a "last tick only" policy all come out short here.
    const test = await started('channel-count')
    const FRAMES = 300
    for (let index = 0; index < FRAMES; index += 1) test.frame(STEP_MS * 3)
    const delivered = test.renderer.snapshots.flatMap((snapshot) => snapshot.actionEvents ?? [])
    const deliveredBlows = delivered.filter((event) => event.kind !== 'death').length
    const deliveredDeaths = delivered.filter((event) => event.kind === 'death').length
    const lastTick = test.controller.hud().tick

    const bare = createBattle('channel-count')
    bare.start()
    let blows = 0
    let deaths = 0
    for (let step = 0; step < FRAMES * 3; step += 1) {
      const result = bare.step()
      if (!result.ran) break
      if (result.tick >= lastTick) break
      blows += result.damageEvents.length
      deaths += result.transitions.enemyDeaths.length + result.transitions.friendlyDeaths.length
    }

    expect(blows).toBeGreaterThan(100)
    expect(deaths).toBeGreaterThan(0)
    expect(deliveredBlows).toBe(blows)
    expect(deliveredDeaths).toBe(deaths)
  })

  it('hands the same account to a hidden frame that ran no ticks: an empty one', async () => {
    const test = await started('channel-hidden')
    for (let index = 0; index < 60; index += 1) test.frame(STEP_MS * 3)
    test.visible.value = false
    const before = test.renderer.snapshots.length
    test.frame(STEP_MS * 30)
    // §1.1: a hidden tab is not stepped, so there is nothing that happened to report — and in
    // particular the events of the last visible frame must not be replayed into it.
    expect(test.renderer.snapshots[before]!.actionEvents).toEqual([])
  })

  it('does not replay a frame\'s events into a snapshot read after the frame', async () => {
    const test = await started('channel-drain')
    for (let index = 0; index < 200; index += 1) {
      test.frame(STEP_MS * 3)
      // Whatever the frame just drew, a read taken outside the loop is a read of the BOARD and
      // not of the tick. A shell or a test that fed one to a renderer would otherwise play every
      // blow of the last frame a second time.
      expect(test.controller.snapshot().actionEvents).toEqual([])
    }
    const delivered = test.renderer.snapshots.flatMap((snapshot) => snapshot.actionEvents ?? [])
    expect(delivered.length).toBeGreaterThan(50)
  })

  it('drops a finished run\'s events when the same controller restarts', async () => {
    const test = await started('channel-restart')
    for (let index = 0; index < 120; index += 1) test.frame(STEP_MS * 3)
    test.controller.restart('channel-restart-2')
    const before = test.renderer.snapshots.length
    test.frame(STEP_MS / 3)
    expect(test.renderer.snapshots[before]!.actionEvents).toEqual([])
  })
})
