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
    // Merged rather than assigned: the v2 shell installs its own half of this bridge before
    // the renderer chunk has even loaded, and a plain assignment here would erase it.
    window.__SQUADING_TEST__ = {
      ...(window.__SQUADING_TEST__ ?? {}),
      rendererScene: () => activeRenderer?.getVisualState() ?? null,
      projectGroundPoint: (x, y) => activeRenderer?.projectGroundPoint(x, y) ?? null,
    }
  }
  return renderer
}

export { createHybridRenderer } from './hybrid-renderer'
