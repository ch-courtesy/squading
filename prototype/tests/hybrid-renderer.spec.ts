import { expect, test } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

type HybridDiagnostics = {
  readonly rendererType: 'webgl'
  readonly objectCount: number
  readonly actualObjectCount: number
  readonly visualUnitCount: number
  readonly visualEffectCount: number
  readonly snapshotUnitIds: readonly number[]
  readonly teamTints: Readonly<Record<'teal' | 'scarlet' | 'enemy', number>>
  readonly unitVisuals: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number; readonly billboard: boolean; readonly facesCamera: boolean; readonly screenY: number; readonly screenHeight: number; readonly kind: string; readonly state: string; readonly cardCenter: { readonly x: number; readonly y: number; readonly z: number }; readonly shadowNormalY: number; readonly markerNormalY: number; readonly shadowFootprint: { readonly x: number; readonly z: number } }[]
  readonly worldBounds: { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }
  readonly camera: { readonly projection: 'orthographic'; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
  readonly rescueSignalCount: number
  readonly quality: { readonly particleCount: number; readonly shadowMapSize: number; readonly shadowTargetSize: { readonly width: number; readonly height: number } | null; readonly dpr: number }
  readonly metrics: { readonly drawCalls: number | null; readonly textures: number | null; readonly geometries: number | null }
  applyQuality(level: 'full' | 'reduced-particles' | 'reduced-shadows' | 'low-dpr'): void
  dispose(): void
}

async function startHybridGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('?renderer=hybrid&enemies=100&seed=hybrid-fixture')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(async () => (await diagnostics(page)).snapshotUnitIds.length).toBe(118)
}

async function diagnostics(page: import('@playwright/test').Page): Promise<HybridDiagnostics> {
  return page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__)
}

test('renders the shared fixture through a real orthographic Three.js cardboard scene', async ({ page }) => {
  await startHybridGame(page)
  const scene = await diagnostics(page)

  expect(scene.rendererType).toBe('webgl')
  expect(scene.actualObjectCount).toBe(scene.objectCount)
  expect(scene.objectCount).toBeGreaterThanOrEqual(118)
  expect(scene.visualUnitCount).toBe(118)
  expect(scene.snapshotUnitIds).toEqual(Array.from({ length: 118 }, (_, index) => index + 1))
  expect(scene.teamTints).toEqual({ teal: 0x4bc6bd, scarlet: 0xd45d52, enemy: 0x835146 })
  expect(scene.worldBounds).toEqual({ width: 64, height: 36, centerX: 0, centerY: 0 })
  expect(scene.camera.projection).toBe('orthographic')
  expect(scene.camera.right - scene.camera.left).toBeCloseTo(scene.worldBounds.width, 5)
  expect(scene.camera.top - scene.camera.bottom).toBeCloseTo(scene.worldBounds.height, 5)

  const commander = scene.unitVisuals.find((unit) => unit.kind === 'commander')!
  const soldier = scene.unitVisuals.find((unit) => unit.kind === 'soldier' && unit.state !== 'downed')!
  const snapshotPositions = await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: { unitPositions: Record<string, { x: number; y: number }> } }).__TABLETOP_DIAGNOSTICS__.unitPositions)
  expect(commander).toMatchObject({ id: 1, tint: 0x4bc6bd, billboard: true, facesCamera: true })
  expect(soldier).toMatchObject({ billboard: true, facesCamera: true })
  expect(commander.x).toBeCloseTo(snapshotPositions['1'].x, 5)
  expect(commander.y).toBeCloseTo(snapshotPositions['1'].y, 5)
  expect(commander.screenHeight / soldier.screenHeight).toBeGreaterThanOrEqual(1.125)
  expect(commander.screenHeight / soldier.screenHeight).toBeLessThanOrEqual(1.375)
  expect(commander.screenY).toBeGreaterThan(0)
  expect(commander.cardCenter.x).toBeCloseTo(commander.x, 5)
  expect(commander.cardCenter.z).toBeCloseTo(commander.y, 5)
  expect(commander.shadowFootprint).toEqual({ x: expect.closeTo(commander.x, 5), z: expect.closeTo(commander.y, 5) })
  expect(commander.shadowNormalY).toBeCloseTo(1, 5)
  expect(commander.markerNormalY).toBeCloseTo(1, 5)
  expect(scene.metrics.drawCalls).toBeGreaterThan(0)
  expect(scene.metrics.textures).toBeGreaterThanOrEqual(1)
  expect(scene.metrics.geometries).toBeGreaterThanOrEqual(3)
})

test('applies the quality ladder to actual Three renderer resolution, particles, and shadow map', async ({ page }) => {
  await startHybridGame(page)
  const before = await diagnostics(page)
  const canvas = page.locator('.game-stage canvas')
  const fullResolution = await canvas.evaluate((element) => (element as HTMLCanvasElement).width)

  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('reduced-particles'))
  await expect.poll(async () => (await diagnostics(page)).quality.particleCount).toBe(before.quality.particleCount / 2)
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('reduced-shadows'))
  await expect.poll(async () => (await diagnostics(page)).quality.shadowMapSize).toBe(512)
  await expect.poll(async () => (await diagnostics(page)).quality.shadowTargetSize).toEqual({ width: 512, height: 512 })
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('low-dpr'))
  await expect.poll(async () => (await diagnostics(page)).quality.dpr).toBe(1)
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeLessThan(fullResolution)
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('full'))
  await expect.poll(async () => (await diagnostics(page)).quality.shadowTargetSize).toEqual({ width: 1024, height: 1024 })
})

test('renders an actual rescue-signal effect and returns canvas and resource diagnostics to baseline on dispose', async ({ page }) => {
  await startHybridGame(page)
  await page.keyboard.press('Space')
  await expect.poll(async () => (await diagnostics(page)).rescueSignalCount).toBeGreaterThan(0)

  await page.evaluate(() => {
    const diagnostics = (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: HybridDiagnostics }).__TABLETOP_DIAGNOSTICS__
    diagnostics.dispose()
    diagnostics.dispose()
  })
  await expect(page.locator('.game-stage canvas')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => Reflect.has(window, '__TABLETOP_DIAGNOSTICS__'))).toBe(false)
})

test('disposes direct Three scene graph resources after a populated fixture render', async ({ page }) => {
  await page.goto('')
  const result = await page.evaluate(async () => {
    const { createHybridRenderer } = await (0, eval)('import("/src/renderers/three-hybrid/index.ts")')
    const { createSimulation } = await (0, eval)('import("/src/core/simulation.ts")')
    const host = document.createElement('div')
    host.style.width = '960px'
    host.style.height = '540px'
    document.body.append(host)
    const renderer = createHybridRenderer()
    await renderer.mount(host)
    renderer.render(createSimulation({ seed: 'hybrid-dispose', enemyCount: 100 }).getSnapshot(), 0)
    const populated = renderer.getDiagnostics()
    renderer.dispose()
    const baseline = renderer.getDiagnostics()
    return { populated, baseline, canvases: host.querySelectorAll('canvas').length }
  })

  expect(result.populated.metrics.geometries).toBeGreaterThan(0)
  expect(result.populated.metrics.textures).toBeGreaterThan(0)
  expect(result).toMatchObject({ canvases: 0, baseline: { objectCount: 0, visualUnitCount: 0, visualEffectCount: 0, metrics: { drawCalls: null, textures: null, geometries: null } } })
})
