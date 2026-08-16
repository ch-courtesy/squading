import { createHybridRenderer, type HybridGameRenderer } from './hybrid-renderer'

let activeRenderer: HybridGameRenderer | null = null

export function createRenderer(): HybridGameRenderer {
  const renderer = createHybridRenderer()
  // Dev-only bridge onto the live scene graph for browser tests. `import.meta.env.DEV`
  // is a compile-time constant, so a production build drops this whole branch — and
  // with it the only assignment to `activeRenderer`, so the module-level reference
  // itself is dead code there and cannot outlive a disposed renderer.
  if (import.meta.env.DEV) {
    activeRenderer = renderer
    const disposeRenderer = renderer.dispose.bind(renderer)
    renderer.dispose = () => {
      if (activeRenderer === renderer) activeRenderer = null
      disposeRenderer()
    }
    window.__SQUADING_TEST__ = { rendererScene: () => activeRenderer?.getVisualState() ?? null }
  }
  return renderer
}

export { createHybridRenderer } from './hybrid-renderer'
