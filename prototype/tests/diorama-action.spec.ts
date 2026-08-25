import { expect, test, type Page } from '@playwright/test'

// DEV-ONLY SURFACE. This file reaches for `__SQUADING_TEST__` (mounted behind `import.meta.env.DEV`
// and kept out of a production bundle by `assert-no-test-bridge.mjs`) or imports modules from
// `/src`, which exists on the dev server and nowhere in `dist`. Against a built site both are
// simply absent, so the run reports a wall of "failed to fetch" and timeouts that say nothing
// about the build.
//
// The production pass is a check on the BUILD and the Pages BASE PATH — that the bundle loads and
// runs where it will be served from. What it is not is a second run of the gameplay suite, which
// has already run against the dev server in the step before it.
test.skip(process.env.PLAYWRIGHT_PRODUCTION === '1', 'reads dev-only surface (see the note at the top of this file)')


/**
 * Action feedback, read through the dev-only `__SQUADING_TEST__` bridge.
 *
 * A screenshot can show that an effect *exists*; these tests exist to show that it
 * *runs*. The renderer publishes cumulative counters that only ever move when a
 * snapshot delta fires an animation, plus instantaneous samples of the frame that is
 * on screen — so "the lunge plays" is asserted as "the counter climbed and a figure
 * was measurably displaced from its base", not as "a mesh is in the scene graph".
 *
 * Most of it is driven by stepping the authority and handing the renderer every
 * snapshot directly, rather than by playing a battle in real time. That is both far
 * cheaper — the suite already contains a wall-clock gameplay test whose *result* is
 * sensitive to how much work runs before it — and far stronger: the whole 900-tick
 * battle, including the elite's strike and a locked rescue, can be asserted exactly.
 * One real-time battle still checks that the same feedback plays through the live
 * gameplay loop, and the lab route is pinned as producing none of it.
 *
 * Nothing here touches the authority: every counter is derived inside the renderer
 * from hit points, life states and positions the snapshot already publishes.
 */
async function scene(page: Page) {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene?.() ?? null)
}

/**
 * Steps seed 47 tick by tick and renders every snapshot, holding the rescue key so a
 * carry locks as soon as a squadmate goes down. Returns what the renderer's action
 * state did across the whole battle.
 */
async function replaySeed47(page: Page) {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  return page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createGameplaySimulation } = await (0, eval)('import("/src/core/gameplay/simulation.ts")')
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!

    // A small viewport: this replay renders hundreds of frames back to back, and its
    // assertions are about animation state rather than about framing.
    const host = document.createElement('div')
    host.style.width = '480px'
    host.style.height = '300px'
    document.body.append(host)

    const simulation = createGameplaySimulation({ seed: '47' })
    const renderer = createRenderer()
    await renderer.mount(host)

    let sequence = 0
    simulation.enqueue({ applyTick: 0, sequence: sequence++, kind: 'start-battle' })

    const acc = {
      lungeFrames: 0, peakLunge: 0, flashFrames: 0, peakFlash: 0,
      puffFrames: 0, peakPuffs: 0, peakScraps: 0, scrapFrames: 0,
      toppleFrames: 0, peakBuried: 0,
      pillarFrames: 0, sigilFrames: 0, peakShake: 0,
      countdownMax: 0, capacity: 0,
      telegraphRadius: 0, telegraphNormalY: 0, peakRescueSignals: 0,
      clockTracksSnapshot: true,
    }
    const ringSpins = new Set<number>()
    const sigilPulses = new Set<number>()

    for (let frame = 0; frame < 900; frame += 1) {
      const state = simulation.getState()
      if (state.mode === 'awaiting-upgrade') {
        simulation.enqueue({ applyTick: state.combatTick, sequence: sequence++, kind: 'choose-upgrade', index: 0 })
      }
      // Choosing an upgrade clears persistent input, so the rescue key is re-pressed
      // periodically rather than held once — exactly what a player's keyboard does.
      if (state.combatTick % 60 === 0) {
        simulation.enqueue({ applyTick: state.combatTick, sequence: sequence++, kind: 'set-rescue', held: true })
      }
      simulation.step()
      // The controller hands the renderer a whole tick plus an interpolation fraction;
      // feeding a varying alpha keeps that half of the contract exercised too.
      const snapshot = simulation.getSnapshot()
      const alpha = (frame % 3) / 3
      renderer.render(snapshot, alpha)

      const view = bridge()
      const action = view.action
      // The animation clock has to *be* the snapshot clock, not a wall clock of its own.
      if (Math.abs(action.clockTicks - (snapshot.tick + alpha)) > 1e-9) acc.clockTracksSnapshot = false
      acc.capacity = action.particleCapacity
      if (action.lungingUnits > 0) acc.lungeFrames += 1
      acc.peakLunge = Math.max(acc.peakLunge, action.maxLungeOffset)
      if (action.flashingUnits > 0) acc.flashFrames += 1
      acc.peakFlash = Math.max(acc.peakFlash, action.maxFlash)
      if (action.livePuffs > 0) acc.puffFrames += 1
      acc.peakPuffs = Math.max(acc.peakPuffs, action.livePuffs)
      if (action.liveScraps > 0) acc.scrapFrames += 1
      acc.peakScraps = Math.max(acc.peakScraps, action.liveScraps)
      if (action.topplingUnits > 0) acc.toppleFrames += 1
      acc.peakBuried = Math.max(acc.peakBuried, action.buriedUnits)
      if (action.rescuePillars > 0) {
        acc.pillarFrames += 1
        ringSpins.add(Math.round(action.rescueRingSpinRadians * 1000))
      }
      if (action.telegraphSigils > 0) {
        acc.sigilFrames += 1
        sigilPulses.add(Math.round(action.telegraphPulse * 1000))
        acc.countdownMax = Math.max(acc.countdownMax, action.telegraphCountdown01)
        acc.telegraphRadius = view.eliteTelegraph.radius
        acc.telegraphNormalY = view.eliteTelegraph.normalY
      }
      acc.peakShake = Math.max(acc.peakShake, action.cameraShakeOffset)
      acc.peakRescueSignals = Math.max(acc.peakRescueSignals, view.rescueSignals)
    }

    const last = bridge()
    const final = {
      action: last.action,
      presentation: last.presentation,
      ...acc,
      ringSpinValues: ringSpins.size,
      sigilPulseValues: sigilPulses.size,
    }
    renderer.dispose()
    host.remove()
    return final
  })
}

test('animates attacks, hits, deaths, the rescue token and the elite strike across a whole battle', async ({ page }) => {
  test.setTimeout(180_000)
  const replay = await replaySeed47(page)

  // --- Attack and hit -------------------------------------------------------------
  // The authority publishes no events at all, so these only move when the renderer
  // diffs a drop in hit points out of two consecutive snapshots.
  expect(replay.action.hitsObserved).toBeGreaterThan(50)
  expect(replay.action.attacksObserved).toBeGreaterThan(50)
  // Every attributed attack comes from a hit; an unattributed hit is allowed (an elite
  // area strike has no attacker within range), the other way round would be a bug.
  expect(replay.action.attacksObserved).toBeLessThanOrEqual(replay.action.hitsObserved)
  // The lunge is a real displacement of the figure inside its base, bounded by the
  // lunge distance so it can never drag a unit off its authoritative position.
  expect(replay.lungeFrames).toBeGreaterThan(20)
  expect(replay.peakLunge).toBeGreaterThan(0.05)
  expect(replay.peakLunge).toBeLessThanOrEqual(0.36 + 1e-6)
  expect(replay.flashFrames).toBeGreaterThan(20)
  expect(replay.peakFlash).toBeGreaterThan(0.1)
  // Cotton-puff muzzle bursts.
  expect(replay.puffFrames).toBeGreaterThan(20)
  expect(replay.peakPuffs).toBeGreaterThan(0)

  // --- Death ----------------------------------------------------------------------
  // A death is a visible sequence: the figure spends frames mid-topple, paper scraps
  // are in the air, and only then is it swept off the board.
  expect(replay.action.deathsObserved).toBeGreaterThan(5)
  expect(replay.toppleFrames).toBeGreaterThan(10)
  expect(replay.scrapFrames).toBeGreaterThan(10)
  expect(replay.peakScraps).toBeGreaterThan(0)
  expect(replay.peakBuried).toBeGreaterThan(0)
  // Nothing accumulates: the pools are fixed and can never be exceeded.
  expect(replay.capacity).toBeGreaterThan(0)
  expect(replay.peakScraps + replay.peakPuffs).toBeLessThanOrEqual(replay.capacity)

  // --- Rescue ---------------------------------------------------------------------
  // A lock signals both the casualty and the squadmate carrying them, and each signal
  // wears the full gold token: dashed ring, light pillar and rising halo.
  expect(replay.peakRescueSignals).toBe(2)
  expect(replay.pillarFrames).toBeGreaterThan(5)
  // A static ring would report one rotation for every frame it was up.
  expect(replay.ringSpinValues).toBeGreaterThan(3)

  // --- Elite ----------------------------------------------------------------------
  expect(replay.sigilFrames).toBeGreaterThan(10)
  expect(replay.sigilPulseValues).toBeGreaterThan(3)
  expect(replay.countdownMax).toBeGreaterThan(0)
  // The restyle must not change what the warning promises: the hazard ring is still
  // painted flat on the board at exactly the authoritative footprint radius.
  expect(replay.telegraphRadius).toBe(2)
  expect(replay.telegraphNormalY).toBeCloseTo(1, 5)
  // The strike shakes the table, and the shake stays inside the framing margin.
  expect(replay.action.cameraShakes).toBeGreaterThan(0)
  expect(replay.peakShake).toBeGreaterThan(0)
  expect(replay.peakShake).toBeLessThanOrEqual(0.27)

  // --- Clock ----------------------------------------------------------------------
  // The animation clock is exactly the authority's tick plus the controller's
  // interpolation fraction on every single frame, so it cannot outrun a paused battle
  // or accumulate while a tab is hidden.
  expect(replay.clockTracksSnapshot).toBe(true)
  // The replay runs 900 frames; the clock lands short of 900 ticks because the upgrade
  // overlay freezes the battle and the run ends when the elite falls.
  expect(replay.action.clockTicks).toBeGreaterThan(600)

  // The board paint is still exactly one flat quad inside the play area.
  expect(replay.presentation).toMatchObject({
    mode: 'diorama', surfaceDecalMeshes: 1, surfaceDecalFlat: true,
    surfaceDecalsWithinPlayArea: true, surfaceDecalCastsShadow: false,
  })
})

test('plays the same feedback through the live gameplay loop', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('?lab=v1&seed=47')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.gp-stage canvas')).toHaveCount(1)

  // Driving the real controller — real requestAnimationFrame, real interpolation alpha
  // — has to produce the same lunges and bursts the offline replay above asserts.
  await expect.poll(async () => (await scene(page))?.action.attacksObserved, { intervals: [100], timeout: 30_000 })
    .toBeGreaterThan(0)
  const before = (await scene(page))!.action

  let peakLunge = 0
  let sawPuff = false
  let sawFlash = false
  for (let index = 0; index < 30; index += 1) {
    const action = (await scene(page))!.action
    peakLunge = Math.max(peakLunge, action.maxLungeOffset)
    sawPuff ||= action.livePuffs > 0
    sawFlash ||= action.flashingUnits > 0
    await page.waitForTimeout(40)
  }
  const after = (await scene(page))!.action

  expect(after.hitsObserved).toBeGreaterThan(before.hitsObserved)
  expect(after.attacksObserved).toBeGreaterThan(before.attacksObserved)
  expect(after.clockTicks).toBeGreaterThan(before.clockTicks)
  expect(peakLunge).toBeGreaterThan(0.05)
  expect(sawPuff).toBe(true)
  expect(sawFlash).toBe(true)
})

test('keeps the renderer-comparison lab free of every action effect', async ({ page }) => {
  await page.goto('?lab=renderers&renderer=hybrid&enemies=100&seed=diorama-action-gate')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(async () => (await scene(page))?.framing.units, { intervals: [100] }).toBeGreaterThan(0)
  await page.waitForTimeout(800)

  // No pools, no decals, no tokens, no sigil — and, critically, no snapshot diffing:
  // the lab fixture must keep behaving exactly as `hybrid-renderer.spec.ts` asserts.
  expect((await scene(page))!.action).toMatchObject({
    particleCapacity: 0,
    livePuffs: 0,
    liveScraps: 0,
    rescuePillars: 0,
    telegraphSigils: 0,
    attacksObserved: 0,
    hitsObserved: 0,
    deathsObserved: 0,
    lungingUnits: 0,
    flashingUnits: 0,
    topplingUnits: 0,
    buriedUnits: 0,
    cameraShakes: 0,
    cameraShakeOffset: 0,
  })
})
