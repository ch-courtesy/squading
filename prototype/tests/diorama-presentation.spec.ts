import { expect, test, type Page } from '@playwright/test'

// The gameplay route and the `?lab=renderers` comparison share one Three.js renderer.
// Only the gameplay authority publishes `activeSquad`, and that is the signal the
// renderer uses to switch from the lab's flat cardboard cards to the sculpted tabletop
// diorama. These tests pin both sides of that gate, because every lab assertion in
// `hybrid-renderer.spec.ts` is written against the cardboard presentation.
async function rendererScene(page: Page) {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene() ?? null)
}

test('paints the tabletop diorama on the gameplay route', async ({ page }) => {
  await page.goto('?seed=47')
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
    // Budget: a unit is one merged body mesh + one base ring + one contact shadow.
    meshesPerUnit: 3,
    // Sculpted figures stand on the board; none of them billboard.
    billboardedBodies: 0,
  })
  // Friendly, enemy and elite each merge down to a single shared geometry.
  expect(scene.presentation.mergedBodyGeometries).toBeGreaterThanOrEqual(2)
  expect(scene.presentation.mergedBodyGeometries).toBeLessThanOrEqual(3)
  // Every unit on the board wears a coloured base ring, not just the leaders.
  expect(scene.presentation.baseRings).toBe(scene.framing.units)
  expect(scene.framing.units).toBeGreaterThan(0)
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
  })
  // The lab keeps billboarded cards: every unit body faces the camera.
  expect(scene.presentation.billboardedBodies).toBe(scene.framing.units)
  // And it keeps the sparse marker rule — markers are for leaders, downed and the
  // active squad only, never one ring per unit.
  expect(scene.presentation.baseRings).toBeLessThan(scene.framing.units)
})
