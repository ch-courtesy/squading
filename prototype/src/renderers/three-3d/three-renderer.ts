import * as THREE from 'three'

import type { RenderSnapshot, RenderUnit } from '../../core/types'
import { qualityProfile } from '../../metrics/quality-ladder'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { TEAM_TINTS, flatMaterial, disposeObjectMaterials } from '../three-shared/scene-utils'
import { createProceduralModels, type ProceduralModels } from './procedural-models'

const PARTICLE_COUNT = 12
const MAX_UNITS = 320

export type ThreeRendererCapabilities = { readonly webglSupported?: boolean }
export type ThreeRendererDiagnostics = {
  readonly rendererType: 'webgl'
  readonly instancedMesh: { readonly count: number; readonly triangles: number; readonly instanceIds: readonly number[]; readonly instances: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number; readonly baseTint: number; readonly state: string; readonly matrix: readonly number[] }[] }
  readonly visualUnitCount: number
  readonly snapshotUnitIds: readonly number[]
  readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]
  readonly worldBounds: { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }
  readonly camera: { readonly projection: 'orthographic'; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly target: { readonly x: number; readonly y: number; readonly z: number } }
  readonly quality: { readonly particleCount: number; readonly shadowMapSize: number; readonly shadowTargetSize: { readonly width: number; readonly height: number } | null; readonly dpr: number }
  readonly metrics: RendererMetrics
}
export interface ThreeGameRenderer extends GameRenderer { getDiagnostics(): ThreeRendererDiagnostics }

export function createThreeRenderer(capabilities: ThreeRendererCapabilities = {}): ThreeGameRenderer {
  return new ThreeMiniatureRenderer(capabilities)
}

class ThreeMiniatureRenderer implements ThreeGameRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.OrthographicCamera | null = null
  private models: ProceduralModels | null = null
  private units: THREE.InstancedMesh | null = null
  private unitMaterial: THREE.MeshLambertMaterial | null = null
  private snapshot: RenderSnapshot | null = null
  private particles: THREE.Mesh[] = []
  private instanceIds: number[] = []
  private viewportWidth = 1
  private viewportHeight = 1
  private requestedDpr = 1
  private dpr = 1
  private qualityLevel: QualityLevel = 'full'
  private disposed = false
  private readonly target = new THREE.Vector3()
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly rotation = new THREE.Euler()
  private readonly scale = new THREE.Vector3()
  private readonly color = new THREE.Color()

  constructor(private readonly capabilities: ThreeRendererCapabilities) {}

  async mount(host: HTMLElement): Promise<void> {
    if (this.renderer) return
    if (this.capabilities.webglSupported === false) throw new Error('WebGL is unavailable for Three.js 3D renderer')
    this.disposed = false
    this.viewportWidth = Math.max(1, host.clientWidth || 960)
    this.viewportHeight = Math.max(1, host.clientHeight || 540)
    this.requestedDpr = window.devicePixelRatio || 1
    this.dpr = this.requestedDpr
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      throw new Error('WebGL is unavailable for Three.js 3D renderer')
    }
    renderer.setClearColor(0x1d241d)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-32, 32, 18, -18, 0.1, 100)
    camera.position.set(0, 27, 24)
    camera.lookAt(this.target)
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.models = createProceduralModels()
    this.createTabletop()
    this.createInstancedUnits()
    this.createParticles()
    host.append(renderer.domElement)
    this.applyResolution()
    this.renderScene()
  }

  render(snapshot: RenderSnapshot, _alpha: number): void {
    if (this.disposed || !this.units) return
    this.snapshot = snapshot
    this.updateCameraBounds(snapshot)
    this.instanceIds = snapshot.units.map((unit) => unit.id)
    this.units.count = Math.min(snapshot.units.length, MAX_UNITS)
    snapshot.units.slice(0, MAX_UNITS).forEach((unit, index) => this.writeInstance(unit, index))
    this.units.instanceMatrix.needsUpdate = true
    if (this.units.instanceColor) this.units.instanceColor.needsUpdate = true
    this.renderScene()
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    this.requestedDpr = Math.max(1, dpr)
    this.dpr = this.qualityLevel === 'low-dpr' ? 1 : this.requestedDpr
    this.applyResolution()
    this.renderScene()
  }

  applyQuality(level: QualityLevel): void {
    if (this.disposed || !this.renderer) return
    this.qualityLevel = level
    const profile = qualityProfile(level)
    this.dpr = profile.dpr ?? this.requestedDpr
    this.particles.forEach((particle, index) => { particle.visible = index < Math.ceil(PARTICLE_COUNT * profile.particleScale) })
    const light = this.scene?.getObjectByName('miniature-key-light') as THREE.DirectionalLight | undefined
    if (light && light.shadow.mapSize.x !== profile.shadowMapSize) {
      light.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
      light.shadow.map?.dispose()
      light.shadow.map = null
      this.renderer.shadowMap.needsUpdate = true
    }
    this.applyResolution()
    this.renderScene()
  }

  collectMetrics(): RendererMetrics {
    const info = this.renderer?.info
    return { drawCalls: info?.render.calls ?? null, textures: info?.memory.textures ?? null, geometries: info?.memory.geometries ?? null }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.particles.forEach((particle) => disposeObjectMaterials(particle))
    this.scene?.traverse((object) => {
      if (object instanceof THREE.Mesh && object !== this.units) disposeObjectMaterials(object)
    })
    this.unitMaterial?.dispose()
    this.models?.dispose()
    this.particles = []
    this.instanceIds = []
    this.units = null
    this.unitMaterial = null
    this.models = null
    this.snapshot = null
    this.scene?.clear()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.renderer?.domElement.remove()
    this.renderer = null
    this.scene = null
    this.camera = null
  }

  getDiagnostics(): ThreeRendererDiagnostics {
    const snapshot = this.snapshot
    const unitMesh = this.units
    const instanceIds = this.instanceIds.slice(0, unitMesh?.count ?? 0)
    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    return {
      rendererType: 'webgl',
      instancedMesh: {
        count: unitMesh?.count ?? 0,
        triangles: this.models?.triangleCount ?? 0,
        instanceIds,
        instances: instanceIds.map((id, index) => {
          unitMesh!.getMatrixAt(index, matrix)
          unitMesh!.getColorAt(index, color)
          const unit = snapshot?.units[index]
          return { id, x: matrix.elements[12]!, y: matrix.elements[14]!, tint: color.getHex(), baseTint: unit ? TEAM_TINTS[unit.team] : 0, state: unit?.state ?? 'unknown', matrix: [...matrix.elements] }
        }),
      },
      visualUnitCount: unitMesh?.count ?? 0,
      snapshotUnitIds: snapshot?.units.map((unit) => unit.id) ?? [],
      snapshotUnits: snapshot?.units.map((unit) => ({ id: unit.id, x: unit.x, y: unit.y, tint: TEAM_TINTS[unit.team] })) ?? [],
      worldBounds: { width: snapshot?.camera.worldWidth ?? 64, height: snapshot?.camera.worldHeight ?? 36, centerX: snapshot?.camera.centerX ?? 0, centerY: snapshot?.camera.centerY ?? 0 },
      camera: { projection: 'orthographic', left: this.camera?.left ?? -32, right: this.camera?.right ?? 32, top: this.camera?.top ?? 18, bottom: this.camera?.bottom ?? -18, target: { x: this.target.x, y: this.target.y, z: this.target.z } },
      quality: { particleCount: this.particles.filter((particle) => particle.visible).length, shadowMapSize: ((this.scene?.getObjectByName('miniature-key-light') as THREE.DirectionalLight | undefined)?.shadow.mapSize.x ?? 0), shadowTargetSize: shadowTargetSize(this.scene?.getObjectByName('miniature-key-light') as THREE.DirectionalLight | undefined), dpr: this.dpr },
      metrics: this.collectMetrics(),
    }
  }

  private createTabletop(): void {
    if (!this.scene || !this.models) return
    const ground = new THREE.Mesh(this.models.groundGeometry, new THREE.MeshLambertMaterial({ color: 0x3e4a31 }))
    ground.name = 'miniature-ground'
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    const ambient = new THREE.HemisphereLight(0xe3f0d0, 0x202719, 2.1)
    const light = new THREE.DirectionalLight(0xfff3d5, 2.4)
    light.name = 'miniature-key-light'
    light.position.set(-10, 19, 12)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    light.shadow.camera.left = -32
    light.shadow.camera.right = 32
    light.shadow.camera.top = 18
    light.shadow.camera.bottom = -18
    this.scene.add(ground, ambient, light)
  }

  private createInstancedUnits(): void {
    if (!this.scene || !this.models) return
    this.unitMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
    this.units = new THREE.InstancedMesh(this.models.unitGeometry, this.unitMaterial, MAX_UNITS)
    this.units.name = 'miniature-instances'
    this.units.castShadow = true
    this.units.receiveShadow = true
    this.units.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.units)
  }

  private createParticles(): void {
    if (!this.scene || !this.models) return
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const particle = new THREE.Mesh(this.models!.particleGeometry, flatMaterial(0xf2df81, 0.55))
      particle.name = 'miniature-particle'
      particle.position.set(-26 + (index % 6) * 0.5, 0.35, -14 + Math.floor(index / 6) * 0.5)
      this.scene!.add(particle)
      return particle
    })
  }

  private writeInstance(unit: RenderUnit, index: number): void {
    if (!this.units) return
    const scale = unit.kind === 'commander' || unit.kind === 'enemy-commander' ? 1.35 : unit.state === 'downed' ? 0.72 : 1
    this.position.set(unit.x, unit.state === 'downed' ? 0.18 : 0.62, unit.y)
    this.rotation.set(unit.state === 'downed' ? Math.PI / 2 : 0, -unit.facingRadians, unit.state === 'attacking' ? 0.18 : 0)
    this.scale.set(scale, scale, scale)
    this.matrix.compose(this.position, new THREE.Quaternion().setFromEuler(this.rotation), this.scale)
    this.units.setMatrixAt(index, this.matrix)
    this.color.setHex(TEAM_TINTS[unit.team])
    if (unit.state === 'downed') this.color.multiplyScalar(0.58)
    if (unit.state === 'rescuing') this.color.lerp(new THREE.Color(0xf2df81), 0.25)
    this.units.setColorAt(index, this.color)
  }

  private updateCameraBounds(snapshot: RenderSnapshot): void {
    if (!this.camera) return
    this.camera.left = snapshot.camera.centerX - snapshot.camera.worldWidth / 2
    this.camera.right = snapshot.camera.centerX + snapshot.camera.worldWidth / 2
    this.camera.top = snapshot.camera.centerY + snapshot.camera.worldHeight / 2
    this.camera.bottom = snapshot.camera.centerY - snapshot.camera.worldHeight / 2
    this.target.set(snapshot.camera.centerX, 0, snapshot.camera.centerY)
    this.camera.lookAt(this.target)
    this.camera.updateProjectionMatrix()
  }

  private applyResolution(): void {
    if (!this.renderer) return
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.viewportWidth, this.viewportHeight, false)
    this.renderer.domElement.style.width = `${this.viewportWidth}px`
    this.renderer.domElement.style.height = `${this.viewportHeight}px`
  }

  private renderScene(): void { if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera) }
}

function shadowTargetSize(light: THREE.DirectionalLight | undefined): { width: number; height: number } | null {
  const target = light?.shadow.map
  return target ? { width: target.width, height: target.height } : null
}
