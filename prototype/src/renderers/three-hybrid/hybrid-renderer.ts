import * as THREE from 'three'

import type { RenderEffect, RenderSnapshot, RenderUnit, Squad } from '../../core/types'
import { qualityProfile } from '../../metrics/quality-ladder'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { TEAM_TINTS, cardboardMaterial, createCardboardAssets, disposeObjectMaterials, flatMaterial, type CardboardAssets } from '../three-shared/scene-utils'
import { DECAL_HEIGHT, FX_COSMETIC_SEED, createCombatFxAssets, createSurfaceDecals, surfaceDecalExtent, type CombatFxAssets, type SurfaceDecals } from './combat-fx'
import { FIGURE_SCALE, cosmeticRandom, createDioramaAssets, type DioramaAssets, type MiniatureArchetype } from './diorama-assets'
import { createTerrainProps, type TerrainProps } from './terrain-props'

/**
 * Per-unit action-feedback state. It is *display-only*: nothing in here is ever read
 * back into a snapshot, an input or a digest, and every field is written from something
 * the authority already published (hp, life state, position, active squad).
 */
type UnitAnim = {
  /** Renderer-derived facing: movement heading, overridden by the last shot taken. */
  yaw: number
  aimUntil: number
  lungeStart: number
  lungeX: number
  lungeZ: number
  lungeOffset: number
  hitStart: number
  hitX: number
  hitZ: number
  flash: number
  flashScale: number
  deathStart: number
  deathFromTopple: number
  dead: boolean
  buried: boolean
  /** Last snapshot values, so the next snapshot can be diffed into hit / death events. */
  hp01: number
  x: number
  y: number
}
type UnitVisual = {
  readonly root: THREE.Group
  readonly card: THREE.Mesh
  readonly shadow: THREE.Mesh
  readonly marker: THREE.Mesh
  readonly anim: UnitAnim
}
type EffectVisual = {
  readonly root: THREE.Group
  readonly kind: RenderEffect['kind']
  /** Diorama-only dressing: the elite sigil and countdown, or the gold rescue token. */
  readonly sigil?: THREE.Mesh
  readonly countdown?: THREE.Mesh
  readonly ring?: THREE.Mesh
  readonly pillar?: THREE.Mesh
  readonly halo?: THREE.Mesh
}
type TelegraphTrack = { remaining: number; longest: number; x: number; z: number; radius: number }

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
    /**
     * Flat paint on the play area — scorch, chalk, wear. Exposed separately from
     * `propMeshes` because the whole point is that it is *not* scenery: it lies on the
     * board, casts nothing, and never leaves the play area.
     */
    readonly surfaceDecalMeshes: number
    readonly surfaceDecals: number
    readonly surfaceDecalFlat: boolean
    readonly surfaceDecalsWithinPlayArea: boolean
    readonly surfaceDecalCastsShadow: boolean
  }
  /**
   * Live action feedback. Every counter here is derived from snapshot deltas, and the
   * cumulative ones let a browser test prove the animations actually *run* rather than
   * merely existing in the scene graph.
   */
  readonly action: {
    /** The renderer's animation clock, in simulation ticks (`tick + alpha`). */
    readonly clockTicks: number
    readonly lungingUnits: number
    readonly maxLungeOffset: number
    readonly flashingUnits: number
    readonly maxFlash: number
    readonly topplingUnits: number
    readonly buriedUnits: number
    readonly attacksObserved: number
    readonly hitsObserved: number
    readonly deathsObserved: number
    readonly livePuffs: number
    readonly liveScraps: number
    readonly particleCapacity: number
    readonly rescuePillars: number
    readonly rescueRingSpinRadians: number
    readonly cameraShakes: number
    readonly cameraShakeOffset: number
    readonly telegraphSigils: number
    readonly telegraphPulse: number
    readonly telegraphCountdown01: number
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

// --- Action feedback ---------------------------------------------------------------
// The authority publishes positions, hit points and life states — not events. Every
// animation below is therefore derived by diffing consecutive snapshots inside the
// renderer, and every duration is expressed in simulation ticks so the whole system
// runs off the snapshot clock (`tick + alpha`) the renderer is already handed. A wall
// clock would drift against the fixed 30 Hz authority and would keep animating — and
// keep queueing bursts — while the tab is hidden and the battle is paused.
const SURFACE_DECAL_NAME = 'tabletop-surface-decals'
/** A frame may legally cover up to `MAX_STEPS_PER_FRAME` ticks; anything beyond that is
 * a resume from pause / a hidden tab / a restart, and is resynced without firing a
 * backlog of effects. */
const EVENT_CATCHUP_TICKS = 6
const LUNGE_TICKS = 7
const LUNGE_DISTANCE = 0.36
const LUNGE_PITCH = 0.22
const HIT_TICKS = 5
const HIT_RECOIL = 0.2
const FLASH_COLOR = 0xfff0cf
/**
 * How hard a hit flashes, scaled by how much of the target's health it took. Without
 * that scaling the elite — which is chipped by every friendly, every few ticks, for 24
 * hit points — would sit permanently white and lose its silhouette entirely.
 */
const FLASH_PEAK = 0.55
const FLASH_FLOOR = 0.35
/** How far a damaged unit will look for the hostile that plausibly shot it. The longest
 * authority attack range is well inside this, and it is only ever used to aim a lunge. */
const ATTRIBUTION_RANGE = 7.5
const AIM_HOLD_TICKS = 26
const DEATH_TICKS = 18
/** The figure topples over the first stretch, bursts into scraps, then is swept away. */
const DEATH_TOPPLE_FRACTION = 0.55
const DEATH_BURST_FRACTION = 0.5
const DEATH_SWEEP_FRACTION = 0.72
const SHAKE_TICKS = 10
const SHAKE_AMPLITUDE = 0.26
/** Local weapon muzzles, in pre-scale miniature space (the figure faces +Z). */
const MUZZLE_OFFSETS: Readonly<Record<MiniatureArchetype, readonly [number, number, number]>> = {
  friendly: [0.23, 0.64, 0.42],
  enemy: [0.31, 0.9, 0.3],
  elite: [0.32, 1.72, 0.1],
}
// Pooled particle tints, allocated once. `ParticlePool.spawn` copies out of them, so no
// colour object is ever created per event.
const SCRAP_TINTS: Readonly<Record<MiniatureArchetype, THREE.Color>> = {
  friendly: new THREE.Color(0xf0e2c6),
  enemy: new THREE.Color(0xc9aef0),
  elite: new THREE.Color(0xe6cdff),
}
const TEAM_TRACERS: Readonly<Record<'teal' | 'scarlet' | 'enemy', THREE.Color>> = {
  teal: new THREE.Color(0x9ff2ea),
  scarlet: new THREE.Color(0xffc39a),
  enemy: new THREE.Color(0xd7b0ff),
}
const MUZZLE_SMOKE = new THREE.Color(0xfff2d8)
const MUZZLE_FLASH = new THREE.Color(0xffe08a)
const DEATH_DUST = new THREE.Color(0xd8c39a)
const IMPACT_EMBER = new THREE.Color(0xff8a52)
const IMPACT_SCRAP = new THREE.Color(0xf3d8b6)
const TELEGRAPH_SIGIL_COLOR = 0xff6a48
const RESCUE_GOLD = 0xffb52e
// A narrow beam rather than a column: the token has to point at the two miniatures in
// the carry, not stand in front of them.
const RESCUE_PILLAR_RADIUS = 0.34
const RESCUE_PILLAR_HEIGHT = 2.8

export function createHybridRenderer(): HybridGameRenderer { return new ThreeHybridRenderer() }

class ThreeHybridRenderer implements HybridGameRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private scene: THREE.Scene | null = null
  private camera: THREE.OrthographicCamera | null = null
  private assets: CardboardAssets | null = null
  private diorama: DioramaAssets | null = null
  private props: TerrainProps | null = null
  private fx: CombatFxAssets | null = null
  private surfaceDecals: SurfaceDecals | null = null
  private frameRails: THREE.Mesh[] = []
  /** Animation clock in ticks. Monotonic within a battle, frozen while the sim is. */
  private clock = 0
  private lastEventTick = Number.NEGATIVE_INFINITY
  private shakeStart = Number.NEGATIVE_INFINITY
  private shakeOffsetX = 0
  private shakeOffsetZ = 0
  private shakeMagnitude = 0
  private shakeCount = 0
  private attacksObserved = 0
  private hitsObserved = 0
  private deathsObserved = 0
  private readonly telegraphs = new Map<number, TelegraphTrack>()
  /**
   * Cosmetic-only jitter for burst directions and sizes. Its own renderer-side seed —
   * never an authority PRNG, never the state digest — so nothing it produces can move
   * the simulation, and the whole system stays inside the display layer.
   */
  private readonly fxRandom = cosmeticRandom(FX_COSMETIC_SEED ^ 0x632be5ab)
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

  render(snapshot: RenderSnapshot, alpha: number): void {
    if (this.disposed || !this.scene || !this.camera || !this.assets) return
    this.snapshot = snapshot
    // The lab comparison drives this same renderer with an origin-centred fixture that
    // has no `activeSquad`; only the gameplay authority publishes one. Reading that
    // signal keeps the lab on its cardboard cards without a second renderer.
    if (!this.diorama && snapshot.activeSquad !== undefined) this.applyDioramaPresentation(snapshot)
    // The animation clock *is* the snapshot clock: whole ticks from the authority plus
    // the controller's interpolation fraction. It never runs faster than the
    // simulation, it stops dead when the battle is paused, and it cannot accumulate a
    // backlog while the tab is hidden.
    this.clock = snapshot.tick + clamp01(alpha)
    const elapsedTicks = snapshot.tick - this.lastEventTick
    // A resume, a restart or a long stall lands many ticks at once. Those frames resync
    // the diff state silently instead of detonating every event that was skipped.
    const spawnEvents = this.diorama !== null && elapsedTicks > 0 && elapsedTicks <= EVENT_CATCHUP_TICKS
    // A restart rewinds the authority clock. Everything the renderer scheduled against
    // the old clock — bursts, the shake, the telegraph countdown — has to go with it,
    // or a burst born at tick 500 reappears when the new battle reaches tick 500.
    if (snapshot.tick < this.lastEventTick) this.resetActionState()
    this.updateCameraBounds(snapshot)
    const unitIds = new Set(snapshot.units.map((unit) => unit.id))
    snapshot.units.forEach((unit) => this.renderUnit(unit, snapshot, spawnEvents))
    this.units.forEach((visual, id) => { if (!unitIds.has(id)) this.removeVisual(this.units, id, visual) })
    const effectIds = new Set(snapshot.effects.map((effect) => effect.id))
    snapshot.effects.forEach((effect) => this.renderEffect(effect))
    this.effects.forEach((visual, id) => {
      if (effectIds.has(id)) return
      if (visual.kind === 'elite-telegraph') this.resolveTelegraphImpact(id, spawnEvents)
      this.removeVisual(this.effects, id, visual)
    })
    if (this.fx && this.camera) {
      this.fx.puffs.update(this.clock, this.camera.quaternion)
      this.fx.scraps.update(this.clock, this.camera.quaternion)
    }
    if (snapshot.tick !== this.lastEventTick) this.lastEventTick = snapshot.tick
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
    // The action-feedback pools ride the same ladder: a reduced budget claims fewer
    // slots per burst instead of dropping bursts entirely.
    this.fx?.puffs.setBudget(profile.particleScale)
    this.fx?.scraps.setBudget(profile.particleScale)
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
    this.telegraphs.clear()
    this.surfaceDecals?.dispose(); this.surfaceDecals = null
    this.props?.dispose(); this.props = null
    this.fx?.dispose(); this.fx = null
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
      action: this.describeAction(),
    }
  }

  /**
   * A screenshot proves an effect exists; these counters prove it *runs*. The cumulative
   * three (`attacksObserved` / `hitsObserved` / `deathsObserved`) only ever move when a
   * snapshot delta fires an animation, and the instantaneous ones sample the frame that
   * is on screen right now.
   */
  private describeAction(): HybridVisualState['action'] {
    const visuals = [...this.units.values()]
    const lunging = visuals.filter((visual) => visual.anim.lungeOffset > 1e-4)
    const flashing = visuals.filter((visual) => visual.anim.flash > 1e-4)
    const effects = [...this.effects.values()]
    const rescue = effects.filter((visual) => visual.kind === 'rescue-signal' && visual.pillar !== undefined)
    const telegraphs = effects.filter((visual) => visual.kind === 'elite-telegraph')
    const sigil = telegraphs.find((visual) => visual.sigil)?.sigil
    const track = [...this.telegraphs.values()][0]
    return {
      clockTicks: this.clock,
      lungingUnits: lunging.length,
      maxLungeOffset: lunging.reduce((max, visual) => Math.max(max, visual.anim.lungeOffset), 0),
      flashingUnits: flashing.length,
      maxFlash: flashing.reduce((max, visual) => Math.max(max, visual.anim.flash), 0),
      topplingUnits: visuals.filter((visual) => visual.anim.dead && !visual.anim.buried).length,
      buriedUnits: visuals.filter((visual) => visual.anim.buried).length,
      attacksObserved: this.attacksObserved,
      hitsObserved: this.hitsObserved,
      deathsObserved: this.deathsObserved,
      livePuffs: this.fx?.puffs.live ?? 0,
      liveScraps: this.fx?.scraps.live ?? 0,
      particleCapacity: (this.fx?.puffs.capacity ?? 0) + (this.fx?.scraps.capacity ?? 0),
      rescuePillars: rescue.length,
      rescueRingSpinRadians: rescue[0]?.ring?.rotation.z ?? 0,
      cameraShakes: this.shakeCount,
      cameraShakeOffset: this.shakeMagnitude,
      telegraphSigils: telegraphs.filter((visual) => visual.sigil !== undefined).length,
      telegraphPulse: sigil ? (sigil.material as THREE.MeshBasicMaterial).opacity : 0,
      telegraphCountdown01: track && track.longest > 0 ? clamp01(1 - track.remaining / track.longest) : 0,
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
      surfaceDecalMeshes: this.surfaceDecals?.mesh.parent ? 1 : 0,
      surfaceDecals: this.surfaceDecals?.placements.length ?? 0,
      surfaceDecalFlat: this.decalsLieOnTheBoard(),
      surfaceDecalsWithinPlayArea: this.decalsWithinPlayArea(),
      surfaceDecalCastsShadow: this.surfaceDecals?.mesh.castShadow ?? false,
    }
  }

  /**
   * Every decal vertex has to face straight up and sit on the board's paint layer. A
   * mark that stood up off the surface would start reading as a prop with a silhouette,
   * which is exactly what board paint must never do.
   */
  private decalsLieOnTheBoard(): boolean {
    const geometry = this.surfaceDecals?.mesh.geometry
    if (!geometry) return false
    const position = geometry.attributes.position as THREE.BufferAttribute
    const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined
    if (!normal) return false
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getY(index) - DECAL_HEIGHT) > 1e-5) return false
      if (Math.abs(normal.getY(index) - 1) > 1e-4) return false
    }
    return true
  }

  /** The decals are paint, not scenery: no mark may reach past the play area. */
  private decalsWithinPlayArea(): boolean {
    const decals = this.surfaceDecals
    const camera = this.snapshot?.camera
    if (!decals || !camera) return false
    const halfWidth = camera.worldWidth / 2
    const halfDepth = camera.worldHeight / 2
    return decals.placements.every((placement) => {
      // The rotated footprint, not the unrotated one: a turned mark covers more board.
      const extent = surfaceDecalExtent(placement)
      return Math.abs(placement.x - camera.centerX) + extent.halfX <= halfWidth + 1e-6
        && Math.abs(placement.z - camera.centerY) + extent.halfZ <= halfDepth + 1e-6
    })
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

    // Action feedback: the two pooled particle systems and the textures the sigil, the
    // rescue token and the board decals are painted with. Built once, never per event.
    const fx = createCombatFxAssets()
    this.fx = fx
    this.scene.add(fx.puffs.mesh, fx.scraps.mesh)

    // Flat paint *inside* the play area: scorch craters, chalk deployment boxes and
    // rules, boot wear and drag streaks. Every mark lies on the board, throws no shadow
    // and catches none, and none of it is ever seen by the prop placer that owns the
    // collision-free scenery outside the rail — so it cannot be read as a prop.
    //
    // All of it merges into a single vertex-coloured mesh: one draw call for the whole
    // set, and it is built once from the play-area bounds the snapshot publishes.
    this.surfaceDecals = createSurfaceDecals(snapshot.camera)
    this.surfaceDecals.mesh.name = SURFACE_DECAL_NAME
    this.scene.add(this.surfaceDecals.mesh)

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

  private renderUnit(unit: RenderUnit, snapshot: RenderSnapshot, spawnEvents: boolean): void {
    if (!this.scene || !this.camera || !this.assets) return
    const activeSquad = snapshot.activeSquad
    let visual = this.units.get(unit.id)
    if (!visual) visual = this.diorama ? this.createMiniature(unit) : this.createCard(unit)
    const downed = unit.state === 'downed'
    const marksActiveSquad = activeSquad !== undefined && unit.squad === activeSquad
    visual.root.position.set(unit.x, 0, unit.y); visual.root.scale.setScalar(cardScale(unit))
    visual.shadow.visible = !downed
    if (this.diorama) {
      // Diff this unit against the last snapshot *before* drawing it, so the hit it just
      // took and the lunge of whoever landed it both play on the same frame.
      this.trackUnit(unit, visual, snapshot, spawnEvents)
      this.applyActionFeedback(unit, visual, snapshot, downed, marksActiveSquad)
      return
    }
    visual.card.quaternion.copy(this.camera.quaternion)
    visual.marker.visible = isLeader(unit) || downed || marksActiveSquad
    ;(visual.marker.material as THREE.MeshBasicMaterial).color.setHex(markerColor(unit, marksActiveSquad))
    // A downed card is laid across the tabletop and dropped towards it, so it reads
    // as a fallen counter rather than a standing one that happens to be rotated.
    visual.card.rotation.z = downed ? Math.PI / 2 : 0
    visual.card.position.y = downed ? DOWNED_CARD_HEIGHT : STANDING_CARD_HEIGHT
  }

  /**
   * Turns two consecutive snapshots into the action events the diorama animates. The
   * authority publishes no events at all, so a *drop in hit points* is the hit, the
   * nearest hostile that is currently attacking is the attacker, and a unit reaching
   * zero (an enemy) or being marked `dead` (a friendly, after its downed timer) is the
   * death. Nothing written here is ever read back by the simulation.
   */
  private trackUnit(unit: RenderUnit, visual: UnitVisual, snapshot: RenderSnapshot, spawnEvents: boolean): void {
    const anim = visual.anim
    const dead = isUnitDead(unit)
    if (spawnEvents) {
      if (dead && !anim.dead) this.beginDeath(unit, visual)
      else if (!dead && !anim.dead && unit.hp01 < anim.hp01 - 1e-6) this.registerDamage(unit, visual, snapshot, anim.hp01 - unit.hp01)
    }
    if (dead && !anim.dead) {
      // Resync frames (a resume, a long stall) adopt the death silently, already swept away.
      anim.dead = true
      anim.deathStart = Number.NEGATIVE_INFINITY
    } else if (!dead && anim.dead) {
      // `restart()` rebuilds the roster under the same ids without rebuilding the
      // renderer, so a swept-away figure has to be able to come back standing.
      anim.dead = false
      anim.buried = false
      anim.deathStart = Number.NEGATIVE_INFINITY
      anim.deathFromTopple = 0
    }
    // Facing is renderer-derived: the authority reports `facingRadians` as 0 for every
    // unit, so a figure that never turned would slide sideways into its own fight. It
    // heads where it is walking, unless it is still holding aim on its last target.
    if (!anim.dead && this.clock >= anim.aimUntil) {
      const dx = unit.x - anim.x
      const dz = unit.y - anim.y
      if (dx * dx + dz * dz > 4e-4) anim.yaw = approachAngle(anim.yaw, Math.atan2(dx, dz), 0.32)
    }
    anim.hp01 = unit.hp01
    anim.x = unit.x
    anim.y = unit.y
  }

  /** Draws one miniature with its lunge, recoil, paint flash and topple applied. */
  private applyActionFeedback(unit: RenderUnit, visual: UnitVisual, snapshot: RenderSnapshot, downed: boolean, marksActiveSquad: boolean): void {
    const anim = visual.anim
    const death = anim.dead ? (anim.deathStart === Number.NEGATIVE_INFINITY ? 1 : clamp01((this.clock - anim.deathStart) / DEATH_TICKS)) : 0
    anim.buried = anim.dead && death >= 1

    const lungeAge = this.clock - anim.lungeStart
    const lunge = !anim.dead && lungeAge >= 0 && lungeAge < LUNGE_TICKS ? lungeCurve(lungeAge / LUNGE_TICKS) : 0
    anim.lungeOffset = lunge * LUNGE_DISTANCE

    const hitAge = this.clock - anim.hitStart
    const hit = hitAge >= 0 && hitAge < HIT_TICKS ? (1 - hitAge / HIT_TICKS) ** 2.2 : 0
    anim.flash = hit

    // The lunge and the recoil move the *figure inside its base*, never the unit root:
    // the root stays exactly where the authority put it, which is what keeps the
    // diagnostics, the framing guarantee and the ring footprint honest.
    visual.card.position.set(
      anim.lungeX * anim.lungeOffset + anim.hitX * hit * HIT_RECOIL,
      0,
      anim.lungeZ * anim.lungeOffset + anim.hitZ * hit * HIT_RECOIL,
    )
    visual.card.rotation.set(-lunge * LUNGE_PITCH, anim.yaw, 0)
    const topple = downed ? 1 : anim.dead
      ? anim.deathFromTopple + (1 - anim.deathFromTopple) * easeTopple(Math.min(1, death / DEATH_TOPPLE_FRACTION))
      : 0
    visual.card.rotation.z = topple * (Math.PI / 2)
    visual.card.position.y = topple * DOWNED_FIGURE_HEIGHT
    const sweep = anim.dead ? 1 - smoothstep(DEATH_SWEEP_FRACTION, 1, death) : 1
    visual.card.scale.setScalar(sweep)
    visual.card.visible = !anim.buried
    visual.shadow.visible = !downed && !anim.buried
    ;(visual.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * sweep

    // A struck figure flashes bright rather than changing paint, so the faction read
    // never wobbles: the tint stays exactly what `miniaturePaint` chose.
    const material = visual.card.material as THREE.MeshLambertMaterial
    material.emissiveIntensity = hit * FLASH_PEAK * anim.flashScale

    // Every unit wears a base ring in the diorama; the colour is what carries the read.
    visual.marker.visible = true
    const markerMaterial = visual.marker.material as THREE.MeshBasicMaterial
    markerMaterial.color.setHex(dioramaRingColor(unit, marksActiveSquad))
    const ringOpacity = marksActiveSquad && !downed
      ? RING_BASE_OPACITY + RING_PULSE_AMPLITUDE * Math.sin((snapshot.tick / RING_PULSE_TICKS) * Math.PI * 2)
      : RING_BASE_OPACITY - RING_PULSE_AMPLITUDE
    markerMaterial.opacity = ringOpacity * sweep
  }

  private beginDeath(unit: RenderUnit, visual: UnitVisual): void {
    const anim = visual.anim
    anim.dead = true
    anim.deathStart = this.clock
    // A friendly that bleeds out is already lying on its side; an enemy shot on its feet
    // starts upright. Reading the tilt back off the figure covers both without a flag.
    anim.deathFromTopple = clamp01(visual.card.rotation.z / (Math.PI / 2))
    anim.lungeStart = Number.NEGATIVE_INFINITY
    this.deathsObserved += 1
    this.spawnDeathBurst(unit, DEATH_TICKS * DEATH_BURST_FRACTION)
  }

  /**
   * A unit lost hit points this tick. The renderer cannot see the authority's damage
   * event, so it attributes the shot to the nearest hostile that is currently in the
   * `attacking` state — which is enough to aim the lunge, the muzzle and the recoil.
   */
  private registerDamage(unit: RenderUnit, visual: UnitVisual, snapshot: RenderSnapshot, damage01: number): void {
    this.hitsObserved += 1
    const anim = visual.anim
    anim.flashScale = FLASH_FLOOR + (1 - FLASH_FLOOR) * clamp01(damage01 * 5)
    const attacker = nearestAttacker(unit, snapshot.units)
    let awayX = 0
    let awayZ = 1
    if (attacker) {
      const dx = unit.x - attacker.x
      const dz = unit.y - attacker.y
      const length = Math.hypot(dx, dz) || 1
      awayX = dx / length
      awayZ = dz / length
      this.beginAttack(attacker, unit, -awayX, -awayZ)
    }
    anim.hitStart = this.clock
    anim.hitX = awayX
    anim.hitZ = awayZ
  }

  private beginAttack(attacker: RenderUnit, target: RenderUnit, dirX: number, dirZ: number): void {
    const visual = this.units.get(attacker.id)
    if (!visual || visual.anim.dead) return
    const anim = visual.anim
    this.attacksObserved += 1
    anim.lungeStart = this.clock
    anim.lungeX = dirX
    anim.lungeZ = dirZ
    anim.yaw = Math.atan2(dirX, dirZ)
    anim.aimUntil = this.clock + AIM_HOLD_TICKS
    this.spawnMuzzleBurst(attacker, target, dirX, dirZ)
  }

  /** A cotton puff at the weapon, plus three beads walking down the line of fire. */
  private spawnMuzzleBurst(attacker: RenderUnit, target: RenderUnit, dirX: number, dirZ: number): void {
    const fx = this.fx
    if (!fx) return
    const [localX, localY, localZ] = MUZZLE_OFFSETS[miniatureArchetype(attacker)]
    const scale = cardScale(attacker) * FIGURE_SCALE
    const sin = dirX
    const cos = dirZ
    const muzzleX = attacker.x + (localX * cos + localZ * sin) * scale
    const muzzleZ = attacker.y + (-localX * sin + localZ * cos) * scale
    const muzzleY = localY * scale
    const now = this.clock
    fx.puffs.spawn(now, { x: muzzleX, y: muzzleY, z: muzzleZ, vx: dirX * 0.03, vy: 0.014, vz: dirZ * 0.03, life: 8, startSize: 0.5, endSize: 1.3, color: MUZZLE_SMOKE })
    fx.puffs.spawn(now, { x: muzzleX + dirX * 0.2, y: muzzleY + 0.04, z: muzzleZ + dirZ * 0.2, vx: dirX * 0.05, vy: 0.02, vz: dirZ * 0.05, life: 4, startSize: 0.9, endSize: 0.24, color: MUZZLE_FLASH })
    const dx = target.x - muzzleX
    const dz = target.y - muzzleZ
    if (Math.hypot(dx, dz) < 1.4) return
    const tracer = TEAM_TRACERS[attacker.team]
    for (let index = 1; index <= 4; index += 1) {
      const t = index / 5
      fx.puffs.spawn(now + index * 0.55, {
        x: muzzleX + dx * t, y: muzzleY * (1 - t) + 0.85 * t, z: muzzleZ + dz * t,
        vx: 0, vy: 0, vz: 0, life: 3, startSize: 0.4, endSize: 0.1, color: tracer,
      })
    }
  }

  /** Paper scraps, delayed so the figure gets to topple before it comes apart. */
  private spawnDeathBurst(unit: RenderUnit, delayTicks: number): void {
    const fx = this.fx
    if (!fx) return
    const archetype = miniatureArchetype(unit)
    const tint = SCRAP_TINTS[archetype]
    const burstAt = this.clock + delayTicks
    const count = unit.kind === 'elite' ? 22 : 14
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + this.fxRandom() * 0.7
      const speed = 0.045 + this.fxRandom() * 0.09
      const size = 0.22 + this.fxRandom() * 0.19
      fx.scraps.spawn(burstAt, {
        x: unit.x, y: 0.3 + this.fxRandom() * 0.75, z: unit.y,
        vx: Math.cos(angle) * speed, vy: 0.095 + this.fxRandom() * 0.13, vz: Math.sin(angle) * speed,
        life: 22 + this.fxRandom() * 15, startSize: size, endSize: size,
        gravity: 0.011, drag: 0.32, spin: 0.13 + this.fxRandom() * 0.22, color: tint,
      })
    }
    for (let index = 0; index < 4; index += 1) {
      const angle = this.fxRandom() * Math.PI * 2
      fx.puffs.spawn(burstAt, {
        x: unit.x + Math.cos(angle) * 0.2, y: 0.12, z: unit.y + Math.sin(angle) * 0.2,
        vx: Math.cos(angle) * 0.03, vy: 0.006, vz: Math.sin(angle) * 0.03,
        life: 9, startSize: 0.4, endSize: 1.2, color: DEATH_DUST,
      })
    }
  }

  /**
   * The telegraph vanishing from the snapshot *is* the impact: the authority clears its
   * centre on the damage tick. A telegraph that still had time on the clock was
   * cancelled instead (the elite died mid-warning) and must not shake the camera.
   */
  private resolveTelegraphImpact(id: number, spawnEvents: boolean): void {
    const track = this.telegraphs.get(id)
    this.telegraphs.delete(id)
    if (!track || !spawnEvents || !this.fx || track.remaining > 2) return
    this.shakeStart = this.clock
    this.shakeCount += 1
    for (let index = 0; index < 16; index += 1) {
      const angle = (index / 16) * Math.PI * 2
      const radius = track.radius * (0.55 + this.fxRandom() * 0.5)
      this.fx.puffs.spawn(this.clock, {
        x: track.x + Math.cos(angle) * radius, y: 0.16, z: track.z + Math.sin(angle) * radius,
        vx: Math.cos(angle) * 0.05, vy: 0.02, vz: Math.sin(angle) * 0.05,
        life: 11, startSize: 0.4, endSize: 1.5, color: IMPACT_EMBER,
      })
    }
    for (let index = 0; index < 8; index += 1) {
      const angle = this.fxRandom() * Math.PI * 2
      const speed = 0.06 + this.fxRandom() * 0.1
      this.fx.scraps.spawn(this.clock, {
        x: track.x, y: 0.25, z: track.z,
        vx: Math.cos(angle) * speed, vy: 0.13 + this.fxRandom() * 0.1, vz: Math.sin(angle) * speed,
        life: 24 + this.fxRandom() * 12, startSize: 0.22, endSize: 0.22,
        gravity: 0.011, drag: 0.3, spin: 0.2, color: IMPACT_SCRAP,
      })
    }
  }

  private resetActionState(): void {
    this.fx?.puffs.clear()
    this.fx?.scraps.clear()
    this.telegraphs.clear()
    this.shakeStart = Number.NEGATIVE_INFINITY
    this.shakeOffsetX = 0; this.shakeOffsetZ = 0; this.shakeMagnitude = 0
    this.units.forEach((visual) => {
      visual.anim.lungeStart = Number.NEGATIVE_INFINITY
      visual.anim.hitStart = Number.NEGATIVE_INFINITY
      visual.anim.aimUntil = Number.NEGATIVE_INFINITY
    })
  }

  private updateShake(): void {
    const age = this.clock - this.shakeStart
    if (!(age >= 0 && age < SHAKE_TICKS)) {
      this.shakeOffsetX = 0; this.shakeOffsetZ = 0; this.shakeMagnitude = 0
      return
    }
    // A short, hard, decaying pan. It is bounded well inside the framing margin, so a
    // shake can never push a unit standing on the arena boundary out of frame.
    const decay = (1 - age / SHAKE_TICKS) ** 2
    this.shakeOffsetX = Math.sin(age * 2.9 + 0.7) * SHAKE_AMPLITUDE * decay
    this.shakeOffsetZ = Math.cos(age * 4.1) * SHAKE_AMPLITUDE * decay * 0.6
    this.shakeMagnitude = Math.hypot(this.shakeOffsetX, this.shakeOffsetZ)
  }

  private createCard(unit: RenderUnit): UnitVisual {
    const assets = this.assets!
    const root = new THREE.Group(); root.name = `unit:${unit.id}`
    const shadow = new THREE.Mesh(assets.shadowGeometry, flatMaterial(0x000000, 0.28)); shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.012, 0); shadow.receiveShadow = true
    const card = new THREE.Mesh(assets.unitGeometry, cardboardMaterial(unit.team, assets.unitTexture)); card.position.y = STANDING_CARD_HEIGHT; card.castShadow = true
    const marker = new THREE.Mesh(assets.markerGeometry, flatMaterial(LEADER_MARKER_COLOR)); marker.rotation.x = -Math.PI / 2; marker.position.y = 0.025
    root.add(shadow, card, marker); this.scene!.add(root)
    const visual: UnitVisual = { root, card, shadow, marker, anim: createUnitAnim(unit) }
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

    // `emissive` is what a hit flash rides on: raising `emissiveIntensity` for a few
    // ticks brightens the figure without touching the faction paint underneath it.
    const card = new THREE.Mesh(assets.miniatures[archetype], new THREE.MeshLambertMaterial({ color: miniaturePaint(unit), vertexColors: true, emissive: FLASH_COLOR, emissiveIntensity: 0 }))
    card.name = `miniature:${archetype}`
    card.castShadow = true

    const marker = new THREE.Mesh(assets.baseRingGeometry, flatMaterial(LEADER_MARKER_COLOR, RING_BASE_OPACITY))
    marker.rotation.x = -Math.PI / 2; marker.position.y = 0.03
    if (leader) marker.scale.setScalar(LEADER_RING_SCALE)

    root.add(shadow, card, marker); this.scene!.add(root)
    const anim = createUnitAnim(unit)
    // A unit that is already gone when its visual is built (a renderer remounted mid
    // battle) is adopted as buried rather than replayed as a fresh death.
    if (isUnitDead(unit)) { anim.dead = true; anim.deathStart = Number.NEGATIVE_INFINITY; anim.deathFromTopple = 1 }
    const visual: UnitVisual = { root, card, shadow, marker, anim }
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
      const radius = effect.radius ?? 1
      const area = visual.root.children[0]
      // The ring is the assertion surface for the authoritative footprint: it is scaled
      // to exactly `effect.radius` and never breathes, so the warning can never lie
      // about how much ground the strike covers. The pulse rides on colour and on the
      // sigil disc above it instead.
      if (area) area.scale.setScalar(radius)
      this.animateTelegraph(visual, effect, radius)
      return
    }
    if (visual.kind === 'rescue-signal' && visual.pillar) {
      this.animateRescueToken(visual)
      return
    }
    visual.root.quaternion.copy(this.camera.quaternion)
  }

  /**
   * The elite warning: a hard red hazard ring at the authoritative radius, a rotating
   * sigil painted on the board inside it, and a filling disc that runs the authority's
   * own countdown (`durationTicks` ticking down towards the strike).
   */
  private animateTelegraph(visual: EffectVisual, effect: RenderEffect, radius: number): void {
    const track = this.telegraphs.get(effect.id) ?? { remaining: effect.durationTicks, longest: effect.durationTicks, x: effect.x, z: effect.y, radius }
    track.remaining = effect.durationTicks
    track.longest = Math.max(track.longest, effect.durationTicks)
    track.x = effect.x; track.z = effect.y; track.radius = radius
    this.telegraphs.set(effect.id, track)

    const countdown01 = track.longest > 0 ? clamp01(1 - effect.durationTicks / track.longest) : 0
    // Faster as the strike nears, so the warning reads as urgent rather than decorative.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * (0.35 + countdown01 * 0.55))
    const area = visual.root.children[0] as THREE.Mesh | undefined
    if (area) (area.material as THREE.MeshBasicMaterial).opacity = 0.4 + pulse * 0.45
    if (visual.sigil) {
      visual.sigil.scale.setScalar(radius)
      visual.sigil.rotation.z = -this.clock * 0.035
      ;(visual.sigil.material as THREE.MeshBasicMaterial).opacity = 0.42 + pulse * 0.45
    }
    if (visual.countdown) {
      visual.countdown.scale.setScalar(Math.max(0.001, radius * countdown01))
      ;(visual.countdown.material as THREE.MeshBasicMaterial).opacity = 0.18 + countdown01 * 0.3
    }
  }

  /** The gold token: a dashed ring on the board, a light pillar, and a rising halo. */
  private animateRescueToken(visual: EffectVisual): void {
    if (visual.ring) visual.ring.rotation.z = this.clock * 0.055
    if (visual.pillar) {
      // Restrained on purpose: additively blended gold over a dark board saturates fast,
      // and a hot column swallows the two miniatures the token is meant to point at.
      const breathe = 0.85 + 0.15 * Math.sin(this.clock * 0.28)
      visual.pillar.scale.set(RESCUE_PILLAR_RADIUS * breathe, RESCUE_PILLAR_HEIGHT, RESCUE_PILLAR_RADIUS * breathe)
      visual.pillar.rotation.y = -this.clock * 0.04
      ;(visual.pillar.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.1 * breathe
    }
    if (visual.halo) {
      const rise = ((this.clock * 0.05) % 1 + 1) % 1
      visual.halo.position.y = 0.08 + rise * (RESCUE_PILLAR_HEIGHT * 0.9)
      visual.halo.scale.setScalar(1.5 + rise * 1.2)
      visual.halo.rotation.z = -this.clock * 0.08
      ;(visual.halo.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - rise) ** 1.4
    }
  }

  private createEffectVisual(effect: RenderEffect): EffectVisual {
    const root = new THREE.Group(); root.name = `effect:${effect.kind}:${effect.id}`
    const fx = this.fx
    let visual: EffectVisual
    if (effect.kind === 'elite-telegraph') {
      const area = new THREE.Mesh(this.telegraphGeometry!, flatMaterial(this.diorama ? TELEGRAPH_SIGIL_COLOR : TELEGRAPH_COLOR, 0.42))
      area.rotation.x = -Math.PI / 2; area.position.y = 0.02
      root.add(area)
      if (fx) {
        const countdown = new THREE.Mesh(fx.discGeometry, new THREE.MeshBasicMaterial({ color: 0xb01f16, transparent: true, opacity: 0.2, depthWrite: false }))
        countdown.rotation.x = -Math.PI / 2; countdown.position.y = 0.014; countdown.renderOrder = 1
        const sigil = new THREE.Mesh(fx.discGeometry, new THREE.MeshBasicMaterial({ map: fx.sigilTexture, color: TELEGRAPH_SIGIL_COLOR, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
        sigil.rotation.x = -Math.PI / 2; sigil.position.y = 0.024; sigil.renderOrder = 2
        root.add(countdown, sigil)
        visual = { root, kind: effect.kind, sigil, countdown }
      } else {
        visual = { root, kind: effect.kind }
      }
    } else if (effect.kind === 'rescue-signal' && fx) {
      const ring = new THREE.Mesh(fx.quadGeometry, new THREE.MeshBasicMaterial({ map: fx.rescueRingTexture, color: RESCUE_GOLD, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }))
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.scale.setScalar(2.6); ring.renderOrder = 2
      const pillar = new THREE.Mesh(fx.pillarGeometry, new THREE.MeshBasicMaterial({ map: fx.pillarTexture, color: RESCUE_GOLD, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }))
      pillar.position.y = RESCUE_PILLAR_HEIGHT / 2; pillar.scale.set(RESCUE_PILLAR_RADIUS, RESCUE_PILLAR_HEIGHT, RESCUE_PILLAR_RADIUS); pillar.renderOrder = 3
      const halo = new THREE.Mesh(fx.quadGeometry, new THREE.MeshBasicMaterial({ map: fx.rescueRingTexture, color: 0xffe6ae, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }))
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.08; halo.scale.setScalar(1.5); halo.renderOrder = 3
      root.add(ring, pillar, halo)
      visual = { root, kind: effect.kind, ring, pillar, halo }
    } else {
      const ring = new THREE.Mesh(this.assets!.effectGeometry, flatMaterial(effect.team ? TEAM_TINTS[effect.team] : 0xf5dc79))
      ring.position.y = effect.kind === 'rescue-signal' ? 1.4 : 0.08
      root.add(ring)
      visual = { root, kind: effect.kind }
    }
    this.scene!.add(root)
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
    // The elite's area strike shakes the table. It is a pure pan — position and target
    // move together — so the staged pitch and the framing guarantee are untouched.
    this.updateShake()
    this.camera.position.set(
      centerX + this.shakeOffsetX,
      DIORAMA_CAMERA_DISTANCE * Math.sin(pitch),
      centerY + this.shakeOffsetZ + DIORAMA_CAMERA_DISTANCE * Math.cos(pitch),
    )
    this.camera.lookAt(centerX + this.shakeOffsetX, 0, centerY + this.shakeOffsetZ)
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

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Out hard, back soft: the punch reads on the way in, the settle on the way out. */
function lungeCurve(t: number): number {
  return Math.sin(Math.PI * t ** 0.55)
}

/** A topple that falls fast and stops dead against the board. */
function easeTopple(t: number): number {
  return 1 - (1 - t) ** 2.4
}

/** Shortest-arc approach, so a figure never spins the long way round to face a target. */
function approachAngle(from: number, to: number, rate: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * rate
}

/**
 * A unit the authority has finished with. Fallen enemies are never removed from the
 * roster — they keep being published at zero hit points — while a friendly is only
 * `dead` once its downed timer has run out (it reads zero hit points the whole time it
 * is down, and may still be rescued).
 */
function isUnitDead(unit: RenderUnit): boolean {
  return unit.team === 'enemy' ? unit.hp01 <= 0 : unit.state === 'dead'
}

function createUnitAnim(unit: RenderUnit): UnitAnim {
  return {
    yaw: Math.PI / 2 - unit.facingRadians,
    aimUntil: Number.NEGATIVE_INFINITY,
    lungeStart: Number.NEGATIVE_INFINITY,
    lungeX: 0,
    lungeZ: 1,
    lungeOffset: 0,
    hitStart: Number.NEGATIVE_INFINITY,
    hitX: 0,
    hitZ: 1,
    flash: 0,
    flashScale: 1,
    deathStart: Number.NEGATIVE_INFINITY,
    deathFromTopple: 0,
    dead: false,
    buried: false,
    hp01: unit.hp01,
    x: unit.x,
    y: unit.y,
  }
}

function isHostile(left: RenderUnit, right: RenderUnit): boolean {
  return (left.team === 'enemy') !== (right.team === 'enemy')
}

function isStanding(unit: RenderUnit): boolean {
  return unit.team === 'enemy' ? unit.hp01 > 0 : unit.state !== 'dead' && unit.state !== 'downed'
}

/**
 * Who plausibly landed the hit. The authority's damage events never reach the renderer,
 * so the nearest standing hostile that is currently in the `attacking` state is the best
 * available attribution — and it is only ever used to point a lunge, a muzzle puff and a
 * recoil, never to decide anything.
 */
function nearestAttacker(target: RenderUnit, units: readonly RenderUnit[]): RenderUnit | null {
  let best: RenderUnit | null = null
  let bestDistance = ATTRIBUTION_RANGE * ATTRIBUTION_RANGE
  for (const unit of units) {
    if (unit.state !== 'attacking' || !isHostile(unit, target) || !isStanding(unit)) continue
    const dx = unit.x - target.x
    const dz = unit.y - target.y
    const distance = dx * dx + dz * dz
    if (distance >= bestDistance) continue
    bestDistance = distance
    best = unit
  }
  return best
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
