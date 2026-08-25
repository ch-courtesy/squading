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


// The gameplay route and the `?lab=renderers` comparison share one Three.js renderer.
// Only the gameplay authority publishes `activeSquad`, and that is the signal the
// renderer uses to switch from the lab's flat cardboard cards to the sculpted tabletop
// diorama. These tests pin both sides of that gate, because every lab assertion in
// `hybrid-renderer.spec.ts` is written against the cardboard presentation.
async function rendererScene(page: Page) {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene?.() ?? null)
}

test('paints the tabletop diorama on the gameplay route', async ({ page }) => {
  await page.goto('?lab=v1&seed=47')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.gp-stage canvas')).toHaveCount(1)

  await expect.poll(async () => (await rendererScene(page))?.presentation.mode, { intervals: [100] }).toBe('diorama')
  const scene = (await rendererScene(page))!

  expect(scene.presentation).toMatchObject({
    mode: 'diorama',
    // Sandy board texture with grid seams, the raised edge frame, and the cool rim
    // light that gives the miniatures form next to the warm key.
    boardTextured: true,
    frameRails: 4,
    rimLights: 1,
    // Budget, and it is a ceiling the spec fixes: a unit is one merged body mesh + one base
    // ring + one contact shadow + one health gauge. Four. The gauge is the fourth and last.
    meshesPerUnit: 4,
    // Sculpted figures stand on the board; none of them billboard.
    billboardedBodies: 0,
    // The whole terrain surround costs two meshes: one merged mesh carrying every
    // crate, conifer, banner, sandbag and plank, plus the dirt apron they stand on.
    propMeshes: 2,
    // Scorch, chalk and wear inside the play area are *paint*, not scenery: one flat
    // quad lying on the board, casting nothing, never reaching past the arena. If this
    // ever grew a silhouette it would start reading as a prop with a footprint.
    surfaceDecalMeshes: 1,
    surfaceDecalFlat: true,
    surfaceDecalsWithinPlayArea: true,
    surfaceDecalCastsShadow: false,
  })
  expect(scene.presentation.surfaceDecals).toBeGreaterThan(30)
  // And the decals are not props: adding paint must never add a placement.
  expect(scene.presentation.propItems).toBe(150)
  expect(scene.presentation.propItems).toBeGreaterThan(80)
  // Each class merges down to its own single shared geometry: one geometry per body name, so
  // one draw call still covers a whole figure however much it was sculpted. WHICH bodies exist
  // is a property of the roster the route fields — this is the v1 route, which has no §1.9
  // classes — and is asserted against the v2 roster in `diorama-gauge.spec.ts`.
  expect(scene.presentation.mergedBodyGeometries).toBe(scene.presentation.bodyArchetypes.length)
  expect(scene.presentation.bodyArchetypes.every((name) => name.startsWith('miniature:'))).toBe(true)
  expect(scene.presentation.mergedBodyGeometries).toBeGreaterThanOrEqual(2)
  // Every unit on the board wears a coloured base ring, not just the leaders.
  expect(scene.presentation.baseRings).toBe(scene.framing.units)
  expect(scene.framing.units).toBeGreaterThan(0)

  // The gauge, at the opening of a battle: every friendly wears one and nothing else does,
  // because no hostile has been hurt yet. That clean opening board is the spec's reason for
  // the hostile rule, so it is asserted rather than assumed.
  expect(scene.healthGauges.friendlyStanding).toBeGreaterThan(0)
  expect(scene.healthGauges.friendlyVisible).toBe(scene.healthGauges.friendlyStanding)
  expect(scene.healthGauges.hostileFullVisible).toBe(0)
  expect(scene.healthGauges.downedVisible).toBe(0)
  // Every drawn bar faces the camera, sits above the body it belongs to, and is filled to the
  // snapshot's own `hp01` — the renderer holds no health number of its own.
  expect(scene.healthGauges.billboarded).toBe(scene.healthGauges.visible)
  expect(scene.healthGauges.maxFillError).toBeLessThan(1e-3)
  expect(scene.healthGauges.minHeadroom).toBeGreaterThan(0)
})

test('keeps the renderer-comparison lab on its cardboard cards', async ({ page }) => {
  await page.goto('?lab=renderers&renderer=hybrid&enemies=100&seed=diorama-gate')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()

  await expect.poll(async () => (await rendererScene(page))?.framing.units, { intervals: [100] }).toBeGreaterThan(0)
  const scene = (await rendererScene(page))!

  expect(scene.presentation).toMatchObject({
    mode: 'cardboard',
    boardTextured: false,
    frameRails: 0,
    rimLights: 0,
    mergedBodyGeometries: 0,
    bodyArchetypes: [],
    // The lab keeps the three meshes it always had: card, shadow, marker. The health gauge is
    // part of the diorama presentation and does not reach here.
    meshesPerUnit: 3,
    // No terrain surround either: the comparison lab measures renderers, not scenery.
    propMeshes: 0,
    propItems: 0,
    // ...and no board paint.
    surfaceDecalMeshes: 0,
    surfaceDecals: 0,
  })
  // The lab keeps billboarded cards: every unit body faces the camera.
  expect(scene.presentation.billboardedBodies).toBe(scene.framing.units)
  // And it keeps the sparse marker rule — markers are for leaders, downed and the
  // active squad only, never one ring per unit.
  expect(scene.presentation.baseRings).toBeLessThan(scene.framing.units)
  // No health gauge is built at all on this route.
  expect(scene.healthGauges.visible).toBe(0)
  // And no board clutter: the lab has no play area to dress.
  expect(scene.fieldClutter.items).toBe(0)
})

/**
 * §카메라 and §판 안 지형 소품, taken against a LIVE v2 battle rather than a hand-built board.
 *
 * Both claims in this batch are about what happens when bodies and scenery are on the same mat
 * at the same time, and neither can be read off a static fixture: occlusion needs units that
 * have walked into each other, and "the clutter is walk-through" needs a unit to have actually
 * walked onto a piece. So this steps the authority itself, at full speed, and reads the renderer
 * afterwards. It touches no authority state — `projectBattleSnapshot` is the same projection the
 * shell uses, and the renderer only ever reads it.
 */
test('keeps the lowered camera honest and proves the board clutter is walk-through', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('?lab=renderers')
  await page.waitForTimeout(400)

  const result = await page.evaluate(async () => {
    const { createRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createBattle } = await (0, eval)('import("/src/core/battle/battle.ts")')
    const { projectBattleSnapshot } = await (0, eval)('import("/src/core/battle-view/snapshot.ts")')

    const host = document.createElement('div')
    host.style.width = '1280px'
    host.style.height = '800px'
    document.body.append(host)
    const renderer = createRenderer()
    await renderer.mount(host)
    renderer.resize(1280, 800, 1)

    const battle = createBattle('seed-h')
    battle.start()
    // A kiting circuit, so the squad both spreads out and walks across a lot of board — which is
    // what puts a body on top of a piece of clutter and what packs a melee together.
    const circuit = ['KeyD', 'KeyS', 'KeyA', 'KeyW']
    let held: string | null = null
    const worst = { mean: 0, max: 0, mostly: 0, fully: 0, bodies: 0 }
    let everOverlapped = 0
    let clutter = { items: 0, allInsidePlayArea: false, shapeViolations: 0, tallestFlatPiece: 0, widestPole: 0 }
    for (let tick = 0; tick < 600; tick += 1) {
      if (tick % 150 === 0) {
        if (held) battle.keyUp(held)
        held = circuit[(tick / 150) % circuit.length]!
        battle.keyDown(held)
      }
      const state = battle.state()
      if (state.mode === 'awaiting-upgrade') {
        battle.enqueue({ applyTick: state.combatTick, sequence: tick, kind: 'choose-upgrade', slot: 1 })
      }
      battle.step()
      renderer.render(projectBattleSnapshot(battle.state()), 0)
      const view = window.__SQUADING_TEST__!.rendererScene!()!
      if (view.framing.occlusion.meanHiddenFraction > worst.mean) {
        worst.mean = view.framing.occlusion.meanHiddenFraction
        worst.max = view.framing.occlusion.maxHiddenFraction
        worst.mostly = view.framing.occlusion.mostlyHidden
        worst.fully = view.framing.occlusion.fullyHidden
        worst.bodies = view.framing.occlusion.bodies
      }
      everOverlapped = Math.max(everOverlapped, view.fieldClutter.unitsOverlappingClutter)
      clutter = {
        items: view.fieldClutter.items,
        allInsidePlayArea: view.fieldClutter.allInsidePlayArea,
        shapeViolations: view.fieldClutter.shapeViolations,
        tallestFlatPiece: view.fieldClutter.tallestFlatPiece,
        widestPole: view.fieldClutter.widestPole,
      }
    }
    const finalView = window.__SQUADING_TEST__!.rendererScene!()!
    const out = {
      worst,
      everOverlapped,
      clutter,
      pitch: finalView.framing.cameraPitchDegrees,
      propMeshes: finalView.presentation.propMeshes,
      propItems: finalView.presentation.propItems,
      unitsInView: finalView.framing.unitsInView,
      units: finalView.framing.units,
    }
    renderer.dispose()
    host.remove()
    return out
  })

  // Printed, not only asserted: §카메라 asks for the cost of the lowered camera to be measured
  // and reported, and this run is where the number in the batch report comes from.
  console.log(
    `[§카메라] worst frame of 600: bodies=${result.worst.bodies}`
    + ` mean=${result.worst.mean.toFixed(3)} max=${result.worst.max.toFixed(2)}`
    + ` >half=${result.worst.mostly} ~full=${result.worst.fully}`
    + ` | clutter items=${result.clutter.items} peak units standing on it=${result.everOverlapped}`,
  )

  // The staged angle, read off the live camera rather than off the constant.
  expect(result.pitch).toBeCloseTo(23, 1)

  // §4.4(a) is asserted for real, against real keyboard input, in `battle-play.spec.ts`. Here it
  // is the cheap invariant that would catch a camera that stopped following: nobody leaves frame.
  expect(result.units).toBeGreaterThan(10)
  expect(result.unitsInView).toBe(result.units)

  // THE OCCLUSION CEILING. `staging.ts` chose 23 degrees off this measurement and wrote the
  // numbers down; this is what stops a later change from drifting past them. The bound is an
  // upper bound on an upper bound — the metric boxes every body, so it over-reports — and it is
  // held on the WORST frame of a 600-tick kiting run, not on an average one.
  expect(result.worst.bodies).toBeGreaterThan(8)
  expect(result.worst.mean).toBeLessThan(0.62)
  expect(result.worst.fully / result.worst.bodies).toBeLessThan(0.3)

  // §판 안 지형 소품. The board is dressed, everything on it is on the board, and not one piece
  // breaks the shape rule that makes it walk-through.
  expect(result.clutter.items).toBeGreaterThan(120)
  expect(result.clutter.allInsidePlayArea).toBe(true)
  expect(result.clutter.shapeViolations).toBe(0)
  expect(result.clutter.tallestFlatPiece).toBeLessThanOrEqual(0.22)
  expect(result.clutter.widestPole).toBeLessThanOrEqual(0.1)

  // And the thing a player actually reads it off: bodies stood inside the clutter's footprint
  // during the run. Nothing stopped them, because `core/` has never heard of it.
  expect(result.everOverlapped).toBeGreaterThan(0)

  // Dressing the board cost no draw call: the clutter merged into the surround's single mesh.
  expect(result.propMeshes).toBe(2)
  expect(result.propItems).toBe(150)
})
