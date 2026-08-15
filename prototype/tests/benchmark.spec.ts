import { describe, expect, test } from 'vitest'

import {
  classifyGpuSample,
  createBenchmarkMatrix,
  selectRenderer,
  summarizeBenchmark,
} from '../scripts/benchmark.mjs'

describe('renderer benchmark policy', () => {
  test('creates the three required population cases with one reproducible seed and tick window', () => {
    expect(createBenchmarkMatrix({ seed: 'task6', ticks: 1800 })).toEqual([
      { enemyCount: 100, seed: 'task6', ticks: 1800 },
      { enemyCount: 200, seed: 'task6', ticks: 1800 },
      { enemyCount: 300, seed: 'task6', ticks: 1800 },
    ])
  })

  test('rejects software and SwiftShader GPU samples', () => {
    expect(classifyGpuSample({ vendor: 'Google Inc.', renderer: 'ANGLE (SwiftShader)' })).toMatchObject({ valid: false })
    expect(classifyGpuSample({ vendor: 'Mesa', renderer: 'llvmpipe (LLVM 18.1.0)' })).toMatchObject({ valid: false })
    expect(classifyGpuSample({ vendor: 'NVIDIA', renderer: 'NVIDIA GeForce RTX 3060' })).toMatchObject({ valid: true })
  })

  test('does not rank engines by draw calls and selects by the ordered acceptance rules', () => {
    const summary = summarizeBenchmark([
      ...(['2d', 'hybrid', '3d'] as const).flatMap((renderer) => [
        { renderer, population: 200, p95Ms: 18, loadMs: 800, heapDeltaMb: 2, qualityRecovered: true, inputParity: true, publicSmoke: true, gpuValid: true, headedHardwareGpu: true, coldCache: true, warmupSeconds: 10, sampleSeconds: 60 },
        { renderer, population: 300, p95Ms: 22, loadMs: 800, heapDeltaMb: 2, qualityRecovered: true, inputParity: true, publicSmoke: true, gpuValid: true, headedHardwareGpu: true, coldCache: true, warmupSeconds: 10, sampleSeconds: 60 },
      ]),
    ])
    expect(summary[0]).not.toHaveProperty('drawCalls')
    expect(selectRenderer(summary)).toMatchObject({ renderer: null, action: 'qualitative-scoring-required' })
  })

  test('does not select a renderer until all three renderers have a 300-population capture', () => {
    const incomplete = summarizeBenchmark([
      { renderer: '2d', population: 100, p95Ms: 1, loadMs: 1, heapDeltaMb: 1, qualityRecovered: true, inputParity: true, publicSmoke: true, gpuValid: true },
      { renderer: 'hybrid', population: 200, p95Ms: 1, loadMs: 1, heapDeltaMb: 1, qualityRecovered: true, inputParity: true, publicSmoke: true, gpuValid: true },
      { renderer: '3d', population: 200, p95Ms: 1, loadMs: 1, heapDeltaMb: 1, qualityRecovered: true, inputParity: true, publicSmoke: true, gpuValid: true },
    ])
    expect(selectRenderer(incomplete)).toMatchObject({ renderer: null, fallbackOptimization: true, action: 'complete-300-population-capture-required' })
  })
})
