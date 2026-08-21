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
      // Its own entry rather than a field of `rendererScene`, because it RENDERS: three
      // offscreen passes and three framebuffer reads. Half the browser suite polls
      // `rendererScene` in a loop, and none of those loops should pay for this.
      telegraphLegibility: () => activeRenderer?.measureTelegraph() ?? null,
      projectGroundPoint: (x, y) => activeRenderer?.projectGroundPoint(x, y) ?? null,
      // Its own entry for the same reason as `telegraphLegibility`: `rendererScene` answers
      // "is anything on the board striking", and a screenshot caption has to answer "is THIS
      // body in THAT pose". See `HybridGameRenderer.unitPose`.
      unitPose: (unitId) => activeRenderer?.unitPose(unitId) ?? null,
    }
  }
  return renderer
}

export { createHybridRenderer } from './hybrid-renderer'
