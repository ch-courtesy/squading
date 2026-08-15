import type { GameRenderer, RendererKind } from './contract'

export function createRenderer(kind: RendererKind): GameRenderer {
  throw new Error(`Renderer implementation is pending: ${kind}`)
}
