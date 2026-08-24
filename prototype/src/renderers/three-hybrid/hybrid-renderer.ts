import * as THREE from 'three'

import type { RenderEffect, RenderSnapshot, RenderUnit, Squad } from '../../core/types'
import { qualityProfile } from '../../metrics/quality-ladder'
import type { GameRenderer, QualityLevel, RendererMetrics } from '../contract'
import { TEAM_TINTS, cardboardMaterial, createCardboardAssets, disposeObjectMaterials, flatMaterial, type CardboardAssets } from '../three-shared/scene-utils'
import { DECAL_HEIGHT, FX_COSMETIC_SEED, createCombatFxAssets, createSurfaceDecals, surfaceDecalExtent, type CombatFxAssets, type SurfaceDecals } from './combat-fx'
import { FIGURE_SCALE, GAUGE_HEIGHT, cosmeticRandom, createDioramaAssets, createHealthGaugeGeometry, readHealthGaugeFill, setHealthGaugeColor, setHealthGaugeFill, type DioramaAssets, type MiniatureArchetype } from './diorama-assets'
import {
  AIM_RAISE_TICKS, AIM_RELEASE_TICKS, RIG_ARM, RIG_JOINT_COUNT, STRIDE_CYCLE_DISTANCE,
  RIG_TORSO, STRIKE_FIRE_FRACTION, STRIKE_TICKS_COMMAND_MELEE, STRIKE_TICKS_MELEE, STRIKE_TICKS_RANGED,
  createRigInput, createRigMatrices, createRigPose,
  poseFigure, restRigPose, rigMatrices, strideAmount, stridePhase,
} from './figure-rig'
import { DIORAMA_PITCH_RADIANS } from './staging'
import { CLUTTER_FLAT_HEIGHT, CLUTTER_POLE_RADIUS, clutterExtent, clutterFootprintRadius, clutterShape, createTerrainProps, type TerrainProps } from './terrain-props'

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
  /**
   * Where the blow came FROM, in the figure's own frame, frozen at the instant it landed.
   * `figure-rig.ts` splits the flinch into a pitch and a roll off it.
   */
  hitBearing: number
  flash: number
  flashScale: number
  /** §1.11's revive: when the stand-up began, so the lift can ease out of it. */
  reviveStart: number
  deathStart: number
  deathFromTopple: number
  dead: boolean
  buried: boolean
  /** Last snapshot values, so the next snapshot can be diffed into hit / death events. */
  hp01: number
  x: number
  y: number
  /** The fill fraction currently written into the gauge geometry, or -1 for "never written". */
  gaugeFill: number
  // --- Stride, all display-only and all derived from authority positions ------------------
  /** The last authority tick this unit's movement was sampled on. */
  strideTick: number
  /** World distance the authority has moved this unit, summed over ticks. Drives the phase. */
  travel: number
  /** That distance per tick on the last sampled tick. `<= ARRIVE_EPSILON` means settled. */
  step: number
  /** When the current blow's animation began, and whether it was a shot or a blow by hand. */
  strikeStart: number
  strikeRanged: boolean
  /** When the weapon started coming up. Paired with `aimUntil` into a closed-form blend. */
  aimStart: number
}
type UnitVisual = {
  readonly root: THREE.Group
  readonly card: THREE.Mesh
  readonly shadow: THREE.Mesh
  readonly marker: THREE.Mesh
  /**
   * The health gauge, on the diorama only. Its geometry is per-unit — the fill is a vertex
   * position, not a uniform — so `removeVisual` disposes it, unlike every shared geometry.
   */
  readonly gauge?: THREE.Mesh
  /**
   * The rig's joint matrices, on the diorama only. This array IS the `uJoint` uniform value —
   * the body's material holds the same reference — so posing a figure is eight matrix writes
   * and no allocation. `undefined` on the lab's cardboard cards, which have no rig.
   */
  readonly rig?: THREE.Matrix4[]
  readonly archetype?: MiniatureArchetype
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
  /** §정예 예고: the same circle again, painted over whatever is standing on it. */
  readonly overlay?: THREE.Mesh
  /** §1.11 pin light: the beam over a body on the ground, and its ground pool. */
  readonly beam?: THREE.Mesh
  readonly pool?: THREE.Mesh
}
type TelegraphTrack = { remaining: number; longest: number; x: number; z: number; radius: number }
/**
 * The body's material, whichever presentation built it: the lab route paints a flat cardboard
 * card (Lambert), the diorama a sculpted miniature with a specular lobe (Phong). Both carry the
 * faction tint on `color` and the hit flash on `emissiveIntensity`, which is all the shared code
 * below touches.
 */
type TintedBodyMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial

/**
 * Gameplay-facing view of the live scene graph, read straight off the Three objects.
 * Browser tests use it through the dev-only `__SQUADING_TEST__` bridge to check facts
 * a canvas screenshot cannot show — the telegraph's world radius, whether it stays
 * flat on the tabletop, and which squad currently carries the active marker.
 */
export type HybridVisualState = {
  /**
   * The elite's warning, and how much of it a player can actually read (§정예 예고).
   *
   * Batch K lowered the camera to 23 degrees and reported the ring "substantially covered by the
   * bodies standing inside it, with only its left and right arcs readable". That is a PLAY
   * defect: §4.5 asks whether the strike can be dodged, and a warning whose edge cannot be seen
   * cannot be dodged on purpose. The three sample counts below are the measurement of it, taken
   * off rendered pixels rather than off an intention.
   */
  readonly eliteTelegraph: {
    readonly visible: boolean
    readonly radius: number
    readonly normalY: number
    /** Standing bodies whose base is inside the warned circle right now. */
    readonly bodiesInside: number
    /** Whether the over-body outline exists and asks the depth buffer. It must not. */
    readonly overlayDepthTested: boolean | null
    readonly overlayRenderOrder: number | null
  }
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
    /**
     * How much the miniatures hide each other, measured rather than assumed.
     *
     * Lowering the camera (§카메라) buys the figures their sides back and costs occlusion: a body
     * of height `h` hides `h / tan(pitch)` of board behind it. This samples each drawn body's own
     * screen footprint and reports what fraction of it bodies NEARER THE CAMERA cover, so "the
     * back rank is still visible" is a number the suite can hold a ceiling on instead of a claim.
     */
    readonly occlusion: {
      /** Bodies measured — standing, drawn, and inside the frustum. */
      readonly bodies: number
      readonly maxHiddenFraction: number
      readonly meanHiddenFraction: number
      /** Bodies with more than half their footprint behind another body. */
      readonly mostlyHidden: number
      /** Bodies with essentially nothing left on screen (>= 95% covered). */
      readonly fullyHidden: number
    }
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
    /**
     * Which sculpted bodies are actually on the board, by name, sorted. The spec asks for the
     * CLASS to be readable from the silhouette, and a count of distinct geometries cannot tell
     * "five classes, five bodies" from "five classes sharing two bodies and some paint".
     */
    readonly bodyArchetypes: readonly string[]
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
   * §판 안 지형 소품, as facts rather than as a screenshot.
   *
   * The board clutter is the one thing in this batch that could actively mislead a player: §1.6
   * removed cover, and a prop on the board that looks like it shelters a body is a promise the
   * simulation will break. Three numbers carry the answer — every piece is inside the play area
   * (it is board dressing, not a second surround), every piece obeys the shape rule that makes
   * it walk-through, and units are ACTUALLY SEEN standing inside a piece's footprint, which is
   * the fastest way a player learns it is not cover.
   */
  readonly fieldClutter: {
    readonly items: number
    readonly allInsidePlayArea: boolean
    /** Pieces whose built geometry breaks the flat-or-thin rule. Zero, or the rule is a lie. */
    readonly shapeViolations: number
    readonly tallestFlatPiece: number
    readonly widestPole: number
    /** Live units whose centre is inside some piece's footprint right now. */
    readonly unitsOverlappingClutter: number
  }
  /**
   * The health gauges, as counted off the live scene graph.
   *
   * A screenshot shows bars; these numbers show that the bars mean something — that every
   * friendly has one, that an untouched hostile has none, that a downed body has none, and
   * that the fill is the snapshot's `hp01` rather than a number of its own.
   */
  readonly healthGauges: {
    readonly visible: number
    /** Friendly bodies that are neither downed nor dead — the spec's "always shown" set. */
    readonly friendlyStanding: number
    readonly friendlyVisible: number
    readonly hostileFull: number
    readonly hostileFullVisible: number
    readonly hostileDamaged: number
    readonly hostileDamagedVisible: number
    readonly downed: number
    readonly downedVisible: number
    readonly billboarded: number
    /** Largest gap between a drawn fill and the `hp01` it claims to be. */
    readonly maxFillError: number
    /** Smallest clearance between a drawn bar and the top of the body under it. */
    readonly minHeadroom: number
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
    /**
     * Whether the last snapshot carried the authority's own account of the tick
     * (`RenderSnapshot.actionEvents`), or the renderer had to infer blows from `hp01` deltas.
     * `false` on the v1 gameplay route and in the `?lab=renderers` fixture, by construction.
     */
    readonly authoredEvents: boolean
    /** Action events consumed since mount. Zero while the account is absent. */
    readonly eventsPlayed: number
    /** Gun bursts fired. §액션 피드백's 솜뭉치 퍼프 — a melee blow must never add to this. */
    readonly muzzleBursts: number
    /** Dust at the point of a melee contact, which is what a fist gets instead of a muzzle. */
    readonly contactBursts: number
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
    // --- The stride (batch M) ---------------------------------------------------------
    /** Standing figures whose legs are swinging this frame. */
    readonly stridingUnits: number
    /** Standing figures inside §1.4's dead-band, legs at rest. */
    readonly settledUnits: number
    /** The fastest cadence on the board, in stride cycles per tick. */
    readonly maxCadence: number
    /** Live figures with a strike animation running: a raised rifle or a swung cleaver. */
    readonly strikingUnits: number
    /** How far the busiest weapon carriage is from its sculpted rest, in radians. */
    readonly maxWeaponAngle: number
  }
}

/**
 * How much of the elite's warning survives the bodies standing on it, measured off PIXELS.
 *
 * A SEPARATE CALL from `getVisualState`, and the separation is not tidiness: the reading is taken
 * by rendering the scene three times into an offscreen target and reading the framebuffer back,
 * which costs tens of milliseconds. `getVisualState` is polled in loops by half the browser
 * suite, and burying this inside it would have made every one of those loops pay for it on every
 * frame a warning happened to be up.
 */
export type TelegraphLegibility = {
  /** Points taken evenly around the circumference that were in view. */
  readonly samples: number
  /** Standing bodies whose base is inside the warned circle. */
  readonly bodiesInside: number
  /**
   * Sample points a body NEARER the camera covers. This is batch K's gap as a number: every one
   * of these is a piece of the warning's edge that a ground-painted ring loses.
   */
  readonly occludedSamples: number
  /** Sample points where the ground band ALONE paints pixels — the ring as batch K shipped it. */
  readonly groundOnlyPaintedSamples: number
  /** Sample points where the warning paints pixels as it ships now. */
  readonly paintedSamples: number
}

export type HybridRendererDiagnostics = {
  readonly rendererType: 'webgl'; readonly objectCount: number; readonly actualObjectCount: number; readonly visualUnitCount: number; readonly visualEffectCount: number; readonly snapshotUnitIds: readonly number[]; readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]; readonly teamTints: Readonly<Record<'teal' | 'scarlet' | 'enemy', number>>; readonly unitVisuals: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number; readonly billboard: boolean; readonly facesCamera: boolean; readonly screenY: number; readonly screenHeight: number; readonly kind: string; readonly state: string; readonly cardCenter: { readonly x: number; readonly y: number; readonly z: number }; readonly shadowNormalY: number; readonly markerNormalY: number; readonly shadowFootprint: { readonly x: number; readonly z: number } }[]; readonly worldBounds: { readonly width: number; readonly height: number; readonly centerX: number; readonly centerY: number }; readonly camera: { readonly projection: 'orthographic'; readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }; readonly rescueSignalCount: number; readonly quality: { readonly particleCount: number; readonly shadowMapSize: number; readonly shadowTargetSize: { readonly width: number; readonly height: number } | null; readonly dpr: number }; readonly metrics: RendererMetrics
}
/**
 * One figure's pose this frame — see `HybridGameRenderer.unitPose`.
 *
 * `weaponAngle` is the carriage's total rotation away from where it was sculpted, in radians.
 * `weaponPitch` is the signed X component of that rotation, which is what separates a swing
 * (large and positive) from a recoil (small and negative). `torsoPitch` and `torsoRoll` are the
 * two components of the flinch.
 */
export type UnitPoseReading = {
  readonly unitId: number
  readonly archetype: MiniatureArchetype | null
  readonly weaponAngle: number
  readonly weaponPitch: number
  readonly torsoPitch: number
  readonly torsoRoll: number
  readonly flash: number
  readonly strikeRanged: boolean
  readonly striking: boolean
}

export interface HybridGameRenderer extends GameRenderer { getDiagnostics(): HybridRendererDiagnostics; getVisualState(): HybridVisualState; measureTelegraph(): TelegraphLegibility | null; projectGroundPoint(x: number, y: number): { x: number; y: number } | null; unitPose(unitId: number): UnitPoseReading | null }

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
// ---------------------------------------------------------------------------
// §정예 예고 — READING THE WARNING THROUGH THE BODIES STANDING IN IT
// ---------------------------------------------------------------------------
// Batch K dropped the camera to 23 degrees, which bought the miniatures their fronts back and
// cost the board behind them: a body of height `h` now hides `h / tan(23deg)` — about 2.4 times
// its own height — of ground behind it. The elite's warning ring is painted on that ground, and
// it is painted around the squad, so the bodies standing inside it cover the far arc and leave
// the left and right ones. A player who can only see two arcs cannot judge where the edge is,
// and §4.5's "정예 범위 공격을 피할 수 있는가" is a question about exactly that edge.
//
// The fix is the ring TWICE. The ground band stays as it was — depth-tested, lying on the
// tabletop, sized to the authoritative footprint, and still the thing that says "this ground" —
// and a thin outline of the same circle at the same radius is drawn with DEPTH TESTING OFF, so
// no body can be in front of it. It reads as a chalk line seen through the figures rather than
// as a second object: same colour, thin, and never opaque.
//
// It is drawn ABOVE the particle pools' render order so a burst cannot bury it either.
const TELEGRAPH_OVERLAY_INNER_RADIUS = 0.93
const TELEGRAPH_OVERLAY_RENDER_ORDER = 6
const TELEGRAPH_OVERLAY_BASE_OPACITY = 0.34
const TELEGRAPH_OVERLAY_PULSE_OPACITY = 0.42

// --- Tabletop diorama presentation -----------------------------------------------
// The gameplay route paints a sculpted diorama: sandy board with grid seams, a raised
// wooden edge frame, warm key light plus a cool rim, and merged miniature bodies.
// --- Camera staging --------------------------------------------------------------
// The pitch itself lives in `staging.ts`, without a `three` import, because the v2 shell has
// to invert this staging to read a pointer drag back into world space (§1.15).
// Orthographic, so the distance only has to clear the near plane and keep the whole
// board (and the terrain belt behind it) inside the depth range.
const DIORAMA_CAMERA_DISTANCE = 46
// How much is framed beyond the play area: the raised rail plus a strip of the terrain
// the board stands on. Anything more is wasted magnification — the 48-wide arena is
// what caps the zoom, and every extra unit of margin shrinks the miniatures.
const DIORAMA_EDGE_MARGIN = 2
// Vertical allowance for a standing miniature, used before any body has been built. Once the
// diorama's geometry exists the real number is MEASURED off the tallest merged body
// (`measureFigureHeadroom`) instead of copied here, because a hand-written height is exactly the
// kind of constant a re-sculpt leaves behind: batch K grew the elite's staff and this number
// would have been wrong the moment it did.
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
const BOARD_COLOR = 0xe8d0a6
const CONTACT_SHADOW_COLOR = 0x1d1408
/** The grounding patch under a base. Kept light: the key light's cast shadow is the real one. */
const CONTACT_SHADOW_OPACITY = 0.38

// --- Lighting -----------------------------------------------------------------------
// A high key-to-fill ratio is what gives a sculpted miniature its form; the previous values
// sat near 3:1 and read as ambient-lit plastic. These sit near 6:1 and are exposed through the
// ACES curve, which is what keeps the bright side of a helmet from clipping to flat white.
const DIORAMA_KEY_INTENSITY = 3.35
const DIORAMA_FILL_INTENSITY = 0.55
/** The cool counter-light that separates a purple raider from the sand it stands on. */
const DIORAMA_RIM_INTENSITY = 1.15
const DIORAMA_EXPOSURE = 1.18
/**
 * Painted-plastic sheen for the miniatures. Low and broad: a miniature is matte acrylic with a
 * slight gloss on the raised edges, not a mirror. Diffuse shading alone gives a box face one
 * uniform value however it is turned; the specular lobe is what puts a moving highlight on the
 * lit edge of a pauldron and lets a helmet separate from the shoulder under it.
 */
const MINIATURE_SHININESS = 22
const MINIATURE_SPECULAR = 0x35302a
// Faction paint. The concept sheet fields teal and scarlet painted friendlies against a
// purple horde, so the enemy miniature leaves the shared cardboard tint behind.
const ENEMY_PAINT = 0x8158c4
const ENEMY_COMMANDER_PAINT = 0x6d3fb5
// Darkened in batch K. The sculpt's lit plates multiply the faction paint by `PAINT.edge`, and
// on a tint this light every plate on the elite came out white — the one body on the board that
// most needs to stay recognisably purple was the one losing its colour.
const ELITE_PAINT = 0x6d3ab8
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
// Lowered in batch K, because the tone curve changed what this number means. Emissive is added
// before the ACES curve, so a body that is struck on almost every tick sits at the top of the
// curve permanently and comes out white — and the body that happens to is the elite, the one a
// player must never lose track of. Measured on a live board rather than reasoned about: at 0.55
// and at 0.4 the elite was still white through the whole engagement.
const FLASH_PEAK = 0.3
const FLASH_FLOOR = 0.35
/**
 * How fast the flash saturates with the size of the hit.
 *
 * The renderer sees ONE hp delta per tick, not one per shot, so a body under fire from fifteen
 * rifles at once reports a single large drop and saturated this instantly at the old rate of 5.
 * At 2.5 a squadmate taking a real hit still flashes near the peak while a chipped elite sits
 * around a third of it, which is the difference the scaling was supposed to make in the first
 * place.
 */
const FLASH_DAMAGE_GAIN = 2.5
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
// --- The rig's shader ----------------------------------------------------------------------
// The body is ONE merged geometry and the spec's per-unit budget (body, base ring, contact
// shadow, health gauge) has no room for a fifth mesh — so a limb is not split off, it is moved
// where it already is. Every vertex carries the joint that owns it (`aJoint`, baked in
// `diorama-assets.ts`), and this patch transforms it by that joint's matrix. One geometry, one
// material, one draw call, legs that swing.
//
// The patch is ONE shared function object, so `Material.customProgramCacheKey` — which is
// `onBeforeCompile.toString()` — is identical for every unit and three.js compiles the program
// ONCE for the whole board rather than once per figure. Batch L lost 5 ms a frame to exactly
// that mistake with the telegraph outline; this is the same trap one layer down.
const RIG_VERTEX_HEADER = `
attribute float aJoint;
uniform mat4 uJoint[ ${RIG_JOINT_COUNT} ];
`
const RIG_NORMAL_PATCH = `#include <beginnormal_vertex>
objectNormal = mat3( uJoint[ int( aJoint ) ] ) * objectNormal;
`
const RIG_POSITION_PATCH = `#include <begin_vertex>
transformed = ( uJoint[ int( aJoint ) ] * vec4( transformed, 1.0 ) ).xyz;
`

type RiggedMaterial = THREE.Material & { userData: { rig?: { value: THREE.Matrix4[] } } }

function applyRigShader(this: RiggedMaterial, shader: { vertexShader: string; uniforms: Record<string, unknown> }): void {
  const rig = this.userData.rig
  if (!rig) return
  shader.uniforms.uJoint = rig
  shader.vertexShader = RIG_VERTEX_HEADER + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', RIG_NORMAL_PATCH)
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', RIG_POSITION_PATCH)
}

// Scratch pose and pose inputs, reused for every unit on every frame. Posing runs sixty times a
// frame in the window that has the least headroom, and neither of these is ever handed out.
const rigPoseScratch = createRigPose()
const rigInputScratch = createRigInput()
/** Scratch for `unitPose`, which reads Euler angles back out of the drawn matrices. */
const poseEulerScratch = new THREE.Euler()
/** Scratch matrices for the muzzle placement, which has to agree with the drawn arm. */
const muzzleRigScratch = createRigMatrices()
const muzzleScratch = new THREE.Vector3()

/** Where the warm-up parks its throwaway copies: far under the table, out of every shot. */
const WARM_UP_DEPTH = -80
/** Effect dressing built at mount rather than mid-battle. Both are pooled, never disposed. */
const WARM_UP_EFFECTS: readonly RenderEffect['kind'][] = ['elite-telegraph', 'rescue-signal', 'downed-marker']
/** Ids the authority can never publish, so a warm-up copy can never collide with a real effect. */
const WARM_UP_EFFECT_ID = -1

/** Every class of body the diorama can put on the board. */
const MINIATURE_ARCHETYPES: readonly MiniatureArchetype[] = ['command', 'soldier', 'melee', 'shooter', 'elite']

/** Local weapon muzzles, in pre-scale miniature space (the figure faces +Z). */
const MUZZLE_OFFSETS: Readonly<Record<MiniatureArchetype, readonly [number, number, number]>> = {
  // The command unit's build is a head taller than the trooper's, so its rifle rides higher.
  command: [0.42, 0.7, 0.21],
  soldier: [0.42, 0.66, 0.21],
  // The melee class has no muzzle; the burst comes off the cleaver's edge instead.
  melee: [0.6, 1.12, -0.04],
  shooter: [0.06, 0.66, 1.02],
  elite: [0.33, 2.06, 0.02],
}
// Pooled particle tints, allocated once. `ParticlePool.spawn` copies out of them, so no
// colour object is ever created per event.
//
// KEYED BY FACTION, NOT BY BODY. The old table said `MiniatureArchetype` and held two colours:
// warm paper for `command`/`soldier`, purple for `melee`/`shooter`/`elite` — which is the
// friendly/hostile split spelled in archetype names, and it only read as a body table for as
// long as no friendly shared a body with a hostile. §1.2.1's charger shares `melee` with the
// raider, so under the old key a teal trooper would have burst into purple scraps.
const SCRAP_TINTS: Readonly<Record<'friendly' | 'hostile', THREE.Color>> = {
  friendly: new THREE.Color(0xf0e2c6),
  hostile: new THREE.Color(0xc9aef0),
}
/** The elite is the one hostile whose scraps are its own — brighter, to match its bulk. */
const ELITE_SCRAP_TINT = new THREE.Color(0xe6cdff)
// --- Health gauge -------------------------------------------------------------------------
// The fourth and last mesh a unit is allowed. §체력 게이지 of the visuals spec: friendlies are
// always shown because the squad's state is the player's judgement material, hostiles only
// once damaged so the opening board stays clean, and a downed body shows no gauge at all.
/** How far above the body's own top the bar floats, in world units before the root scale. */
const GAUGE_HEADROOM = 0.15
const GAUGE_OPACITY = 0.86
/** Fill ramps. Friendly and hostile end at different colours so a bar keeps its faction. */
const GAUGE_FRIENDLY_FULL = 0x8fe06a
const GAUGE_FRIENDLY_MID = 0xf2c14e
const GAUGE_HOSTILE_FULL = 0xc3a0f5
const GAUGE_HOSTILE_MID = 0xdd7ec8
const GAUGE_LOW = 0xe0503c
/** Scratch colour for the ramp, so no allocation happens per unit per frame. */
const gaugeScratch = new THREE.Color()
const TEAM_TRACERS: Readonly<Record<'teal' | 'scarlet' | 'enemy', THREE.Color>> = {
  teal: new THREE.Color(0x9ff2ea),
  scarlet: new THREE.Color(0xffc39a),
  enemy: new THREE.Color(0xd7b0ff),
}
const MUZZLE_SMOKE = new THREE.Color(0xfff2d8)
const MUZZLE_FLASH = new THREE.Color(0xffe08a)
const DEATH_DUST = new THREE.Color(0xd8c39a)
const IMPACT_EMBER = new THREE.Color(0xff8a52)
/** Dust kicked up where a melee blow lands. Dimmer than a muzzle, and nowhere near a weapon. */
const CONTACT_DUST = new THREE.Color(0xe8d3b0)
const IMPACT_SCRAP = new THREE.Color(0xf3d8b6)
const TELEGRAPH_SIGIL_COLOR = 0xff6a48
const RESCUE_GOLD = 0xffb52e
// A narrow beam rather than a column: the token has to point at the two miniatures in
// the carry, not stand in front of them.
const RESCUE_PILLAR_RADIUS = 0.34
const RESCUE_PILLAR_HEIGHT = 2.8

/** §1.11's revive flash: brighter than a hit, because it is the opposite of one. */
const REVIVE_FLASH_SCALE = 1.6
/** How long the stand-up takes on screen, in seconds. */
const REVIVE_LIFT_SECONDS = 0.45

/**
 * §1.11's pin light. Cold white at full countdown, hot amber as it runs out — the colour IS the
 * timer, so a glance answers "can I still get there" without reading a number. Taller and far
 * thinner than the rescue pillar so the two never read as the same signal at a distance.
 */
const DOWNED_PIN_COLD = 0x35e0ff
const DOWNED_PIN_HOT = 0xff3a10
const DOWNED_PIN_HEIGHT = 4.6
const DOWNED_PIN_RADIUS = 0.26
/** Above the telegraph overlay: a body on the ground must not be hidden by the ground warning. */
const DOWNED_PIN_RENDER_ORDER = 9

// The legibility probe (`measureTelegraphLegibility`). Diagnostic-only constants.
/** Points taken around the warning's circumference. 64 puts one every 5.6 degrees. */
const TELEGRAPH_PROBE_SAMPLES = 64
/** The offscreen probe is capped rather than matching a 4K drawing buffer pixel for pixel. */
const TELEGRAPH_PROBE_MAX_WIDTH = 1280
/** Summed RGB distance from the bare board at which a pixel counts as painted, out of 765. */
const TELEGRAPH_PROBE_DELTA = 12
/** The height the ring is sampled at: the outline's own plane. */
const DECAL_PROBE_HEIGHT = 0.03

/** No warning on the board. */
const EMPTY_TELEGRAPH: HybridVisualState['eliteTelegraph'] = {
  visible: false, radius: 0, normalY: 0, bodiesInside: 0,
  overlayDepthTested: null, overlayRenderOrder: null,
}

/** No bodies to measure — an empty board hides nothing. */
const EMPTY_OCCLUSION: HybridVisualState['framing']['occlusion'] = {
  bodies: 0, maxHiddenFraction: 0, meanHiddenFraction: 0, mostlyHidden: 0, fullyHidden: 0,
}

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
  /** Tallest thing a unit can put on the board, measured off the built bodies once they exist. */
  private figureHeadroom = DIORAMA_FIGURE_HEADROOM
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
  private authoredEvents = false
  private eventsPlayed = 0
  private muzzleBursts = 0
  private contactBursts = 0
  private readonly telegraphs = new Map<number, TelegraphTrack>()
  /**
   * Cosmetic-only jitter for burst directions and sizes. Its own renderer-side seed —
   * never an authority PRNG, never the state digest — so nothing it produces can move
   * the simulation, and the whole system stays inside the display layer.
   */
  private readonly fxRandom = cosmeticRandom(FX_COSMETIC_SEED ^ 0x632be5ab)
  private telegraphGeometry: THREE.RingGeometry | null = null
  private telegraphOverlayGeometry: THREE.RingGeometry | null = null
  private snapshot: RenderSnapshot | null = null
  private readonly units = new Map<number, UnitVisual>()
  private readonly effects = new Map<number, EffectVisual>()
  /**
   * Dressing kept alive between effects of the same kind. §1.12's warning cycles every
   * `ELITE_COOLDOWN_TICKS` and used to build four meshes and four materials inside `render` each
   * time; these are the ones it has already built. Nothing in here is on the scene graph.
   */
  private readonly retiredEffects = new Map<RenderEffect['kind'], EffectVisual[]>()
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
    this.telegraphOverlayGeometry = new THREE.RingGeometry(TELEGRAPH_OVERLAY_INNER_RADIUS, 1, TELEGRAPH_SEGMENTS)
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
    // WHERE THE ACTION COMES FROM, and there are two answers.
    //
    // The v2 battle publishes `actionEvents`: the authority's own account of every blow the
    // ticks behind this frame resolved, with its own attacker, target and cause. When the field
    // is THERE it is the whole truth, and the renderer must not also guess — a guess on top
    // would play every blow twice.
    //
    // v1's gameplay snapshot and the `?lab=renderers` fixture publish no such field, and for
    // those the renderer still infers a hit from a drop in `hp01` and blames the nearest hostile
    // that is attacking. That path is lossy in ways the account is not — one flash per frame
    // however many blows landed, no killing blow at all (a body that dies is never seen to lose
    // health), a muzzle puff on a melee attacker — which is why batch L built the account. It is
    // kept because those two callers have no events to give.
    const authored = snapshot.actionEvents !== undefined
    this.authoredEvents = authored
    // A resume, a restart or a long stall lands many ticks at once. Those frames resync
    // the diff state silently instead of detonating every event that was skipped.
    const spawnEvents = !authored && this.diorama !== null && elapsedTicks > 0 && elapsedTicks <= EVENT_CATCHUP_TICKS
    // A restart rewinds the authority clock. Everything the renderer scheduled against
    // the old clock — bursts, the shake, the telegraph countdown — has to go with it,
    // or a burst born at tick 500 reappears when the new battle reaches tick 500.
    if (snapshot.tick < this.lastEventTick) this.resetActionState()
    this.updateCameraBounds(snapshot)
    // Before the bodies are drawn, so the lunge of whoever fired and the flash of whoever was
    // hit both land on the frame the blow belongs to instead of the one after it.
    if (authored && this.diorama) this.playActionEvents(snapshot)
    const unitIds = new Set(snapshot.units.map((unit) => unit.id))
    snapshot.units.forEach((unit) => this.renderUnit(unit, snapshot, spawnEvents))
    this.units.forEach((visual, id) => { if (!unitIds.has(id)) this.removeVisual(this.units, id, visual) })
    const effectIds = new Set(snapshot.effects.map((effect) => effect.id))
    snapshot.effects.forEach((effect) => this.renderEffect(effect))
    this.effects.forEach((visual, id) => {
      if (effectIds.has(id)) return
      // The strike's own shake does not ride on `spawnEvents`: an authored snapshot delivers
      // every tick in order, so a telegraph that has left the account really has landed.
      if (visual.kind === 'elite-telegraph') this.resolveTelegraphImpact(id, authored || spawnEvents)
      this.retireEffect(id, visual)
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
    this.units.forEach((visual) => { disposeObjectMaterials(visual.root); visual.gauge?.geometry.dispose() }); this.effects.forEach((visual) => disposeObjectMaterials(visual.root)); this.particles.forEach((particle) => disposeObjectMaterials(particle))
    this.scene?.traverse((object) => { if (object instanceof THREE.Mesh && object.name.startsWith('tabletop-')) disposeObjectMaterials(object) })
    this.retiredEffects.forEach((pool) => pool.forEach((visual) => disposeObjectMaterials(visual.root)))
    this.units.clear(); this.effects.clear(); this.retiredEffects.clear(); this.particles = []; this.frameRails = []
    this.telegraphGeometry?.dispose(); this.telegraphGeometry = null
    this.telegraphOverlayGeometry?.dispose(); this.telegraphOverlayGeometry = null
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
        return visual ? [{ id: unit.id, x: unit.x, y: unit.y, tint: (visual.card.material as TintedBodyMaterial).color.getHex() }] : []
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
      fieldClutter: this.describeFieldClutter(),
      healthGauges: this.describeGauges(),
      action: this.describeAction(),
    }
  }

  /**
   * The board clutter, measured against its own rule.
   *
   * `shapeViolations` re-derives the extents from the BUILT geometry rather than from the
   * planner's declared numbers, so a builder that grew past its declaration is caught here and
   * not only in the unit test — this runs against the clutter the player is actually looking at.
   */
  private describeFieldClutter(): HybridVisualState['fieldClutter'] {
    const clutter = this.props?.fieldClutter ?? []
    const area = this.snapshot?.playArea ?? this.snapshot?.camera
    let violations = 0
    let tallestFlat = 0
    let widestPole = 0
    for (const placement of clutter) {
      const extent = clutterExtent(placement)
      if (clutterShape(placement.kind) === 'pole') {
        widestPole = Math.max(widestPole, extent.radius)
        if (extent.radius > CLUTTER_POLE_RADIUS + 1e-6) violations += 1
      } else {
        tallestFlat = Math.max(tallestFlat, extent.height)
        if (extent.height > CLUTTER_FLAT_HEIGHT + 1e-6) violations += 1
      }
    }
    const allInsidePlayArea = area !== undefined && clutter.every((placement) => {
      const radius = clutterFootprintRadius(placement)
      return Math.abs(placement.x - area.centerX) + radius <= area.worldWidth / 2 + 1e-6
        && Math.abs(placement.z - area.centerY) + radius <= area.worldHeight / 2 + 1e-6
    })
    let overlapping = 0
    for (const unit of this.snapshot?.units ?? []) {
      if (unit.state === 'dead') continue
      if (clutter.some((placement) => {
        const radius = clutterFootprintRadius(placement)
        const dx = unit.x - placement.x
        const dz = unit.y - placement.z
        return dx * dx + dz * dz <= radius * radius
      })) overlapping += 1
    }
    return {
      items: clutter.length,
      allInsidePlayArea: clutter.length > 0 && allInsidePlayArea,
      shapeViolations: violations,
      tallestFlatPiece: tallestFlat,
      widestPole,
      unitsOverlappingClutter: overlapping,
    }
  }

  /** Reads the gauges back off the scene graph, against the snapshot they claim to show. */
  private describeGauges(): HybridVisualState['healthGauges'] {
    const units = this.snapshot?.units ?? []
    const counts = {
      visible: 0,
      friendlyStanding: 0,
      friendlyVisible: 0,
      hostileFull: 0,
      hostileFullVisible: 0,
      hostileDamaged: 0,
      hostileDamagedVisible: 0,
      downed: 0,
      downedVisible: 0,
      billboarded: 0,
      maxFillError: 0,
      minHeadroom: Number.POSITIVE_INFINITY,
    }
    for (const unit of units) {
      const visual = this.units.get(unit.id)
      const gauge = visual?.gauge
      const shown = gauge?.visible === true
      const downed = unit.state === 'downed'
      const hostile = unit.team === 'enemy'
      // A body the authority has finished with is not drawn at all; counting it would make
      // "every friendly has a bar" fail on a corpse that is mid-sweep.
      const gone = visual ? visual.anim.dead || visual.anim.buried : true
      if (downed) {
        counts.downed += 1
        if (shown) counts.downedVisible += 1
      } else if (!hostile && !gone) {
        counts.friendlyStanding += 1
        if (shown) counts.friendlyVisible += 1
      } else if (hostile && !gone) {
        if (unit.hp01 >= 1 - 1e-6) {
          counts.hostileFull += 1
          if (shown) counts.hostileFullVisible += 1
        } else {
          counts.hostileDamaged += 1
          if (shown) counts.hostileDamagedVisible += 1
        }
      }
      if (!shown || !gauge) continue
      counts.visible += 1
      if (this.facesCamera(gauge)) counts.billboarded += 1
      counts.maxFillError = Math.max(counts.maxFillError, Math.abs(readHealthGaugeFill(gauge.geometry) - clamp01(unit.hp01)))
      counts.minHeadroom = Math.min(counts.minHeadroom, gauge.position.y - bodyTop(visual!.card.geometry))
    }
    if (counts.minHeadroom === Number.POSITIVE_INFINITY) counts.minHeadroom = 0
    return counts
  }

  /**
   * A screenshot proves an effect exists; these counters prove it *runs*. The cumulative
   * three (`attacksObserved` / `hitsObserved` / `deathsObserved`) only ever move when a
   * snapshot delta fires an animation, and the instantaneous ones sample the frame that
   * is on screen right now.
   */
  private describeAction(): HybridVisualState['action'] {
    const visuals = [...this.units.values()]
    const standing = visuals.filter((visual) => !visual.anim.dead && visual.card.rotation.z < 1e-4)
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
      authoredEvents: this.authoredEvents,
      eventsPlayed: this.eventsPlayed,
      muzzleBursts: this.muzzleBursts,
      contactBursts: this.contactBursts,
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
      // The stride, read off the same numbers the rig is posed from. `standing` excludes the
      // toppled: a body on its side is neither walking nor settled, it is waiting for someone.
      stridingUnits: standing.filter((visual) => strideAmount(visual.anim.step) > 0).length,
      settledUnits: standing.filter((visual) => strideAmount(visual.anim.step) === 0).length,
      maxCadence: standing.reduce((max, visual) => Math.max(max, visual.anim.step / STRIDE_CYCLE_DISTANCE), 0),
      strikingUnits: standing.filter((visual) => this.clock - visual.anim.strikeStart
        < strikeTicksFor(visual.archetype, visual.anim.strikeRanged)
        && this.clock >= visual.anim.strikeStart).length,
      maxWeaponAngle: standing.reduce((max, visual) => {
        const rig = visual.rig
        if (!rig) return max
        // The weapon carriage's total rotation away from rest, read straight off the matrix the
        // GPU was handed rather than off the inputs that built it.
        const trace = rig[RIG_ARM]!.elements[0]! + rig[RIG_ARM]!.elements[5]! + rig[RIG_ARM]!.elements[10]!
        return Math.max(max, Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))))
      }, 0),
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
      bodyArchetypes: this.diorama ? [...new Set(visuals.map((visual) => visual.card.name))].sort() : [],
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
    const camera = this.snapshot?.playArea ?? this.snapshot?.camera
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
    if (!this.camera) return { units: units.length, unitsInView: 0, groundCoversViewCentre: false, cameraPitchDegrees: 0, viewHalfWidth: 0, viewHalfHeight: 0, occlusion: EMPTY_OCCLUSION }
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
      occlusion: this.measureOcclusion(),
    }
  }

  /**
   * What the lowered camera costs, in the only currency that matters: board information.
   *
   * Each standing body is reduced to the screen rectangle it actually covers (its own bounding
   * box, transformed by the live camera), and its footprint is sampled on a coarse grid against
   * every body that is NEARER the camera. Nearer is depth in camera space, which is exactly the
   * order the depth buffer resolves, so a sample counted as hidden really is behind something.
   *
   * It is an UPPER BOUND, deliberately. A miniature does not fill its own bounding box — a
   * levelled rifle or a standard makes the box far wider than the body — so a sample counted as
   * hidden may in truth be looking past the occluder. A ceiling held against an over-estimate
   * still holds against the truth; a floor would not, which is why nothing here asserts a
   * minimum.
   *
   * It is a diagnostic: it runs when a test reads the visual state, never inside `render`.
   */
  private measureOcclusion(): HybridVisualState['framing']['occlusion'] {
    const camera = this.camera
    if (!camera) return EMPTY_OCCLUSION
    const boxes: { minX: number; maxX: number; minY: number; maxY: number; depth: number }[] = []
    for (const unit of this.snapshot?.units ?? []) {
      const visual = this.units.get(unit.id)
      // A toppled or swept body is not information the player is owed, and a downed one is
      // lying flat; the claim is about STANDING miniatures hiding each other.
      if (!visual || !visual.card.visible || visual.anim.dead || unit.state === 'downed') continue
      const world = new THREE.Box3().setFromObject(visual.card)
      if (world.isEmpty()) continue
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      const corner = new THREE.Vector3()
      for (let index = 0; index < 8; index += 1) {
        corner.set(
          index & 1 ? world.max.x : world.min.x,
          index & 2 ? world.max.y : world.min.y,
          index & 4 ? world.max.z : world.min.z,
        ).project(camera)
        minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x)
        minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y)
      }
      // Off-screen bodies are a framing question (`unitsInView`), not an occlusion one.
      if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1) continue
      const centre = visual.root.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse)
      boxes.push({ minX, maxX, minY, maxY, depth: -centre.z })
    }
    if (boxes.length === 0) return EMPTY_OCCLUSION
    let maxHidden = 0
    let totalHidden = 0
    let mostlyHidden = 0
    let fullyHidden = 0
    const STEPS = 5
    for (const box of boxes) {
      const nearer = boxes.filter((other) => other !== box
        && other.depth < box.depth
        && other.maxX > box.minX && other.minX < box.maxX
        && other.maxY > box.minY && other.minY < box.maxY)
      let hidden = 0
      if (nearer.length > 0) {
        for (let ix = 0; ix < STEPS; ix += 1) {
          const x = box.minX + ((ix + 0.5) / STEPS) * (box.maxX - box.minX)
          for (let iy = 0; iy < STEPS; iy += 1) {
            const y = box.minY + ((iy + 0.5) / STEPS) * (box.maxY - box.minY)
            if (nearer.some((other) => x >= other.minX && x <= other.maxX && y >= other.minY && y <= other.maxY)) hidden += 1
          }
        }
      }
      const fraction = hidden / (STEPS * STEPS)
      maxHidden = Math.max(maxHidden, fraction)
      totalHidden += fraction
      if (fraction > 0.5) mostlyHidden += 1
      if (fraction >= 0.95) fullyHidden += 1
    }
    return {
      bodies: boxes.length,
      maxHiddenFraction: maxHidden,
      meanHiddenFraction: totalHidden / boxes.length,
      mostlyHidden,
      fullyHidden,
    }
  }

  /**
   * A point on the tabletop, in normalized device coordinates.
   *
   * §4.4's framing guarantee is about the WORLD REGION on screen, not about the units that
   * happen to be standing in it — "지휘 유닛 중심 반경 ...의 월드 영역이 전부 뷰포트 안" names
   * ground, and there is no body at most of it. Projecting through the live camera is the only
   * way to assert that from the render result rather than from a re-derivation of the frustum.
   */
  projectGroundPoint(x: number, y: number): { x: number; y: number } | null {
    if (!this.camera) return null
    const projected = new THREE.Vector3(x, 0, y).project(this.camera)
    return { x: projected.x, y: projected.y }
  }

  /**
   * One figure's POSE, read off the matrices the GPU was handed this frame.
   *
   * ITS OWN CALL, not a field of `getVisualState`, and for the same reason `measureTelegraph` is
   * its own call: `getVisualState`'s pose aggregates (`maxWeaponAngle`, `strikingUnits`) answer
   * "is anything on the board doing this". A SCREENSHOT has to answer the other question — is
   * THIS body, the one the caption names, in the pose the caption claims — and an aggregate
   * cannot: a cleaver enemy mid-chop and the command unit mid-swing produce the same maximum.
   *
   * Read off the drawn matrices rather than off the `UnitAnim` inputs that built them, so a rig
   * that stopped applying an input would show up here rather than being reported from the input.
   */
  unitPose(unitId: number): UnitPoseReading | null {
    const visual = this.units.get(unitId)
    const rig = visual?.rig
    if (!visual || !rig) return null
    const arm = rig[RIG_ARM]!
    const trace = arm.elements[0]! + arm.elements[5]! + arm.elements[10]!
    poseEulerScratch.setFromRotationMatrix(arm)
    const weaponPitch = poseEulerScratch.x
    poseEulerScratch.setFromRotationMatrix(rig[RIG_TORSO]!)
    return {
      unitId,
      archetype: visual.archetype ?? null,
      weaponAngle: Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))),
      weaponPitch,
      torsoPitch: poseEulerScratch.x,
      torsoRoll: poseEulerScratch.z,
      flash: visual.anim.flash,
      strikeRanged: visual.anim.strikeRanged,
      striking: this.clock >= visual.anim.strikeStart
        && this.clock - visual.anim.strikeStart < strikeTicksFor(visual.archetype, visual.anim.strikeRanged),
    }
  }

  private describeTelegraph(): HybridVisualState['eliteTelegraph'] {
    const telegraph = [...this.effects.values()].find((visual) => visual.kind === 'elite-telegraph')
    const area = telegraph?.root.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    if (!telegraph || !area) return EMPTY_TELEGRAPH
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(area.getWorldQuaternion(new THREE.Quaternion())).normalize()
    const radius = (area.geometry as THREE.RingGeometry).parameters.outerRadius * area.scale.x
    const overlay = telegraph.overlay
    const overlayMaterial = overlay?.material as THREE.MeshBasicMaterial | undefined
    return {
      visible: true,
      radius,
      normalY: normal.y,
      bodiesInside: this.bodiesInsideTelegraph(telegraph, radius),
      overlayDepthTested: overlayMaterial ? overlayMaterial.depthTest : null,
      overlayRenderOrder: overlay ? overlay.renderOrder : null,
    }
  }

  private bodiesInsideTelegraph(telegraph: EffectVisual, radius: number): number {
    const centreX = telegraph.root.position.x
    const centreZ = telegraph.root.position.z
    return (this.snapshot?.units ?? []).filter((unit) => {
      const visual = this.units.get(unit.id)
      if (!visual || visual.anim.dead || unit.state === 'downed' || unit.state === 'dead') return false
      return Math.hypot(unit.x - centreX, unit.y - centreZ) <= radius
    }).length
  }

  /** The public face of the probe: the warning that is up, or `null` when there is none. */
  measureTelegraph(): TelegraphLegibility | null {
    const telegraph = [...this.effects.values()].find((visual) => visual.kind === 'elite-telegraph')
    const area = telegraph?.root.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)
    if (!telegraph || !area) return null
    const radius = (area.geometry as THREE.RingGeometry).parameters.outerRadius * area.scale.x
    return this.measureTelegraphLegibility(telegraph, radius)
  }

  /**
   * How much of the warning's edge survives the bodies standing on it — measured off PIXELS.
   *
   * The scene is rendered three times into an offscreen target: as it ships, with the over-body
   * outline hidden (which is the ring batch K shipped), and with the whole warning hidden (the
   * board underneath). A sample point counts as PAINTED when its pixel differs from the bare
   * board, so nothing here depends on guessing the warning's colour after it has been blended
   * over sand, a scorch decal or a purple miniature.
   *
   * `occludedSamples` is the geometric half of the same question, computed the way
   * `measureOcclusion` computes its own: a sample is occluded when a body NEARER THE CAMERA
   * covers its screen position. It is an upper bound for the same reason that one is — a
   * miniature does not fill its own bounding box.
   *
   * It is a DIAGNOSTIC. It renders, so it must never be called from `render`, and it is not: the
   * only caller is `getVisualState`, which exists for the dev-only test bridge.
   */
  private measureTelegraphLegibility(telegraph: EffectVisual, radius: number): TelegraphLegibility {
    const camera = this.camera
    const renderer = this.renderer
    const scene = this.scene
    const blank = { bodiesInside: 0, samples: 0, occludedSamples: 0, groundOnlyPaintedSamples: 0, paintedSamples: 0 }
    if (!camera || !renderer || !scene || radius <= 0) return blank

    const centreX = telegraph.root.position.x
    const centreZ = telegraph.root.position.z
    const bodiesInside = this.bodiesInsideTelegraph(telegraph, radius)

    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const width = Math.max(1, Math.min(TELEGRAPH_PROBE_MAX_WIDTH, Math.round(size.x)))
    const height = Math.max(1, Math.round((size.y / Math.max(1, size.x)) * width))

    // Sample points on the circle, in screen pixels, plus their camera depth for the occlusion
    // half. The probe radius is the MIDDLE of the outline's band, not its outer edge: the edge
    // is one antialiased pixel wide and a reading taken there measures rounding, not paint.
    const probeRadius = radius * (1 + TELEGRAPH_OVERLAY_INNER_RADIUS) / 2
    const points: { px: number; py: number; depth: number }[] = []
    const world = new THREE.Vector3()
    for (let index = 0; index < TELEGRAPH_PROBE_SAMPLES; index += 1) {
      const angle = (index / TELEGRAPH_PROBE_SAMPLES) * Math.PI * 2
      world.set(centreX + Math.cos(angle) * probeRadius, DECAL_PROBE_HEIGHT, centreZ + Math.sin(angle) * probeRadius)
      const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z
      const ndc = world.project(camera)
      if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue
      points.push({
        px: Math.min(width - 1, Math.max(0, Math.round(((ndc.x + 1) / 2) * width))),
        py: Math.min(height - 1, Math.max(0, Math.round(((ndc.y + 1) / 2) * height))),
        depth,
      })
    }
    if (points.length === 0) return { ...blank, bodiesInside }

    const occludedSamples = this.countOccludedSamples(points, width, height)

    const overlay = telegraph.overlay
    const overlayWas = overlay?.visible ?? false
    const rootWas = telegraph.root.visible
    const target = new THREE.WebGLRenderTarget(width, height)
    const shipped = new Uint8Array(width * height * 4)
    const groundOnly = new Uint8Array(width * height * 4)
    const bare = new Uint8Array(width * height * 4)
    const previousTarget = renderer.getRenderTarget()
    try {
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, shipped)
      if (overlay) overlay.visible = false
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, groundOnly)
      telegraph.root.visible = false
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, bare)
    } finally {
      if (overlay) overlay.visible = overlayWas
      telegraph.root.visible = rootWas
      renderer.setRenderTarget(previousTarget)
      target.dispose()
      // Put back on screen exactly what was there before the probe.
      this.renderScene()
    }

    // A 3x3 neighbourhood, because a sample is a mathematical point and a pixel is not: a band
    // a couple of pixels wide can fall between two sample coordinates after rounding.
    const painted = (buffer: Uint8Array, point: { px: number; py: number }): boolean => {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = point.px + dx
          const py = point.py + dy
          if (px < 0 || py < 0 || px >= width || py >= height) continue
          const offset = (py * width + px) * 4
          const delta = Math.abs(buffer[offset]! - bare[offset]!)
            + Math.abs(buffer[offset + 1]! - bare[offset + 1]!)
            + Math.abs(buffer[offset + 2]! - bare[offset + 2]!)
          if (delta > TELEGRAPH_PROBE_DELTA) return true
        }
      }
      return false
    }

    return {
      bodiesInside,
      samples: points.length,
      occludedSamples,
      groundOnlyPaintedSamples: points.filter((point) => painted(groundOnly, point)).length,
      paintedSamples: points.filter((point) => painted(shipped, point)).length,
    }
  }

  /** Sample points with a standing body between them and the camera, in pixel space. */
  private countOccludedSamples(
    points: readonly { px: number; py: number; depth: number }[],
    width: number,
    height: number,
  ): number {
    const camera = this.camera
    if (!camera) return 0
    const boxes: { minX: number; maxX: number; minY: number; maxY: number; depth: number }[] = []
    for (const unit of this.snapshot?.units ?? []) {
      const visual = this.units.get(unit.id)
      if (!visual || !visual.card.visible || visual.anim.dead || unit.state === 'downed') continue
      const world = new THREE.Box3().setFromObject(visual.card)
      if (world.isEmpty()) continue
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      const corner = new THREE.Vector3()
      for (let index = 0; index < 8; index += 1) {
        corner.set(
          index & 1 ? world.max.x : world.min.x,
          index & 2 ? world.max.y : world.min.y,
          index & 4 ? world.max.z : world.min.z,
        ).project(camera)
        minX = Math.min(minX, ((corner.x + 1) / 2) * width); maxX = Math.max(maxX, ((corner.x + 1) / 2) * width)
        minY = Math.min(minY, ((corner.y + 1) / 2) * height); maxY = Math.max(maxY, ((corner.y + 1) / 2) * height)
      }
      const centre = visual.root.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse)
      boxes.push({ minX, maxX, minY, maxY, depth: -centre.z })
    }
    return points.filter((point) => boxes.some((box) => box.depth < point.depth
      && point.px >= box.minX && point.px <= box.maxX
      && point.py >= box.minY && point.py <= box.maxY)).length
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
    this.figureHeadroom = measureFigureHeadroom(assets)
    this.renderer.setClearColor(0x171208)

    // THE TONE CURVE, and it is the difference between "flat" and "lit". The scene is lit far
    // above 1.0 on purpose — a warm key at 3.3 plus a cool rim — and a linear output clips all of
    // that to white, which is what washed the sculpted forms out into single-value silhouettes.
    // ACES rolls the highlights off instead, so the key can be strong enough to carve a helmet
    // out of a shoulder while the sand keeps its paint. Applied only here: the `?lab=renderers`
    // comparison keeps the flat cardboard output it measures renderers against.
    //
    // Rings, gauges and telegraphs opt OUT of it (`toneMapped: false`) — they are read-outs, not
    // lit surfaces, and their colour is the information.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = DIORAMA_EXPOSURE
    // Percentage-closer *soft* filtering: at this camera the raking key throws a shadow nearly
    // twice a figure's own length, and a hard 1-tap edge on something that long reads as a
    // painted stripe rather than as a shadow.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.needsUpdate = true

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
    if (ambient) { ambient.intensity = DIORAMA_FILL_INTENSITY; ambient.color.setHex(0xffeec6); ambient.groundColor.setHex(0x38271a) }
    const key = this.scene.getObjectByName('tabletop-key-light') as THREE.DirectionalLight | undefined
    if (key) {
      key.color.setHex(0xffe6b4)
      key.intensity = DIORAMA_KEY_INTENSITY
      // Wide enough to keep the terrain belt in the shadow pass, and pushed far enough
      // out that props on the camera side of the board are still in front of the light.
      key.shadow.camera.left = -40; key.shadow.camera.right = 40; key.shadow.camera.top = 36; key.shadow.camera.bottom = -36
      key.shadow.camera.near = 1; key.shadow.camera.far = 130
      key.shadow.bias = -0.0012
      key.shadow.normalBias = 0.03
      key.shadow.camera.updateProjectionMatrix()
    }
    const rim = new THREE.DirectionalLight(0x8fb6ff, DIORAMA_RIM_INTENSITY)
    rim.name = RIM_LIGHT_NAME
    this.scene.add(rim, rim.target)

    // The terrain surround. Built once, from cosmetic randomness only, entirely outside
    // the play area — it decorates the board and never takes part in judgement.
    this.props = createTerrainProps(snapshot.playArea ?? snapshot.camera, { sightlineSlope: 1.05 / Math.tan(DIORAMA_PITCH_RADIANS) })
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
    this.surfaceDecals = createSurfaceDecals(snapshot.playArea ?? snapshot.camera)
    this.surfaceDecals.mesh.name = SURFACE_DECAL_NAME
    this.scene.add(this.surfaceDecals.mesh)

    // Units created before the first gameplay snapshot would still be cards; there are
    // none in practice, but rebuilding keeps the invariant true either way.
    this.units.forEach((visual, id) => this.removeVisual(this.units, id, visual))
    this.warmUpDressing()
  }

  /**
   * Draws one of everything the board will ever need, once, far under the table.
   *
   * BATCH L LEFT AN UNATTRIBUTED SPIKE and this is the answer to it, measured rather than
   * reasoned about. Probing `WebGLRenderer.info` across a whole `seed-h` run showed the frame
   * §1.12's elite arrives on going `programs 12 -> 14, geometries 43 -> 46, textures 10 -> 11`:
   * that frame is also the FIRST ELITE TELEGRAPH, and its dressing — the sigil disc with its
   * additive-blended texture, the countdown disc, the two ring geometries — had never been drawn
   * before. TWO SHADER PROGRAMS ARE LINKED INSIDE `render`, on a frame that is already drawing a
   * full board. That, and not the elite's body, is where the 9-15 ms went; batch K had it too.
   *
   * Nothing about the work is avoidable. WHICH FRAME PAYS IT is a choice, and this makes it the
   * mount frame — which is already building the board, the terrain, the decals and the particle
   * pools, and which no one is watching.
   *
   * The effect dressing is RETIRED INTO THE POOL rather than disposed, because disposing a
   * material releases its program: a warm-up that threw its materials away would recompile
   * everything it had just compiled. The five bodies ARE thrown away — their materials are
   * per-unit and cannot be reused — but their shared geometry buffers stay uploaded, which is
   * the half of that cost that does carry over.
   */
  private warmUpDressing(): void {
    const assets = this.diorama
    if (!assets || !this.scene || !this.camera || !this.renderer) return
    const warm = new THREE.Group()
    warm.name = 'diorama-warmup'
    const rig = { value: createRigMatrices() }
    for (const archetype of MINIATURE_ARCHETYPES) {
      const material = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, emissive: FLASH_COLOR, emissiveIntensity: 0, specular: MINIATURE_SPECULAR, shininess: MINIATURE_SHININESS })
      ;(material as RiggedMaterial).userData.rig = rig
      material.onBeforeCompile = applyRigShader
      const mesh = new THREE.Mesh(assets.miniatures[archetype], material)
      const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
      ;(depthMaterial as RiggedMaterial).userData.rig = rig
      depthMaterial.onBeforeCompile = applyRigShader
      mesh.customDepthMaterial = depthMaterial
      mesh.castShadow = true
      mesh.frustumCulled = false
      mesh.position.set(0, WARM_UP_DEPTH, 0)
      warm.add(mesh)
    }
    this.scene.add(warm)

    // The two pieces of effect dressing, built through the REAL path so what gets warmed is
    // exactly what gets used, then parked out of shot for the one frame that uploads it.
    const dressed = WARM_UP_EFFECTS.map((kind, index) => {
      const visual = this.createEffectVisual({
        id: WARM_UP_EFFECT_ID - index, kind, team: null, x: 0, y: 0, radius: 1,
        startedTick: 0, durationTicks: 1,
      })
      visual.root.position.y = WARM_UP_DEPTH
      visual.root.traverse((object) => { object.frustumCulled = false })
      return visual
    })

    this.renderer.render(this.scene, this.camera)

    warm.removeFromParent()
    disposeObjectMaterials(warm)
    dressed.forEach((visual, index) => {
      visual.root.position.y = 0
      visual.root.traverse((object) => { object.frustumCulled = true })
      this.retireEffect(WARM_UP_EFFECT_ID - index, visual)
    })
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
    const visual = this.ensureUnitVisual(unit)
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
    //
    // §1.11's revive EASES OUT of that pose rather than snapping upright. The authority stands
    // the body up on one tick — correct, and unreadable at 30Hz on a busy board, which is the
    // "구조한 느낌이 안 남" this exists to answer. The lift is display-only: the unit is already
    // standing in the state while these frames play.
    const lifting = clamp01((this.clock - visual.anim.reviveStart) / REVIVE_LIFT_SECONDS)
    const laid = downed ? 1 : 1 - easeTopple(lifting)
    visual.card.rotation.z = laid * (Math.PI / 2)
    visual.card.position.y = DOWNED_CARD_HEIGHT + (1 - laid) * (STANDING_CARD_HEIGHT - DOWNED_CARD_HEIGHT)
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
    // THE STRIDE'S ONE INPUT, sampled per AUTHORITY TICK rather than per frame. A browser frame
    // here regularly covers three ticks and just as regularly covers none of them (the position
    // a snapshot publishes is the tick's, not an interpolation), so a per-frame difference would
    // read zero on most frames and three ticks' worth on the rest — a cadence made of the frame
    // rate instead of the movement. Summing per tick makes the phase a function of how far the
    // AUTHORITY moved this unit and of nothing else.
    if (snapshot.tick !== anim.strideTick) {
      const elapsed = snapshot.tick - anim.strideTick
      const distance = Math.hypot(unit.x - anim.x, unit.y - anim.y)
      if (elapsed > 0 && elapsed <= EVENT_CATCHUP_TICKS) {
        anim.step = distance / elapsed
        anim.travel += distance
      } else {
        // A resume, a restart or a long stall: adopt the new position without crediting the
        // gap as walking, exactly as the event diff above resyncs instead of detonating.
        anim.step = 0
      }
      anim.strideTick = snapshot.tick
    }
    anim.hp01 = unit.hp01
    anim.x = unit.x
    anim.y = unit.y
  }

  /**
   * Poses one figure's rig for this frame and writes the eight matrices its material reads.
   *
   * COMPOSITION, which is the question an attack-while-moving game has to answer (§1.3 makes
   * firing on the move the common case): the LOWER body is the stride and only the stride, the
   * UPPER body is the stride's carry pose with the strike added on top of it, and the arm's
   * counter-swing hands over to the aim as the weapon comes up. `figure-rig.ts` owns that rule;
   * this method owns the timers it is fed.
   *
   * A toppled figure — downed, or dead and falling — is posed at rest instead. §4.5's fourth
   * question is whether the player agonised over going back for someone, and a body on its side
   * that is still jogging is not a body that reads as needing help.
   */
  private poseFigure(visual: UnitVisual, unit: RenderUnit, downed: boolean, topple: number): void {
    const rig = visual.rig
    const archetype = visual.archetype
    if (!rig || !archetype) return
    const anim = visual.anim
    if (downed || topple > 0 || anim.dead) {
      restRigPose(rigPoseScratch)
      rigMatrices(rig, rigPoseScratch, archetype, FIGURE_SCALE)
      return
    }
    // Sub-tick smoothing: `clock - tick` is the controller's own interpolation fraction, so the
    // legs keep moving between ticks at the speed the last tick actually measured.
    const fraction = clamp01(this.clock - anim.strideTick)
    const stride = strideAmount(anim.step)
    const phase = stridePhase(unit.id, anim.travel + anim.step * fraction)
    const strikeTicks = strikeTicksFor(archetype, anim.strikeRanged)
    const strikeAge = this.clock - anim.strikeStart
    const strike = strikeAge >= 0 && strikeAge < strikeTicks ? strikeAge / strikeTicks : -1
    // The aim blend runs whichever weapon the last blow was. `figure-rig.ts` uses it as the CARRY
    // pose in both branches, so a command unit crossing from rifle range into melee range lowers
    // its weapon over `AIM_RELEASE_TICKS` instead of snapping to rest on the branch.
    const aim = aimBlend(this.clock, anim.aimStart, anim.aimUntil)
    rigInputScratch.archetype = archetype
    rigInputScratch.phase = phase
    rigInputScratch.stride = stride
    rigInputScratch.strike = strike
    rigInputScratch.strikeRanged = anim.strikeRanged
    rigInputScratch.aim = aim
    rigInputScratch.hit = anim.flash
    rigInputScratch.hitBearing = anim.hitBearing
    poseFigure(rigPoseScratch, rigInputScratch)
    rigMatrices(rig, rigPoseScratch, archetype, FIGURE_SCALE)
    visual.card.position.y += rigPoseScratch.bounce * FIGURE_SCALE
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
    ;(visual.shadow.material as THREE.MeshBasicMaterial).opacity = CONTACT_SHADOW_OPACITY * sweep

    // A struck figure flashes bright rather than changing paint, so the faction read
    // never wobbles: the tint stays exactly what `miniaturePaint` chose.
    const material = visual.card.material as TintedBodyMaterial
    material.emissiveIntensity = hit * FLASH_PEAK * anim.flashScale

    // Every unit wears a base ring in the diorama; the colour is what carries the read.
    visual.marker.visible = true
    const markerMaterial = visual.marker.material as THREE.MeshBasicMaterial
    markerMaterial.color.setHex(dioramaRingColor(unit, marksActiveSquad))
    const ringOpacity = marksActiveSquad && !downed
      ? RING_BASE_OPACITY + RING_PULSE_AMPLITUDE * Math.sin((snapshot.tick / RING_PULSE_TICKS) * Math.PI * 2)
      : RING_BASE_OPACITY - RING_PULSE_AMPLITUDE
    markerMaterial.opacity = ringOpacity * sweep

    // Last, because it adds the stride's bounce to the height the topple just wrote.
    this.poseFigure(visual, unit, downed, topple)
    this.updateGauge(unit, visual, downed)
  }

  /**
   * The authority's own account of the ticks behind this frame, turned into motion.
   *
   * EACH EVENT IS SCHEDULED AT ITS OWN TICK, not at the frame edge, and that is the whole answer
   * to the frame/tick mismatch. A browser frame here regularly covers three ticks; starting all
   * three ticks' animations at the same instant would collapse a staggered volley into one
   * simultaneous flash and hide exactly the rhythm §1.4 is about. `event.tick + 1` is the moment
   * that tick's result first existed, so a blow from two ticks back opens two ticks into its own
   * curve — already past its peak, on its way out, which is where it should be.
   *
   * Nothing here reads or writes an authoritative value: the events are numbers copied out of a
   * projection, and every field they touch lives in `UnitAnim` or in a particle pool.
   */
  /** The figure for a unit, built on first sight. Both callers need it before they draw. */
  private ensureUnitVisual(unit: RenderUnit): UnitVisual {
    return this.units.get(unit.id) ?? (this.diorama ? this.createMiniature(unit) : this.createCard(unit))
  }

  private playActionEvents(snapshot: RenderSnapshot): void {
    const events = snapshot.actionEvents
    if (!events || events.length === 0) return
    this.eventsPlayed += events.length
    const units = new Map(snapshot.units.map((unit) => [unit.id, unit] as const))
    for (const event of events) {
      // Never ahead of the frame's own clock: a particle born in the future would sit at zero
      // scale, and an animation started in the future would freeze at its first frame.
      const at = Math.min(this.clock, event.tick + 1)
      const target = units.get(event.targetId)
      // The figure is BUILT HERE if this is the first the renderer has heard of the body, and
      // that is not a nicety: an enemy composed on tick N can be shot on tick N, and its first
      // frame is this one. Skipping the event instead lost 17 blows across a measured run.
      const visual = target ? this.ensureUnitVisual(target) : undefined
      // A target the snapshot does not carry at all has nothing on screen to move.
      if (!target || !visual) continue
      if (event.kind === 'death') {
        if (!visual.anim.dead) this.beginDeath(target, visual, at)
        continue
      }
      if (event.kind === 'revive') {
        this.beginRevive(visual, at)
        continue
      }
      const dx = event.targetX - event.sourceX
      const dz = event.targetY - event.sourceY
      const length = Math.hypot(dx, dz)
      const towardsX = length > 1e-6 ? dx / length : 0
      const towardsZ = length > 1e-6 ? dz / length : 1
      const attacker = event.sourceId === null ? undefined : units.get(event.sourceId)
      // The elite's area strike has no striker at the point of impact — its whole telegraph is
      // the warning and its shake is the blow — so nothing lunges for it.
      if (attacker && event.kind !== 'blast') {
        this.beginAttack(attacker, target, towardsX, towardsZ, at, event.kind === 'shot')
      }
      this.applyHit(visual, event.strength01, -towardsX, -towardsZ, at)
    }
  }

  /**
   * §1.11's completion — the one beat in this game that had none.
   *
   * Death gets a topple and a burst of paper; the opposite of death got a body quietly changing
   * which way it was lying. A person played it and said rescue did not feel like rescuing, and
   * half of that was the input (§1.11 v19 took that half); this is the other half.
   *
   * Three things at once, because the moment is short and the board is busy: the figure clears
   * whatever death animation it was mid-way through and stands, it flashes bright the way a hit
   * flashes but upward and warm, and it throws the same paper the death burst throws — the same
   * pooled particles, so the payoff costs no new draw call.
   */
  private beginRevive(visual: UnitVisual, at: number = this.clock): void {
    const anim = visual.anim
    anim.dead = false
    anim.buried = false
    anim.deathStart = Number.NEGATIVE_INFINITY
    anim.deathFromTopple = 0
    anim.flash = 1
    anim.flashScale = REVIVE_FLASH_SCALE
    anim.reviveStart = at
  }

  private beginDeath(unit: RenderUnit, visual: UnitVisual, at: number = this.clock): void {
    const anim = visual.anim
    anim.dead = true
    anim.deathStart = at
    // A friendly that bleeds out is already lying on its side; an enemy shot on its feet
    // starts upright. Reading the tilt back off the figure covers both without a flag.
    anim.deathFromTopple = clamp01(visual.card.rotation.z / (Math.PI / 2))
    anim.lungeStart = Number.NEGATIVE_INFINITY
    this.deathsObserved += 1
    this.spawnDeathBurst(unit, DEATH_TICKS * DEATH_BURST_FRACTION, at)
  }

  /**
   * A unit lost hit points this tick. The renderer cannot see the authority's damage
   * event, so it attributes the shot to the nearest hostile that is currently in the
   * `attacking` state — which is enough to aim the lunge, the muzzle and the recoil.
   */
  private registerDamage(unit: RenderUnit, visual: UnitVisual, snapshot: RenderSnapshot, damage01: number): void {
    const attacker = nearestAttacker(unit, snapshot.units)
    let awayX = 0
    let awayZ = 1
    if (attacker) {
      const dx = unit.x - attacker.x
      const dz = unit.y - attacker.y
      const length = Math.hypot(dx, dz) || 1
      awayX = dx / length
      awayZ = dz / length
      // The inferred path cannot tell a rifle from a fist, so it keeps the muzzle burst it has
      // always had. §액션 피드백's "근접형이 총구 퍼프를 뿜으면 안 된다" is answered on the
      // AUTHORED path, where the cause says which it was.
      this.beginAttack(attacker, unit, -awayX, -awayZ, this.clock, true)
    }
    this.applyHit(visual, damage01, awayX, awayZ, this.clock)
  }

  /**
   * The struck end of one blow: the paint flashes bright and the figure is shoved back inside
   * its own base. Both are display-only — the base never moves, so the authoritative position
   * this unit occupies is the same before and after.
   */
  private applyHit(visual: UnitVisual, damage01: number, awayX: number, awayZ: number, at: number): void {
    this.hitsObserved += 1
    const anim = visual.anim
    // §액션 피드백 does not say the flash should scale, and it is scaled anyway: an elite chipped
    // for 2% and a squadmate taking a third of its health are different events, and a flash of
    // one fixed size makes them the same one. The floor keeps the smallest blow visible.
    anim.flashScale = FLASH_FLOOR + (1 - FLASH_FLOOR) * clamp01(damage01 * FLASH_DAMAGE_GAIN)
    anim.hitStart = at
    anim.hitX = awayX
    anim.hitZ = awayZ
    // `awayX/awayZ` points from the attacker to this body, so the attacker is the other way.
    // Subtracting the figure's own yaw puts that direction in the figure's frame, and it is
    // frozen HERE rather than recomputed per frame: the body turns while it flinches (it is
    // still fighting), and a flinch that turned with it would read as chasing the blow.
    anim.hitBearing = Math.atan2(-awayX, -awayZ) - anim.yaw
  }

  /** `muzzle` is false for a blow landed by hand: a fist must not emit gun smoke. */
  private beginAttack(
    attacker: RenderUnit,
    target: RenderUnit,
    dirX: number,
    dirZ: number,
    at: number = this.clock,
    muzzle = true,
  ): void {
    const visual = this.units.get(attacker.id)
    if (!visual || visual.anim.dead) return
    const anim = visual.anim
    this.attacksObserved += 1
    anim.lungeStart = at
    anim.lungeX = dirX
    anim.lungeZ = dirZ
    anim.yaw = Math.atan2(dirX, dirZ)
    // THE ANIMATION IS ANCHORED TO THE EVENT, not to a free-running loop. `at` is `event.tick + 1`
    // — the instant that tick's blow first existed — so a swing that resolved two ticks ago opens
    // two ticks into its own curve, already past its peak. That is what keeps §1.4's volley
    // rhythm on screen: sixteen rifles whose first shots scatter and then converge play as
    // sixteen scattered raises converging into one, because each raise is dated by its own tick.
    if (this.clock >= anim.aimUntil) anim.aimStart = at
    anim.aimUntil = at + AIM_HOLD_TICKS
    anim.strikeStart = at
    // The cleaver class swings whichever path put the blow here. `muzzle` is false on the
    // authored path (`DamageEvent.cause` says `melee-contact`); the inferred path cannot tell a
    // rifle from a fist and passes true, and the archetype closes that half of the gap.
    anim.strikeRanged = muzzle && miniatureArchetype(attacker) !== 'melee'
    if (muzzle) this.spawnMuzzleBurst(attacker, target, dirX, dirZ, at)
    else this.spawnContactBurst(target, dirX, dirZ, at)
  }

  /**
   * A cotton puff at the weapon, plus three beads walking down the line of fire.
   *
   * THE PUFF COMES OFF THE BARREL AS IT IS ACTUALLY POSED. `MUZZLE_OFFSETS` is the barrel end in
   * the SCULPTED pose, and batch L placed the puff there — against a rifle that, since this
   * batch, has swung round to point down-range by the time the shot leaves it. So the offset is
   * put through the same rig, with the same inputs, at the same instant the frame will draw it:
   * the tick of the blow, with the weapon as far up as it has actually come and the kick at its
   * peak (`STRIKE_FIRE_FRACTION` is 0). The FIRST shot of an engagement therefore flashes off a
   * rifle still coming up, and every shot after it off a levelled one, which is what the figure
   * is doing on those frames.
   */
  private spawnMuzzleBurst(attacker: RenderUnit, target: RenderUnit, dirX: number, dirZ: number, at: number = this.clock): void {
    const fx = this.fx
    if (!fx) return
    const archetype = miniatureArchetype(attacker)
    const [restX, restY, restZ] = MUZZLE_OFFSETS[archetype]
    const anim = this.units.get(attacker.id)?.anim
    rigInputScratch.archetype = archetype
    rigInputScratch.phase = anim ? stridePhase(attacker.id, anim.travel) : 0
    rigInputScratch.stride = anim ? strideAmount(anim.step) : 0
    rigInputScratch.strike = STRIKE_FIRE_FRACTION
    rigInputScratch.strikeRanged = true
    rigInputScratch.aim = anim ? aimBlend(at, anim.aimStart, anim.aimUntil) : 1
    rigInputScratch.hit = 0
    rigInputScratch.hitBearing = 0
    poseFigure(rigPoseScratch, rigInputScratch)
    rigMatrices(muzzleRigScratch, rigPoseScratch, archetype, 1)
    muzzleScratch.set(restX, restY, restZ).applyMatrix4(muzzleRigScratch[RIG_ARM]!)
    const localX = muzzleScratch.x
    const localY = muzzleScratch.y
    const localZ = muzzleScratch.z
    const scale = cardScale(attacker) * FIGURE_SCALE
    const sin = dirX
    const cos = dirZ
    const muzzleX = attacker.x + (localX * cos + localZ * sin) * scale
    const muzzleZ = attacker.y + (-localX * sin + localZ * cos) * scale
    this.muzzleBursts += 1
    const muzzleY = localY * scale
    const now = at
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

  /**
   * A blow landed by hand. Dust at the point of contact and nothing at the attacker's weapon:
   * §액션 피드백's 솜뭉치 퍼프 is a MUZZLE puff, and a melee figure that emitted one would be
   * telling the player it shoots — which is the one thing §4.5's "어디에 멈출지" hangs on.
   */
  private spawnContactBurst(target: RenderUnit, dirX: number, dirZ: number, at: number): void {
    const fx = this.fx
    if (!fx) return
    this.contactBursts += 1
    const contactX = target.x - dirX * target.radius
    const contactZ = target.y - dirZ * target.radius
    fx.puffs.spawn(at, {
      x: contactX, y: 0.55, z: contactZ,
      vx: dirX * 0.02, vy: 0.012, vz: dirZ * 0.02,
      life: 5, startSize: 0.34, endSize: 0.78, color: CONTACT_DUST,
    })
  }

  /** Paper scraps, delayed so the figure gets to topple before it comes apart. */
  private spawnDeathBurst(unit: RenderUnit, delayTicks: number, at: number = this.clock): void {
    const fx = this.fx
    if (!fx) return
    const tint = unit.kind === 'elite'
      ? ELITE_SCRAP_TINT
      : SCRAP_TINTS[unit.team === 'enemy' ? 'hostile' : 'friendly']
    const burstAt = at + delayTicks
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
      visual.anim.aimStart = Number.NEGATIVE_INFINITY
      visual.anim.strikeStart = Number.NEGATIVE_INFINITY
      // The stride's phase is an accumulator, and a restart rewinds the clock it was
      // accumulated against. Carrying it over would put the new battle's tick 0 at whatever
      // phase the old battle's last tick reached, which is exactly the drift the rest of this
      // method exists to prevent.
      visual.anim.strideTick = Number.NEGATIVE_INFINITY
      visual.anim.travel = 0
      visual.anim.step = 0
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
   * One unit costs four meshes and no more: the merged body, the base ring, the contact
   * shadow, and the health gauge the spec's budget names as the fourth. The body's primitives
   * (base disc, legs, torso, pauldrons, head, weapon, and whatever the class cue is) are
   * merged per archetype at build time and the paint variation is baked into vertex colours,
   * so a whole figure still renders in a single draw call with a single material — the extra
   * detail batch J sculpted costs vertices, not draw calls.
   */
  private createMiniature(unit: RenderUnit): UnitVisual {
    const assets = this.diorama!
    const archetype = miniatureArchetype(unit)
    const leader = isLeader(unit)
    const root = new THREE.Group(); root.name = `unit:${unit.id}`

    const shadow = new THREE.Mesh(assets.contactShadowGeometry, new THREE.MeshBasicMaterial({ map: assets.contactShadowTexture, color: CONTACT_SHADOW_COLOR, transparent: true, opacity: CONTACT_SHADOW_OPACITY, depthWrite: false, toneMapped: false }))
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.012, 0)
    if (leader) shadow.scale.setScalar(1.5)

    // `emissive` is what a hit flash rides on: raising `emissiveIntensity` for a few
    // ticks brightens the figure without touching the faction paint underneath it.
    const material = new THREE.MeshPhongMaterial({ color: miniaturePaint(unit), vertexColors: true, emissive: FLASH_COLOR, emissiveIntensity: 0, specular: MINIATURE_SPECULAR, shininess: MINIATURE_SHININESS })
    const card = new THREE.Mesh(assets.miniatures[archetype], material)
    card.name = `miniature:${archetype}`
    card.castShadow = true
    // The rig, and the SECOND material that carries it. The shadow-map pass draws the body with
    // its own depth material, and a depth material without the rig would cast the shadow of a
    // figure standing still under one that is walking. It is not a fifth mesh — the shadow pass
    // already drew this same body — so the four-per-unit budget is untouched.
    const rig = { value: createRigMatrices() }
    ;(material as RiggedMaterial).userData.rig = rig
    material.onBeforeCompile = applyRigShader
    const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    ;(depthMaterial as RiggedMaterial).userData.rig = rig
    depthMaterial.onBeforeCompile = applyRigShader
    card.customDepthMaterial = depthMaterial

    const marker = new THREE.Mesh(assets.baseRingGeometry, flatMaterial(LEADER_MARKER_COLOR, RING_BASE_OPACITY))
    marker.rotation.x = -Math.PI / 2; marker.position.y = 0.03
    if (leader) marker.scale.setScalar(LEADER_RING_SCALE)

    // The gauge hangs off the body's own bounding box rather than off a table of hand-copied
    // head heights, so re-sculpting a figure can never leave its bar buried in its helmet.
    const gauge = new THREE.Mesh(
      createHealthGaugeGeometry(),
      // `forceSinglePass`: a transparent double-sided material is drawn twice by default, and
      // the gauge is one flat quad pair with nothing to sort against itself. Without it the
      // bar costs two draw calls and the four-per-unit budget is broken by the thing the
      // budget was widened to hold.
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: GAUGE_OPACITY, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false }),
    )
    gauge.name = 'unit-health-gauge'
    gauge.renderOrder = 4
    gauge.position.y = bodyTop(assets.miniatures[archetype]) + GAUGE_HEADROOM
    gauge.visible = false

    root.add(shadow, card, marker, gauge); this.scene!.add(root)
    const anim = createUnitAnim(unit)
    // A unit that is already gone when its visual is built (a renderer remounted mid
    // battle) is adopted as buried rather than replayed as a fresh death.
    if (isUnitDead(unit)) { anim.dead = true; anim.deathStart = Number.NEGATIVE_INFINITY; anim.deathFromTopple = 1 }
    const visual: UnitVisual = { root, card, shadow, marker, gauge, rig: rig.value, archetype, anim }
    this.units.set(unit.id, visual)
    return visual
  }

  /**
   * Points the gauge at the camera and fills it to `hp01`.
   *
   * The visibility rule is the spec's, verbatim: the sixteen friendlies are always shown,
   * a hostile only once it has actually been hurt, and a downed body shows none — §1.11's
   * countdown is what matters for that body, and it is on the roster strip in the HUD, not
   * on the board. The fill is written into the geometry only on the frames where the value
   * moved, so a full-health board writes nothing at all.
   */
  private updateGauge(unit: RenderUnit, visual: UnitVisual, downed: boolean): void {
    const gauge = visual.gauge
    if (!gauge || !this.camera) return
    const anim = visual.anim
    const hostile = unit.team === 'enemy'
    const visible = !anim.buried && !anim.dead && !downed && (!hostile || unit.hp01 < 1 - 1e-6)
    gauge.visible = visible
    if (!visible) return
    gauge.quaternion.copy(this.camera.quaternion)
    if (Math.abs(anim.gaugeFill - unit.hp01) < 1e-4) return
    anim.gaugeFill = unit.hp01
    setHealthGaugeFill(gauge.geometry, unit.hp01)
    setHealthGaugeColor(gauge.geometry, gaugeFillColor(hostile, unit.hp01))
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
    if (visual.kind === 'downed-marker' && visual.beam) {
      this.animateDownedPin(visual, effect)
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
    if (visual.overlay) {
      // Same radius as the band under it, so the outline is the footprint and not a decoration
      // near it. It brightens with the same countdown, and its floor is what keeps it readable
      // at the darkest part of the pulse — an outline that faded out is not an outline.
      visual.overlay.scale.setScalar(radius)
      ;(visual.overlay.material as THREE.MeshBasicMaterial).opacity =
        TELEGRAPH_OVERLAY_BASE_OPACITY + pulse * TELEGRAPH_OVERLAY_PULSE_OPACITY
    }
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
  /**
   * §1.11's countdown, expressed as colour and height rather than as a number.
   *
   * `urgency01` arrives 1 on the tick a body falls and 0 as it is about to die. The pin cools
   * from white to amber and shortens as it drains, and the pulse quickens — three channels on
   * one fact because the board is busy and the glance is short. A number would be exact and
   * unreadable at the distance this signal exists to be read from.
   *
   * The projection sends `urgency01` only for this kind; the fallback of 1 keeps a marker
   * visible rather than invisible if it ever arrives without one, which is the failure that
   * costs a life rather than a frame.
   */
  private animateDownedPin(visual: EffectVisual, effect: RenderEffect): void {
    const urgency = effect.urgency01 ?? 1
    const beam = visual.beam!
    const pool = visual.pool!
    // Faster as it runs out: 2.2 rad/s at full, 7 rad/s at the end.
    const pulse = 0.72 + 0.28 * Math.sin(this.clock * (2.2 + 5 * (1 - urgency)))
    const tint = new THREE.Color(DOWNED_PIN_HOT).lerp(new THREE.Color(DOWNED_PIN_COLD), urgency)
    const beamMaterial = beam.material as THREE.MeshBasicMaterial
    const poolMaterial = pool.material as THREE.MeshBasicMaterial
    beamMaterial.color.copy(tint)
    poolMaterial.color.copy(tint)
    // NOT dimmer when calmer. The first version faded with urgency, which put the pin at its
    // faintest at full countdown — exactly the moment the player still HAS the choice. The
    // pulse now rides on top of a floor that never drops out of sight.
    beamMaterial.opacity = 0.72 + 0.24 * pulse
    poolMaterial.opacity = 0.6 + 0.3 * pulse
    // Sinks as the countdown drains — full height at 1, three fifths at 0.
    const height = DOWNED_PIN_HEIGHT * (0.6 + 0.4 * urgency)
    beam.scale.set(DOWNED_PIN_RADIUS, height, DOWNED_PIN_RADIUS)
    beam.position.y = height / 2
    pool.scale.setScalar(1.05 + 0.25 * pulse)
    visual.root.quaternion.copy(this.camera!.quaternion)
    visual.root.rotation.x = 0
    visual.root.rotation.z = 0
  }

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
    // RETIRED VISUALS COME BACK RATHER THAN BEING REBUILT, and this is the other half of batch
    // L's unattributed spike. §1.12's elite warns, strikes and warns again every
    // `ELITE_COOLDOWN_TICKS`, and every cycle used to build four fresh meshes with four fresh
    // materials INSIDE `render` — on the first frame of a warning, which is a frame that is
    // already drawing a full board and a new ring. The dressing is identical between cycles, so
    // the second warning is the first one put back on the board.
    const retired = this.retiredEffects.get(effect.kind)?.pop()
    if (retired) {
      retired.root.name = `effect:${effect.kind}:${effect.id}`
      this.scene!.add(retired.root)
      this.effects.set(effect.id, retired)
      return retired
    }
    const root = new THREE.Group(); root.name = `effect:${effect.kind}:${effect.id}`
    const fx = this.fx
    let visual: EffectVisual
    if (effect.kind === 'elite-telegraph') {
      const area = new THREE.Mesh(this.telegraphGeometry!, flatMaterial(this.diorama ? TELEGRAPH_SIGIL_COLOR : TELEGRAPH_COLOR, 0.42))
      area.rotation.x = -Math.PI / 2; area.position.y = 0.02
      root.add(area)
      // The over-body outline, and it is diorama-only: the `?lab=renderers` comparison keeps
      // exactly the flat cardboard telegraph `hybrid-renderer.spec.ts` pins. `depthTest: false`
      // is the whole mechanism — the bodies are still drawn in front of it in space, and the
      // fragment shader simply does not ask. It is the SAME circle at the SAME authoritative
      // radius as the band under it, so the two can never disagree about the strike's footprint.
      let overlay: THREE.Mesh | undefined
      if (this.diorama) {
        // `flatMaterial` rather than a hand-rolled `MeshBasicMaterial`, for two measured
        // reasons. It is the SAME material recipe as the ground band, so the outline wears the
        // same colour under the tone curve instead of a tone-mapped version of it — and it is
        // the same shader program, so building it costs no compile. A hand-rolled variant
        // differed in `side` and `toneMapped`, which are both program parameters in three.js,
        // and the compile it forced added 6-9 ms to the draw of every telegraph frame.
        const overlayMaterial = flatMaterial(TELEGRAPH_SIGIL_COLOR, TELEGRAPH_OVERLAY_BASE_OPACITY)
        overlayMaterial.depthTest = false
        overlay = new THREE.Mesh(this.telegraphOverlayGeometry!, overlayMaterial)
        overlay.rotation.x = -Math.PI / 2
        overlay.position.y = 0.03
        overlay.renderOrder = TELEGRAPH_OVERLAY_RENDER_ORDER
        root.add(overlay)
      }
      if (fx) {
        const countdown = new THREE.Mesh(fx.discGeometry, new THREE.MeshBasicMaterial({ color: 0xb01f16, transparent: true, opacity: 0.2, depthWrite: false }))
        countdown.rotation.x = -Math.PI / 2; countdown.position.y = 0.014; countdown.renderOrder = 1
        const sigil = new THREE.Mesh(fx.discGeometry, new THREE.MeshBasicMaterial({ map: fx.sigilTexture, color: TELEGRAPH_SIGIL_COLOR, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }))
        sigil.rotation.x = -Math.PI / 2; sigil.position.y = 0.024; sigil.renderOrder = 2
        root.add(countdown, sigil)
        visual = { root, kind: effect.kind, sigil, countdown, overlay }
      } else {
        visual = { root, kind: effect.kind, overlay }
      }
    } else if (effect.kind === 'downed-marker' && fx) {
      // THE PIN IS DELIBERATELY NOT THE GOLD PILLAR, and the difference carries meaning rather
      // than taste. The pillar means "press Space now" — it only ever attaches inside
      // `RESCUE_RANGE`. The pin means "somebody is on the ground out there", which is a
      // question and not an instruction. So: thin and cold against the pillar's wide warm gold.
      //
      // `depthTest: false` is load-bearing, not polish. A downed body lies ON the tabletop at a
      // 23-degree camera, so the miniatures still standing hide it exactly when the board is
      // busiest — which is the only time anyone goes down. The beam is drawn through them.
      const beam = new THREE.Mesh(fx.pillarGeometry, new THREE.MeshBasicMaterial({
        // NORMAL BLENDING, not additive like every other effect in this file, and the board is
        // why. Additive can only ADD to what is behind it, and §디오라마's tabletop is a bright
        // sandy tan — a cold beam added to it washes toward white and disappears. Measured on a
        // real down at tick 1475: the additive version was a pale streak most of a screen-width
        // from the commander and easy to miss entirely. Normal blending lets the pin be a
        // colour the sand is not.
        map: fx.pillarTexture, color: DOWNED_PIN_COLD, transparent: true, opacity: 0.92,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }))
      beam.position.y = DOWNED_PIN_HEIGHT / 2
      beam.scale.set(DOWNED_PIN_RADIUS, DOWNED_PIN_HEIGHT, DOWNED_PIN_RADIUS)
      beam.renderOrder = DOWNED_PIN_RENDER_ORDER
      const pool = new THREE.Mesh(fx.quadGeometry, new THREE.MeshBasicMaterial({
        map: fx.rescueRingTexture, color: DOWNED_PIN_COLD, transparent: true, opacity: 0.85,
        depthTest: false, depthWrite: false,
      }))
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.06; pool.scale.setScalar(1.15)
      pool.renderOrder = DOWNED_PIN_RENDER_ORDER
      root.add(beam, pool)
      visual = { root, kind: effect.kind, beam, pool }
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
    return { id: unit.id, x: visual.root.position.x, y: visual.root.position.z, tint: (visual.card.material as TintedBodyMaterial).color.getHex(), billboard: !this.diorama, facesCamera: this.facesCamera(visual.card), screenY: (1 - center.y) * canvasHeight / 2, screenHeight: Math.abs(top.y - bottom.y) * canvasHeight / 2, kind: unit.kind, state: unit.state, cardCenter, shadowNormalY: shadowNormal.y, markerNormalY: markerNormal.y, shadowFootprint: { x: shadowFootprint.x, z: shadowFootprint.z } }
  }

  private removeVisual<T extends { readonly root: THREE.Group; readonly gauge?: THREE.Mesh }>(collection: Map<number, T>, id: number, visual: T): void {
    visual.root.removeFromParent()
    disposeObjectMaterials(visual.root)
    // Every other geometry in a unit is shared with the whole roster; the gauge's is not,
    // because its fill lives in the vertex positions. It dies with the unit.
    visual.gauge?.geometry.dispose()
    collection.delete(id)
  }

  /**
   * An effect has left the snapshot. Its dressing is kept for the next one of its kind rather
   * than disposed — see `createEffectVisual`. It is off the scene graph the moment it retires, so
   * it is neither drawn nor counted, and `dispose()` is what finally frees it.
   */
  private retireEffect(id: number, visual: EffectVisual): void {
    visual.root.removeFromParent()
    this.effects.delete(id)
    const pool = this.retiredEffects.get(visual.kind)
    if (pool) pool.push(visual)
    else this.retiredEffects.set(visual.kind, [visual])
  }
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
    const requiredHalfHeight = (worldHeight / 2 + DIORAMA_EDGE_MARGIN) * Math.sin(pitch) + this.figureHeadroom * Math.cos(pitch)
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
    // The BOARD, which is where play is confined — not the camera's window onto it. They are the
    // same rectangle for v1 and the lab, which publish no `playArea`; they are not the same for a
    // camera that follows a unit, and drawing the rail at the window's edge would paint a
    // boundary that walks around with the player.
    const { centerX, centerY, worldWidth, worldHeight } = snapshot.playArea ?? snapshot.camera
    const view = snapshot.camera
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
      //
      // The LIGHTS track the view and not the board: the shadow camera covers a fixed span
      // around wherever it is aimed, so aiming it at a board centre the player has walked away
      // from would leave the lit half of the arena without shadows.
      if (this.diorama) light.position.set(view.centerX - 26, 22, view.centerY + 30)
      else light.position.set(view.centerX - 8, CAMERA_HEIGHT - 2, view.centerY + 10)
      light.target.position.set(view.centerX, 0, view.centerY)
      light.target.updateMatrixWorld()
    }
    this.updateFrameRails(centerX, centerY, worldWidth, worldHeight)
    const rim = this.scene?.getObjectByName(RIM_LIGHT_NAME) as THREE.DirectionalLight | undefined
    if (rim) {
      rim.position.set(view.centerX + 12, 9, view.centerY - 14)
      rim.target.position.set(view.centerX, 0, view.centerY)
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
    reviveStart: Number.NEGATIVE_INFINITY,
    lungeX: 0,
    lungeZ: 1,
    lungeOffset: 0,
    hitStart: Number.NEGATIVE_INFINITY,
    hitX: 0,
    hitZ: 1,
    hitBearing: 0,
    flash: 0,
    flashScale: 1,
    deathStart: Number.NEGATIVE_INFINITY,
    deathFromTopple: 0,
    dead: false,
    buried: false,
    hp01: unit.hp01,
    x: unit.x,
    y: unit.y,
    gaugeFill: -1,
    strideTick: Number.NEGATIVE_INFINITY,
    travel: 0,
    step: 0,
    strikeStart: Number.NEGATIVE_INFINITY,
    strikeRanged: true,
    aimStart: Number.NEGATIVE_INFINITY,
  }
}

/**
 * How far the weapon is up, in closed form.
 *
 * The value is a function of `(clock, aimStart, aimUntil)` and of nothing else — no smoothing
 * against the previous frame — so the SAME TICK gives the SAME POSE however the frames fell
 * around it, which is what makes the rig's determinism testable at all. It rises over
 * `AIM_RAISE_TICKS` from the shot that armed it and falls over `AIM_RELEASE_TICKS` as the hold
 * runs out; a unit that fires again mid-hold never lowers.
 */
/**
 * How long the curve for THIS blow runs, in ticks.
 *
 * Three lengths, one per weapon that exists, and each is shorter than the shortest interval the
 * authority can produce for it — a curve longer than its own interval restarts from its middle
 * every time and never reads as a completed action:
 *
 *   ranged        8  <  SOLDIER_ATTACK_INTERVAL 12, COMMANDER_ATTACK_INTERVAL 10
 *   cleaver      12  <  MELEE_ATTACK_INTERVAL 15
 *   trooper swing 6  <  COMMANDER_MELEE_INTERVAL 8, and under the 7 that §1.13's `연사` makes it
 *
 * `tests/figure-rig.test.ts` pins all three against the authority constants.
 */
function strikeTicksFor(archetype: MiniatureArchetype | undefined, ranged: boolean): number {
  if (ranged) return STRIKE_TICKS_RANGED
  return archetype === 'melee' ? STRIKE_TICKS_MELEE : STRIKE_TICKS_COMMAND_MELEE
}

function aimBlend(clock: number, aimStart: number, aimUntil: number): number {
  if (!(aimUntil > clock)) return 0
  return clamp01((clock - aimStart) / AIM_RAISE_TICKS) * clamp01((aimUntil - clock) / AIM_RELEASE_TICKS)
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

/** Leaders and the elite are drawn larger; this is the largest scale any unit is ever given. */
const LEADER_CARD_SCALE = 1.25

function cardScale(unit: RenderUnit): number {
  if (isLeader(unit)) return LEADER_CARD_SCALE
  return unit.state === 'downed' ? 0.85 : 1
}

function markerColor(unit: RenderUnit, marksActiveSquad: boolean): number {
  if (unit.state === 'downed') return DOWNED_MARKER_COLOR
  if (unit.kind === 'enemy-commander' || unit.kind === 'elite') return HOSTILE_LEADER_MARKER_COLOR
  return marksActiveSquad ? TEAM_TINTS[unit.team] : LEADER_MARKER_COLOR
}

/**
 * One archetype per `UnitKind`, which is the only class signal the authority publishes.
 *
 * The two hostile names read oddly and are not this module's to rename: `core/battle-view`
 * projects §1.9's melee class as `enemy` and its RANGED class as `enemy-commander`, a label
 * left over from v1's roster. What the board shows is the class — a shield-and-cleaver brute
 * against a hooded figure with a levelled rifle — not a chain of command.
 */
function miniatureArchetype(unit: RenderUnit): MiniatureArchetype {
  switch (unit.kind) {
    case 'elite': return 'elite'
    case 'commander': return 'command'
    case 'charger': return 'melee'
    case 'enemy': return 'melee'
    case 'enemy-commander': return 'shooter'
    default: return unit.team === 'enemy' ? 'melee' : 'soldier'
  }
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

/**
 * The top of a merged body, in the unit root's space. `merge()` computes the box after the
 * figure scale is applied, so this is the height the gauge has to clear.
 */
function bodyTop(geometry: THREE.BufferGeometry): number {
  return geometry.boundingBox?.max.y ?? 2
}

/**
 * The tallest point any unit can put on the board: the tallest merged body, grown by the
 * largest root scale a unit is ever drawn at, plus the gauge that floats over its head.
 *
 * §4.4's framing is what this feeds, and the alternative — a hand-written constant — is a
 * silent liability: the elite's staff was re-sculpted in this batch and grew past the number
 * that was written down for it.
 */
function measureFigureHeadroom(assets: DioramaAssets): number {
  const tallest = Math.max(...Object.values(assets.miniatures).map((geometry) => bodyTop(geometry)))
  return tallest * LEADER_CARD_SCALE + GAUGE_HEADROOM + GAUGE_HEIGHT
}

/**
 * The fill's colour at a given health. Two stages through an amber middle, because a single
 * lerp spends most of its range looking healthy and the drop that matters is the last third.
 *
 * The two ends differ by side: a wounded hostile must not read as a wounded friendly at a
 * glance, and the bar is small enough that colour is the only thing carrying that.
 */
function gaugeFillColor(hostile: boolean, hp01: number): THREE.Color {
  const full = hostile ? GAUGE_HOSTILE_FULL : GAUGE_FRIENDLY_FULL
  const mid = hostile ? GAUGE_HOSTILE_MID : GAUGE_FRIENDLY_MID
  const health = clamp01(hp01)
  return health >= 0.5
    ? gaugeScratch.setHex(mixHex(mid, full, (health - 0.5) * 2))
    : gaugeScratch.setHex(mixHex(GAUGE_LOW, mid, health * 2))
}

function mixHex(from: number, to: number, amount: number): number {
  const channel = (shift: number) => Math.round((((from >> shift) & 0xff) * (1 - amount)) + (((to >> shift) & 0xff) * amount))
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

function shadowTargetSize(light: THREE.DirectionalLight | undefined): { width: number; height: number } | null {
  const target = light?.shadow.map
  return target ? { width: target.width, height: target.height } : null
}
