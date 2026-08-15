export type BenchmarkCase = { enemyCount: 100 | 200 | 300; seed: string; ticks: number }
export type GpuSample = { vendor?: string; renderer?: string }
export type BenchmarkRow = {
  renderer: '2d' | 'hybrid' | '3d'
  population: number
  p95Ms: number
  loadMs: number
  heapDeltaMb: number
  qualityRecovered: boolean
  inputParity: boolean
  publicSmoke: boolean
  gpuValid: boolean
}
export function createBenchmarkMatrix(options?: { seed?: string; ticks?: number }): BenchmarkCase[]
export function classifyGpuSample(sample?: GpuSample): { valid: boolean; vendor: string; renderer: string; reason: string | null }
export function summarizeBenchmark(rows: BenchmarkRow[]): Omit<BenchmarkRow, 'drawCalls'>[]
export function selectRenderer(summary: BenchmarkRow[]): { renderer: BenchmarkRow['renderer'] | null; rule: number | null; fallbackOptimization: boolean; action?: string }
export function createCapturePlan(options?: { seed?: string; ticks?: number }): Record<string, unknown>
