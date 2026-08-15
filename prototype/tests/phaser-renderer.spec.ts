import { expect, test } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

type TabletopDiagnostics = {
  readonly rendererType: 'canvas' | 'webgl'
  readonly objectCount: number
  readonly actualChildCount: number
  readonly visualUnitCount: number
  readonly generatedTextureCount: number
  readonly unitDepthOrder: readonly { readonly id: number; readonly depth: number }[]
  readonly snapshotUnitIds: readonly number[]
  readonly teamTints: Readonly<Record<'teal' | 'scarlet' | 'enemy', number>>
  readonly markers: { readonly commander: number; readonly downed: number; readonly enemyCommander: number }
  readonly yOrdered: boolean
  readonly visualFrame: { readonly viewportWidth: number; readonly viewportHeight: number; readonly unitCssX: number; readonly unitCssY: number; readonly unitCssSize: number }
  readonly quality: { readonly particleCount: number; readonly dpr: number }
  readonly metrics: { readonly drawCalls: number | null; readonly textures: number | null; readonly geometries: number | null }
  applyQuality(level: 'full' | 'reduced-particles' | 'reduced-shadows' | 'low-dpr'): void
  isYOrdered(order: readonly { readonly id: number; readonly depth: number }[]): boolean
  dispose(): void
}

async function startTwoDimensionalGame(page: import('@playwright/test').Page, search = ''): Promise<void> {
  await page.goto(`?renderer=2d&enemies=100${search}`)
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __TABLETOP_DIAGNOSTICS__?: unknown }).__TABLETOP_DIAGNOSTICS__))).toBe(true)
  await expect.poll(async () => (await diagnostics(page)).snapshotUnitIds.length).toBe(118)
}

async function diagnostics(page: import('@playwright/test').Page): Promise<TabletopDiagnostics> {
  return page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__)
}

test('renders the shared snapshot as a sorted cardboard scene with visual role markers', async ({ page }) => {
  await startTwoDimensionalGame(page)
  const scene = await diagnostics(page)

  expect(scene.objectCount).toBeGreaterThanOrEqual(118)
  expect(scene.actualChildCount).toBe(scene.objectCount)
  expect(scene.visualUnitCount).toBe(118)
  expect(scene.generatedTextureCount).toBe(4)
  expect(scene.snapshotUnitIds).toHaveLength(118)
  expect(scene.snapshotUnitIds[0]).toBe(1)
  expect(scene.snapshotUnitIds.at(-1)).toBe(118)
  expect(scene.teamTints).toEqual({ teal: 0x4bc6bd, scarlet: 0xd45d52, enemy: 0x835146 })
  expect(scene.markers).toEqual({ commander: 1, downed: 1, enemyCommander: 1 })
  expect(scene.yOrdered).toBe(true)
  expect(scene.unitDepthOrder).toHaveLength(118)
  expect(await page.evaluate(() => {
    const diagnostics = (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__
    return diagnostics.isYOrdered([...diagnostics.unitDepthOrder].reverse())
  })).toBe(false)
  expect(scene.metrics.drawCalls).toBeNull()
  expect(scene.metrics.textures).toBe(4)
  expect(scene.metrics.geometries).toBeNull()
})

test('lowers the Phaser backing store DPR without changing CSS visual framing before restoring it', async ({ page }) => {
  await startTwoDimensionalGame(page)
  const before = await diagnostics(page)
  expect(before.quality.particleCount).toBeGreaterThan(0)
  expect(before.visualFrame.unitCssSize).toBeGreaterThan(0)
  const canvas = page.locator('.game-stage canvas')
  const fullResolution = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
  }))
  expect(fullResolution.width).toBeGreaterThan(fullResolution.cssWidth)

  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('reduced-particles'))
  await expect.poll(async () => (await diagnostics(page)).quality.particleCount).toBe(before.quality.particleCount / 2)
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('low-dpr'))
  await expect.poll(async () => (await diagnostics(page)).quality.dpr).toBe(1)
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeLessThan(fullResolution.width)
  const lowDpr = await diagnostics(page)
  const lowResolution = await canvas.evaluate((element) => ({
    cssWidth: element.getBoundingClientRect().width,
    cssHeight: element.getBoundingClientRect().height,
  }))
  expect(lowResolution).toEqual({ cssWidth: fullResolution.cssWidth, cssHeight: fullResolution.cssHeight })
  expect(lowDpr.visualFrame).toEqual(before.visualFrame)

  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('full'))
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBe(fullResolution.width)
})

test('returns canvas resources to baseline on repeated dispose and removes app diagnostics', async ({ page }) => {
  await startTwoDimensionalGame(page)

  await page.evaluate(() => {
    const diagnostics = (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: TabletopDiagnostics }).__TABLETOP_DIAGNOSTICS__
    diagnostics.dispose()
    diagnostics.dispose()
  })
  await expect(page.locator('.game-stage canvas')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => Reflect.has(window, '__TABLETOP_DIAGNOSTICS__'))).toBe(false)
})

test('uses injected WebGL-unavailable capability to select the Canvas renderer', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __TABLETOP_RENDERER_CAPABILITIES__?: { webglSupported: boolean } }).__TABLETOP_RENDERER_CAPABILITIES__ = { webglSupported: false }
  })
  await startTwoDimensionalGame(page)
  await expect.poll(async () => (await diagnostics(page)).rendererType).toBe('canvas')
})

test('uses forceCanvas as a separate deterministic renderer path', async ({ page }) => {
  await startTwoDimensionalGame(page, '&forceCanvas=1')

  await expect.poll(async () => (await diagnostics(page)).rendererType).toBe('canvas')
})

test('clears diagnostics when a renderer startup error returns to selection', async ({ page }) => {
  await page.route('**/src/renderers/three-3d/**', (route) => route.abort())
  await page.goto('?renderer=3d')
  await page.getByRole('button', { name: '게임 시작' }).click()

  await expect(page.getByRole('alert')).toContainText(/Failed to fetch dynamically imported module|error loading dynamically imported module/)
  await expect.poll(() => page.evaluate(() => Reflect.has(window, '__TABLETOP_DIAGNOSTICS__'))).toBe(false)
})

test('settles a mount disposed before Phaser scene creation without leaking a late canvas or scene resources', async ({ page }) => {
  await page.goto('')
  const result = await page.evaluate(async () => {
    const { createPhaserRenderer } = await (0, eval)('import("/src/renderers/phaser-2d/index.ts")')
    const host = document.createElement('div')
    host.style.width = '640px'
    host.style.height = '360px'
    document.body.append(host)
    const renderer = createPhaserRenderer()
    const mounting = renderer.mount(host)
    renderer.dispose()
    await mounting
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    return { canvases: host.querySelectorAll('canvas').length, objectCount: renderer.getDiagnostics().objectCount }
  })

  expect(result).toEqual({ canvases: 0, objectCount: 0 })
})
