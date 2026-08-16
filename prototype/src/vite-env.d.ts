/// <reference types="vite/client" />

import type { HybridVisualState } from './renderers/three-hybrid/hybrid-renderer'

declare global {
  interface Window {
    /**
     * Dev-only browser-test bridge onto the live Three.js hybrid scene, installed by
     * `renderers/three-hybrid/index.ts` under `import.meta.env.DEV`. Production builds
     * never define it, and gameplay code must never read it.
     */
    __SQUADING_TEST__?: { rendererScene(): HybridVisualState | null }
  }
}
