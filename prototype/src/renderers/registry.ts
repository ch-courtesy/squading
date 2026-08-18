import type { GameRenderer, RendererKind } from './contract'

export type RendererLoader = () => Promise<GameRenderer>
export type RendererLoaders = Readonly<Record<RendererKind, RendererLoader>>

const unavailable = (kind: RendererKind): RendererLoader => async () => (await import('./pending-renderer')).createRenderer(kind)

const defaultLoaders: RendererLoaders = {
  '2d': async () => (await import('./phaser-2d')).createRenderer(),
  hybrid: async () => (await import('./three-hybrid')).createRenderer(),
  '3d': async () => (await import('./three-3d')).createRenderer(),
}

export function loadRenderer(kind: RendererKind, loaders: RendererLoaders = defaultLoaders): Promise<GameRenderer> {
  return loaders[kind]()
}

// Gameplay mode only ever loads the Three.js 2.5D hybrid renderer. This reuses the
// identical `import('./three-hybrid')` literal as `defaultLoaders.hybrid` above so Vite
// keeps it as the same single dynamic chunk rather than splitting a duplicate.
export const loadGameplayRenderer: RendererLoader = async () => (await import('./three-hybrid')).createRenderer()

// The v2 commander battle (§6: "기존 디오라마 렌더러 ... 를 재사용한다"). Same literal again,
// so all three routes share one chunk; it is a separate name only so the v2 controller does
// not read as a caller of v1's loader.
export const loadBattleRenderer: RendererLoader = async () => (await import('./three-hybrid')).createRenderer()
