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
