import { expect, test, type Page } from '@playwright/test'

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
})
