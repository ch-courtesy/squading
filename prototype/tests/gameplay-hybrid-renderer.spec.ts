import { expect, test, type Page } from '@playwright/test'

// These tests read the real Three.js scene graph through the dev-only
// `__SQUADING_TEST__` bridge, because a canvas cannot tell us whether the elite
// telegraph is a flat 2-unit circle or whether a downed card is actually laid
// down. `gameplay-play.spec.ts` deliberately never touches the bridge — it
// verifies authority outcomes through the player-visible UI only.
type RendererScene = NonNullable<Awaited<ReturnType<typeof rendererScene>>>

async function rendererScene(page: Page) {
  return page.evaluate(() => window.__SQUADING_TEST__?.rendererScene?.() ?? null)
}

async function startSeed47Battle(page: Page): Promise<void> {
  await page.goto('?lab=v1&seed=47')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.gp-stage canvas')).toHaveCount(1)
}

test('renders elite telegraph and downed/rescue states from a gameplay snapshot', async ({ page }) => {
  // Seed 47 with no movement spawns the elite at tick 540, telegraphs from tick
  // 570 and downs the first squadmate at tick 572 — roughly 20 real seconds.
  test.setTimeout(120_000)
  await startSeed47Battle(page)

  // The upgrade overlay freezes the battle at tick 291 until a card is chosen.
  await page.getByRole('button', { name: '화력 강화' }).click()
  await expect(page.locator('[data-upgrade]')).toBeHidden()
  // Held Space is what makes the authority lock a rescuer onto a casualty, which
  // is what the renderer draws as a `rescue-signal`.
  await page.keyboard.down('Space')

  await expect(page.locator('[data-elite-hp]')).not.toHaveText('정예 대기 중', { timeout: 60_000 })
  const withElite = (await rendererScene(page))!
  expect(withElite.eliteCards).toHaveLength(1)
  // The gameplay route wears the tabletop diorama, so the elite is a sculpted
  // miniature standing on its plinth: still oversized, but it no longer turns to face
  // the camera the way the lab's cardboard card does.
  expect(withElite.eliteCards[0]).toMatchObject({ scale: 1.25, facesCamera: false })

  let telegraph: RendererScene['eliteTelegraph'] | undefined
  await expect.poll(async () => {
    telegraph = (await rendererScene(page))?.eliteTelegraph
    return telegraph?.visible
  }, { intervals: [100], timeout: 30_000 }).toBe(true)
  expect(telegraph).toMatchObject({ visible: true, radius: 2 })
  // The danger circle is painted onto the tabletop, so unlike a unit card it must
  // keep the tabletop normal instead of turning to face the camera.
  expect(telegraph!.normalY).toBeCloseTo(1, 5)

  let downed: RendererScene | undefined
  await expect.poll(async () => {
    downed = (await rendererScene(page)) ?? undefined
    return downed?.downedCards
  }, { intervals: [100], timeout: 60_000 }).toBeGreaterThan(0)
  expect(downed!.downedTiltRadians).not.toHaveLength(0)
  for (const tilt of downed!.downedTiltRadians) expect(tilt).toBeCloseTo(Math.PI / 2, 5)

  // A live lock signals both ends of the carry: the casualty being picked up and the
  // squadmate who is stuck doing it.
  await expect.poll(async () => (await rendererScene(page))?.rescueSignals, { intervals: [100], timeout: 30_000 })
    .toBe(2)
  await page.keyboard.up('Space')
})

test('marks the active squad on the tabletop and moves the marker with a real Q switch', async ({ page }) => {
  await startSeed47Battle(page)
  await expect(page.locator('[data-active-squad]')).toHaveText('주홍')
  await expect.poll(async () => (await rendererScene(page))?.activeSquadMarkers, { intervals: [100] })
    .toEqual({ teal: 0, scarlet: 8 })

  await page.keyboard.press('q')
  await expect(page.locator('[data-active-squad]')).toHaveText('청록')
  await expect.poll(async () => (await rendererScene(page))?.activeSquadMarkers, { intervals: [100] })
    .toEqual({ teal: 8, scarlet: 0 })
})

test('frames the gameplay arena so every unit is actually on screen', async ({ page }) => {
  // The gameplay arena spans 0..48 x 0..27, not the lab's origin-centred world. A camera
  // that treats those world bounds as orthographic frustum offsets renders a tabletop
  // corner and nothing else, which every scene-graph assertion above still passes.
  await startSeed47Battle(page)

  await expect.poll(async () => (await rendererScene(page))?.framing.units, { intervals: [100] }).toBeGreaterThan(0)
  const framing = (await rendererScene(page))!.framing
  expect(framing.unitsInView).toBe(framing.units)
  expect(framing.groundCoversViewCentre).toBe(true)

  // The diorama is staged from a low oblique angle rather than looking straight down,
  // which is what gives the miniatures a silhouette and a long shadow. The framing
  // above is the constraint that angle has to live inside: the arena is 48 wide and
  // enemies spawn on its boundary, so the view can never be tightened past it.
  expect(framing.cameraPitchDegrees).toBeGreaterThan(24)
  expect(framing.cameraPitchDegrees).toBeLessThan(36)
  expect(framing.viewHalfWidth).toBeLessThan(27)
  expect(framing.viewHalfWidth).toBeGreaterThanOrEqual(24)
})
