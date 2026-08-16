import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { context2d, cosmeticRandom } from './diorama-assets'

/**
 * Combat action feedback for the tabletop diorama: the pooled particle system behind
 * the cotton-puff muzzle bursts and the paper-scrap death bursts, the code-generated
 * textures the rescue token / elite sigil / board decals are painted with, and the
 * shared geometries all of them reuse.
 *
 * Everything here is display-only. The randomness runs off this module's own cosmetic
 * seed — never an authority PRNG, never the state digest — and is evaluated once, at
 * mount time, inside canvas-painting code and pooled-particle spawn jitter.
 */

/** Renderer-owned cosmetic seed. Distinct from the board's and the terrain belt's. */
export const FX_COSMETIC_SEED = 0x51f3a7b

// --- Textures ---------------------------------------------------------------------

/**
 * A cotton puff: three overlapping soft lobes so the sprite has a lumpy silhouette
 * rather than reading as a perfect airbrushed circle. Drawn white and tinted per
 * instance; the pool blends it additively, which is also how the puff fades out.
 */
function createPuffTexture(): THREE.CanvasTexture {
  const size = 64
  const context = context2d(size, size)
  const random = cosmeticRandom(FX_COSMETIC_SEED)
  const lobe = (cx: number, cy: number, radius: number, strength: number) => {
    const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, `rgba(255,255,255,${strength})`)
    gradient.addColorStop(0.45, `rgba(255,247,226,${strength * 0.55})`)
    gradient.addColorStop(1, 'rgba(255,236,196,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  lobe(size / 2, size / 2, size / 2, 0.95)
  for (let index = 0; index < 3; index += 1) {
    const angle = random() * Math.PI * 2
    const distance = 6 + random() * 8
    lobe(size / 2 + Math.cos(angle) * distance, size / 2 + Math.sin(angle) * distance, 11 + random() * 8, 0.5)
  }
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * A torn paper scrap: an irregular white polygon with a slightly darker torn edge and
 * a printed crease, so a death burst reads as shredded card rather than as sparks.
 */
function createScrapTexture(): THREE.CanvasTexture {
  const size = 64
  const context = context2d(size, size)
  const random = cosmeticRandom(FX_COSMETIC_SEED ^ 0x1b873593)
  context.clearRect(0, 0, size, size)
  context.beginPath()
  const points = 9
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2
    const radius = size * (0.28 + random() * 0.2)
    const x = size / 2 + Math.cos(angle) * radius
    const y = size / 2 + Math.sin(angle) * radius * 0.82
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  }
  context.closePath()
  context.fillStyle = 'rgba(255,255,255,1)'
  context.fill()
  context.strokeStyle = 'rgba(120,100,74,0.85)'
  context.lineWidth = 2
  context.stroke()
  // A crease and a printed fleck so the scrap does not read as a flat blob.
  context.strokeStyle = 'rgba(96,78,54,0.45)'
  context.lineWidth = 1.4
  context.beginPath()
  context.moveTo(size * 0.3, size * 0.36)
  context.lineTo(size * 0.68, size * 0.6)
  context.stroke()
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The elite's warning sigil: a broken hazard ring, radial cracks and an angry rune in
 * the middle, painted in the concept sheet's glowing red. Drawn onto a disc that is
 * scaled to the *authoritative* footprint radius, so the art never invents a size.
 */
function createSigilTexture(): THREE.CanvasTexture {
  const size = 256
  const context = context2d(size, size)
  const random = cosmeticRandom(FX_COSMETIC_SEED ^ 0x27d4eb2f)
  const centre = size / 2
  context.clearRect(0, 0, size, size)

  // Bloom under the whole sigil.
  const bloom = context.createRadialGradient(centre, centre, 0, centre, centre, centre)
  bloom.addColorStop(0, 'rgba(255,96,64,0.30)')
  bloom.addColorStop(0.62, 'rgba(226,52,38,0.20)')
  bloom.addColorStop(1, 'rgba(180,26,20,0)')
  context.fillStyle = bloom
  context.fillRect(0, 0, size, size)

  // Broken hazard ring: twelve arc segments with irregular gaps.
  context.lineCap = 'butt'
  for (let index = 0; index < 12; index += 1) {
    const start = (index / 12) * Math.PI * 2
    const sweep = (Math.PI * 2 / 12) * (0.5 + random() * 0.3)
    context.strokeStyle = index % 3 === 0 ? 'rgba(255,214,180,0.95)' : 'rgba(255,86,58,0.9)'
    context.lineWidth = index % 3 === 0 ? 9 : 6
    context.beginPath()
    context.arc(centre, centre, centre * 0.86, start, start + sweep)
    context.stroke()
  }

  // Radial cracks reaching in from the ring.
  context.lineCap = 'round'
  for (let index = 0; index < 16; index += 1) {
    const angle = random() * Math.PI * 2
    const inner = centre * (0.42 + random() * 0.22)
    const outer = centre * (0.72 + random() * 0.12)
    context.strokeStyle = 'rgba(255,120,80,0.42)'
    context.lineWidth = 1 + random() * 2.4
    context.beginPath()
    context.moveTo(centre + Math.cos(angle) * inner, centre + Math.sin(angle) * inner)
    context.lineTo(centre + Math.cos(angle) * outer, centre + Math.sin(angle) * outer)
    context.stroke()
  }

  // The rune: a downward chevron stack inside a hard triangle, the concept's angry mark.
  context.strokeStyle = 'rgba(255,232,206,0.95)'
  context.lineWidth = 8
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(centre, centre - centre * 0.34)
  context.lineTo(centre + centre * 0.32, centre + centre * 0.24)
  context.lineTo(centre - centre * 0.32, centre + centre * 0.24)
  context.closePath()
  context.stroke()
  context.strokeStyle = 'rgba(255,120,86,0.95)'
  context.lineWidth = 6
  for (let index = 0; index < 2; index += 1) {
    const offset = centre * (0.02 + index * 0.14)
    context.beginPath()
    context.moveTo(centre - centre * 0.16, offset - centre * 0.06)
    context.lineTo(centre, offset + centre * 0.05)
    context.lineTo(centre + centre * 0.16, offset - centre * 0.06)
    context.stroke()
  }

  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * The rescue token: a dashed gold ring with a small aid mark in the middle, exactly the
 * gold marker the concept sheet puts under a downed miniature.
 */
function createRescueRingTexture(): THREE.CanvasTexture {
  const size = 256
  const context = context2d(size, size)
  const centre = size / 2
  context.clearRect(0, 0, size, size)

  const bloom = context.createRadialGradient(centre, centre, centre * 0.15, centre, centre, centre)
  bloom.addColorStop(0, 'rgba(255,226,140,0.20)')
  bloom.addColorStop(1, 'rgba(255,196,72,0)')
  context.fillStyle = bloom
  context.fillRect(0, 0, size, size)

  context.lineCap = 'butt'
  for (let index = 0; index < 14; index += 1) {
    const start = (index / 14) * Math.PI * 2
    const sweep = (Math.PI * 2 / 14) * 0.62
    context.strokeStyle = 'rgba(255,220,128,0.96)'
    context.lineWidth = 11
    context.beginPath()
    context.arc(centre, centre, centre * 0.84, start, start + sweep)
    context.stroke()
  }
  context.strokeStyle = 'rgba(255,244,206,0.55)'
  context.lineWidth = 3
  context.beginPath()
  context.arc(centre, centre, centre * 0.62, 0, Math.PI * 2)
  context.stroke()

  // Aid mark.
  context.fillStyle = 'rgba(255,238,182,0.92)'
  const arm = centre * 0.1
  const reach = centre * 0.3
  context.fillRect(centre - arm, centre - reach, arm * 2, reach * 2)
  context.fillRect(centre - reach, centre - arm, reach * 2, arm * 2)

  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Vertical gold falloff for the rescue light pillar: bright at the board, gone at the top. */
function createPillarTexture(): THREE.CanvasTexture {
  const width = 32
  const height = 128
  const context = context2d(width, height)
  const random = cosmeticRandom(FX_COSMETIC_SEED ^ 0x85ebca6b)
  const gradient = context.createLinearGradient(0, height, 0, 0)
  gradient.addColorStop(0, 'rgba(255,232,170,0.92)')
  gradient.addColorStop(0.35, 'rgba(255,205,102,0.46)')
  gradient.addColorStop(1, 'rgba(255,190,80,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  for (let index = 0; index < 14; index += 1) {
    const x = random() * width
    context.fillStyle = `rgba(255,246,214,${0.05 + random() * 0.12})`
    context.fillRect(x, height * random() * 0.5, 1 + random() * 2, height * (0.3 + random() * 0.5))
  }
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

// --- Board surface decals -----------------------------------------------------------
// Flat paint *inside* the play area: scorch craters, chalk deployment boxes and rule
// lines, boot wear and drag streaks. This is paint on the board, never a prop — every
// piece lies on the surface, casts and receives nothing, and is never seen by the prop
// placer that owns collision-free scenery outside the rail.
//
// It is built as a set of *discrete* quads merged into one geometry rather than as a
// single sheet stretched over the whole arena, and that is a frame-budget decision
// backed by measurement: a play-area-sized blended quad is the largest transparent
// surface in the frame and cost ~5 ms a frame (lit) / ~3 ms (unlit) on the software GL
// the browser tests run under. Discrete quads paint the same marks while covering
// roughly a third of the area, in the same single draw call.

export type SurfaceDecalKind = 'scorch' | 'wear' | 'chalk-box' | 'streak' | 'chalk-line' | 'ticks'

export type SurfaceDecalPlacement = {
  readonly kind: SurfaceDecalKind
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
  readonly rotation: number
  readonly tint: number
  readonly alpha: number
}

export type PlayAreaBounds = {
  readonly centerX: number
  readonly centerY: number
  readonly worldWidth: number
  readonly worldHeight: number
}

/** The board must still read as a board, so nothing is painted right up to the rail. */
export const DECAL_EDGE_MARGIN = 1.1
/**
 * How far the paint floats above the board. High enough to clear the ruled surface
 * without z-fighting, low enough to stay under the contact shadows (0.012) and the base
 * rings (0.03). Nothing in the set writes depth, so the marks layer against each other
 * purely in the order they were planned: chalk first, then wear, then burns on top.
 */
export const DECAL_HEIGHT = 0.006

const DECAL_ATLAS_COLUMNS = 4
const DECAL_ATLAS_ROWS = 2
const DECAL_CELL: Readonly<Record<SurfaceDecalKind, readonly [number, number]>> = {
  scorch: [0, 0],
  wear: [1, 0],
  'chalk-box': [2, 0],
  streak: [3, 0],
  'chalk-line': [0, 1],
  ticks: [1, 1],
}

/**
 * The axis-aligned footprint a rotated decal actually occupies on the board. Exported
 * because "no mark reaches past the play area" is the property the whole set has to
 * satisfy, and a rotated quad covers more than its own width and depth.
 */
export function surfaceDecalExtent(placement: Pick<SurfaceDecalPlacement, 'width' | 'depth' | 'rotation'>): { halfX: number; halfZ: number } {
  const sin = Math.abs(Math.sin(placement.rotation))
  const cos = Math.abs(Math.cos(placement.rotation))
  return {
    halfX: (placement.width * cos + placement.depth * sin) / 2,
    halfZ: (placement.width * sin + placement.depth * cos) / 2,
  }
}

/**
 * Deterministic decal layout for a play area, from this module's cosmetic seed. Pure and
 * exported so it can be asserted directly: every mark has to sit inside the arena.
 *
 * The set is deliberately sparse. Total painted area is kept well under half the board,
 * because on the software GL the browser tests run under, blended surface area is the
 * dominant cost of the decals and a play-area-sized sheet was measurably too expensive.
 */
export function planSurfaceDecals(bounds: PlayAreaBounds, seed = FX_COSMETIC_SEED ^ 0xc2b2ae35): SurfaceDecalPlacement[] {
  const random = cosmeticRandom(seed)
  const halfWidth = bounds.worldWidth / 2 - DECAL_EDGE_MARGIN
  const halfDepth = bounds.worldHeight / 2 - DECAL_EDGE_MARGIN
  const placements: SurfaceDecalPlacement[] = []

  const place = (placement: Omit<SurfaceDecalPlacement, 'x' | 'z'>, x: number, z: number, margin: number): void => {
    // Clamp on the *rotated* footprint, so a mark can never poke past the board however
    // it was turned.
    const extent = surfaceDecalExtent(placement)
    const limitX = Math.max(0, bounds.worldWidth / 2 - margin - extent.halfX)
    const limitZ = Math.max(0, bounds.worldHeight / 2 - margin - extent.halfZ)
    placements.push({
      ...placement,
      x: bounds.centerX + Math.max(-limitX, Math.min(limitX, x - bounds.centerX)),
      z: bounds.centerY + Math.max(-limitZ, Math.min(limitZ, z - bounds.centerY)),
    })
  }

  const scatter = (kind: SurfaceDecalKind, count: number, minSize: number, maxSize: number, stretch: number, tints: readonly number[], alphaLow: number, alphaHigh: number) => {
    for (let index = 0; index < count; index += 1) {
      const size = minSize + random() * (maxSize - minSize)
      const placement = {
        kind,
        width: size * (1 + random() * stretch),
        depth: size * (0.72 + random() * 0.4),
        rotation: random() * Math.PI * 2,
        tint: tints[Math.floor(random() * tints.length)]!,
        alpha: alphaLow + random() * (alphaHigh - alphaLow),
      }
      place(
        placement,
        bounds.centerX + (random() * 2 - 1) * halfWidth,
        bounds.centerY + (random() * 2 - 1) * halfDepth,
        DECAL_EDGE_MARGIN,
      )
    }
  }

  // Chalk staging first, so the burns and the wear land on top of it.
  for (const side of [-1, 1]) {
    place(
      { kind: 'chalk-box', width: bounds.worldWidth * 0.12, depth: bounds.worldHeight * 0.28, rotation: 0, tint: CHALK, alpha: 0.5 },
      bounds.centerX + side * bounds.worldWidth * 0.14, bounds.centerY, 0.4,
    )
  }
  place({ kind: 'chalk-line', width: 0.6, depth: bounds.worldHeight * 0.78, rotation: 0, tint: CHALK, alpha: 0.35 }, bounds.centerX, bounds.centerY, 0.4)
  place({ kind: 'chalk-line', width: 0.6, depth: bounds.worldWidth * 0.86, rotation: Math.PI / 2, tint: CHALK, alpha: 0.3 }, bounds.centerX, bounds.centerY, 0.4)
  for (const side of [-1, 1]) {
    place(
      { kind: 'ticks', width: bounds.worldWidth * 0.86, depth: 0.7, rotation: 0, tint: CHALK, alpha: 0.28 },
      bounds.centerX, bounds.centerY + side * halfDepth, 0.4,
    )
  }

  // Wear and scuffs stay very faint — they are meant to age the board, not to draw the
  // eye off the fight. Only the burns are allowed to read hard.
  scatter('streak', 7, 2.4, 5.2, 1.0, [0x4a3420, 0xe6d6b6], 0.07, 0.16)
  scatter('wear', 11, 2.4, 4.6, 0.3, [0x6a4c2a, 0xf0e2c4], 0.07, 0.17)
  scatter('scorch', 15, 1.7, 3.3, 0.25, [0x140d08, 0x1d1409], 0.8, 0.97)
  return placements
}

const CHALK = 0xe2eef0

/** One 4x2 atlas holding every decal stamp, so the whole set merges into one mesh. */
function createSurfaceDecalAtlas(): THREE.CanvasTexture {
  const cell = 512
  const width = cell * DECAL_ATLAS_COLUMNS
  const height = cell * DECAL_ATLAS_ROWS
  const context = context2d(width, height)
  const random = cosmeticRandom(FX_COSMETIC_SEED ^ 0x165667b1)
  context.clearRect(0, 0, width, height)

  const withCell = (kind: SurfaceDecalKind, paint: (size: number) => void) => {
    const [column, row] = DECAL_CELL[kind]
    context.save()
    context.translate(column * cell, row * cell)
    context.beginPath()
    context.rect(0, 0, cell, cell)
    context.clip()
    paint(cell)
    context.restore()
  }

  // Scorch: charred core with a wobbly rim and a spatter of ejecta. Painted white so a
  // placement's own tint decides how black the burn is.
  withCell('scorch', (size) => {
    const centre = size / 2
    context.beginPath()
    for (let step = 0; step <= 30; step += 1) {
      const angle = (step / 30) * Math.PI * 2
      const wobble = centre * (0.52 + random() * 0.24)
      const x = centre + Math.cos(angle) * wobble
      const y = centre + Math.sin(angle) * wobble
      if (step === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
    const burn = context.createRadialGradient(centre, centre, 0, centre, centre, centre * 0.76)
    burn.addColorStop(0, 'rgba(255,255,255,1)')
    burn.addColorStop(0.62, 'rgba(255,255,255,0.97)')
    burn.addColorStop(0.86, 'rgba(255,255,255,0.55)')
    burn.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = burn
    context.fill()
    context.fillStyle = 'rgba(255,255,255,0.34)'
    for (let fleck = 0; fleck < 26; fleck += 1) {
      const angle = random() * Math.PI * 2
      const distance = centre * (0.55 + random() * 0.4)
      context.beginPath()
      context.arc(centre + Math.cos(angle) * distance, centre + Math.sin(angle) * distance, 2 + random() * 6, 0, Math.PI * 2)
      context.fill()
    }
  })

  // Wear: a soft scuffed patch with a few drybrush strokes through it.
  withCell('wear', (size) => {
    const centre = size / 2
    const gradient = context.createRadialGradient(centre, centre, 0, centre, centre, centre * 0.94)
    gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.4)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
    context.lineCap = 'round'
    for (let index = 0; index < 14; index += 1) {
      const y = size * (0.15 + random() * 0.7)
      context.strokeStyle = `rgba(255,255,255,${0.14 + random() * 0.22})`
      context.lineWidth = 3 + random() * 9
      context.beginPath()
      context.moveTo(size * 0.12, y)
      context.lineTo(size * 0.88, y + (random() - 0.5) * size * 0.16)
      context.stroke()
    }
  })

  // Chalk deployment box: a dashed outline with hand-drawn corner ticks.
  withCell('chalk-box', (size) => {
    const inset = size * 0.08
    const span = size - inset * 2
    context.setLineDash([34, 26])
    context.strokeStyle = 'rgba(255,255,255,0.85)'
    context.lineWidth = 9
    context.strokeRect(inset, inset, span, span)
    context.setLineDash([])
    context.strokeStyle = 'rgba(255,255,255,1)'
    context.lineWidth = 12
    const tick = size * 0.09
    for (const [cx, cy, sx, sy] of [
      [inset, inset, 1, 1], [inset + span, inset, -1, 1],
      [inset, inset + span, 1, -1], [inset + span, inset + span, -1, -1],
    ] as const) {
      context.beginPath()
      context.moveTo(cx + sx * tick, cy)
      context.lineTo(cx, cy)
      context.lineTo(cx, cy + sy * tick)
      context.stroke()
    }
  })

  // Drag streak: a long tapering scuff, authored across the cell.
  withCell('streak', (size) => {
    context.lineCap = 'round'
    for (let index = 0; index < 5; index += 1) {
      const y = size * (0.3 + random() * 0.4)
      context.strokeStyle = `rgba(255,255,255,${0.3 + random() * 0.45})`
      context.lineWidth = 5 + random() * 16
      context.beginPath()
      context.moveTo(size * 0.04, y)
      context.quadraticCurveTo(size * 0.5, y + (random() - 0.5) * size * 0.3, size * 0.96, y + (random() - 0.5) * size * 0.16)
      context.stroke()
    }
  })

  // A dashed chalk rule, authored down the cell so a thin quad reads as a ruled line.
  withCell('chalk-line', (size) => {
    context.setLineDash([30, 26])
    context.strokeStyle = 'rgba(255,255,255,0.9)'
    context.lineWidth = size * 0.26
    context.beginPath()
    context.moveTo(size / 2, 0)
    context.lineTo(size / 2, size)
    context.stroke()
    context.setLineDash([])
  })

  // Graduated ruler ticks along an edge of the mat.
  withCell('ticks', (size) => {
    context.strokeStyle = 'rgba(255,255,255,0.9)'
    for (let index = 1; index < 16; index += 1) {
      const x = (size / 16) * index
      const long = index % 4 === 0
      context.lineWidth = long ? 9 : 5
      context.beginPath()
      context.moveTo(x, size * 0.5)
      context.lineTo(x, size * (long ? 0.02 : 0.24))
      context.stroke()
    }
  })

  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export type SurfaceDecals = {
  readonly mesh: THREE.Mesh
  readonly placements: readonly SurfaceDecalPlacement[]
  dispose(): void
}

/**
 * Builds the planned decals into a single merged, vertex-coloured mesh: one draw call,
 * one texture, no per-decal material. Tint and opacity ride in a four-component colour
 * attribute, so the same white stamp serves a black burn and a pale chalk line.
 */
export function createSurfaceDecals(bounds: PlayAreaBounds, seed?: number): SurfaceDecals {
  const atlas = createSurfaceDecalAtlas()
  const placements = planSurfaceDecals(bounds, seed)
  const parts = placements.map((placement) => {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const uv = geometry.attributes.uv as THREE.BufferAttribute
    const [column, row] = DECAL_CELL[placement.kind]
    for (let index = 0; index < uv.count; index += 1) {
      // The canvas is uploaded with `flipY`, so the top row of cells is the *high* v band.
      const u = (column + uv.getX(index)) / DECAL_ATLAS_COLUMNS
      const v = (DECAL_ATLAS_ROWS - row - 1 + uv.getY(index)) / DECAL_ATLAS_ROWS
      uv.setXY(index, u, v)
    }
    const count = geometry.attributes.position.count
    const colors = new Float32Array(count * 4)
    const red = ((placement.tint >> 16) & 0xff) / 255
    const green = ((placement.tint >> 8) & 0xff) / 255
    const blue = (placement.tint & 0xff) / 255
    for (let index = 0; index < count; index += 1) {
      colors[index * 4] = red
      colors[index * 4 + 1] = green
      colors[index * 4 + 2] = blue
      colors[index * 4 + 3] = placement.alpha
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    geometry.scale(placement.width, placement.depth, 1)
    geometry.rotateX(-Math.PI / 2)
    geometry.rotateY(placement.rotation)
    geometry.translate(placement.x, DECAL_HEIGHT, placement.z)
    return geometry
  })

  const merged = mergeGeometries(parts)
  parts.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error('Failed to merge the board surface decals')
  const material = new THREE.MeshBasicMaterial({
    map: atlas,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
  })
  const mesh = new THREE.Mesh(merged, material)
  // Paint, not scenery: it lies on the board, throws no shadow and catches none.
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.renderOrder = -1

  return {
    mesh,
    placements,
    dispose: () => {
      mesh.removeFromParent()
      merged.dispose()
      material.dispose()
      atlas.dispose()
    },
  }
}

// --- Pooled particles --------------------------------------------------------------

type Particle = {
  active: boolean
  birth: number
  life: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  gravity: number
  drag: number
  startSize: number
  endSize: number
  spin: number
  axisX: number
  axisY: number
  axisZ: number
  phase: number
}

const WHITE = new THREE.Color(1, 1, 1)

export type ParticleSpawn = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  /** Lifetime in simulation ticks — the pool runs on the renderer's snapshot clock. */
  readonly life: number
  readonly startSize: number
  readonly endSize: number
  readonly gravity?: number
  readonly drag?: number
  readonly spin?: number
  readonly color?: THREE.Color
}

/**
 * A fixed-capacity instanced particle pool. One `InstancedMesh` means one draw call for
 * every burst on the board at once, and nothing is ever allocated per event: `spawn`
 * writes into the next slot and recycles the oldest when the pool is full.
 *
 * Two fade strategies, both free of a custom shader:
 * - `additive` puffs fade by driving their instance colour to black.
 * - `tumbling` scraps fade by shrinking, and spin about a per-particle axis.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh
  private readonly particles: Particle[]
  private readonly geometry: THREE.PlaneGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly baseColors: THREE.Color[]
  private readonly tumbling: boolean
  private cursor = 0
  private liveCount = 0
  /** Slots holding a particle that is alive or still waiting to be born. */
  private activeSlots = 0
  /** Whether the instance colour buffer needs another upload this frame. */
  private colorsDirty = false
  private budget: number
  private readonly random: () => number
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly scratchQuaternion = new THREE.Quaternion()
  private readonly scratchAxis = new THREE.Vector3()
  private readonly scratchPosition = new THREE.Vector3()
  private readonly scratchScale = new THREE.Vector3()
  private readonly scratchColor = new THREE.Color()

  constructor(options: {
    readonly name: string
    readonly capacity: number
    readonly texture: THREE.Texture
    readonly tumbling: boolean
    readonly seed: number
  }) {
    this.tumbling = options.tumbling
    this.budget = options.capacity
    this.random = cosmeticRandom(options.seed)
    this.geometry = new THREE.PlaneGeometry(1, 1)
    this.material = new THREE.MeshBasicMaterial({
      map: options.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: options.tumbling ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, options.capacity)
    this.mesh.name = options.name
    // The instances live anywhere on the board; the geometry's own bounds would cull
    // the whole mesh the moment the origin left the frustum.
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.receiveShadow = false
    this.mesh.renderOrder = 4
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.baseColors = Array.from({ length: options.capacity }, () => new THREE.Color(1, 1, 1))
    this.particles = Array.from({ length: options.capacity }, () => ({
      active: false, birth: 0, life: 1, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0,
      gravity: 0, drag: 0, startSize: 0, endSize: 0, spin: 0, axisX: 0, axisY: 1, axisZ: 0, phase: 0,
    }))
    // Allocate the instance colour buffer up front so `setColorAt` never reallocates
    // mid-frame, and park every instance at zero scale.
    this.particles.forEach((_, index) => {
      this.mesh.setColorAt(index, this.scratchColor.setRGB(1, 1, 1))
      this.mesh.setMatrixAt(index, this.scratchMatrix.makeScale(0, 0, 0))
    })
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.mesh.count = 0
  }

  get capacity(): number {
    return this.particles.length
  }

  get live(): number {
    return this.liveCount
  }

  /** Quality ladder hook: shrinks how many slots a burst is allowed to claim. */
  setBudget(scale: number): void {
    this.budget = Math.max(1, Math.round(this.particles.length * Math.max(0, Math.min(1, scale))))
  }

  spawn(now: number, spawn: ParticleSpawn): void {
    if (this.budget <= 0) return
    const index = this.cursor % this.budget
    this.cursor = (this.cursor + 1) % this.budget
    const particle = this.particles[index]!
    if (!particle.active) this.activeSlots += 1
    particle.active = true
    particle.birth = now
    particle.life = spawn.life
    particle.x = spawn.x
    particle.y = spawn.y
    particle.z = spawn.z
    particle.vx = spawn.vx
    particle.vy = spawn.vy
    particle.vz = spawn.vz
    particle.gravity = spawn.gravity ?? 0
    particle.drag = spawn.drag ?? 0
    particle.startSize = spawn.startSize
    particle.endSize = spawn.endSize
    particle.spin = spawn.spin ?? 0
    particle.phase = this.random() * Math.PI * 2
    if (this.tumbling) {
      const ax = this.random() * 2 - 1
      const ay = this.random() * 2 - 1
      const az = this.random() * 2 - 1
      const length = Math.hypot(ax, ay, az) || 1
      particle.axisX = ax / length
      particle.axisY = ay / length
      particle.axisZ = az / length
    }
    const color = this.baseColors[index]!.copy(spawn.color ?? WHITE)
    // A tumbling scrap never changes colour again, so it is written once here; a puff's
    // colour is driven every frame by its fade.
    if (this.tumbling) this.mesh.setColorAt(index, color)
    this.colorsDirty = true
  }

  /**
   * Advances every slot to `now` (in ticks) and writes the instance buffers. The pool is
   * a fixed array, so the per-frame cost is a constant, tiny matrix loop regardless of
   * how busy the board is — and a paused snapshot clock simply freezes it in place.
   */
  update(now: number, cameraQuaternion: THREE.Quaternion): void {
    // An idle pool costs nothing at all: no matrix loop, and `count = 0` keeps the
    // instanced mesh out of the draw list entirely rather than submitting a screenful
    // of zero-scale quads. Most frames of a quiet board take this path.
    if (this.activeSlots === 0) {
      if (this.mesh.count !== 0) this.mesh.count = 0
      this.liveCount = 0
      return
    }
    this.mesh.count = this.particles.length
    let live = 0
    let active = 0
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]!
      if (!particle.active) continue
      const age = now - particle.birth
      if (age >= particle.life) {
        particle.active = false
        this.mesh.setMatrixAt(index, this.scratchMatrix.makeScale(0, 0, 0))
        continue
      }
      if (age < 0) {
        // Not born yet. A burst can be scheduled ahead of the clock — the scraps of a
        // death wait for the figure to finish toppling — without a timer or a queue.
        active += 1
        this.mesh.setMatrixAt(index, this.scratchMatrix.makeScale(0, 0, 0))
        continue
      }
      live += 1
      active += 1
      const t = age / particle.life
      // Closed-form integration of a constant force with linear drag, so a slot can be
      // evaluated from its birth alone: no per-frame state to drift out of step when a
      // frame is long, and no accumulation while the tab is hidden.
      const damping = 1 - particle.drag * t
      const x = particle.x + particle.vx * age * damping
      const z = particle.z + particle.vz * age * damping
      const y = Math.max(0.05, particle.y + particle.vy * age * damping - 0.5 * particle.gravity * age * age)
      const size = particle.startSize + (particle.endSize - particle.startSize) * t
      const scale = this.tumbling ? size * Math.min(1, (1 - t) / 0.35) : size
      if (this.tumbling) {
        this.scratchQuaternion.setFromAxisAngle(
          this.scratchAxis.set(particle.axisX, particle.axisY, particle.axisZ),
          particle.phase + particle.spin * age,
        )
      } else {
        this.scratchQuaternion.copy(cameraQuaternion)
      }
      this.scratchMatrix.compose(
        this.scratchPosition.set(x, y, z),
        this.scratchQuaternion,
        this.scratchScale.set(scale, scale, scale),
      )
      this.mesh.setMatrixAt(index, this.scratchMatrix)
      // Additive puffs fade by dimming towards black — a gentle exponent keeps a puff
      // readable while it is still expanding — so their colours are rewritten every
      // frame. A tumbling scrap keeps the colour it was spawned with, so its colour
      // buffer is only re-uploaded on the frames a burst actually claimed a slot.
      if (!this.tumbling) {
        const brightness = Math.max(0, 1 - t) ** 0.9
        const base = this.baseColors[index]!
        this.mesh.setColorAt(index, this.scratchColor.setRGB(base.r * brightness, base.g * brightness, base.b * brightness))
        this.colorsDirty = true
      }
    }
    this.liveCount = live
    this.activeSlots = active
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.colorsDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true
      this.colorsDirty = false
    }
  }

  clear(): void {
    this.particles.forEach((particle, index) => {
      particle.active = false
      this.mesh.setMatrixAt(index, this.scratchMatrix.makeScale(0, 0, 0))
    })
    this.liveCount = 0
    this.activeSlots = 0
    this.mesh.count = 0
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}

// --- Asset bundle -------------------------------------------------------------------

export type CombatFxAssets = {
  readonly puffTexture: THREE.CanvasTexture
  readonly scrapTexture: THREE.CanvasTexture
  readonly sigilTexture: THREE.CanvasTexture
  readonly rescueRingTexture: THREE.CanvasTexture
  readonly pillarTexture: THREE.CanvasTexture
  /** Unit quad, scaled per instance to the play area / effect footprint. */
  readonly discGeometry: THREE.CircleGeometry
  readonly quadGeometry: THREE.PlaneGeometry
  readonly pillarGeometry: THREE.CylinderGeometry
  readonly puffs: ParticlePool
  readonly scraps: ParticlePool
  dispose(): void
}

/** Muzzle bursts are small and frequent; scraps come in bigger, rarer showers. */
const PUFF_CAPACITY = 72
const SCRAP_CAPACITY = 96

export function createCombatFxAssets(): CombatFxAssets {
  const puffTexture = createPuffTexture()
  const scrapTexture = createScrapTexture()
  const sigilTexture = createSigilTexture()
  const rescueRingTexture = createRescueRingTexture()
  const pillarTexture = createPillarTexture()
  const discGeometry = new THREE.CircleGeometry(1, 48)
  const quadGeometry = new THREE.PlaneGeometry(1, 1)
  const pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
  const puffs = new ParticlePool({ name: 'fx-puffs', capacity: PUFF_CAPACITY, texture: puffTexture, tumbling: false, seed: FX_COSMETIC_SEED ^ 0x9e3779b9 })
  const scraps = new ParticlePool({ name: 'fx-scraps', capacity: SCRAP_CAPACITY, texture: scrapTexture, tumbling: true, seed: FX_COSMETIC_SEED ^ 0x7feb352d })

  return {
    puffTexture,
    scrapTexture,
    sigilTexture,
    rescueRingTexture,
    pillarTexture,
    discGeometry,
    quadGeometry,
    pillarGeometry,
    puffs,
    scraps,
    dispose: () => {
      puffs.dispose()
      scraps.dispose()
      puffTexture.dispose()
      scrapTexture.dispose()
      sigilTexture.dispose()
      rescueRingTexture.dispose()
      pillarTexture.dispose()
      discGeometry.dispose()
      quadGeometry.dispose()
      pillarGeometry.dispose()
    },
  }
}
