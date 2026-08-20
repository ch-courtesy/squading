import * as THREE from 'three'

import type { Team } from '../../core/types'

export const TEAM_TINTS = { teal: 0x4bc6bd, scarlet: 0xd45d52, enemy: 0x835146 } as const

export type CardboardAssets = {
  readonly unitGeometry: THREE.PlaneGeometry
  readonly shadowGeometry: THREE.CircleGeometry
  readonly markerGeometry: THREE.RingGeometry
  readonly effectGeometry: THREE.RingGeometry
  readonly unitTexture: THREE.CanvasTexture
  dispose(): void
}

export function createCardboardAssets(): CardboardAssets {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 48
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable for procedural cardboard texture')
  context.fillStyle = '#e5cfa5'
  context.fillRect(7, 4, 34, 40)
  context.strokeStyle = '#35271d'
  context.lineWidth = 3
  context.strokeRect(7, 4, 34, 40)
  context.fillStyle = '#8b6f4b'
  context.fillRect(13, 10, 22, 8)
  const unitTexture = new THREE.CanvasTexture(canvas)
  unitTexture.colorSpace = THREE.SRGBColorSpace
  const geometries = [new THREE.PlaneGeometry(0.9, 1.1), new THREE.CircleGeometry(0.52, 20), new THREE.RingGeometry(0.17, 0.29, 4), new THREE.RingGeometry(0.2, 0.28, 24)]
  return {
    unitGeometry: geometries[0] as THREE.PlaneGeometry,
    shadowGeometry: geometries[1] as THREE.CircleGeometry,
    markerGeometry: geometries[2] as THREE.RingGeometry,
    effectGeometry: geometries[3] as THREE.RingGeometry,
    unitTexture,
    dispose: () => { geometries.forEach((geometry) => geometry.dispose()); unitTexture.dispose() },
  }
}

export function cardboardMaterial(team: Team, texture: THREE.Texture): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: TEAM_TINTS[team], map: texture, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide })
}

/**
 * `forceSinglePass` is a DRAW CALL, not a style. Since three r151 a transparent double-sided
 * material is rendered twice — back faces, then front faces — so that a closed shape sorts
 * against itself correctly. Everything built with this helper is a single flat quad or ring
 * with nothing behind itself to sort against, so the second pass draws the same pixels again
 * and buys nothing. Batch J measured it: each base ring on the board was costing two GL draw
 * calls, which put a unit over the four the visuals spec budgets it before its health gauge
 * had been added at all.
 *
 * `toneMapped: false` because everything built with this helper is a READ-OUT — a base ring, a
 * hazard band, a rescue token — whose colour *is* its information. The diorama presentation runs
 * an ACES curve so its lit surfaces can be keyed hard without clipping, and a marker pushed
 * through that curve comes out as a colour nobody chose. It is a no-op on the lab route, which
 * does no tone mapping at all.
 */
export function flatMaterial(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: opacity >= 1, toneMapped: false })
}

export function disposeObjectMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => material.dispose())
  })
}
