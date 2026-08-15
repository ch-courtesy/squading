import type { QualityLevel, RendererKind } from '../renderers/contract'

export type HudMetrics = {
  readonly fps: number
  readonly p95Ms: number
  readonly loadMs: number
  readonly activeUnits: number
  readonly drawCalls: number | null
  readonly textures: number | null
  readonly geometries: number | null
  readonly qualityLevel: QualityLevel
}

export type RendererReport = {
  readonly renderer: RendererKind
  readonly mode: 'manual' | 'benchmark'
  readonly metrics: HudMetrics
}

export function exportReport(report: RendererReport): string {
  for (const [name, value] of Object.entries(report.metrics)) {
    if (!['drawCalls', 'textures', 'geometries'].includes(name) && typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${name} must be finite`)
    }
  }
  for (const [name, value] of Object.entries({
    drawCalls: report.metrics.drawCalls,
    textures: report.metrics.textures,
    geometries: report.metrics.geometries,
  })) {
    if (value !== null && !Number.isFinite(value)) throw new Error(`${name} must be finite or null`)
  }
  return JSON.stringify(report)
}
