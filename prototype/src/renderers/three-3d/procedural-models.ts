import * as THREE from 'three'

/** Code-created low-poly assets; no model files or textures are loaded. */
export type ProceduralModels = {
  readonly unitGeometry: THREE.ConeGeometry
  readonly groundGeometry: THREE.PlaneGeometry
  readonly particleGeometry: THREE.TetrahedronGeometry
  readonly triangleCount: number
  dispose(): void
}

export function createProceduralModels(): ProceduralModels {
  // Six radial segments keep each miniature well below the 1,500-triangle proxy budget.
  const unitGeometry = new THREE.ConeGeometry(0.42, 1.25, 6, 1)
  const groundGeometry = new THREE.PlaneGeometry(64, 36)
  const particleGeometry = new THREE.TetrahedronGeometry(0.11, 0)
  const triangleCount = triangleCountOf(unitGeometry)
  return {
    unitGeometry,
    groundGeometry,
    particleGeometry,
    triangleCount,
    dispose: () => { unitGeometry.dispose(); groundGeometry.dispose(); particleGeometry.dispose() },
  }
}

export function triangleCountOf(geometry: THREE.BufferGeometry): number {
  return geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3
}
