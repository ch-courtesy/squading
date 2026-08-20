/// <reference types="vite/client" />

import type { FrameSample } from './app/battle/battle-controller'
import type { RecordedInput } from './app/battle/battle-replay'
import type { BattleHud } from './core/battle-view/hud'
import type { RenderSnapshot } from './core/types'
import type { HybridVisualState, TelegraphLegibility } from './renderers/three-hybrid/hybrid-renderer'

/**
 * What the v2 shell publishes for §4.3 and §4.4, and nothing a player-facing screen could
 * carry instead: the input log those two gates replay, the world positions the framing
 * assertion projects, and the frame timings §4.3 measures.
 */
type BattleTestBridge = {
  seed(): string
  hud(): BattleHud
  snapshot(): RenderSnapshot
  inputLog(): readonly RecordedInput[]
  stepCount(): number
  digest(): string
  frameSamples(): readonly FrameSample[]
}

declare global {
  interface Window {
    /**
     * Dev-only browser-test bridge, installed under `import.meta.env.DEV` by
     * `renderers/three-hybrid/index.ts` (the scene half) and `app/battle/battle-shell.ts`
     * (the battle half). Production builds never define it — `npm run build` runs
     * `scripts/assert-no-test-bridge.mjs`, which fails if the name reaches a bundle — and
     * gameplay code must never read it.
     *
     * Every member is optional because the two halves are installed independently and either
     * can be absent: the lab route has no battle, and a shell mounted before its renderer
     * chunk resolves has no scene.
     */
    __SQUADING_TEST__?: {
      rendererScene?(): HybridVisualState | null
      /**
       * §정예 예고's readability, measured off rendered pixels — `null` when no warning is up.
       *
       * Separate from `rendererScene` because it renders three offscreen passes and reads the
       * framebuffer back three times. It is far too expensive to sit inside a state reader that
       * browser tests poll every frame.
       */
      telegraphLegibility?(): TelegraphLegibility | null
      /**
       * Project a point on the tabletop through the live camera, in NDC — `null` when no
       * scene is mounted. §4.4's framing is a claim about what is ON SCREEN, and a scene-graph
       * reading cannot tell a framed battle from one drawn outside the frustum.
       */
      projectGroundPoint?(x: number, y: number): { x: number; y: number } | null
      battle?: BattleTestBridge
    }
  }
}
