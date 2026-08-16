import { expect, test } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

type ThreeDiagnostics = {
  readonly rendererType: 'webgl'
  readonly instancedMesh: { readonly count: number; readonly triangles: number; readonly instanceIds: readonly number[]; readonly instances: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number; readonly baseTint: number; readonly state: string; readonly matrix: readonly number[] }[] }
  readonly visualUnitCount: number
  readonly snapshotUnitIds: readonly number[]
  readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]
  readonly worldBounds: { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }
  readonly camera: { readonly projection: 'orthographic'; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly target: { readonly x: number; readonly y: number; readonly z: number } }
  readonly quality: { readonly particleCount: number; readonly shadowMapSize: number; readonly shadowTargetSize: { readonly width: number; readonly height: number } | null; readonly dpr: number }
  readonly metrics: { readonly drawCalls: number | null; readonly textures: number | null; readonly geometries: number | null }
  applyQuality(level: 'full' | 'reduced-particles' | 'reduced-shadows' | 'low-dpr'): void
  dispose(): void
}

async function startThreeGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('?lab=renderers&renderer=3d&enemies=100&seed=three-fixture')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(async () => (await diagnostics(page)).snapshotUnitIds.length).toBe(118)
}

async function diagnostics(page: import('@playwright/test').Page): Promise<ThreeDiagnostics> {
  return page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: ThreeDiagnostics }).__TABLETOP_DIAGNOSTICS__)
}

test('renders every snapshot unit through actual tinted InstancedMesh transforms within the triangle budget', async ({ page }) => {
  await startThreeGame(page)
  const scene = await diagnostics(page)

  expect(scene.rendererType).toBe('webgl')
  expect(scene.visualUnitCount).toBe(118)
  expect(scene.snapshotUnitIds).toEqual(Array.from({ length: 118 }, (_, index) => index + 1))
  expect(scene.instancedMesh.count).toBe(scene.snapshotUnitIds.length)
  expect(scene.instancedMesh.instanceIds).toEqual(scene.snapshotUnitIds)
  expect(scene.instancedMesh.triangles).toBeLessThanOrEqual(1500)
  expect(scene.instancedMesh.instances).toHaveLength(118)

  for (const instance of scene.instancedMesh.instances) {
    const snapshot = scene.snapshotUnits.find((unit) => unit.id === instance.id)!
    expect(snapshot).toBeTruthy()
    expect(instance.x).toBeCloseTo(snapshot.x, 5)
    expect(instance.y).toBeCloseTo(snapshot.y, 5)
    expect(instance.baseTint).toBe(snapshot.tint)
    expect(instance.matrix).toHaveLength(16)
    expect(instance.matrix.every(Number.isFinite)).toBe(true)
  }
  expect(scene.instancedMesh.instances.some((unit) => unit.state === 'downed' && unit.tint !== unit.baseTint)).toBe(true)
  expect(scene.metrics.drawCalls).toBeGreaterThan(0)
  expect(scene.metrics.geometries).toBeGreaterThan(0)
})

test('uses snapshot-equivalent orthographic world framing and centers the commanders in view', async ({ page }) => {
  await startThreeGame(page)
  const scene = await diagnostics(page)
  const commander = scene.instancedMesh.instances.find((unit) => unit.id === 1)!

  expect(scene.worldBounds).toEqual({ width: 64, height: 36, centerX: 0, centerY: 0 })
  expect(scene.camera.projection).toBe('orthographic')
  expect(scene.camera.right - scene.camera.left).toBeCloseTo(scene.worldBounds.width, 5)
  expect(scene.camera.top - scene.camera.bottom).toBeCloseTo(scene.worldBounds.height, 5)
  expect(scene.camera.target).toEqual({ x: 0, y: 0, z: 0 })
  expect(commander.x).toBeGreaterThan(scene.camera.left)
  expect(commander.x).toBeLessThan(scene.camera.right)
  expect(commander.y).toBeGreaterThan(scene.camera.bottom)
  expect(commander.y).toBeLessThan(scene.camera.top)
})

test('applies actual particle, 512px shadow-target, and DPR quality reductions', async ({ page }) => {
  await startThreeGame(page)
  const before = await diagnostics(page)
  const canvas = page.locator('.game-stage canvas')
  const fullWidth = await canvas.evaluate((element) => (element as HTMLCanvasElement).width)

  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: ThreeDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('reduced-particles'))
  await expect.poll(async () => (await diagnostics(page)).quality.particleCount).toBe(before.quality.particleCount / 2)
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: ThreeDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('reduced-shadows'))
  await expect.poll(async () => (await diagnostics(page)).quality.shadowMapSize).toBe(512)
  await expect.poll(async () => (await diagnostics(page)).quality.shadowTargetSize).toEqual({ width: 512, height: 512 })
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: ThreeDiagnostics }).__TABLETOP_DIAGNOSTICS__.applyQuality('low-dpr'))
  await expect.poll(async () => (await diagnostics(page)).quality.dpr).toBe(1)
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeLessThan(fullWidth)
})

test('disposes populated Three canvas and resource counters idempotently', async ({ page }) => {
  await page.goto('?lab=renderers')
  const result = await page.evaluate(async () => {
    const { createThreeRenderer } = await (0, eval)('import("/src/renderers/three-3d/index.ts")')
    const { createSimulation } = await (0, eval)('import("/src/core/simulation.ts")')
    const host = document.createElement('div')
    host.style.width = '960px'
    host.style.height = '540px'
    document.body.append(host)
    const renderer = createThreeRenderer()
    await renderer.mount(host)
    renderer.render(createSimulation({ seed: 'three-dispose', enemyCount: 100 }).getSnapshot(), 0)
    const populated = renderer.getDiagnostics()
    renderer.dispose()
    renderer.dispose()
    return { populated, baseline: renderer.getDiagnostics(), canvases: host.querySelectorAll('canvas').length }
  })

  expect(result.populated.metrics.geometries).toBeGreaterThan(0)
  expect(result).toMatchObject({ canvases: 0, baseline: { visualUnitCount: 0, instancedMesh: { count: 0, instances: [] }, metrics: { drawCalls: null, textures: null, geometries: null } } })
})

test('fails cleanly without creating a canvas when WebGL is explicitly unavailable', async ({ page }) => {
  await page.goto('?lab=renderers')
  const result = await page.evaluate(async () => {
    const { createThreeRenderer } = await (0, eval)('import("/src/renderers/three-3d/index.ts")')
    const host = document.createElement('div')
    document.body.append(host)
    const renderer = createThreeRenderer({ webglSupported: false })
    try {
      await renderer.mount(host)
      return { error: null, canvases: host.querySelectorAll('canvas').length }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), canvases: host.querySelectorAll('canvas').length }
    }
  })
  expect(result).toEqual({ error: 'WebGL is unavailable for Three.js 3D renderer', canvases: 0 })
})
