import { beforeEach, describe, expect, it } from 'vitest'

import { createBattle } from '../../src/core/battle/battle'
import { BATTLE_TICKS_PER_SECOND } from '../../src/core/battle-view/snapshot'
import {
  MAX_STEPS_PER_FRAME,
  createBattleController,
  type BattleController,
} from '../../src/app/battle/battle-controller'
import { replayBattleInput } from '../../src/app/battle/battle-replay'
import type { GameRenderer, RendererMetrics } from '../../src/renderers/contract'

const STEP_MS = 1000 / BATTLE_TICKS_PER_SECOND

function stubRenderer(): GameRenderer & { renders: number } {
  return {
    renders: 0,
    mount: async () => {},
    render(): void {
      this.renders += 1
    },
    resize: () => {},
    applyQuality: () => {},
    collectMetrics: (): RendererMetrics => ({ drawCalls: null, textures: null, geometries: null }),
    dispose: () => {},
  }
}

type Harness = {
  controller: BattleController
  renderer: GameRenderer & { renders: number }
  frame(deltaMs: number): void
  visible: { value: boolean }
}

async function harness(seed = 'ctrl-a'): Promise<Harness> {
  const host = document.createElement('div')
  document.body.append(host)
  const renderer = stubRenderer()
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

  return {
    controller,
    renderer,
    visible,
    frame(deltaMs: number): void {
      clock += deltaMs
      const callback = pending
      pending = null
      callback?.(clock)
    },
  }
}

function runFrames(test: Harness, count: number, deltaMs: number): void {
  for (let index = 0; index < count; index += 1) test.frame(deltaMs)
}

/** Everything up to the first frame that carries a delta, which is where the clock starts. */
async function started(seed?: string): Promise<Harness> {
  const test = await harness(seed)
  test.controller.begin()
  test.frame(0)
  return test
}

describe('the v2 controller drives §1.1 fixed steps', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('runs 30 ticks per wall-clock second regardless of how the frames land', async () => {
    const smooth = await started()
    runFrames(smooth, 60, 1000 / 60)

    const jittery = await started()
    for (let index = 0; index < 20; index += 1) {
      jittery.frame(11)
      jittery.frame(23)
      jittery.frame(16)
    }

    expect(smooth.controller.hud().tick).toBe(BATTLE_TICKS_PER_SECOND)
    expect(jittery.controller.hud().tick).toBe(BATTLE_TICKS_PER_SECOND)
  })

  it('refuses to catch up more than one frame is allowed to', async () => {
    const test = await started()
    test.frame(STEP_MS * 40)
    expect(test.controller.hud().tick).toBe(MAX_STEPS_PER_FRAME)
  })

  it('never steps a hidden tab (§1.15: hidden is not a mode)', async () => {
    const test = await started()
    runFrames(test, 10, STEP_MS)
    const before = test.controller.hud().tick
    expect(before).toBe(10)

    test.visible.value = false
    runFrames(test, 40, STEP_MS)
    expect(test.controller.hud().tick).toBe(before)

    // And the backlog the hidden stretch built up is not paid out on the way back.
    test.visible.value = true
    runFrames(test, 1, STEP_MS)
    expect(test.controller.hud().tick).toBe(before + 1)
  })

  it('still draws while hidden, so the tab is not a stale rectangle on return', async () => {
    const test = await started()
    const drawn = test.renderer.renders
    test.visible.value = false
    runFrames(test, 3, STEP_MS)
    expect(test.renderer.renders).toBeGreaterThan(drawn)
  })

  it('moves the command unit up for KeyW, because §1.15 fixes -y as up', async () => {
    const test = await started()
    const before = test.controller.snapshot().camera.centerY
    test.controller.keyDown('KeyW')
    runFrames(test, 60, STEP_MS)
    expect(test.controller.snapshot().camera.centerY).toBeLessThan(before)
  })

  it('ignores a code this game does not use', async () => {
    const test = await started()
    const before = test.controller.snapshot().camera
    test.controller.keyDown('KeyZ')
    test.controller.keyDown('__proto__')
    runFrames(test, 30, STEP_MS)
    const after = test.controller.snapshot().camera
    expect(after.centerX).toBe(before.centerX)
    expect(after.centerY).toBe(before.centerY)
    expect(test.controller.inputLog()).toEqual([])
  })

  it('restarts to a tick-zero run and forgets the keys that were held', async () => {
    const test = await started()
    test.controller.keyDown('KeyD')
    runFrames(test, 30, STEP_MS)
    expect(test.controller.snapshot().camera.centerX).toBeGreaterThan(28)

    test.controller.restart()
    expect(test.controller.hud().tick).toBe(0)
    expect(test.controller.hud().mode).toBe('ready')
    expect(test.controller.inputLog()).toEqual([])

    test.controller.begin()
    test.frame(0)
    runFrames(test, 30, STEP_MS)
    // `KeyD` was never released, and the restart must not have carried its axis over.
    expect(test.controller.snapshot().camera.centerX).toBeCloseTo(28, 6)
  })

  it('notifies subscribers with the projection and never with the state', async () => {
    const test = await harness()
    const seen: object[] = []
    test.controller.subscribe((hud) => seen.push(hud))
    test.controller.begin()
    test.frame(0)
    runFrames(test, 3, STEP_MS)

    expect(seen.length).toBeGreaterThan(0)
    expect(Object.keys(seen[0])).toContain('roster')
    expect(Object.keys(seen[0])).not.toContain('prng')
    expect(Object.keys(seen[0])).not.toContain('friendlies')
  })

  it('stops the clock on Escape and starts it again on the next one (§1.15)', async () => {
    const test = await started()
    runFrames(test, 5, STEP_MS)
    test.controller.togglePause()
    runFrames(test, 10, STEP_MS)
    expect(test.controller.hud().mode).toBe('paused')
    expect(test.controller.hud().tick).toBe(5)

    test.controller.togglePause()
    runFrames(test, 4, STEP_MS)
    expect(test.controller.hud().mode).toBe('running')
    expect(test.controller.hud().tick).toBe(9)
  })

  it('records an input log a headless replay reproduces digest-for-digest (§4.3)', async () => {
    const test = await started('replay-a')
    runFrames(test, 20, STEP_MS)
    test.controller.keyDown('KeyD')
    runFrames(test, 25, STEP_MS)
    test.controller.togglePause()
    runFrames(test, 5, STEP_MS)
    test.controller.keyUp('KeyD')
    test.controller.togglePause()
    runFrames(test, 25, STEP_MS)
    test.controller.keyDown('KeyW')
    runFrames(test, 20, STEP_MS)

    const log = test.controller.inputLog()
    expect(log.length).toBeGreaterThan(0)
    // The pause released the held key on the way in, so a `keyUp` behind it is not in the log.
    expect(log.every((entry) => entry.step >= 0 && entry.step < test.controller.stepCount())).toBe(true)

    // The replay drives the SAME facade the controller drives, through the same verbs.
    // That is what §4.3's comparison is.
    const replay = replayBattleInput(createBattle('replay-a'), log, test.controller.stepCount())

    expect(replay.endTick).toBe(test.controller.hud().tick)
    expect(replay.digest).toBe(test.controller.digest())
  })

  it('measures the CPU each frame spent, for §4.3', async () => {
    const test = await started()
    runFrames(test, 10, STEP_MS)
    const samples = test.controller.frameSamples()
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every((sample) => Number.isFinite(sample.ms) && sample.ms >= 0)).toBe(true)
    expect(samples.at(-1)!.tick).toBe(test.controller.hud().tick)
  })
})
