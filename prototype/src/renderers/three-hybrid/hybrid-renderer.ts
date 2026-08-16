import * as THREE from 'three'

import type { RenderEffect, RenderSnapshot, RenderUnit, Squad } from '../../core/types'
import { qualityProfile } from '../../metrics/quality-ladder'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { TEAM_TINTS, cardboardMaterial, createCardboardAssets, disposeObjectMaterials, flatMaterial, type CardboardAssets } from '../three-shared/scene-utils'
import { createDioramaAssets, type DioramaAssets, type MiniatureArchetype } from './diorama-assets'
import { createTerrainProps, type TerrainProps } from './terrain-props'

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
  readonly framing: {
    readonly units: number
    readonly unitsInView: number
    readonly groundCoversViewCentre: boolean
    /** Camera elevation above the tabletop. The staged diorama view sits low and oblique. */
    readonly cameraPitchDegrees: number
    readonly viewHalfWidth: number
    readonly viewHalfHeight: number
  }
  /**
   * Which presentation the scene is wearing. The renderer is shared with the
   * `?lab=renderers` comparison, which must keep the flat cardboard cards, so the
   * sculpted diorama is gated on the gameplay-only `activeSquad` snapshot signal.
   */
  readonly presentation: {
    readonly mode: 'diorama' | 'cardboard'
    readonly boardTextured: boolean
    readonly frameRails: number
    readonly rimLights: number
    readonly meshesPerUnit: number
    readonly baseRings: number
    readonly billboardedBodies: number
    readonly mergedBodyGeometries: number
    /** Terrain surround: merged prop meshes on the board and how many props they carry. */
    readonly propMeshes: number
    readonly propItems: number
  }
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

// --- Tabletop diorama presentation -----------------------------------------------
// The gameplay route paints a sculpted diorama: sandy board with grid seams, a raised
// wooden edge frame, warm key light plus a cool rim, and merged miniature bodies.
// --- Camera staging --------------------------------------------------------------
// The concept sheet is shot from a low oblique angle: the miniatures stand up against
// the board, their bases read as ellipses rather than circles, and the key light rakes
// long shadows across the sand. A near top-down view flattens all three away.
//
// 30 degrees is as low as the staging can go before the front rank starts hiding the
// rank behind it, and it matches the base-ring ellipse of the concept art.
const DIORAMA_PITCH_RADIANS = (30 * Math.PI) / 180
// Orthographic, so the distance only has to clear the near plane and keep the whole
// board (and the terrain belt behind it) inside the depth range.
const DIORAMA_CAMERA_DISTANCE = 46
// How much is framed beyond the play area: the raised rail plus a strip of the terrain
// the board stands on. Anything more is wasted magnification — the 48-wide arena is
// what caps the zoom, and every extra unit of margin shrinks the miniatures.
const DIORAMA_EDGE_MARGIN = 2
// Vertical allowance for a standing miniature: the elite is the tallest, roughly four
// world units from its plinth to the tip of its staff. It never binds at a normal
// viewport aspect, but it is what keeps a very tall window from clipping heads.
const DIORAMA_FIGURE_HEADROOM = 4.4
// The ruled board stops just outside its own rail; past that the terrain apron takes
// over. That edge is what makes the play area read as a board rather than as a fence
// drawn across an endless map.
const DIORAMA_BOARD_PAD = 1.35
const DIORAMA_BOARD_TILE = 5.6
const FRAME_RAIL_THICKNESS = 1.2
// Low enough that the near rail never hides the base of a unit standing on the board's
// near edge at the staged pitch: a sightline over the rail clears it by 1.2 * tan(30).
const FRAME_RAIL_HEIGHT = 0.6
const FRAME_RAIL_NAME = 'tabletop-frame-rail'
const RIM_LIGHT_NAME = 'tabletop-rim-light'
const BOARD_COLOR = 0xd6c0a0
const CONTACT_SHADOW_COLOR = 0x1d1408
// Faction paint. The concept sheet fields teal and scarlet painted friendlies against a
// purple horde, so the enemy miniature leaves the shared cardboard tint behind.
const ENEMY_PAINT = 0x8158c4
const ENEMY_COMMANDER_PAINT = 0x6d3fb5
const ELITE_PAINT = 0xa274e6
const ENEMY_RING_COLOR = 0x8a5fd0
const HOSTILE_LEADER_RING_COLOR = 0xba8ef5
// An idle friendly still wears a ring, just a muted one, so the active squad's full
// team tint reads as the brighter of the two at a glance.
const IDLE_RING_MIX = 0.42
const IDLE_RING_FLOOR = 0x1d1710
const RING_BASE_OPACITY = 0.82
const RING_PULSE_AMPLITUDE = 0.18
const RING_PULSE_TICKS = 34
const LEADER_RING_SCALE = 1.6
// A toppled miniature lies on its side, lifted just clear of the board.
const DOWNED_FIGURE_HEIGHT = 0.16
export function createHybridRenderer(): HybridGameRenderer { return new ThreeHybridRenderer() }

class ThreeHybridRenderer implements HybridGameRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.OrthographicCamera | null = null
  private assets: CardboardAssets | null = null
  private diorama: DioramaAssets | null = null
  private props: TerrainProps | null = null
  private frameRails: THREE.Mesh[] = []
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
    // The lab comparison drives this same renderer with an origin-centred fixture that
    // has no `activeSquad`; only the gameplay authority publishes one. Reading that
    // signal keeps the lab on its cardboard cards without a second renderer.
    if (!this.diorama && snapshot.activeSquad !== undefined) this.applyDioramaPresentation(snapshot)
    this.updateCameraBounds(snapshot)
    const unitIds = new Set(snapshot.units.map((unit) => unit.id))
    snapshot.units.forEach((unit) => this.renderUnit(unit, snapshot))
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
    this.scene?.traverse((object) => { if (object instanceof THREE.Mesh && object.name.startsWith('tabletop-')) disposeObjectMaterials(object) })
    this.units.clear(); this.effects.clear(); this.particles = []; this.frameRails = []
    this.telegraphGeometry?.dispose(); this.telegraphGeometry = null
    this.props?.dispose(); this.props = null
    this.diorama?.dispose(); this.diorama = null
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
      presentation: this.describePresentation(),
    }
  }

  private describePresentation(): HybridVisualState['presentation'] {
    const visuals = [...this.units.values()]
    const ground = this.scene?.getObjectByName('tabletop-ground')
    const boardTextured = ground instanceof THREE.Mesh
      && (ground.material as THREE.MeshLambertMaterial).map === (this.diorama?.boardTexture ?? null)
      && this.diorama !== null
    return {
      mode: this.diorama ? 'diorama' : 'cardboard',
      boardTextured,
      frameRails: this.frameRails.filter((rail) => rail.parent !== null).length,
      rimLights: this.scene?.getObjectByName(RIM_LIGHT_NAME) ? 1 : 0,
      meshesPerUnit: visuals.length === 0 ? 0 : Math.max(...visuals.map((visual) => visual.root.children.filter((child) => child instanceof THREE.Mesh).length)),
      baseRings: visuals.filter((visual) => visual.marker.visible).length,
      billboardedBodies: visuals.filter((visual) => this.facesCamera(visual.card)).length,
      mergedBodyGeometries: this.diorama ? new Set(visuals.map((visual) => visual.card.geometry.uuid)).size : 0,
      propMeshes: (this.props?.meshes ?? []).filter((mesh) => mesh.parent !== null).length,
      propItems: this.props?.placements.length ?? 0,
    }
  }

  // Scene-graph assertions cannot tell a framed battle from an off-screen one: a renderer
  // that puts every unit outside the frustum still reports the same cards and markers.
  // This projects what is actually on screen.
  private describeFraming(): HybridVisualState['framing'] {
    const units = this.snapshot?.units ?? []
    if (!this.camera) return { units: units.length, unitsInView: 0, groundCoversViewCentre: false, cameraPitchDegrees: 0, viewHalfWidth: 0, viewHalfHeight: 0 }
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
    return {
      units: units.length,
      unitsInView,
      groundCoversViewCentre,
      cameraPitchDegrees: THREE.MathUtils.radToDeg(Math.asin(-camera.getWorldDirection(new THREE.Vector3()).y)),
      viewHalfWidth: (camera.right - camera.left) / 2,
      viewHalfHeight: (camera.top - camera.bottom) / 2,
    }
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

  /**
   * Upgrades the shared cardboard scene into the tabletop diorama: a painted sandy
   * board with grid seams, a raised wooden edge frame, and a warm key / cool rim pair
   * that gives the sculpted miniatures form instead of the flat card readout.
   *
   * Runs once, on the first gameplay snapshot. The lab route never reaches it.
   */
  private applyDioramaPresentation(snapshot: RenderSnapshot): void {
    if (!this.scene || !this.renderer || this.diorama) return
    const assets = createDioramaAssets()
    this.diorama = assets
    this.renderer.setClearColor(0x171208)

    const ground = this.scene.getObjectByName('tabletop-ground')
    if (ground instanceof THREE.Mesh) {
      assets.boardTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      const previous = ground.material as THREE.Material
      ground.material = new THREE.MeshLambertMaterial({ color: BOARD_COLOR, map: assets.boardTexture })
      previous.dispose()
    }

    assets.frameTexture.repeat.set(6, 1)
    const railMaterial = new THREE.MeshLambertMaterial({ color: 0xe6cda9, map: assets.frameTexture })
    this.frameRails = Array.from({ length: 4 }, () => {
      const rail = new THREE.Mesh(assets.frameRailGeometry, railMaterial)
      rail.name = FRAME_RAIL_NAME
      rail.castShadow = true
      rail.receiveShadow = true
      this.scene!.add(rail)
      return rail
    })

    // Warm key from the front-left already exists for shadows; a cool rim from behind
    // separates the miniatures from the sandy board, and the hemisphere fill drops so
    // the sculpted forms keep their shading instead of washing flat.
    const ambient = this.scene.children.find((child): child is THREE.HemisphereLight => child instanceof THREE.HemisphereLight)
    if (ambient) { ambient.intensity = 0.85; ambient.color.setHex(0xf7e2bf); ambient.groundColor.setHex(0x2f2114) }
    const key = this.scene.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined
    if (key) {
      key.color.setHex(0xffdda2)
      key.intensity = 2.9
      // Wide enough to keep the terrain belt in the shadow pass, and pushed far enough
      // out that props on the camera side of the board are still in front of the light.
      key.shadow.camera.left = -40; key.shadow.camera.right = 40; key.shadow.camera.top = 36; key.shadow.camera.bottom = -36
      key.shadow.camera.near = 1; key.shadow.camera.far = 130
      key.shadow.bias = -0.0012
      key.shadow.normalBias = 0.03
      key.shadow.camera.updateProjectionMatrix()
    }
    const rim = new THREE.DirectionalLight(0x93bcff, 1.4)
    rim.name = RIM_LIGHT_NAME
    this.scene.add(rim, rim.target)

    // The terrain surround. Built once, from cosmetic randomness only, entirely outside
    // the play area — it decorates the board and never takes part in judgement.
    this.props = createTerrainProps(snapshot.camera, { sightlineSlope: 1.05 / Math.tan(DIORAMA_PITCH_RADIANS) })
    this.props.meshes.forEach((mesh) => this.scene!.add(mesh))

    // Units created before the first gameplay snapshot would still be cards; there are
    // none in practice, but rebuilding keeps the invariant true either way.
    this.units.forEach((visual, id) => this.removeVisual(this.units, id, visual))
  }

  private createParticles(): void {
    if (!this.scene || !this.assets) return
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const particle = new THREE.Mesh(this.assets!.effectGeometry, flatMaterial(0xf5dc79, 0.32))
      particle.name = 'effect-particle'; particle.position.set(-18 + (index % 6) * 0.45, 0.08, -10 + Math.floor(index / 6) * 0.45); particle.rotation.x = -Math.PI / 2; this.scene!.add(particle); return particle
    })
  }

  private renderUnit(unit: RenderUnit, snapshot: RenderSnapshot): void {
    if (!this.scene || !this.camera || !this.assets) return
    const activeSquad = snapshot.activeSquad
    let visual = this.units.get(unit.id)
    if (!visual) visual = this.diorama ? this.createMiniature(unit) : this.createCard(unit)
    const downed = unit.state === 'downed'
    const marksActiveSquad = activeSquad !== undefined && unit.squad === activeSquad
    visual.root.position.set(unit.x, 0, unit.y); visual.root.scale.setScalar(cardScale(unit))
    visual.shadow.visible = !downed
    if (this.diorama) {
      // A sculpted figure stands on the board; it never turns to face the camera, it
      // turns to face where the authority says the unit is looking.
      visual.card.rotation.set(0, Math.PI / 2 - unit.facingRadians, 0)
      // Every unit wears a base ring in the diorama; the colour is what carries the read.
      visual.marker.visible = true
      ;(visual.marker.material as THREE.MeshBasicMaterial).color.setHex(dioramaRingColor(unit, marksActiveSquad))
      ;(visual.marker.material as THREE.MeshBasicMaterial).opacity = marksActiveSquad && !downed
        ? RING_BASE_OPACITY + RING_PULSE_AMPLITUDE * Math.sin((snapshot.tick / RING_PULSE_TICKS) * Math.PI * 2)
        : RING_BASE_OPACITY - RING_PULSE_AMPLITUDE
    } else {
      visual.card.quaternion.copy(this.camera.quaternion)
      visual.marker.visible = isLeader(unit) || downed || marksActiveSquad
      ;(visual.marker.material as THREE.MeshBasicMaterial).color.setHex(markerColor(unit, marksActiveSquad))
    }
    // A downed card is laid across the tabletop and dropped towards it, so it reads
    // as a fallen counter rather than a standing one that happens to be rotated. The
    // same tilt topples a miniature off its feet.
    visual.card.rotation.z = downed ? Math.PI / 2 : 0
    visual.card.position.y = this.diorama
      ? (downed ? DOWNED_FIGURE_HEIGHT : 0)
      : (downed ? DOWNED_CARD_HEIGHT : STANDING_CARD_HEIGHT)
  }

  private createCard(unit: RenderUnit): UnitVisual {
    const assets = this.assets!
    const root = new THREE.Group(); root.name = `unit:${unit.id}`
    const shadow = new THREE.Mesh(assets.shadowGeometry, flatMaterial(0x000000, 0.28)); shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.012, 0); shadow.receiveShadow = true
    const card = new THREE.Mesh(assets.unitGeometry, cardboardMaterial(unit.team, assets.unitTexture)); card.position.y = STANDING_CARD_HEIGHT; card.castShadow = true
    const marker = new THREE.Mesh(assets.markerGeometry, flatMaterial(LEADER_MARKER_COLOR)); marker.rotation.x = -Math.PI / 2; marker.position.y = 0.025
    root.add(shadow, card, marker); this.scene!.add(root)
    const visual: UnitVisual = { root, card, shadow, marker }
    this.units.set(unit.id, visual)
    return visual
  }

  /**
   * One unit costs one merged body mesh, one base ring and one contact shadow — the
   * same three meshes the cardboard card already cost. The body's primitives (base
   * disc, legs, torso, pauldrons, head, weapon) are merged per archetype at mount time
   * and the paint variation is baked into vertex colours, so a whole figure still
   * renders in a single draw call with a single material.
   */
  private createMiniature(unit: RenderUnit): UnitVisual {
    const assets = this.diorama!
    const archetype = miniatureArchetype(unit)
    const leader = isLeader(unit)
    const root = new THREE.Group(); root.name = `unit:${unit.id}`

    const shadow = new THREE.Mesh(assets.contactShadowGeometry, new THREE.MeshBasicMaterial({ map: assets.contactShadowTexture, color: CONTACT_SHADOW_COLOR, transparent: true, opacity: 0.5, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.012, 0)
    if (leader) shadow.scale.setScalar(1.5)

    const card = new THREE.Mesh(assets.miniatures[archetype], new THREE.MeshLambertMaterial({ color: miniaturePaint(unit), vertexColors: true }))
    card.name = `miniature:${archetype}`
    card.castShadow = true

    const marker = new THREE.Mesh(assets.baseRingGeometry, flatMaterial(LEADER_MARKER_COLOR, RING_BASE_OPACITY))
    marker.rotation.x = -Math.PI / 2; marker.position.y = 0.03
    if (leader) marker.scale.setScalar(LEADER_RING_SCALE)

    root.add(shadow, card, marker); this.scene!.add(root)
    const visual: UnitVisual = { root, card, shadow, marker }
    this.units.set(unit.id, visual)
    return visual
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
    return { id: unit.id, x: visual.root.position.x, y: visual.root.position.z, tint: (visual.card.material as THREE.MeshLambertMaterial).color.getHex(), billboard: !this.diorama, facesCamera: this.facesCamera(visual.card), screenY: (1 - center.y) * canvasHeight / 2, screenHeight: Math.abs(top.y - bottom.y) * canvasHeight / 2, kind: unit.kind, state: unit.state, cardCenter, shadowNormalY: shadowNormal.y, markerNormalY: markerNormal.y, shadowFootprint: { x: shadowFootprint.x, z: shadowFootprint.z } }
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
    // The lab keeps the exact world-bounds framing it asserts.
    if (!this.diorama) {
      this.camera.left = -worldWidth / 2
      this.camera.right = worldWidth / 2
      this.camera.top = worldHeight / 2
      this.camera.bottom = -worldHeight / 2
      this.camera.position.set(centerX, CAMERA_HEIGHT, centerY + CAMERA_DEPTH)
      this.camera.lookAt(centerX, 0, centerY)
      this.camera.updateProjectionMatrix()
      this.updateTabletopBounds(snapshot)
      return
    }

    // Diorama staging. The camera is pitched down 30 degrees from the near edge, so the
    // board's depth is foreshortened by sin(pitch) while a standing miniature keeps
    // cos(pitch) of its height — that is what turns the tokens back into models.
    //
    // The frustum is then sized from what has to be *guaranteed* on screen rather than
    // from a fixed zoom factor: the full play area plus the raised rail across the
    // width, the foreshortened play area plus a figure's headroom across the height,
    // and whichever of the two the viewport aspect makes binding. Enemies spawn on the
    // arena boundary, so the width requirement is never negotiable — it is also what
    // caps how large a miniature can be drawn.
    const pitch = DIORAMA_PITCH_RADIANS
    const aspect = this.viewportWidth / this.viewportHeight
    const requiredHalfWidth = worldWidth / 2 + DIORAMA_EDGE_MARGIN
    const requiredHalfHeight = (worldHeight / 2 + DIORAMA_EDGE_MARGIN) * Math.sin(pitch) + DIORAMA_FIGURE_HEADROOM * Math.cos(pitch)
    const halfWidth = Math.max(requiredHalfWidth, requiredHalfHeight * aspect)
    const halfHeight = halfWidth / aspect
    this.camera.left = -halfWidth
    this.camera.right = halfWidth
    this.camera.top = halfHeight
    this.camera.bottom = -halfHeight
    this.camera.near = 0.1
    this.camera.far = DIORAMA_CAMERA_DISTANCE * 3
    this.camera.position.set(
      centerX,
      DIORAMA_CAMERA_DISTANCE * Math.sin(pitch),
      centerY + DIORAMA_CAMERA_DISTANCE * Math.cos(pitch),
    )
    this.camera.lookAt(centerX, 0, centerY)
    this.camera.updateProjectionMatrix()
    this.updateTabletopBounds(snapshot)
  }

  private updateTabletopBounds(snapshot: RenderSnapshot): void {
    const { centerX, centerY, worldWidth, worldHeight } = snapshot.camera
    const ground = this.scene?.getObjectByName('tabletop-ground')
    if (ground) {
      ground.position.set(centerX, 0, centerY)
      // The diorama's ruled board stops just past its own rail — the terrain apron the
      // props stand on carries the rest of the frame — and re-tiles its texture to that
      // extent so the grid squares keep their size.
      const boardWidth = this.diorama ? worldWidth + DIORAMA_BOARD_PAD * 2 : worldWidth * GROUND_MARGIN
      const boardDepth = this.diorama ? worldHeight + DIORAMA_BOARD_PAD * 2 : worldHeight * GROUND_MARGIN
      ground.scale.set(boardWidth / GROUND_GEOMETRY_WIDTH, boardDepth / GROUND_GEOMETRY_DEPTH, 1)
      if (this.diorama) this.diorama.boardTexture.repeat.set(boardWidth / DIORAMA_BOARD_TILE, boardDepth / DIORAMA_BOARD_TILE)
    }
    const light = this.scene?.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined
    if (light) {
      // A low raking key from the front left. Its 29-degree elevation is what stretches
      // a miniature's shadow to nearly twice its own height, the way the concept art
      // reads; it sits far out so every prop stays in front of the shadow camera.
      if (this.diorama) light.position.set(centerX - 26, 22, centerY + 30)
      else light.position.set(centerX - 8, CAMERA_HEIGHT - 2, centerY + 10)
      light.target.position.set(centerX, 0, centerY)
      light.target.updateMatrixWorld()
    }
    this.updateFrameRails(centerX, centerY, worldWidth, worldHeight)
    const rim = this.scene?.getObjectByName(RIM_LIGHT_NAME) as THREE.DirectionalLight | undefined
    if (rim) {
      rim.position.set(centerX + 12, 9, centerY - 14)
      rim.target.position.set(centerX, 0, centerY)
      rim.target.updateMatrixWorld()
    }
  }

  /**
   * Four rails laid on the play-area boundary form the raised edge of the board. They
   * share one box geometry and one material and are scaled — never stretched as a
   * single ring — so the rail keeps a constant thickness on all four sides.
   */
  private updateFrameRails(centerX: number, centerY: number, worldWidth: number, worldHeight: number): void {
    if (this.frameRails.length !== 4) return
    const halfW = worldWidth / 2
    const halfH = worldHeight / 2
    const t = FRAME_RAIL_THICKNESS
    const h = FRAME_RAIL_HEIGHT
    const y = h / 2 - 0.12
    const layout = [
      { position: [centerX, y, centerY - halfH - t / 2], scale: [halfW * 2 + t * 2, h, t] },
      { position: [centerX, y, centerY + halfH + t / 2], scale: [halfW * 2 + t * 2, h, t] },
      { position: [centerX - halfW - t / 2, y, centerY], scale: [t, h, halfH * 2] },
      { position: [centerX + halfW + t / 2, y, centerY], scale: [t, h, halfH * 2] },
    ] as const
    this.frameRails.forEach((rail, index) => {
      const { position, scale } = layout[index]!
      rail.position.set(position[0], position[1], position[2])
      rail.scale.set(scale[0], scale[1], scale[2])
    })
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

function miniatureArchetype(unit: RenderUnit): MiniatureArchetype {
  if (unit.kind === 'elite') return 'elite'
  return unit.team === 'enemy' ? 'enemy' : 'friendly'
}

/**
 * The archetype geometry bakes paint *values* as vertex colours, so this single tint
 * is what turns the same merged body into a teal trooper, a scarlet trooper or a
 * purple raider.
 */
function miniaturePaint(unit: RenderUnit): number {
  if (unit.kind === 'elite') return ELITE_PAINT
  if (unit.kind === 'enemy-commander') return ENEMY_COMMANDER_PAINT
  if (unit.team === 'enemy') return ENEMY_PAINT
  return TEAM_TINTS[unit.team]
}

/**
 * The base ring is the unit's read at a glance. An active-squad friendly keeps the
 * *exact* team tint (and pulses) while an idle one is muted towards the board, so the
 * squad the player is steering is the brighter of the two without inventing a colour.
 */
function dioramaRingColor(unit: RenderUnit, marksActiveSquad: boolean): number {
  if (unit.state === 'downed') return DOWNED_MARKER_COLOR
  if (unit.kind === 'elite' || unit.kind === 'enemy-commander') return HOSTILE_LEADER_RING_COLOR
  if (unit.team === 'enemy') return ENEMY_RING_COLOR
  if (marksActiveSquad) return TEAM_TINTS[unit.team]
  return mixHex(TEAM_TINTS[unit.team], IDLE_RING_FLOOR, IDLE_RING_MIX)
}

function mixHex(from: number, to: number, amount: number): number {
  const channel = (shift: number) => Math.round((((from >> shift) & 0xff) * (1 - amount)) + (((to >> shift) & 0xff) * amount))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function shadowTargetSize(light: THREE.DirectionalLight | undefined): { width: number; height: number } | null {
  const target = light?.shadow.map
  return target ? { width: target.width, height: target.height } : null
}
