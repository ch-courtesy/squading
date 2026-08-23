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

/**
 * Drive the current stage to §1.16's verdict, answering §1.13's card screens on the way.
 *
 * The card screen has to be answered or the run never decides: §1.1 stops the clock in
 * `awaiting-upgrade`, so a driver that ignores it loops at a constant tick. Slot 1 every time —
 * WHICH card is taken is not what these fixtures are about.
 */
function playToTheVerdict(test: Harness): void {
  for (let frame = 0; frame < 2000; frame += 1) {
    const mode = test.controller.hud().mode
    if (mode === 'won' || mode === 'lost') return
    if (mode === 'awaiting-upgrade') test.controller.chooseUpgrade(1)
    test.frame(STEP_MS * MAX_STEPS_PER_FRAME)
  }
  throw new Error(`the stage did not decide (mode ${test.controller.hud().mode})`)
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
    // The phases are what makes a maximum actionable rather than a mystery (batch J).
    expect(
      samples.every(
        (sample) =>
          Number.isFinite(sample.sim) &&
          Number.isFinite(sample.project) &&
          Number.isFinite(sample.draw) &&
          Number.isFinite(sample.hud) &&
          sample.steps >= 0 &&
          sample.steps <= MAX_STEPS_PER_FRAME,
      ),
    ).toBe(true)
  })

  it('folds the finished stage into the campaign, once (§1.1, §1.4)', async () => {
    // NOTHING UNDER `src/core` CAN DO THIS. The core has no loop, so noticing that a stage has
    // ended is the driver's job — exactly like not stepping a hidden tab.
    const test = await started('campaign-a')
    expect(test.controller.campaign().phase).toBe('in-stage')
    expect(test.controller.campaign().kills).toBe(0)

    playToTheVerdict(test)

    const battle = test.controller.hud()
    const campaign = test.controller.campaign()
    expect(battle.mode === 'won' || battle.mode === 'lost').toBe(true)
    // §5 stage 2: seven stages, so stage 1 is never the end of a campaign that was WON — a win
    // hands the squad on (`stage-cleared`) and only a loss ends it here (§1.4). Written as a
    // branch on the battle's own verdict rather than pinned, because which way this seed goes is
    // a balance fact and §5 stage 4 owns the balance.
    const won = battle.mode === 'won'
    expect(campaign.phase).toBe(won ? 'stage-cleared' : 'campaign-over')
    expect(campaign.end).toBe(won ? null : 'defeat')
    expect(campaign.outcome).toBe(won ? null : 'lost')
    expect(campaign.stageId).toBe(1)
    expect(campaign.stageCount).toBe(7)
    expect(campaign.nextStageId).toBe(2)
    // The stage's kills are now the campaign's, and the dead are named.
    expect(campaign.kills).toBe(battle.kills)
    expect(campaign.fallen.length).toBe(battle.dead + battle.downed)
    expect(campaign.fallen.every((entry) => entry.name.length > 0)).toBe(true)

    // Fold once: another 40 frames of a finished battle must not re-count anything.
    const digestOfRecord = { ...campaign }
    runFrames(test, 40, STEP_MS * 5)
    expect(test.controller.campaign()).toEqual(digestOfRecord)
  })

  it('restarts the CAMPAIGN, not the stage (§1.4)', async () => {
    // §1.10.1 (v14) MOVED THIS SEED. Both this fixture and the one below need a stage 1 that a
    // no-input run LOSES, because `campaign-over` is only reachable through §1.4's defeat. Under
    // the absolute cap `campaign-a` lost; scaling the board to the standing squad makes a squad
    // that has lost half its bodies meet half a board, and `campaign-a` now WINS at tick 2143.
    // `campaign-b` loses at 2290 and is the seed these two now drive. The seed is the fixture's,
    // not the band's — §4.1's eight are untouched — and the other fixture on this path branches on
    // the verdict instead of pinning it, which is why it did not have to move.
    const test = await started('campaign-b')
    playToTheVerdict(test)
    expect(test.controller.campaign().phase).toBe('campaign-over')

    test.controller.restart()

    const campaign = test.controller.campaign()
    expect(campaign.phase).toBe('in-stage')
    expect(campaign.end).toBeNull()
    expect(campaign.stageId).toBe(1)
    expect(campaign.kills).toBe(0)
    expect(campaign.fallen).toEqual([])
    expect(campaign.cards).toEqual([])
    expect(test.controller.hud().tick).toBe(0)
    expect(test.controller.hud().roster).toHaveLength(16)
  })

  it('refuses to advance a campaign that is over', async () => {
    // A no-op rather than a throw, because a screen that cannot be shown must not be able to crash
    // the shell either. The reachable case is a LOST stage 1, and the phase is asserted rather
    // than assumed: if the balance ever makes this seed win, the campaign is `stage-cleared` and
    // the button is legal, and this fixture must fail loudly rather than quietly test nothing.
    // See the seed note on the fixture above: `campaign-b` since §1.10.1 (v14).
    const test = await started('campaign-b')
    playToTheVerdict(test)
    const before = test.controller.campaign()
    expect(before.phase).toBe('campaign-over')

    test.controller.advanceStage()

    expect(test.controller.campaign()).toEqual(before)
    expect(test.controller.hud().mode === 'won' || test.controller.hud().mode === 'lost').toBe(true)
  })

  it('draws once before the loop, so the first battle frame is not the asset build', async () => {
    // The diorama renderer builds every procedural asset it owns on the FIRST snapshot it is
    // handed, and batch J measured that call at 99-112 ms against §4.3's 20 ms ceiling. It is
    // paid here, inside `start()`, where it is part of the load rather than a frame.
    const test = await harness()
    expect(test.renderer.renders).toBe(1)
    expect(test.controller.frameSamples()).toHaveLength(0)
  })
})
