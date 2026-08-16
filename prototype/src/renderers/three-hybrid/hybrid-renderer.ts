import * as THREE from 'three'

import type { RenderEffect, RenderSnapshot, RenderUnit, Squad } from '../../core/types'
import { qualityProfile } from '../../metrics/quality-ladder'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { TEAM_TINTS, cardboardMaterial, createCardboardAssets, disposeObjectMaterials, flatMaterial, type CardboardAssets } from '../three-shared/scene-utils'

type UnitVisual = { readonly root: THREE.Group; readonly card: THREE.Mesh; readonly shadow: THREE.Mesh; readonly marker: THREE.Mesh }
type EffectVisual = { readonly root: THREE.Group; readonly kind: RenderEffect['kind'] }

/**
 * Gameplay-facing view of the live scene graph, read straight off the Three objects.
 * Browser tests use it through the dev-only `__SQUADING_TEST__` bridge to check facts
 * a canvas screenshot cannot show — the telegraph's world radius, whether it stays
 * flat on the tabletop, and which squad currently carries the active marker.
 */
export type HybridVisualState = {
  readonly eliteTelegraph: { readonly visible: boolean; readonly radius: number; readonly normalY: number }
  readonly eliteCards: readonly { readonly scale: number; readonly facesCamera: boolean }[]
  readonly downedCards: number
  readonly downedTiltRadians: readonly number[]
  readonly rescueSignals: number
  readonly activeSquadMarkers: Readonly<Record<Squad, number>>
  readonly framing: { readonly units: number; readonly unitsInView: number; readonly groundCoversViewCentre: boolean }
}

export type HybridRendererDiagnostics = {
  readonly rendererType: 'webgl'; readonly objectCount: number; readonly actualObjectCount: number; readonly visualUnitCount: number; readonly visualEffectCount: number; readonly snapshotUnitIds: readonly number[]; readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]; readonly teamTints: Readonly<Record<'teal' | 'scarlet' | 'enemy', number>>; readonly unitVisuals: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number; readonly billboard: boolean; readonly facesCamera: boolean; readonly screenY: number; readonly screenHeight: number; readonly kind: string; readonly state: string; readonly cardCenter: { readonly x: number; readonly y: number; readonly z: number }; readonly shadowNormalY: number; readonly markerNormalY: number; readonly shadowFootprint: { readonly x: number; readonly z: number } }[]; readonly worldBounds: { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }; readonly camera: { readonly projection: 'orthographic'; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }; readonly rescueSignalCount: number; readonly quality: { readonly particleCount: number; readonly shadowMapSize: number; readonly shadowTargetSize: { readonly width: number; readonly height: number } | null; readonly dpr: number }; readonly metrics: RendererMetrics
}
export interface HybridGameRenderer extends GameRenderer { getDiagnostics(): HybridRendererDiagnostics; getVisualState(): HybridVisualState }

const PARTICLE_COUNT = 12
const WORLD_WIDTH = 40
const WORLD_HEIGHT = 24
const CAMERA_HEIGHT = 16
const CAMERA_DEPTH = 20
const GROUND_GEOMETRY_WIDTH = 64
const GROUND_GEOMETRY_DEPTH = 36
// The tabletop is drawn wider than the play area so its edge never cuts across the arena.
const GROUND_MARGIN = 1.2
const LEADER_KINDS: readonly RenderUnit['kind'][] = ['commander', 'enemy-commander', 'elite']
const STANDING_CARD_HEIGHT = 0.65
const DOWNED_CARD_HEIGHT = 0.3
const DOWNED_MARKER_COLOR = 0xf4d66c
const HOSTILE_LEADER_MARKER_COLOR = 0xf08a6b
const LEADER_MARKER_COLOR = 0xf2d580
const TELEGRAPH_COLOR = 0xe1725f
// A unit-radius band, scaled per effect by the authoritative footprint radius so the
// painted circle always matches the area the simulation will actually damage.
const TELEGRAPH_INNER_RADIUS = 0.78
const TELEGRAPH_SEGMENTS = 48
export function createHybridRenderer(): HybridGameRenderer { return new ThreeHybridRenderer() }

class ThreeHybridRenderer implements HybridGameRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.OrthographicCamera | null = null
  private assets: CardboardAssets | null = null
  private telegraphGeometry: THREE.RingGeometry | null = null
  private snapshot: RenderSnapshot | null = null
  private readonly units = new Map<number, UnitVisual>()
  private readonly effects = new Map<number, EffectVisual>()
  private particles: THREE.Mesh[] = []
  private viewportWidth = 1
  private viewportHeight = 1
  private requestedDpr = 1
  private dpr = 1
  private qualityLevel: QualityLevel = 'full'
  private disposed = false

  async mount(host: HTMLElement): Promise<void> {
    if (this.renderer) return
    this.disposed = false
    this.viewportWidth = Math.max(1, host.clientWidth || 960)
    this.viewportHeight = Math.max(1, host.clientHeight || 540)
    this.requestedDpr = window.devicePixelRatio || 1
    this.dpr = this.requestedDpr
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setClearColor(0x201d16)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-32, 32, 18, -18, 0.1, 100)
    camera.position.set(0, 16, 20)
    camera.lookAt(0, 0, 0)
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.assets = createCardboardAssets()
    this.telegraphGeometry = new THREE.RingGeometry(TELEGRAPH_INNER_RADIUS, 1, TELEGRAPH_SEGMENTS)
    this.createTabletop(); this.createParticles(); host.append(renderer.domElement); this.applyResolution(); this.renderScene()
  }

  render(snapshot: RenderSnapshot, _alpha: number): void {
    if (this.disposed || !this.scene || !this.camera || !this.assets) return
    this.snapshot = snapshot
    this.updateCameraBounds(snapshot)
    const unitIds = new Set(snapshot.units.map((unit) => unit.id))
    snapshot.units.forEach((unit) => this.renderUnit(unit, snapshot.activeSquad))
    this.units.forEach((visual, id) => { if (!unitIds.has(id)) this.removeVisual(this.units, id, visual) })
    const effectIds = new Set(snapshot.effects.map((effect) => effect.id))
    snapshot.effects.forEach((effect) => this.renderEffect(effect))
    this.effects.forEach((visual, id) => { if (!effectIds.has(id)) this.removeVisual(this.effects, id, visual) })
    this.renderScene()
  }

  resize(width: number, height: number, dpr: number): void {
    if (this.disposed) return
    this.viewportWidth = Math.max(1, width); this.viewportHeight = Math.max(1, height); this.requestedDpr = Math.max(1, dpr); this.dpr = this.qualityLevel === 'low-dpr' ? 1 : this.requestedDpr
    this.applyResolution(); this.renderScene()
  }

  applyQuality(level: QualityLevel): void {
    if (this.disposed || !this.renderer) return
    this.qualityLevel = level
    const profile = qualityProfile(level)
    this.dpr = profile.dpr ?? this.requestedDpr
    const light = this.scene?.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined
    if (light) {
      light.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize)
      light.shadow.map?.dispose()
      light.shadow.map = null
    }
    this.particles.forEach((particle, index) => { particle.visible = index < Math.ceil(PARTICLE_COUNT * profile.particleScale) })
    this.applyResolution(); this.renderScene()
  }

  collectMetrics(): RendererMetrics {
    const info = this.renderer?.info
    return { drawCalls: info?.render.calls ?? null, textures: info?.memory.textures ?? null, geometries: info?.memory.geometries ?? null }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.units.forEach((visual) => disposeObjectMaterials(visual.root)); this.effects.forEach((visual) => disposeObjectMaterials(visual.root)); this.particles.forEach((particle) => disposeObjectMaterials(particle))
    this.scene?.traverse((object) => { if (object instanceof THREE.Mesh && object.name === 'tabletop-ground') disposeObjectMaterials(object) })
    this.units.clear(); this.effects.clear(); this.particles = []
    this.telegraphGeometry?.dispose(); this.telegraphGeometry = null
    this.assets?.dispose(); this.assets = null; this.scene?.clear(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove()
    this.renderer = null; this.scene = null; this.camera = null; this.snapshot = null
  }

  getDiagnostics(): HybridRendererDiagnostics {
    const objects: THREE.Object3D[] = []
    this.scene?.traverse((object) => { if (object !== this.scene) objects.push(object) })
    const snapshot = this.snapshot
    return {
      rendererType: 'webgl', objectCount: objects.length, actualObjectCount: objects.length, visualUnitCount: this.units.size, visualEffectCount: this.effects.size, snapshotUnitIds: snapshot?.units.map((unit) => unit.id) ?? [], snapshotUnits: snapshot?.units.flatMap((unit) => {
        const visual = this.units.get(unit.id)
        return visual ? [{ id: unit.id, x: unit.x, y: unit.y, tint: (visual.card.material as THREE.MeshLambertMaterial).color.getHex() }] : []
      }) ?? [], teamTints: TEAM_TINTS,
      unitVisuals: snapshot?.units.map((unit) => this.describeUnit(unit, this.units.get(unit.id))) ?? [],
      worldBounds: { width: snapshot?.camera.worldWidth ?? WORLD_WIDTH, height: snapshot?.camera.worldHeight ?? WORLD_HEIGHT, centerX: snapshot?.camera.centerX ?? 0, centerY: snapshot?.camera.centerY ?? 0 },
      camera: { projection: 'orthographic', left: this.camera?.left ?? -32, right: this.camera?.right ?? 32, top: this.camera?.top ?? 18, bottom: this.camera?.bottom ?? -18 }, rescueSignalCount: this.rescueSignalCount(),
      quality: { particleCount: this.particles.filter((particle) => particle.visible).length, shadowMapSize: ((this.scene?.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined)?.shadow.mapSize.x ?? 0), shadowTargetSize: shadowTargetSize(this.scene?.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined), dpr: this.dpr }, metrics: this.collectMetrics(),
    }
  }

  getVisualState(): HybridVisualState {
    const units = this.snapshot?.units ?? []
    const activeSquad = this.snapshot?.activeSquad
    const downedVisuals = units.flatMap((unit) => {
      const visual = unit.state === 'downed' ? this.units.get(unit.id) : undefined
      return visual ? [visual] : []
    })
    const activeSquadMarkers: Record<Squad, number> = { teal: 0, scarlet: 0 }
    for (const unit of units) {
      if (unit.squad === null || activeSquad === undefined || unit.squad !== activeSquad) continue
      const marker = this.units.get(unit.id)?.marker
      if (!marker?.visible) continue
      // A marker is only an *active squad* marker when it is actually wearing the
      // squad tint; the same ring also serves downed and leader units in other colours.
      if ((marker.material as THREE.MeshBasicMaterial).color.getHex() !== TEAM_TINTS[unit.team]) continue
      activeSquadMarkers[unit.squad] += 1
    }
    return {
      eliteTelegraph: this.describeTelegraph(),
      eliteCards: units.flatMap((unit) => {
        const visual = unit.kind === 'elite' ? this.units.get(unit.id) : undefined
        return visual ? [{ scale: visual.root.scale.x, facesCamera: this.facesCamera(visual.card) }] : []
      }),
      downedCards: downedVisuals.length,
      downedTiltRadians: downedVisuals.map((visual) => visual.card.rotation.z),
      rescueSignals: this.rescueSignalCount(),
      activeSquadMarkers,
      framing: this.describeFraming(),
    }
  }

  // Scene-graph assertions cannot tell a framed battle from an off-screen one: a renderer
  // that puts every unit outside the frustum still reports the same cards and markers.
  // This projects what is actually on screen.
  private describeFraming(): { units: number; unitsInView: number; groundCoversViewCentre: boolean } {
    const units = this.snapshot?.units ?? []
    if (!this.camera) return { units: units.length, unitsInView: 0, groundCoversViewCentre: false }
    const camera = this.camera
    const unitsInView = units.filter((unit) => {
      const visual = this.units.get(unit.id)
      if (!visual) return false
      const ndc = visual.root.getWorldPosition(new THREE.Vector3()).project(camera)
      return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1
    }).length
    const ground = this.scene?.getObjectByName('tabletop-ground')
    const groundCoversViewCentre = ground
      ? new THREE.Raycaster(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3())).intersectObject(ground, false).length > 0
      : false
    return { units: units.length, unitsInView, groundCoversViewCentre }
  }

  private describeTelegraph(): HybridVisualState['eliteTelegraph'] {
    const area = [...this.effects.values()]
      .filter((visual) => visual.kind === 'elite-telegraph')
      .map((visual) => visual.root.children[0])
      .find((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    if (!area) return { visible: false, radius: 0, normalY: 0 }
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(area.getWorldQuaternion(new THREE.Quaternion())).normalize()
    return {
      visible: true,
      radius: (area.geometry as THREE.RingGeometry).parameters.outerRadius * area.scale.x,
      normalY: normal.y,
    }
  }

  private rescueSignalCount(): number {
    return [...this.effects.values()].filter((visual) => visual.kind === 'rescue-signal').length
  }

  private facesCamera(card: THREE.Mesh): boolean {
    if (!this.camera) return false
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(card.getWorldQuaternion(new THREE.Quaternion())).normalize()
    return normal.dot(this.camera.getWorldDirection(new THREE.Vector3()).negate()) > 0.99
  }

  private createTabletop(): void {
    if (!this.scene) return
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 36), new THREE.MeshLambertMaterial({ color: 0x383226 }))
    ground.name = 'tabletop-ground'; ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true
    const ambient = new THREE.HemisphereLight(0xf8ead2, 0x35291e, 2.4)
    const light = new THREE.DirectionalLight(0xffefd0, 2.5)
    light.name = 'tabletop-key-light'; light.position.set(-8, 14, 10); light.castShadow = true; light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -22; light.shadow.camera.right = 22; light.shadow.camera.top = 15; light.shadow.camera.bottom = -15
    this.scene.add(ground, ambient, light, light.target)
  }

  private createParticles(): void {
    if (!this.scene || !this.assets) return
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const particle = new THREE.Mesh(this.assets!.effectGeometry, flatMaterial(0xf5dc79, 0.32))
      particle.name = 'effect-particle'; particle.position.set(-18 + (index % 6) * 0.45, 0.08, -10 + Math.floor(index / 6) * 0.45); particle.rotation.x = -Math.PI / 2; this.scene!.add(particle); return particle
    })
  }

  private renderUnit(unit: RenderUnit, activeSquad: Squad | undefined): void {
    if (!this.scene || !this.camera || !this.assets) return
    let visual = this.units.get(unit.id)
    if (!visual) {
      const root = new THREE.Group(); root.name = `unit:${unit.id}`
      const shadow = new THREE.Mesh(this.assets.shadowGeometry, flatMaterial(0x000000, 0.28)); shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.012, 0); shadow.receiveShadow = true
      const card = new THREE.Mesh(this.assets.unitGeometry, cardboardMaterial(unit.team, this.assets.unitTexture)); card.position.y = STANDING_CARD_HEIGHT; card.castShadow = true
      const marker = new THREE.Mesh(this.assets.markerGeometry, flatMaterial(LEADER_MARKER_COLOR)); marker.rotation.x = -Math.PI / 2; marker.position.y = 0.025
      root.add(shadow, card, marker); this.scene.add(root); visual = { root, card, shadow, marker }; this.units.set(unit.id, visual)
    }
    const downed = unit.state === 'downed'
    const marksActiveSquad = activeSquad !== undefined && unit.squad === activeSquad
    visual.root.position.set(unit.x, 0, unit.y); visual.root.scale.setScalar(cardScale(unit)); visual.card.quaternion.copy(this.camera.quaternion)
    visual.shadow.visible = !downed; visual.marker.visible = isLeader(unit) || downed || marksActiveSquad
    ;(visual.marker.material as THREE.MeshBasicMaterial).color.setHex(markerColor(unit, marksActiveSquad))
    // A downed card is laid across the tabletop and dropped towards it, so it reads
    // as a fallen counter rather than a standing one that happens to be rotated.
    visual.card.rotation.z = downed ? Math.PI / 2 : 0
    visual.card.position.y = downed ? DOWNED_CARD_HEIGHT : STANDING_CARD_HEIGHT
  }

  private renderEffect(effect: RenderEffect): void {
    if (!this.scene || !this.camera || !this.assets) return
    const visual = this.effects.get(effect.id) ?? this.createEffectVisual(effect)
    visual.root.position.set(effect.x, 0, effect.y)
    // The telegraph marks ground the squad has to leave, so it stays painted flat on
    // the tabletop and re-reads its footprint every frame; every other effect is a
    // billboarded token like the unit cards.
    if (visual.kind === 'elite-telegraph') {
      const area = visual.root.children[0]
      if (area) area.scale.setScalar(effect.radius ?? 1)
      return
    }
    visual.root.quaternion.copy(this.camera.quaternion)
  }

  private createEffectVisual(effect: RenderEffect): EffectVisual {
    const root = new THREE.Group(); root.name = `effect:${effect.kind}:${effect.id}`
    if (effect.kind === 'elite-telegraph') {
      const area = new THREE.Mesh(this.telegraphGeometry!, flatMaterial(TELEGRAPH_COLOR, 0.42))
      area.rotation.x = -Math.PI / 2; area.position.y = 0.02
      root.add(area)
    } else {
      const ring = new THREE.Mesh(this.assets!.effectGeometry, flatMaterial(effect.team ? TEAM_TINTS[effect.team] : 0xf5dc79))
      ring.position.y = effect.kind === 'rescue-signal' ? 1.4 : 0.08
      root.add(ring)
    }
    this.scene!.add(root)
    const visual: EffectVisual = { root, kind: effect.kind }
    this.effects.set(effect.id, visual)
    return visual
  }

  private describeUnit(unit: RenderUnit, visual: UnitVisual | undefined) {
    if (!visual || !this.camera || !this.renderer) return { id: unit.id, x: unit.x, y: unit.y, tint: TEAM_TINTS[unit.team], billboard: false, facesCamera: false, screenY: 0, screenHeight: 0, kind: unit.kind, state: unit.state, cardCenter: { x: 0, y: 0, z: 0 }, shadowNormalY: 0, markerNormalY: 0, shadowFootprint: { x: 0, z: 0 } }
    const bottom = visual.card.localToWorld(new THREE.Vector3(0, -0.55, 0)).project(this.camera)
    const top = visual.card.localToWorld(new THREE.Vector3(0, 0.55, 0)).project(this.camera)
    const cardCenter = visual.card.getWorldPosition(new THREE.Vector3())
    const center = cardCenter.clone().project(this.camera)
    const canvasHeight = this.renderer.domElement.getBoundingClientRect().height || this.viewportHeight
    const shadowFootprint = visual.shadow.getWorldPosition(new THREE.Vector3())
    const shadowNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.shadow.getWorldQuaternion(new THREE.Quaternion()))
    const markerNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(visual.marker.getWorldQuaternion(new THREE.Quaternion()))
    return { id: unit.id, x: visual.root.position.x, y: visual.root.position.z, tint: (visual.card.material as THREE.MeshLambertMaterial).color.getHex(), billboard: true, facesCamera: this.facesCamera(visual.card), screenY: (1 - center.y) * canvasHeight / 2, screenHeight: Math.abs(top.y - bottom.y) * canvasHeight / 2, kind: unit.kind, state: unit.state, cardCenter, shadowNormalY: shadowNormal.y, markerNormalY: markerNormal.y, shadowFootprint: { x: shadowFootprint.x, z: shadowFootprint.z } }
  }

  private removeVisual<T extends { readonly root: THREE.Group }>(collection: Map<number, T>, id: number, visual: T): void { visual.root.removeFromParent(); disposeObjectMaterials(visual.root); collection.delete(id) }
  private updateCameraBounds(snapshot: RenderSnapshot): void {
    if (!this.camera) return
    const { centerX, centerY, worldWidth, worldHeight } = snapshot.camera
    // An orthographic frustum is expressed in camera space, so world bounds cannot be
    // assigned to left/right/top/bottom directly: the camera has to sit over the world
    // centre and take only the half-extents from the snapshot. Assigning world
    // coordinates worked while every snapshot was centred on the origin and pushed the
    // whole arena out of view as soon as one was not.
    this.camera.left = -worldWidth / 2
    this.camera.right = worldWidth / 2
    this.camera.top = worldHeight / 2
    this.camera.bottom = -worldHeight / 2
    this.camera.position.set(centerX, CAMERA_HEIGHT, centerY + CAMERA_DEPTH)
    this.camera.lookAt(centerX, 0, centerY)
    this.camera.updateProjectionMatrix()
    this.updateTabletopBounds(snapshot)
  }

  private updateTabletopBounds(snapshot: RenderSnapshot): void {
    const { centerX, centerY, worldWidth, worldHeight } = snapshot.camera
    const ground = this.scene?.getObjectByName('tabletop-ground')
    if (ground) {
      ground.position.set(centerX, 0, centerY)
      ground.scale.set((worldWidth * GROUND_MARGIN) / GROUND_GEOMETRY_WIDTH, (worldHeight * GROUND_MARGIN) / GROUND_GEOMETRY_DEPTH, 1)
    }
    const light = this.scene?.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined
    if (light) {
      light.position.set(centerX - 8, CAMERA_HEIGHT - 2, centerY + 10)
      light.target.position.set(centerX, 0, centerY)
      light.target.updateMatrixWorld()
    }
  }
  private applyResolution(): void { if (!this.renderer) return; this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.viewportWidth, this.viewportHeight, false); this.renderer.domElement.style.width = `${this.viewportWidth}px`; this.renderer.domElement.style.height = `${this.viewportHeight}px` }
  private renderScene(): void { if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera) }
}

function isLeader(unit: RenderUnit): boolean {
  return LEADER_KINDS.includes(unit.kind)
}

function cardScale(unit: RenderUnit): number {
  if (isLeader(unit)) return 1.25
  return unit.state === 'downed' ? 0.85 : 1
}

function markerColor(unit: RenderUnit, marksActiveSquad: boolean): number {
  if (unit.state === 'downed') return DOWNED_MARKER_COLOR
  if (unit.kind === 'enemy-commander' || unit.kind === 'elite') return HOSTILE_LEADER_MARKER_COLOR
  return marksActiveSquad ? TEAM_TINTS[unit.team] : LEADER_MARKER_COLOR
}

function shadowTargetSize(light: THREE.DirectionalLight | undefined): { width: number; height: number } | null {
  const target = light?.shadow.map
  return target ? { width: target.width, height: target.height } : null
}
