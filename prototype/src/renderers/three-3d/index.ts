import { createThreeRenderer } from './three-renderer'

export function createRenderer() { return createThreeRenderer() }
export { createThreeRenderer, type ThreeGameRenderer, type ThreeRendererCapabilities, type ThreeRendererDiagnostics } from './three-renderer'
