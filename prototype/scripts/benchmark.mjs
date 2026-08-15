#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const RENDERERS = ['2d', 'hybrid', '3d']

export function createBenchmarkMatrix({ seed = 'task6-benchmark', ticks = 1800 } = {}) {
  return [100, 200, 300].map((enemyCount) => ({ enemyCount, seed, ticks }))
}

export function classifyGpuSample({ vendor = '', renderer = '' } = {}) {
  const label = `${vendor} ${renderer}`.toLowerCase()
  const software = /(swiftshader|llvmpipe|software|software rasterizer|mesa offscreen)/i.test(label)
  return { valid: !software && Boolean(vendor.trim() && renderer.trim()), vendor, renderer, reason: software ? 'software-renderer' : null }
}

export function summarizeBenchmark(rows) {
  return rows.map(({ renderer, population, p95Ms, loadMs, heapDeltaMb, qualityRecovered, inputParity, publicSmoke, gpuValid, headedHardwareGpu, coldCache, warmupSeconds, sampleSeconds }) => ({
    renderer,
    population,
    p95Ms,
    loadMs,
    heapDeltaMb,
    qualityRecovered,
    inputParity,
    publicSmoke,
    gpuValid,
    headedHardwareGpu,
    coldCache,
    warmupSeconds,
    sampleSeconds,
    // Deliberately omit draw calls: they are not comparable across engines.
  }))
}

export function selectRenderer(summary) {
  // Selection is made against the worst required case, not whichever row a
  // caller happened to provide first.  A partial (100/200 only) capture is
  // evidence-incomplete and must never silently choose a production renderer.
  const population = Math.max(...summary.map((row) => Number(row.population) || 0), 0)
  if (population < 300 || !RENDERERS.every((renderer) => summary.some((row) => row.renderer === renderer && Number(row.population) >= 300))) {
    return { renderer: null, rule: null, fallbackOptimization: true, action: 'complete-300-population-capture-required' }
  }
  const rowsFor = (renderer) => summary.filter((row) => row.renderer === renderer)
  const evidenceComplete = RENDERERS.every((renderer) => [200, 300].every((population) => {
    const row = rowsFor(renderer).find((candidate) => Number(candidate.population) === population)
    return row && row.headedHardwareGpu === true && row.coldCache === true && row.warmupSeconds >= 10 && row.sampleSeconds >= 60 && row.publicSmoke === true && row.inputParity === true && row.qualityRecovered === true && row.gpuValid === true
  }))
  if (!evidenceComplete) return { renderer: null, rule: null, fallbackOptimization: true, action: 'protocol-compliant-evidence-required' }
  const passing = RENDERERS.filter((renderer) => {
    const row200 = rowsFor(renderer).find((row) => Number(row.population) === 200)
    const row300 = rowsFor(renderer).find((row) => Number(row.population) === 300)
    return row200.p95Ms <= 20 && row300.p95Ms <= 33 && row300.qualityRecovered === true
  })
  if (passing.length === 0) return { renderer: null, rule: null, fallbackOptimization: true, action: 'shared-core-once-and-two-hour-per-renderer-optimization' }
  return { renderer: null, rule: 4, fallbackOptimization: false, action: 'qualitative-scoring-required', candidates: passing }
}

/**
 * Run the deterministic portion of the capture in a real browser.  The
 * headed/hardware-GPU run is deliberately opt-in; CI and local development
 * use a short deterministic window and still emit the same evidence shape.
 */
export async function runBrowserBenchmark({
  baseUrl = 'http://127.0.0.1:4173/',
  seed = 'task6-benchmark',
  ticks = 1800,
  warmupSeconds = 0,
  sampleSeconds = 0,
  switches = 10,
  headed = false,
  hardwareGpu = false,
  publicUrl = false,
  coldCache = false,
} = {}) {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({
    headless: !headed,
    args: [...(hardwareGpu ? ['--ignore-gpu-blocklist', '--enable-gpu'] : []), '--enable-precise-memory-info'],
  })
  const rows = []
  const captures = []
  const startedAt = Date.now()
  try {
    for (const { enemyCount } of createBenchmarkMatrix({ seed, ticks })) {
      for (const renderer of RENDERERS) {
        const context = await browser.newContext()
        const page = await context.newPage()
        const cdp = await context.newCDPSession(page)
        const loadStarted = Date.now()
        await page.goto(`${baseUrl}?renderer=${renderer}&enemies=${enemyCount}&seed=${encodeURIComponent(seed)}&mode=benchmark`, { waitUntil: 'domcontentloaded' })
        const loadMs = Date.now() - loadStarted
        await page.getByRole('button', { name: '게임 시작' }).click()
        await page.locator('.game-stage canvas').waitFor({ state: 'visible' })
        await page.waitForFunction(() => Boolean(window.__TABLETOP_DIAGNOSTICS__?.advance), undefined, { timeout: 30_000 })
        await cdp.send('HeapProfiler.collectGarbage')
        const baselineHeap = await page.evaluate(() => {
          const memory = performance.memory
          return memory ? memory.usedJSHeapSize : null
        })
        if (warmupSeconds > 0) await page.waitForTimeout(warmupSeconds * 1000)
        const before = await page.evaluate(() => performance.now())
        const advanced = await page.evaluate((advanceTicks) => {
          const diagnostics = window.__TABLETOP_DIAGNOSTICS__
          if (!diagnostics || typeof diagnostics.advance !== 'function') return false
          diagnostics.advance(advanceTicks)
          return true
        }, ticks)
        if (!advanced) throw new Error(`benchmark protocol violation: diagnostics.advance missing for ${renderer}`)
        const deterministic = await page.evaluate(() => {
          const diagnostics = window.__TABLETOP_DIAGNOSTICS__
          return {
            tick: diagnostics?.tick ?? 0,
            result: diagnostics?.result ?? 'running',
            snapshotUnits: diagnostics?.snapshotUnits ?? [],
          }
        })
        if (sampleSeconds > 0) await page.waitForTimeout(sampleSeconds * 1000)
        await cdp.send('HeapProfiler.collectGarbage')
        const capture = await page.evaluate(() => {
          const diagnostics = window.__TABLETOP_DIAGNOSTICS__
          const probe = document.createElement('canvas')
          const gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl')
          const debug = gl?.getExtension('WEBGL_debug_renderer_info')
          const memory = performance.memory
          return {
            qualityRecovered: diagnostics?.qualityState?.recoveryOutcome === 'recovered' || (diagnostics?.qualityState?.level === 'full' && diagnostics?.qualityState?.phase === 'ready'),
            qualityState: diagnostics?.qualityState ?? null,
            p95Ms: Number(diagnostics?.metrics?.p95Ms ?? 0),
            heapUsedMb: memory ? (memory.usedJSHeapSize / 1024 / 1024) : null,
            gpu: debug && gl ? { vendor: String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? ''), renderer: String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '') } : { vendor: '', renderer: '' },
          }
        })
        if (deterministic.tick !== ticks) throw new Error(`benchmark protocol violation: ${renderer}/${enemyCount} advanced ${deterministic.tick} != ${ticks}`)
        const localSmoke = await page.locator('[data-restart]').isVisible() && await page.locator('[data-export-report]').isVisible() && await page.locator('.game-controls').getByText('조작 안내').isVisible()
        rows.push({ renderer, population: enemyCount, loadMs, ...deterministic, ...capture, heapDeltaMb: baselineHeap === null || capture.heapUsedMb === null ? null : capture.heapUsedMb - (baselineHeap / 1024 / 1024), publicSmoke: Boolean(publicUrl && localSmoke), inputParity: false, gpuValid: classifyGpuSample(capture.gpu).valid, headedHardwareGpu: headed && hardwareGpu, coldCache: true, cacheState: 'fresh-browser-context', warmupSeconds, sampleSeconds })
        captures.push({ renderer, population: enemyCount, elapsedMs: await page.evaluate((started) => Math.max(0, performance.now() - started), before) })
        await context.close()
      }
    }

    const switchPage = await browser.newPage()
    await switchPage.goto(`${baseUrl}?renderer=2d&enemies=100&seed=${encodeURIComponent(seed)}&mode=benchmark`, { waitUntil: 'domcontentloaded' })
    await switchPage.getByRole('button', { name: '게임 시작' }).click()
    await switchPage.locator('.game-stage canvas').waitFor({ state: 'visible' })
    const initialCanvasCount = await switchPage.evaluate(() => document.querySelectorAll('.game-stage canvas').length)
    const gcAvailable = await switchPage.evaluate(() => typeof globalThis.gc === 'function')
    let completedSwitches = 0
    for (let index = 0; index < switches; index += 1) {
      const renderer = RENDERERS[index % RENDERERS.length]
      const switched = await switchPage.evaluate(async (nextRenderer) => {
        const diagnostics = window.__TABLETOP_DIAGNOSTICS__
        if (!diagnostics || typeof diagnostics.switchRenderer !== 'function') return false
        await diagnostics.switchRenderer(nextRenderer)
        return true
      }, renderer)
      if (!switched) throw new Error('benchmark protocol violation: same-page switchRenderer missing')
      await switchPage.locator('.game-stage canvas').waitFor({ state: 'visible' })
      const canvasCount = await switchPage.evaluate(() => document.querySelectorAll('.game-stage canvas').length)
      if (canvasCount !== initialCanvasCount) throw new Error(`renderer switch leaked canvas: ${canvasCount} != ${initialCanvasCount}`)
      await switchPage.evaluate(() => {
        const diagnostics = window.__TABLETOP_DIAGNOSTICS__
        diagnostics?.gc?.()
      })
      completedSwitches += 1
    }
    await switchPage.close()

    const unavailable = await browser.newPage()
    await unavailable.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function getContext(kind, ...args) {
        if (kind === 'webgl' || kind === 'experimental-webgl' || kind === 'webgl2') return null
        return original.call(this, kind, ...args)
      }
    })
    await unavailable.goto(`${baseUrl}?renderer=hybrid&enemies=100&seed=${encodeURIComponent(seed)}`, { waitUntil: 'domcontentloaded' })
    const webglDisabled = await unavailable.locator('[data-renderer="hybrid"]').isDisabled()
    await unavailable.close()
    const forced = await browser.newPage()
    await forced.goto(`${baseUrl}?renderer=3d&enemies=100&seed=${encodeURIComponent(seed)}&forceRendererError=1`, { waitUntil: 'domcontentloaded' })
    await forced.getByRole('button', { name: '게임 시작' }).click()
    await forced.getByRole('heading', { name: '1. 렌더러 선택' }).waitFor()
    const forcedErrorReturned = await forced.getByRole('alert').isVisible()
    await forced.close()

    const byPopulation = new Map()
    for (const row of rows) {
      if (!byPopulation.has(row.population)) byPopulation.set(row.population, [])
      byPopulation.get(row.population).push(row)
    }
    for (const group of byPopulation.values()) {
      const reference = group[0].snapshotUnits
      for (const row of group) row.inputParity = row.tick === group[0].tick && JSON.stringify(row.snapshotUnits) === JSON.stringify(reference)
    }
    return {
      protocol: 'task6-local-comparison-v1',
      generatedAt: new Date().toISOString(),
      status: 'captured',
      durationMs: Date.now() - startedAt,
      rows,
      captures,
      switches: { requested: switches, completed: completedSwitches, disposed: completedSwitches },
      checks: { webglDisabled, forcedErrorReturned },
      gpu: rows.find((row) => row.gpu?.renderer)?.gpu ?? { vendor: '', renderer: '' },
      selection: selectRenderer(summarizeBenchmark(rows)),
      externalEvidence: { headedHardwareGpu: headed && hardwareGpu, publicUrlCleanChrome: publicUrl === true, publicUrlCleanSafari: false, coldCache: true },
    }
  } finally {
    await browser.close()
  }
}

export function createCapturePlan({ seed = 'task6-benchmark', ticks = 1800 } = {}) {
  return {
    protocol: 'task6-local-comparison-v1',
    matrix: createBenchmarkMatrix({ seed, ticks }),
    renderers: [...RENDERERS],
    warmupSeconds: 10,
    sampleSeconds: 60,
    switches: 10,
    requires: ['headed-system-chrome', 'hardware-gpu', 'WEBGL_debug_renderer_info', 'performance.memory'],
    invalidGpuPatterns: ['SwiftShader', 'llvmpipe', 'software rasterizer'],
    unavailableEvidence: ['public-url-clean-chrome', 'public-url-clean-safari', 'headed-hardware-gpu-capture'],
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const local = process.argv.includes('--local')
  const output = local
    ? await runBrowserBenchmark({
        baseUrl: process.env.BENCHMARK_BASE_URL ?? 'http://127.0.0.1:4173/',
        headed: process.argv.includes('--headed'),
        hardwareGpu: process.argv.includes('--hardware-gpu'),
        warmupSeconds: Number(process.env.BENCHMARK_WARMUP_SECONDS ?? 0),
        sampleSeconds: Number(process.env.BENCHMARK_SAMPLE_SECONDS ?? 0),
        switches: Number(process.env.BENCHMARK_SWITCHES ?? 10),
        publicUrl: Boolean(process.env.BENCHMARK_PUBLIC_URL),
        coldCache: process.argv.includes('--cold-cache'),
      })
    : { ...createCapturePlan(), generatedAt: new Date().toISOString(), status: 'plan-only-local-until-headed-gpu-url-is-authorized' }
  if (local && (!output.checks?.webglDisabled || !output.checks?.forcedErrorReturned)) {
    throw new Error(`benchmark recovery checks failed: ${JSON.stringify(output.checks)}`)
  }
  const json = JSON.stringify(output, null, 2)
  const outputPath = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null
  if (outputPath) await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
    const { dirname } = await import('node:path')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${json}\n`, 'utf8')
  })
  else process.stdout.write(`${json}\n`)
}
