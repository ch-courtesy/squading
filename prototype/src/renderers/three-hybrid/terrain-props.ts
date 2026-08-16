import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { cosmeticRandom } from './diorama-assets'

/**
 * The terrain that surrounds the play area: wooden crate stacks, plank barricades,
 * painted conifers, faction banners, sandbag piles and scattered debris.
 *
 * Everything here is decoration. The placement runs off its own cosmetic seed, is
 * evaluated once when the diorama presentation is applied, and never reaches the
 * authority state: it reads only the arena bounds the snapshot already publishes and
 * writes nothing back. No prop is ever placed inside the play area, so a prop can not
 * be mistaken for cover the simulation does not model.
 *
 * Geometry-wise every prop is built from Three.js primitives, has its UVs remapped
 * into one code-generated canvas atlas and its paint baked into vertex colours, so the
 * whole set merges into a single mesh with a single material — one draw call for the
 * lot, plus one more for the dirt apron they stand on. Both are built once, at mount.
 */

/** Cosmetic-only seed. Deliberately unrelated to any gameplay seed or PRNG. */
export const TERRAIN_PROP_SEED = 0x2f6ab19

export type TerrainPropKind = 'conifer' | 'crates' | 'barricade' | 'banner' | 'sandbags' | 'debris'

export type TerrainBounds = {
  readonly centerX: number
  readonly centerY: number
  readonly worldWidth: number
  readonly worldHeight: number
}

export type PropPlacement = {
  readonly kind: TerrainPropKind
  /** Board-space position. `z` is the snapshot's `y` axis. */
  readonly x: number
  readonly z: number
  /** Distance from the nearest play-area boundary, always positive. */
  readonly clearance: number
  /** `far` is the edge away from the camera, `near` is the edge the camera sits behind. */
  readonly side: 'far' | 'near'
  readonly rotation: number
  readonly scale: number
  /** Cosmetic 0..1 variation the builders use for silhouette and paint noise. */
  readonly variant: number
}

export type TerrainProps = {
  readonly meshes: readonly THREE.Mesh[]
  readonly placements: readonly PropPlacement[]
  dispose(): void
}

type KindSpec = {
  readonly kind: TerrainPropKind
  readonly weight: number
  /** Tallest silhouette the builder can produce at `scale` 1, used for the sightline rule. */
  readonly maxHeight: number
  /** Footprint radius used to keep props from growing into each other. */
  readonly radius: number
}

const KIND_SPECS: readonly KindSpec[] = [
  { kind: 'conifer', weight: 26, maxHeight: 3.3, radius: 1.05 },
  { kind: 'crates', weight: 22, maxHeight: 1.6, radius: 1.0 },
  { kind: 'barricade', weight: 12, maxHeight: 1.25, radius: 1.5 },
  { kind: 'banner', weight: 8, maxHeight: 3.1, radius: 0.7 },
  { kind: 'sandbags', weight: 12, maxHeight: 0.8, radius: 0.9 },
  { kind: 'debris', weight: 20, maxHeight: 0.4, radius: 0.55 },
]

/** Props start beyond the raised edge frame, never on it and never inside the board. */
export const PROP_KEEP_OUT = 2.1
/** How deep the decorated belt runs past each long edge of the board. */
const BELT_DEPTH = 20
/** How far past the left and right board edges props may sit; the camera crops there. */
const BELT_OVERHANG = 2.2
const PROP_COUNT = 150
/** The far belt reads as background scenery, so it carries slightly more of the set. */
const FAR_SIDE_SHARE = 0.56
/**
 * Screen-space clearance rule. At the staged camera pitch a prop of height `h` hides
 * `h * sightlineSlope` of board behind it, so a prop on the *near* belt may only be as
 * tall as its distance from the board allows. Far-belt props hide nothing but terrain.
 */
const DEFAULT_SIGHTLINE_SLOPE = 1.85
/** How far the dirt apron runs past the play area; it has to reach the frame on all sides. */
const APRON_PAD = 46
const APRON_TILE = 7.5

export type TerrainPlanOptions = {
  readonly seed?: number
  readonly count?: number
  readonly sightlineSlope?: number
}

/**
 * Deterministic placement. Pure: no canvas, no WebGL, no authority state — which is
 * what lets a unit test prove the play area stays clear of props.
 */
export function planTerrainProps(bounds: TerrainBounds, options: TerrainPlanOptions = {}): readonly PropPlacement[] {
  const seed = options.seed ?? TERRAIN_PROP_SEED
  const count = options.count ?? PROP_COUNT
  const sightlineSlope = options.sightlineSlope ?? DEFAULT_SIGHTLINE_SLOPE
  const random = cosmeticRandom(seed)
  const halfWidth = bounds.worldWidth / 2
  const halfHeight = bounds.worldHeight / 2
  const placements: PropPlacement[] = []

  for (let attempt = 0; attempt < count * 8 && placements.length < count; attempt += 1) {
    const side = random() < FAR_SIDE_SHARE ? 'far' : 'near'
    // Biased towards the board edge: the belt closest to the play area is the part the
    // camera actually frames, and the tail keeps the far corners from going bare.
    const clearance = PROP_KEEP_OUT + Math.pow(random(), 1.7) * BELT_DEPTH
    const spanX = random()
    const rotation = random() * Math.PI * 2
    const variant = random()
    const scale = 0.82 + random() * 0.5
    const heightLimit = side === 'near' ? clearance / sightlineSlope : Number.POSITIVE_INFINITY
    const spec = pickKind(random(), heightLimit, scale)
    if (!spec) continue
    const x = bounds.centerX + (spanX * 2 - 1) * (halfWidth + BELT_OVERHANG)
    const z = side === 'far' ? bounds.centerY - halfHeight - clearance : bounds.centerY + halfHeight + clearance
    const radius = spec.radius * scale
    const crowded = placements.some((other) => {
      const separation = (radius + KIND_SPECS.find((candidate) => candidate.kind === other.kind)!.radius * other.scale) * 0.62
      const dx = other.x - x
      const dz = other.z - z
      return dx * dx + dz * dz < separation * separation
    })
    if (crowded) continue
    placements.push({ kind: spec.kind, x, z, clearance, side, rotation, scale, variant })
  }

  return placements
}

function pickKind(roll: number, heightLimit: number, scale: number): KindSpec | null {
  const allowed = KIND_SPECS.filter((spec) => spec.maxHeight * scale <= heightLimit)
  if (allowed.length === 0) return null
  const total = allowed.reduce((sum, spec) => sum + spec.weight, 0)
  let cursor = roll * total
  for (const spec of allowed) {
    cursor -= spec.weight
    if (cursor <= 0) return spec
  }
  return allowed[allowed.length - 1]!
}

/** Height the placement rule promises this prop will not exceed. */
export function propMaxHeight(kind: TerrainPropKind, scale: number): number {
  return KIND_SPECS.find((spec) => spec.kind === kind)!.maxHeight * scale
}

// --- Painted atlas ---------------------------------------------------------------
// One 512x512 canvas holding four painted cells. Every prop face is remapped into one
// of them, so the entire surround needs a single texture and therefore a single
// material — which is what lets it merge into one mesh.

type AtlasCell = readonly [number, number]
const CELL_CRATE: AtlasCell = [0, 0]
const CELL_PLANK: AtlasCell = [1, 0]
const CELL_FOLIAGE: AtlasCell = [0, 1]
const CELL_CLOTH: AtlasCell = [1, 1]
const CELL_PAD = 0.016

function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable for the procedural terrain prop atlas')
  return context
}

function paintCrateCell(context: CanvasRenderingContext2D, originX: number, originY: number, size: number, random: () => number): void {
  context.save()
  context.translate(originX, originY)
  context.fillStyle = '#b98a52'
  context.fillRect(0, 0, size, size)
  // Horizontal slats with recessed joints.
  const slats = 4
  for (let index = 0; index < slats; index += 1) {
    const y = (size / slats) * index
    context.fillStyle = index % 2 === 0 ? 'rgba(146,102,56,0.30)' : 'rgba(214,172,120,0.24)'
    context.fillRect(0, y, size, size / slats)
    context.fillStyle = 'rgba(58,36,16,0.55)'
    context.fillRect(0, y - 2, size, 4)
  }
  // Grain.
  for (let index = 0; index < 140; index += 1) {
    const y = random() * size
    context.strokeStyle = random() > 0.5 ? 'rgba(72,46,22,0.16)' : 'rgba(226,192,146,0.16)'
    context.lineWidth = 0.7 + random() * 1.5
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(size, y + (random() - 0.5) * 5)
    context.stroke()
  }
  // Corner posts and the diagonal brace that makes a box read as a crate.
  context.fillStyle = 'rgba(126,84,42,0.85)'
  context.fillRect(0, 0, size * 0.09, size)
  context.fillRect(size * 0.91, 0, size * 0.09, size)
  context.fillRect(0, 0, size, size * 0.09)
  context.fillRect(0, size * 0.91, size, size * 0.09)
  context.strokeStyle = 'rgba(126,84,42,0.9)'
  context.lineWidth = size * 0.07
  context.beginPath()
  context.moveTo(size * 0.1, size * 0.1)
  context.lineTo(size * 0.9, size * 0.9)
  context.moveTo(size * 0.9, size * 0.1)
  context.lineTo(size * 0.1, size * 0.9)
  context.stroke()
  // Nail heads.
  context.fillStyle = 'rgba(48,32,18,0.7)'
  for (const [nx, ny] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.5]] as const) {
    context.beginPath()
    context.arc(size * nx, size * ny, size * 0.014, 0, Math.PI * 2)
    context.fill()
  }
  // Edge shading so a flat box face still turns at the corners.
  const vignette = context.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(40,24,10,0.30)')
  context.fillStyle = vignette
  context.fillRect(0, 0, size, size)
  context.restore()
}

function paintPlankCell(context: CanvasRenderingContext2D, originX: number, originY: number, size: number, random: () => number): void {
  context.save()
  context.translate(originX, originY)
  context.fillStyle = '#a3744a'
  context.fillRect(0, 0, size, size)
  for (let index = 0; index < 170; index += 1) {
    const x = random() * size
    context.strokeStyle = random() > 0.5 ? 'rgba(60,38,18,0.20)' : 'rgba(206,168,124,0.18)'
    context.lineWidth = 0.7 + random() * 2
    context.beginPath()
    context.moveTo(x, 0)
    context.bezierCurveTo(x + (random() - 0.5) * 8, size * 0.35, x + (random() - 0.5) * 8, size * 0.7, x + (random() - 0.5) * 6, size)
    context.stroke()
  }
  // Knots.
  for (let index = 0; index < 3; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = size * (0.02 + random() * 0.03)
    context.strokeStyle = 'rgba(64,40,18,0.4)'
    context.lineWidth = 2
    for (let ring = 3; ring > 0; ring -= 1) {
      context.beginPath()
      context.ellipse(x, y, radius * ring * 0.4, radius * ring * 0.6, random(), 0, Math.PI * 2)
      context.stroke()
    }
  }
  context.fillStyle = 'rgba(46,28,12,0.35)'
  context.fillRect(0, 0, size, size * 0.04)
  context.fillRect(0, size * 0.96, size, size * 0.04)
  context.restore()
}

function paintFoliageCell(context: CanvasRenderingContext2D, originX: number, originY: number, size: number, random: () => number): void {
  context.save()
  context.translate(originX, originY)
  context.fillStyle = '#3c6b45'
  context.fillRect(0, 0, size, size)
  context.lineCap = 'round'
  // Needle clusters: short strokes fanning downward, the way a painted conifer is
  // drybrushed over a dark basecoat.
  for (let index = 0; index < 900; index += 1) {
    const x = random() * size
    const y = random() * size
    const length = 4 + random() * 16
    const lean = (random() - 0.5) * 0.9
    const bright = random()
    context.strokeStyle = bright > 0.72
      ? 'rgba(139,187,122,0.45)'
      : bright > 0.4
        ? 'rgba(84,140,86,0.4)'
        : 'rgba(30,66,44,0.45)'
    context.lineWidth = 1 + random() * 2
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + lean * length, y + length)
    context.stroke()
  }
  // A few dusty highlights read as the dry pigment on the tips.
  for (let index = 0; index < 60; index += 1) {
    context.fillStyle = 'rgba(186,214,150,0.30)'
    context.beginPath()
    context.arc(random() * size, random() * size, 1 + random() * 2.4, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function paintClothCell(context: CanvasRenderingContext2D, originX: number, originY: number, size: number, random: () => number): void {
  context.save()
  context.translate(originX, originY)
  context.fillStyle = '#e8dcc4'
  context.fillRect(0, 0, size, size)
  // Burlap weave: this cell dresses both the banners and the sandbag piles, so it has
  // to read as woven cloth under any tint.
  context.strokeStyle = 'rgba(150,126,90,0.22)'
  context.lineWidth = 1
  for (let index = 0; index < size; index += 4) {
    context.beginPath()
    context.moveTo(index, 0)
    context.lineTo(index, size)
    context.moveTo(0, index)
    context.lineTo(size, index)
    context.stroke()
  }
  for (let index = 0; index < 130; index += 1) {
    context.fillStyle = random() > 0.5 ? 'rgba(120,96,64,0.16)' : 'rgba(255,250,236,0.2)'
    context.fillRect(random() * size, random() * size, 2 + random() * 5, 1 + random() * 3)
  }
  // Vertical fold shading down the cloth.
  const folds = context.createLinearGradient(0, 0, size, 0)
  folds.addColorStop(0, 'rgba(70,52,30,0.28)')
  folds.addColorStop(0.28, 'rgba(255,255,255,0.12)')
  folds.addColorStop(0.55, 'rgba(70,52,30,0.20)')
  folds.addColorStop(0.8, 'rgba(255,255,255,0.10)')
  folds.addColorStop(1, 'rgba(70,52,30,0.30)')
  context.fillStyle = folds
  context.fillRect(0, 0, size, size)
  // Frayed lower hem.
  context.fillStyle = 'rgba(60,44,26,0.35)'
  for (let index = 0; index < size; index += 6) {
    context.fillRect(index, size - 4 - random() * 8, 4, 4 + random() * 8)
  }
  context.restore()
}

function createPropAtlas(seed: number): THREE.CanvasTexture {
  const size = 512
  const half = size / 2
  const context = context2d(size, size)
  const random = cosmeticRandom(seed ^ 0x1b873593)
  // Textures upload flipped (`flipY` defaults to true), so v = 0 samples the *bottom*
  // canvas row: a cell whose v runs 0..0.5 lives in the lower half of the canvas.
  paintCrateCell(context, 0, half, half, random)
  paintPlankCell(context, half, half, half, random)
  paintFoliageCell(context, 0, 0, half, random)
  paintClothCell(context, half, 0, half, random)
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The natural ground the board sits on. A single tiling plane, painted as scuffed dirt
 * with pebbles and dry grass so the ruled battle mat reads as a board placed on terrain
 * rather than as an arbitrary fence drawn across one endless map.
 */
function createApronTexture(seed: number): THREE.CanvasTexture {
  const size = 512
  const context = context2d(size, size)
  const random = cosmeticRandom(seed ^ 0x27d4eb2f)
  context.fillStyle = '#7d6142'
  context.fillRect(0, 0, size, size)

  // Every feature is drawn nine times, once per wrap offset, so the tile repeats without
  // a visible cut where a blob would otherwise be clipped.
  const wrapped = (draw: (offsetX: number, offsetY: number) => void) => {
    for (const offsetX of [-size, 0, size]) for (const offsetY of [-size, 0, size]) draw(offsetX, offsetY)
  }

  for (let index = 0; index < 60; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 26 + random() * 90
    const dark = random() > 0.5
    wrapped((offsetX, offsetY) => {
      const gradient = context.createRadialGradient(x + offsetX, y + offsetY, 0, x + offsetX, y + offsetY, radius)
      gradient.addColorStop(0, dark ? 'rgba(72,54,34,0.30)' : 'rgba(150,124,86,0.26)')
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2)
      context.fill()
    })
  }

  for (let index = 0; index < 5000; index += 1) {
    const x = random() * size
    const y = random() * size
    context.fillStyle = random() > 0.5 ? 'rgba(58,42,24,0.12)' : 'rgba(178,152,112,0.12)'
    context.fillRect(x, y, 1 + Math.round(random()), 1 + Math.round(random()))
  }

  // Pebbles with a tiny drop shadow.
  for (let index = 0; index < 110; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 1.4 + random() * 3.2
    wrapped((offsetX, offsetY) => {
      context.fillStyle = 'rgba(48,34,18,0.34)'
      context.beginPath()
      context.arc(x + offsetX + 1.2, y + offsetY + 1.2, radius, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(166,148,118,0.6)'
      context.beginPath()
      context.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2)
      context.fill()
    })
  }

  // Dry grass tufts.
  context.lineCap = 'round'
  for (let index = 0; index < 240; index += 1) {
    const x = random() * size
    const y = random() * size
    const blades = 3 + Math.floor(random() * 4)
    const green = random() > 0.45
    wrapped((offsetX, offsetY) => {
      context.strokeStyle = green ? 'rgba(94,116,60,0.5)' : 'rgba(140,120,70,0.45)'
      context.lineWidth = 1 + random() * 1.2
      for (let blade = 0; blade < blades; blade += 1) {
        const lean = (random() - 0.5) * 8
        context.beginPath()
        context.moveTo(x + offsetX, y + offsetY)
        context.lineTo(x + offsetX + lean, y + offsetY - 4 - random() * 7)
        context.stroke()
      }
    })
  }

  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

// --- Geometry --------------------------------------------------------------------

type PieceSpec = {
  readonly cell: AtlasCell
  readonly color: number
  /** Linear multiplier baked on top of the paint colour, for shading a part down. */
  readonly shade?: number
  readonly at: readonly [number, number, number]
  readonly rotate?: readonly [number, number, number]
  readonly scale?: readonly [number, number, number]
}

/**
 * Remaps a primitive into one atlas cell, bakes its paint into vertex colours and
 * places it. Every piece therefore carries the same attribute set, which is what lets
 * the entire surround merge into one buffer under one material.
 */
function piece(geometry: THREE.BufferGeometry, spec: PieceSpec): THREE.BufferGeometry {
  const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined
  if (uv) {
    const span = 0.5 - CELL_PAD * 2
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(
        index,
        spec.cell[0] * 0.5 + CELL_PAD + uv.getX(index) * span,
        spec.cell[1] * 0.5 + CELL_PAD + uv.getY(index) * span,
      )
    }
    uv.needsUpdate = true
  }
  const paint = new THREE.Color(spec.color).multiplyScalar(spec.shade ?? 1)
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = paint.r
    colors[index * 3 + 1] = paint.g
    colors[index * 3 + 2] = paint.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (spec.scale) geometry.scale(spec.scale[0], spec.scale[1], spec.scale[2])
  const [rx, ry, rz] = spec.rotate ?? [0, 0, 0]
  if (rx) geometry.rotateX(rx)
  if (ry) geometry.rotateY(ry)
  if (rz) geometry.rotateZ(rz)
  geometry.translate(spec.at[0], spec.at[1], spec.at[2])
  return geometry
}

const TRUNK_PAINT = 0x6f4a2c
const PLANK_PAINT = 0xc99a63
const CRATE_PAINT = 0xd0a06a
const SANDBAG_PAINT = 0xbda471
const STONE_PAINT = 0x9c8f7c
const FOLIAGE_PAINTS = [0x4f8a55, 0x3f7048, 0x5d9a54, 0x35603f] as const
const BANNER_PAINTS = [0x4bc6bd, 0xd45d52, 0x8158c4] as const

function buildConifer(variant: number): THREE.BufferGeometry[] {
  const paint = FOLIAGE_PAINTS[Math.floor(variant * FOLIAGE_PAINTS.length) % FOLIAGE_PAINTS.length]!
  const lean = (variant - 0.5) * 0.12
  const tiers = variant > 0.45 ? 3 : 2
  const pieces = [
    piece(new THREE.CylinderGeometry(0.08, 0.13, 0.5, 6), { cell: CELL_PLANK, color: TRUNK_PAINT, at: [0, 0.25, 0] }),
  ]
  const heights = tiers === 3 ? [0.95, 0.85, 0.72] : [1.05, 0.9]
  const radii = tiers === 3 ? [0.62, 0.47, 0.31] : [0.6, 0.4]
  let base = 0.34
  heights.forEach((height, index) => {
    pieces.push(piece(new THREE.ConeGeometry(radii[index]!, height, 8), {
      cell: CELL_FOLIAGE,
      color: paint,
      shade: 1 - index * 0.06,
      at: [0, base + height / 2, 0],
      rotate: [lean * 0.4, 0, lean],
    }))
    base += height * 0.62
  })
  return pieces
}

function buildCrates(variant: number): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = []
  const first = 0.78 + variant * 0.3
  pieces.push(piece(new THREE.BoxGeometry(first, first * 0.86, first), { cell: CELL_CRATE, color: CRATE_PAINT, at: [0, first * 0.43, 0] }))
  const second = first * (0.7 + variant * 0.2)
  pieces.push(piece(new THREE.BoxGeometry(second, second * 0.9, second), {
    cell: CELL_CRATE,
    color: CRATE_PAINT,
    shade: 0.9,
    at: [first * 0.62, second * 0.45, first * (variant - 0.5) * 0.5],
    rotate: [0, 0.4 + variant, 0],
  }))
  if (variant > 0.55) {
    const third = second * 0.82
    pieces.push(piece(new THREE.BoxGeometry(third, third * 0.8, third), {
      cell: CELL_CRATE,
      color: CRATE_PAINT,
      shade: 1.05,
      at: [first * 0.1, first * 0.86 + third * 0.4, first * 0.1],
      rotate: [0, 0.9 - variant, 0],
    }))
  }
  return pieces
}

function buildBarricade(variant: number): THREE.BufferGeometry[] {
  const length = 2.1 + variant * 1.2
  const height = 0.62 + variant * 0.28
  const pieces = [
    piece(new THREE.BoxGeometry(length, height, 0.2), { cell: CELL_PLANK, color: PLANK_PAINT, at: [0, height * 0.62, 0], rotate: [-0.08, 0, 0] }),
    piece(new THREE.BoxGeometry(length * 0.94, height * 0.42, 0.16), { cell: CELL_PLANK, color: PLANK_PAINT, shade: 0.86, at: [0, height * 0.2, 0.05] }),
    piece(new THREE.BoxGeometry(0.16, height * 1.35, 0.16), { cell: CELL_PLANK, color: TRUNK_PAINT, shade: 1.2, at: [-length * 0.46, height * 0.62, 0.02] }),
    piece(new THREE.BoxGeometry(0.16, height * 1.35, 0.16), { cell: CELL_PLANK, color: TRUNK_PAINT, shade: 1.2, at: [length * 0.46, height * 0.62, 0.02] }),
  ]
  if (variant > 0.6) {
    pieces.push(piece(new THREE.BoxGeometry(0.13, length * 0.5, 0.13), {
      cell: CELL_PLANK,
      color: PLANK_PAINT,
      shade: 0.8,
      at: [length * 0.16, height * 0.5, -0.14],
      rotate: [0, 0, 1.1],
    }))
  }
  return pieces
}

function buildBanner(variant: number): THREE.BufferGeometry[] {
  const paint = BANNER_PAINTS[Math.floor(variant * BANNER_PAINTS.length) % BANNER_PAINTS.length]!
  const height = 2.3 + variant * 0.5
  return [
    piece(new THREE.CylinderGeometry(0.055, 0.07, height, 6), { cell: CELL_PLANK, color: TRUNK_PAINT, at: [0, height / 2, 0] }),
    piece(new THREE.CylinderGeometry(0.26, 0.3, 0.14, 8), { cell: CELL_CRATE, color: STONE_PAINT, at: [0, 0.07, 0] }),
    piece(new THREE.BoxGeometry(0.62, height * 0.46, 0.035), {
      cell: CELL_CLOTH,
      color: paint,
      at: [0.33, height * 0.7, 0],
      rotate: [0, 0, -0.05],
    }),
    piece(new THREE.ConeGeometry(0.085, 0.24, 6), { cell: CELL_PLANK, color: PLANK_PAINT, shade: 1.15, at: [0, height + 0.1, 0] }),
  ]
}

function buildSandbags(variant: number): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = []
  const rows = variant > 0.5 ? 2 : 1
  const perRow = 3
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < perRow; index += 1) {
      const offset = (index - (perRow - 1) / 2) * 0.42 + (row === 1 ? 0.2 : 0)
      pieces.push(piece(new THREE.SphereGeometry(0.24, 8, 6), {
        cell: CELL_CLOTH,
        color: SANDBAG_PAINT,
        shade: 1 - row * 0.08 - index * 0.02,
        at: [offset, 0.14 + row * 0.24, (variant - 0.5) * 0.2 * index],
        scale: [1.5, 0.62, 1.05],
        rotate: [0, (variant + index) * 0.4, 0],
      }))
    }
  }
  return pieces
}

function buildDebris(variant: number): THREE.BufferGeometry[] {
  const pieces = [
    piece(new THREE.BoxGeometry(0.9 + variant * 0.8, 0.09, 0.18), {
      cell: CELL_PLANK,
      color: PLANK_PAINT,
      shade: 0.88,
      at: [0, 0.05, 0],
      rotate: [0, variant * 1.4, 0.03],
    }),
  ]
  if (variant > 0.35) {
    pieces.push(piece(new THREE.BoxGeometry(0.7 + variant * 0.5, 0.08, 0.14), {
      cell: CELL_PLANK,
      color: PLANK_PAINT,
      shade: 1.05,
      at: [0.18, 0.13, 0.16],
      rotate: [0, variant * -2.1, -0.06],
    }))
  }
  if (variant > 0.7) {
    pieces.push(piece(new THREE.SphereGeometry(0.17, 6, 5), {
      cell: CELL_CRATE,
      color: STONE_PAINT,
      shade: 0.9,
      at: [-0.42, 0.1, -0.2],
      scale: [1.2, 0.7, 1],
    }))
  }
  return pieces
}

function buildProp(placement: PropPlacement): THREE.BufferGeometry[] {
  switch (placement.kind) {
    case 'conifer': return buildConifer(placement.variant)
    case 'crates': return buildCrates(placement.variant)
    case 'barricade': return buildBarricade(placement.variant)
    case 'banner': return buildBanner(placement.variant)
    case 'sandbags': return buildSandbags(placement.variant)
    case 'debris': return buildDebris(placement.variant)
  }
}

/**
 * Builds the whole surround as one merged mesh. Called once, when the gameplay route
 * switches the shared renderer into its diorama presentation.
 */
export function createTerrainProps(bounds: TerrainBounds, options: TerrainPlanOptions = {}): TerrainProps {
  const placements = planTerrainProps(bounds, options)
  const parts: THREE.BufferGeometry[] = []
  for (const placement of placements) {
    for (const geometry of buildProp(placement)) {
      geometry.scale(placement.scale, placement.scale, placement.scale)
      geometry.rotateY(placement.rotation)
      geometry.translate(placement.x, 0, placement.z)
      parts.push(geometry)
    }
  }

  const seed = options.seed ?? TERRAIN_PROP_SEED
  const atlas = createPropAtlas(seed)
  const merged = mergeGeometries(parts)
  parts.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error('Failed to merge the terrain prop geometry')
  merged.name = 'diorama-props'
  merged.computeBoundingSphere()

  const material = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true })
  const mesh = new THREE.Mesh(merged, material)
  mesh.name = 'diorama-props'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()

  // The dirt the props stand on. One quad, drawn under the ruled board and running past
  // the frame on every side, so the battle mat has a terrain table around it instead of
  // an endless grid or an empty void.
  const apronWidth = bounds.worldWidth + APRON_PAD * 2
  const apronDepth = bounds.worldHeight + APRON_PAD * 2
  const apronTexture = createApronTexture(seed)
  apronTexture.repeat.set(apronWidth / APRON_TILE, apronDepth / APRON_TILE)
  const apronGeometry = new THREE.PlaneGeometry(apronWidth, apronDepth)
  const apronMaterial = new THREE.MeshLambertMaterial({ map: apronTexture, color: 0xdcc6a4 })
  const apron = new THREE.Mesh(apronGeometry, apronMaterial)
  apron.name = 'diorama-terrain-apron'
  apron.rotation.x = -Math.PI / 2
  apron.position.set(bounds.centerX, -0.02, bounds.centerY)
  // Deliberately does not receive shadows. It covers the whole frame, and a full-screen
  // shadow-receiving surface measured at +35 ms/frame on the software GL the browser
  // tests run under — enough to change how a real-time kiting run plays out. The ruled
  // board still receives, so every miniature keeps the long raking shadow that matters;
  // the props keep casting, onto the board and onto each other.
  apron.receiveShadow = false
  apron.matrixAutoUpdate = false
  apron.updateMatrix()

  return {
    meshes: [apron, mesh],
    placements,
    dispose: () => {
      mesh.removeFromParent()
      apron.removeFromParent()
      merged.dispose()
      material.dispose()
      atlas.dispose()
      apronGeometry.dispose()
      apronMaterial.dispose()
      apronTexture.dispose()
    },
  }
}
