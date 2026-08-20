import { expect, test, type Page } from '@playwright/test'

/**
 * The v2 half of §액션 피드백, in a real browser: the authority's account of a tick, reaching
 * the screen.
 *
 * `diorama-action.spec.ts` covers the OTHER path — v1's gameplay simulation, where the renderer
 * has no account and infers a hit from a drop in `hp01`. Both still exist and they are asserted
 * apart on purpose: the inferred path is what the lab and v1 have, and it is lossy in ways this
 * file's numbers show. Every counter below is read off the renderer's own state through the
 * dev-only bridge, and every one of them is compared against what was HANDED IN, so none of it
 * can pass by an animation merely existing.
 */
async function scene(page: Page) {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene?.() ?? null)
}

/**
 * Steps a v2 battle tick by tick, projects each tick through the display channel and renders
 * every snapshot — the same three calls the live controller makes, without the wall clock.
 */
async function replayBattle(page: Page, seed: string, ticks: number) {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
  return page.evaluate(async ({ seed, ticks }) => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createBattle } = await (0, eval)('import("/src/core/battle/battle.ts")')
    const { projectBattleSnapshot } = await (0, eval)('import("/src/core/battle-view/snapshot.ts")')
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!

    const host = document.createElement('div')
    host.style.width = '640px'
    host.style.height = '400px'
    document.body.append(host)

    const battle = createBattle(seed)
    const renderer = createRenderer()
    await renderer.mount(host)
    battle.start()

    const handed = { events: 0, shots: 0, melees: 0, blasts: 0, deaths: 0 }
    const seen = { lungeFrames: 0, flashFrames: 0, toppleFrames: 0, puffFrames: 0, scrapFrames: 0 }
    let quietFrames = 0
    let quietCounters = ''
    for (let step = 0; step < ticks; step += 1) {
      const result = battle.step()
      if (!result.ran) {
        // §1.13's card screen stops the clock; answering it keeps the run going.
        if (result.mode === 'awaiting-upgrade') battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
        else break
        continue
      }
      const snapshot = projectBattleSnapshot(battle.state(), [result])
      for (const event of snapshot.actionEvents) {
        handed.events += 1
        if (event.kind === 'shot') handed.shots += 1
        if (event.kind === 'melee') handed.melees += 1
        if (event.kind === 'blast') handed.blasts += 1
        if (event.kind === 'death') handed.deaths += 1
      }
      const before = bridge().action
      renderer.render(snapshot, 0)
      const action = bridge().action
      if (action.lungingUnits > 0) seen.lungeFrames += 1
      if (action.flashingUnits > 0) seen.flashFrames += 1
      if (action.topplingUnits > 0) seen.toppleFrames += 1
      if (action.livePuffs > 0) seen.puffFrames += 1
      if (action.liveScraps > 0) seen.scrapFrames += 1
      // The floor of the non-vacuity argument: a frame handed NO events must move no counter.
      if (snapshot.actionEvents.length === 0) {
        quietFrames += 1
        const moved = action.attacksObserved !== before.attacksObserved
          || action.hitsObserved !== before.hitsObserved
          || action.deathsObserved !== before.deathsObserved
        if (moved && quietCounters === '') quietCounters = `tick ${result.tick}`
      }
    }

    const last = bridge()
    const final = { action: last.action, handed, seen, quietFrames, quietCounters }
    renderer.dispose()
    host.remove()
    return final
  }, { seed, ticks })
}

test('plays every blow the v2 authority resolved, and only those', async ({ page }) => {
  test.setTimeout(240_000)
  const replay = await replayBattle(page, '47', 1200)

  // --- The account arrived ----------------------------------------------------------
  expect(replay.action.authoredEvents).toBe(true)
  expect(replay.handed.events).toBeGreaterThan(200)
  // N events handed in, N events played. This is the assertion the batch existed to make
  // true: the data was there and never reached the screen.
  expect(replay.action.eventsPlayed).toBe(replay.handed.events)

  // --- ...and zero events moved nothing ---------------------------------------------
  // Both halves of non-vacuity in one run: hundreds of frames carried an empty account, and
  // not one of them fired an animation.
  expect(replay.quietFrames).toBeGreaterThan(100)
  expect(replay.quietCounters).toBe('')

  // --- Attack -----------------------------------------------------------------------
  expect(replay.handed.shots).toBeGreaterThan(50)
  expect(replay.handed.melees).toBeGreaterThan(0)
  expect(replay.action.attacksObserved).toBeGreaterThan(50)
  expect(replay.seen.lungeFrames).toBeGreaterThan(20)
  expect(replay.seen.puffFrames).toBeGreaterThan(20)
  // Guns puff, fists do not. A muzzle burst for every melee blow as well would put this at
  // `shots + melees`; it is capped by the shots alone.
  expect(replay.action.muzzleBursts).toBeGreaterThan(0)
  expect(replay.action.muzzleBursts).toBeLessThanOrEqual(replay.handed.shots)
  expect(replay.action.contactBursts).toBeGreaterThan(0)
  expect(replay.action.contactBursts).toBeLessThanOrEqual(replay.handed.melees)

  // --- Hit --------------------------------------------------------------------------
  // Every blow flashes its target, including the killing one — which the inferred path
  // cannot do, because a body that dies is never seen to lose health.
  expect(replay.action.hitsObserved).toBe(replay.handed.shots + replay.handed.melees + replay.handed.blasts)
  expect(replay.seen.flashFrames).toBeGreaterThan(20)

  // --- Death ------------------------------------------------------------------------
  expect(replay.handed.deaths).toBeGreaterThan(5)
  expect(replay.action.deathsObserved).toBe(replay.handed.deaths)
  expect(replay.seen.toppleFrames).toBeGreaterThan(10)
  expect(replay.seen.scrapFrames).toBeGreaterThan(10)
})

/**
 * A hand-built board, because the two claims below need control the authority cannot give:
 * a frame carrying ONLY melee blows, and a warning ring with bodies deliberately standing on
 * its far arc. The snapshots carry display inputs only (`kind`, `state`, `hp01`, effects,
 * action events); nothing here reaches a rule, and nothing a rule produces is asserted.
 */
async function fixture(page: Page) {
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)
}


test('gives a gun the muzzle puff and a fist the dust, and never the other way round', async ({ page }) => {
  await fixture(page)
  const readings = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!.action
    const host = document.createElement('div')
    host.style.cssText = 'width:800px;height:500px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)

    const body = (id: number, kind: string, team: string, x: number, y: number) => ({
      id, kind, team, squad: team === 'enemy' ? null : team,
      x, y, facingRadians: 0, radius: 0.45, hp01: 1, fatigue01: 0, morale01: 1, state: 'idle',
    })
    const base = {
      elapsedMs: 0,
      units: [body(1, 'commander', 'scarlet', -2, 0), body(101, 'enemy', 'enemy', 2, 0)],
      projectiles: [], effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 20, worldHeight: 12 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      activeSquad: 'teal',
    }
    const blow = (kind: string, tick: number) => ({
      kind, tick, sourceId: 101, sourceX: 2, sourceY: 0,
      targetId: 1, targetX: -2, targetY: 0, strength01: 0.3,
    })

    // Two settling frames with an empty account, so the bodies exist before anything is fired.
    renderer.render({ ...base, tick: 1, actionEvents: [] }, 0)
    renderer.render({ ...base, tick: 2, actionEvents: [] }, 0)
    const settled = bridge()

    renderer.render({ ...base, tick: 3, actionEvents: [blow('melee', 2)] }, 0)
    const afterMelee = bridge()
    renderer.render({ ...base, tick: 4, actionEvents: [blow('shot', 3)] }, 0)
    const afterShot = bridge()

    const readings = {
      settled: { muzzle: settled.muzzleBursts, contact: settled.contactBursts, played: settled.eventsPlayed },
      afterMelee: { muzzle: afterMelee.muzzleBursts, contact: afterMelee.contactBursts, played: afterMelee.eventsPlayed },
      afterShot: { muzzle: afterShot.muzzleBursts, contact: afterShot.contactBursts, played: afterShot.eventsPlayed },
    }
    renderer.dispose()
    host.remove()
    return readings
  })

  expect(readings.settled).toEqual({ muzzle: 0, contact: 0, played: 0 })
  // A melee blow: dust at the contact, and not one puff of gun smoke.
  expect(readings.afterMelee).toEqual({ muzzle: 0, contact: 1, played: 1 })
  // A shot: the muzzle, and no extra contact dust.
  expect(readings.afterShot).toEqual({ muzzle: 1, contact: 1, played: 2 })
})

/**
 * §정예 예고, with bodies standing in the ring.
 *
 * Batch K lowered the camera to 23 degrees and reported the warning ring "substantially covered
 * by the bodies standing inside it, with only its left and right arcs readable" — a play defect,
 * because §4.5 asks whether the strike can be dodged and a warning whose edge cannot be seen
 * cannot be dodged on purpose.
 *
 * The reading is taken off rendered PIXELS: the scene is drawn three times offscreen — as it
 * ships, with the over-body outline hidden, and with the whole warning hidden — and a point on
 * the ring counts as painted when its pixel differs from the bare board.
 */
test('keeps the elite warning readable through the bodies standing inside it', async ({ page }) => {
  await fixture(page)
  const reading = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const host = document.createElement('div')
    host.style.cssText = 'width:1200px;height:760px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    renderer.resize(1200, 760, 1)

    // A ring of the authoritative blast radius with the squad standing across it — including
    // four bodies planted on the FAR arc, which at 23 degrees is the arc that gets covered.
    const RADIUS = 2
    const body = (id: number, kind: string, team: string, x: number, y: number) => ({
      id, kind, team, squad: team === 'enemy' ? null : team,
      x, y, facingRadians: 0, radius: kind === 'commander' ? 0.55 : 0.45,
      hp01: 1, fatigue01: 0, morale01: 1, state: 'idle',
    })
    const inside = [
      body(1, 'commander', 'scarlet', 0, 0.2),
      body(2, 'soldier', 'teal', -1.1, -1.1),
      body(3, 'soldier', 'teal', 0, -1.4),
      body(4, 'soldier', 'teal', 1.1, -1.1),
      body(5, 'soldier', 'teal', -0.9, 0.9),
      body(6, 'soldier', 'teal', 0.9, 0.9),
    ]
    const snapshot = {
      elapsedMs: 0,
      units: [...inside, body(1000, 'elite', 'enemy', 6, 0)],
      projectiles: [],
      effects: [{
        id: 1000, kind: 'elite-telegraph', team: 'enemy',
        x: 0, y: 0, radius: RADIUS, startedTick: 1, durationTicks: 20,
      }],
      actionEvents: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 22, worldHeight: 14 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      activeSquad: 'teal',
    }
    for (let frame = 0; frame < 4; frame += 1) renderer.render({ ...snapshot, tick: 10 + frame }, 0)
    const telegraph = window.__SQUADING_TEST__!.rendererScene!()!.eliteTelegraph
    const legibility = window.__SQUADING_TEST__!.telegraphLegibility!()!
    renderer.dispose()
    host.remove()
    return { ...telegraph, ...legibility }
  })

  expect(reading.visible).toBe(true)
  expect(reading.radius).toBe(2)
  // The board is genuinely crowded, and the bodies genuinely cover part of the ring: without
  // both, everything below would pass on an empty circle.
  expect(reading.bodiesInside).toBeGreaterThanOrEqual(5)
  expect(reading.samples).toBeGreaterThan(50)
  expect(reading.occludedSamples).toBeGreaterThan(0)

  // Batch K's ring, measured: the ground band alone loses the points the bodies stand on.
  // A floor rather than "fewer than all of them", so this cannot pass on a board where the
  // occlusion happened not to bite — which would make the comparison below meaningless.
  // Measured on this fixture: 43 of 64 painted, 21 lost.
  expect(reading.samples - reading.groundOnlyPaintedSamples).toBeGreaterThanOrEqual(5)

  // The ring as it ships now: every sample point on the circumference is painted.
  expect(reading.paintedSamples).toBe(reading.samples)
  expect(reading.paintedSamples).toBeGreaterThan(reading.groundOnlyPaintedSamples)

  // ...and the mechanism that makes it so, rather than a hope that it stays that way.
  expect(reading.overlayDepthTested).toBe(false)
  expect(reading.overlayRenderOrder).toBeGreaterThan(4)

  console.log(
    `[§정예 예고] samples=${reading.samples} bodiesInside=${reading.bodiesInside}`
    + ` occluded=${reading.occludedSamples} groundOnlyPainted=${reading.groundOnlyPaintedSamples}`
    + ` painted=${reading.paintedSamples}`,
  )
})

test('keeps the renderer-comparison lab on the inferred path, with no account and no outline', async ({ page }) => {
  await page.goto('?lab=renderers&renderer=hybrid&enemies=100&seed=battle-action-gate')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(async () => (await scene(page))?.framing.units, { intervals: [100] }).toBeGreaterThan(0)
  await page.waitForTimeout(600)

  const view = (await scene(page))!
  // The lab fixture publishes no `actionEvents`, so the renderer must stay on the inferred
  // path and must not build the diorama-only over-body outline.
  expect(view.action.authoredEvents).toBe(false)
  expect(view.action.eventsPlayed).toBe(0)
  expect(view.eliteTelegraph.overlayDepthTested).toBe(null)
  expect(view.presentation.mode).toBe('cardboard')
})

test('carries the account through the live v2 loop, not only through an offline replay', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('?seed=47')
  await expect(page.locator('[data-battle-ready]')).toBeVisible()
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.bt-stage canvas')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await scene(page))?.action.eventsPlayed ?? 0, { intervals: [200], timeout: 120_000 })
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
    await page.waitForTimeout(60)
  }
  const after = (await scene(page))!.action

  expect(after.authoredEvents).toBe(true)
  expect(after.eventsPlayed).toBeGreaterThan(before.eventsPlayed)
  expect(after.attacksObserved).toBeGreaterThan(before.attacksObserved)
  expect(after.hitsObserved).toBeGreaterThan(before.hitsObserved)
  expect(peakLunge).toBeGreaterThan(0.05)
  expect(sawPuff).toBe(true)
  expect(sawFlash).toBe(true)
})

/**
 * §1.4's rhythm, and what the renderer can and cannot promise about it.
 *
 * The spec asks the renderer to "reveal this rhythm visually": after the squad stops, each unit
 * fires on its own leftover cooldown and the shots are scattered, then the phases align and the
 * squad fires together. The rhythm IS in the data — measured over 700 ticks of `seed-h`, most
 * ticks carry one or two friendly shots and 31 of them carry four or more, peaking at eight —
 * and what this pins is the renderer's half of it: one shot, one muzzle burst, so a tick that
 * fired eight puts eight puffs on the board and a tick that fired one puts one.
 *
 * WHAT IS NOT ASSERTED, because it was not tested: that a player watching at 30 ticks a second
 * PERCEIVES the alternation as scattered-then-together. That is a judgement about a person, and
 * nothing here or in the screenshots establishes it.
 */
test('puts one muzzle burst on the board per shot, so a volley reads as a volley', async ({ page }) => {
  await fixture(page)
  const readings = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!.action
    const host = document.createElement('div')
    host.style.cssText = 'width:900px;height:560px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)

    const shooters = [1, 2, 3, 4, 5, 6]
    const body = (id: number, kind: string, team: string, x: number, y: number) => ({
      id, kind, team, squad: team === 'enemy' ? null : team,
      x, y, facingRadians: 0, radius: 0.45, hp01: 1, fatigue01: 0, morale01: 1, state: 'idle',
    })
    const base = {
      elapsedMs: 0,
      units: [
        ...shooters.map((id, index) => body(id, id === 1 ? 'commander' : 'soldier', id === 1 ? 'scarlet' : 'teal', -3 + index * 0.9, 0)),
        body(101, 'enemy-commander', 'enemy', 2, 3),
      ],
      projectiles: [], effects: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 24, worldHeight: 15 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      activeSquad: 'teal',
    }
    const shot = (sourceId: number, tick: number) => ({
      kind: 'shot', tick, sourceId, sourceX: -3 + (sourceId - 1) * 0.9, sourceY: 0,
      targetId: 101, targetX: 2, targetY: 3, strength01: 0.2,
    })

    renderer.render({ ...base, tick: 1, actionEvents: [] }, 0)
    renderer.render({ ...base, tick: 2, actionEvents: [] }, 0)
    const drawCallsQuiet = renderer.collectMetrics().drawCalls
    const burstsQuiet = bridge().muzzleBursts

    // A scattered tick: one body fires.
    renderer.render({ ...base, tick: 3, actionEvents: [shot(1, 2)] }, 0)
    const afterOne = bridge().muzzleBursts

    // A synchronised volley: all six on the same tick.
    renderer.render({ ...base, tick: 4, actionEvents: shooters.map((id) => shot(id, 3)) }, 0)
    const afterVolley = bridge().muzzleBursts
    const drawCallsBusy = renderer.collectMetrics().drawCalls
    const livePuffs = bridge().livePuffs

    const readings = { drawCallsQuiet, drawCallsBusy, burstsQuiet, afterOne, afterVolley, livePuffs }
    renderer.dispose()
    host.remove()
    return readings
  })

  expect(readings.burstsQuiet).toBe(0)
  expect(readings.afterOne).toBe(1)
  // Six shots on one tick, six bursts. A renderer that merged a frame's blows would answer 2.
  expect(readings.afterVolley).toBe(7)
  expect(readings.livePuffs).toBeGreaterThanOrEqual(6)

  // --- What the whole action feedback costs in draw calls -----------------------------
  // Both particle pools are one `InstancedMesh` each, so a burst of any size is one call and
  // twenty-eight live puffs cost exactly what one does. The unit lunge, the recoil, the flash
  // and the topple are transforms and material fields on meshes that were being drawn anyway.
  console.log(
    `[draw calls] quiet=${readings.drawCallsQuiet} with ${readings.livePuffs} live puffs=${readings.drawCallsBusy}`,
  )
  expect(readings.drawCallsBusy! - readings.drawCallsQuiet!).toBeLessThanOrEqual(2)
})

/**
 * §액션 피드백's last line: "정예 범위 공격: 착탄 순간 화면이 짧게 흔들린다".
 *
 * The strike is the one action that has NO damage event to hang on, and deliberately so. On
 * `seed-h`'s winning route the elite's blast lands zero blows across the whole run — the squad
 * kites out of every circle, which is §4.5's dodging question answered in the authority's own
 * numbers — and a shake driven by damage would then never fire on the route a player actually
 * wins with. So it is driven by the WARNING CLEARING with its countdown run out, which is the
 * moment the strike lands whether or not anybody was standing there.
 *
 * A cancelled warning (the elite died mid-countdown, so the ring vanishes with time still on it)
 * must NOT shake, and that is the other half of what is pinned here.
 */
test('shakes the table when the elite strike lands, and not when it was called off', async ({ page }) => {
  await fixture(page)
  const readings = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const bridge = () => window.__SQUADING_TEST__!.rendererScene!()!.action
    const host = document.createElement('div')
    host.style.cssText = 'width:800px;height:500px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)

    const base = {
      elapsedMs: 0,
      units: [{
        id: 1, kind: 'commander', team: 'scarlet', squad: 'scarlet',
        x: 0, y: 0, facingRadians: 0, radius: 0.55, hp01: 1, fatigue01: 0, morale01: 1, state: 'idle',
      }],
      projectiles: [],
      actionEvents: [],
      camera: { centerX: 0, centerY: 0, worldWidth: 20, worldHeight: 12 },
      playArea: { centerX: 0, centerY: 0, worldWidth: 56, worldHeight: 32 },
      activeSquad: 'teal',
    }
    const warning = (durationTicks: number) => [{
      id: 1000, kind: 'elite-telegraph', team: 'enemy',
      x: 3, y: 0, radius: 2, startedTick: 1, durationTicks,
    }]

    // A warning that runs its countdown out, then clears: the strike landed.
    let tick = 1
    for (const remaining of [30, 20, 10, 4, 1]) {
      renderer.render({ ...base, tick: tick++, effects: warning(remaining) }, 0)
    }
    const beforeStrike = bridge().cameraShakes
    renderer.render({ ...base, tick: tick++, effects: [] }, 0)
    const struckOn = bridge().cameraShakes
    // The camera offset is applied at the head of the NEXT frame — the shake is armed after the
    // camera has already been placed for this one — so the displacement is read one frame on.
    renderer.render({ ...base, tick: tick++, effects: [] }, 0)
    const afterStrike = { shakes: struckOn, offset: bridge().cameraShakeOffset }

    // A warning called off with time still on its clock: the elite fell mid-countdown.
    for (const remaining of [30, 22, 16]) {
      renderer.render({ ...base, tick: tick++, effects: warning(remaining) }, 0)
    }
    renderer.render({ ...base, tick: tick++, effects: [] }, 0)
    const afterCancel = bridge().cameraShakes

    const readings = { beforeStrike, afterStrike, afterCancel }
    renderer.dispose()
    host.remove()
    return readings
  })

  expect(readings.beforeStrike).toBe(0)
  expect(readings.afterStrike.shakes).toBe(1)
  expect(readings.afterStrike.offset).toBeGreaterThan(0)
  expect(readings.afterCancel).toBe(1)
})
