import { createPhaserRenderer } from './phaser-renderer'

export function createRenderer() {
  return createPhaserRenderer()
}

export { createPhaserRenderer, type PhaserGameRenderer, type PhaserRendererCapabilities, type PhaserRendererDiagnostics } from './phaser-renderer'
