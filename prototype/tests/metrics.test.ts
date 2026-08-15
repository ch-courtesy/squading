import { describe, expect, test } from 'vitest'

import { FrameMetrics } from '../src/metrics/frame-metrics'
import { QualityLadder, qualityProfile } from '../src/metrics/quality-ladder'
import { exportReport } from '../src/metrics/report'

describe('frame metrics', () => {
  test('computes p95 from valid frame samples and excludes invalid samples', () => {
    const metrics = new FrameMetrics()
    ;[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 50, Number.NaN, Infinity, -2].forEach(
      (sample) => metrics.recordFrame(sample),
    )

    expect(metrics.summary()).toMatchObject({ sampleCount: 11, invalidSampleCount: 3, p95Ms: 50 })
  })

  test('keeps only timestamped frame samples within its bounded window', () => {
    const metrics = new FrameMetrics({ windowMs: 3_000 })
    metrics.recordFrame(60, 0)
    metrics.recordFrame(10, 3_001)

    expect(metrics.summary(3_001)).toMatchObject({ sampleCount: 1, p95Ms: 10 })
  })
})

describe('quality ladder', () => {
  test('defines the required particle, shadow, and DPR quality values', () => {
    expect(qualityProfile('reduced-particles')).toMatchObject({ particleScale: 0.5 })
    expect(qualityProfile('reduced-shadows')).toMatchObject({ shadowMapSize: 512 })
    expect(qualityProfile('low-dpr')).toMatchObject({ dpr: 1 })
  })

  test('lowers particles, shadows, then DPR after each three-second p95 breach and exposes timing windows', () => {
    const applied: string[] = []
    const ladder = new QualityLadder((level) => applied.push(level))

    ladder.observe(34, 0)
    ladder.observe(34, 3_000)
    expect(ladder.state()).toMatchObject({ level: 'reduced-particles', phase: 'stabilizing', stabilizationUntilMs: 8_000 })

    ladder.observe(34, 8_000)
    expect(ladder.state()).toMatchObject({ phase: 'recovery-window', recoveryUntilMs: 18_000 })
    ladder.observeFrame(34, 8_001)
    ladder.observe(34, 18_000)
    ladder.observe(34, 21_000)
    ladder.observe(34, 26_000)
    ladder.observeFrame(34, 26_001)
    ladder.observe(34, 36_000)
    ladder.observe(34, 39_000)
    ladder.observe(34, 44_000)
    ladder.observeFrame(34, 44_001)
    ladder.observe(34, 54_000)

    expect(applied).toEqual(['reduced-particles', 'reduced-shadows', 'low-dpr'])
  })

  test('requires strictly over 33ms contiguous samples for three seconds and resets after a long gap or normal sample', () => {
    const applied: string[] = []
    const ladder = new QualityLadder((level) => applied.push(level))
    ladder.observe(33, 0)
    ladder.observe(34, 2_999)
    ladder.observe(34, 3_000)
    ladder.observe(33, 3_001)
    ladder.observe(34, 3_002)
    ladder.observe(34, 7_000)
    ladder.observe(34, 7_001)

    expect(applied).toEqual([])
  })

  test('evaluates the ten-second recovery window after stabilization and exposes recovered p95', () => {
    const applied: string[] = []
    const ladder = new QualityLadder((level) => applied.push(level))

    ladder.observe(34, 0)
    ladder.observe(34, 3_000)
    ladder.observe(34, 8_000)
    ladder.observeFrame(20, 8_001)
    ladder.observeFrame(30, 17_999)
    ladder.observe(20, 18_000)

    expect(ladder.state()).toMatchObject({
      level: 'reduced-particles',
      phase: 'ready',
      recoveryOutcome: 'recovered',
      recoveryP95Ms: 30,
    })
    expect(applied).toEqual(['reduced-particles'])
  })

  test('excludes invalid recovery samples and lowers the next quality stage when recovery p95 remains over budget', () => {
    const applied: string[] = []
    const ladder = new QualityLadder((level) => applied.push(level))

    ladder.observe(34, 0)
    ladder.observe(34, 3_000)
    ladder.observe(34, 8_000)
    ladder.observeFrame(Number.NaN, 8_100)
    ladder.observeFrame(34, 8_101)
    ladder.observe(34, 18_000)

    expect(ladder.state()).toMatchObject({
      level: 'reduced-shadows',
      phase: 'stabilizing',
      recoveryOutcome: 'needs-downgrade',
      recoveryP95Ms: 34,
    })
    expect(applied).toEqual(['reduced-particles', 'reduced-shadows'])
  })
})

describe('renderer report', () => {
  test('exports manual and benchmark measurements as distinct JSON modes with HUD metrics', () => {
    const json = exportReport({
      renderer: 'hybrid',
      mode: 'benchmark',
      metrics: { fps: 60, p95Ms: 18, loadMs: 42, activeUnits: 217, drawCalls: 12, textures: 4, geometries: 2, qualityLevel: 'full' },
    })

    expect(JSON.parse(json)).toEqual({
      renderer: 'hybrid',
      mode: 'benchmark',
      metrics: { fps: 60, p95Ms: 18, loadMs: 42, activeUnits: 217, drawCalls: 12, textures: 4, geometries: 2, qualityLevel: 'full' },
    })
  })

  test('rejects non-finite report metrics instead of serializing them as JSON null', () => {
    expect(() => exportReport({
      renderer: '2d',
      mode: 'manual',
      metrics: { fps: Number.NaN, p95Ms: 1, loadMs: 1, activeUnits: 1, drawCalls: null, textures: null, geometries: null, qualityLevel: 'full' },
    })).toThrow('fps must be finite')
  })

  test('rejects an infinite draw-call reference while preserving null as the sole nullable metric', () => {
    expect(() => exportReport({
      renderer: '2d',
      mode: 'manual',
      metrics: { fps: 1, p95Ms: 1, loadMs: 1, activeUnits: 1, drawCalls: Infinity, textures: null, geometries: null, qualityLevel: 'full' },
    })).toThrow('drawCalls must be finite or null')
  })

  test('rejects non-finite texture and geometry references while allowing null', () => {
    expect(() => exportReport({
      renderer: '2d',
      mode: 'manual',
      metrics: { fps: 1, p95Ms: 1, loadMs: 1, activeUnits: 1, drawCalls: null, textures: Infinity, geometries: null, qualityLevel: 'full' },
    })).toThrow('textures must be finite or null')
  })
})
