import type { RenderSnapshot } from '../core/types'

export type RendererKind = '2d' | 'hybrid' | '3d'
export type QualityLevel = 'full' | 'reduced-particles' | 'reduced-shadows' | 'low-dpr'

export type RendererMetrics = {
  readonly drawCalls: number | null
  readonly textures: number | null
  readonly geometries: number | null
}

export interface GameRenderer {
  mount(host: HTMLElement): Promise<void>
  render(snapshot: RenderSnapshot, alpha: number): void
  resize(width: number, height: number, dpr: number): void
  applyQuality(level: QualityLevel): void
  collectMetrics(): RendererMetrics
  dispose(): void
}
