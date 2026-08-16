import { createHybridRenderer, type HybridGameRenderer } from './hybrid-renderer'

let activeRenderer: HybridGameRenderer | null = null

export function createRenderer(): HybridGameRenderer {
  activeRenderer = createHybridRenderer()
  // Dev-only bridge onto the live scene graph for browser tests. `import.meta.env.DEV`
  // is a compile-time constant, so a production build drops this branch — and every
  // trace of the bridge — from the chunk.
  if (import.meta.env.DEV) {
    window.__SQUADING_TEST__ = { rendererScene: () => activeRenderer?.getVisualState() ?? null }
  }
  return activeRenderer
}

export { createHybridRenderer } from './hybrid-renderer'
