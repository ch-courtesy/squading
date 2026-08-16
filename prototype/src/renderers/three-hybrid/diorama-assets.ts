import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Code-generated tabletop-diorama assets: the sandy board texture, the wooden edge
 * frame, the soft contact shadow, and one *merged* geometry per miniature archetype.
 *
 * Everything here is procedural — no external files, no new runtime dependency.
 * `mergeGeometries` ships inside the `three` package we already depend on.
 *
 * The randomness below is purely cosmetic. It runs off its own local PRNG seed and is
 * evaluated once at mount time from canvas painting code, so it can never reach the
 * authority state, the input log, or the snapshot digest.
 */

const COSMETIC_SEED = 0x5d10a4a

/** Deterministic cosmetic noise (mulberry32). Never used for gameplay decisions. */
export function cosmeticRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type MiniatureArchetype = 'friendly' | 'enemy' | 'elite'

export type DioramaAssets = {
  readonly boardTexture: THREE.CanvasTexture
  readonly frameTexture: THREE.CanvasTexture
  readonly contactShadowTexture: THREE.CanvasTexture
  /** One merged geometry per archetype, so a unit body costs exactly one draw call. */
  readonly miniatures: Readonly<Record<MiniatureArchetype, THREE.BufferGeometry>>
  readonly baseRingGeometry: THREE.RingGeometry
  readonly contactShadowGeometry: THREE.PlaneGeometry
  readonly frameRailGeometry: THREE.BoxGeometry
  dispose(): void
}

export function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable for the procedural diorama textures')
  return context
}

/**
 * One tile of painted tabletop: sandy base colour, wear blotches, fine grit and the
 * dark grid seam along two edges so the tiled result reads as ruled board squares.
 */
function createBoardTexture(): THREE.CanvasTexture {
  const size = 512
  const context = context2d(size, size)
  const random = cosmeticRandom(COSMETIC_SEED)

  context.fillStyle = '#c3a071'
  context.fillRect(0, 0, size, size)

  // Wear blotches stay deliberately faint: the tile repeats across the whole board, so
  // anything with a readable shape turns into visible wallpaper.
  for (let index = 0; index < 48; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 18 + random() * 70
    const lighten = random() > 0.5
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, lighten ? 'rgba(228,207,172,0.14)' : 'rgba(138,104,60,0.13)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  for (let index = 0; index < 6000; index += 1) {
    const x = random() * size
    const y = random() * size
    context.fillStyle = random() > 0.5 ? 'rgba(90,66,36,0.09)' : 'rgba(240,222,190,0.09)'
    context.fillRect(x, y, 1 + Math.round(random()), 1 + Math.round(random()))
  }

  // Scuffs and drybrushed wear streaks.
  context.lineCap = 'round'
  for (let index = 0; index < 42; index += 1) {
    const x = random() * size
    const y = random() * size
    const length = 10 + random() * 46
    const angle = random() * Math.PI
    context.strokeStyle = random() > 0.5 ? 'rgba(120,90,52,0.16)' : 'rgba(238,220,188,0.14)'
    context.lineWidth = 1 + random() * 2.4
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length)
    context.stroke()
  }

  // Loose grit and pebbles, each with a tiny drop shadow so the board reads as sculpted.
  for (let index = 0; index < 70; index += 1) {
    const x = random() * size
    const y = random() * size
    const radius = 1.2 + random() * 2.6
    context.fillStyle = 'rgba(70,50,28,0.30)'
    context.beginPath()
    context.arc(x + 1, y + 1, radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(214,190,152,0.55)'
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }

  // The grid seam: a recessed dark groove with a lit lip, drawn on two edges so the
  // repeated tile forms a continuous ruled grid across the whole board.
  const drawSeam = (horizontal: boolean, offset: number, strength: number) => {
    const groove = 4 + strength * 4
    context.fillStyle = `rgba(70,48,26,${0.22 + strength * 0.34})`
    if (horizontal) context.fillRect(0, offset, size, groove)
    else context.fillRect(offset, 0, groove, size)
    context.fillStyle = `rgba(238,219,186,${0.12 + strength * 0.2})`
    if (horizontal) context.fillRect(0, offset + groove, size, 2.5)
    else context.fillRect(offset + groove, 0, 2.5, size)
  }
  // A fainter half-cell rule inside each tile breaks the repeat up into a finer grid,
  // the way a ruled battle mat subdivides its squares.
  drawSeam(true, size / 2, 0.18)
  drawSeam(false, size / 2, 0.18)
  drawSeam(true, 0, 1)
  drawSeam(false, 0, 1)

  // Short broken hairline cracks. Several small ones read as surface wear; one long
  // wandering line reads as a repeated decal.
  context.lineWidth = 1.4
  context.strokeStyle = 'rgba(66,46,26,0.20)'
  for (let index = 0; index < 9; index += 1) {
    let crackX = random() * size
    let crackY = random() * size
    const segments = 2 + Math.floor(random() * 4)
    context.beginPath()
    context.moveTo(crackX, crackY)
    for (let segment = 0; segment < segments; segment += 1) {
      crackX += (random() - 0.35) * 30
      crackY += (random() - 0.5) * 22
      context.lineTo(crackX, crackY)
    }
    context.stroke()
  }

  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Painted wood for the raised edge frame around the play area. */
function createFrameTexture(): THREE.CanvasTexture {
  const width = 256
  const height = 64
  const context = context2d(width, height)
  const random = cosmeticRandom(COSMETIC_SEED ^ 0x9e3779b9)

  context.fillStyle = '#a9784a'
  context.fillRect(0, 0, width, height)
  for (let index = 0; index < 90; index += 1) {
    const y = random() * height
    context.strokeStyle = random() > 0.5 ? 'rgba(58,36,18,0.28)' : 'rgba(196,152,104,0.24)'
    context.lineWidth = 0.6 + random() * 1.8
    context.beginPath()
    context.moveTo(0, y)
    context.bezierCurveTo(width * 0.3, y + (random() - 0.5) * 6, width * 0.7, y + (random() - 0.5) * 6, width, y + (random() - 0.5) * 4)
    context.stroke()
  }
  // Plank joints.
  for (let plank = 1; plank < 5; plank += 1) {
    const x = (width / 5) * plank
    context.fillStyle = 'rgba(48,28,12,0.45)'
    context.fillRect(x, 0, 2.5, height)
  }
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Soft radial falloff used as the miniature's contact shadow on the board. */
function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 64
  const context = context2d(size, size)
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.45)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(context.canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

type Placement = {
  readonly at: readonly [number, number, number]
  readonly rotate?: readonly [number, number, number]
  /**
   * Linear paint value the part multiplies the archetype tint by. 1 is the fully
   * painted team colour, low values read as dark gunmetal or shadowed underside.
   */
  readonly value: number
}

/**
 * Bakes a flat paint value into the part as vertex colours, then places it. Every part
 * therefore carries the same attribute set (position, normal, uv, color) which is what
 * lets the whole figure merge into one buffer with a single material.
 */
function part(geometry: THREE.BufferGeometry, placement: Placement): THREE.BufferGeometry {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  colors.fill(placement.value)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const [rx, ry, rz] = placement.rotate ?? [0, 0, 0]
  if (rx) geometry.rotateX(rx)
  if (ry) geometry.rotateY(ry)
  if (rz) geometry.rotateZ(rz)
  geometry.translate(placement.at[0], placement.at[1], placement.at[2])
  return geometry
}

/**
 * The board is seen at a shallow 2.5D tilt, which foreshortens a standing figure to
 * roughly two thirds of its height on screen. Figures are authored at card scale and
 * then grown by this factor so a miniature reads at least as large as the billboarded
 * card it replaces.
 */
export const FIGURE_SCALE = 1.7

function merge(parts: readonly THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const merged = mergeGeometries(parts as THREE.BufferGeometry[])
  parts.forEach((geometry) => geometry.dispose())
  if (!merged) throw new Error(`Failed to merge the ${name} miniature geometry`)
  merged.scale(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE)
  merged.name = name
  merged.computeBoundingSphere()
  return merged
}

/**
 * A rank-and-file trooper: round base, boots, torso, pauldrons, helmet with a dark
 * visor, backpack and a shouldered rifle. Feet sit at y = 0 and the figure faces +Z.
 */
function createFriendlyMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.27, 0.3, 0.07, 16), { at: [0, 0.035, 0], value: 0.3 }),
    part(new THREE.BoxGeometry(0.28, 0.34, 0.22), { at: [0, 0.24, 0], value: 0.4 }),
    part(new THREE.BoxGeometry(0.36, 0.36, 0.26), { at: [0, 0.59, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.54, 0.15, 0.3), { at: [0, 0.77, 0], value: 0.62 }),
    part(new THREE.BoxGeometry(0.2, 0.22, 0.1), { at: [0, 0.6, -0.17], value: 0.22 }),
    part(new THREE.SphereGeometry(0.14, 10, 8), { at: [0, 0.93, 0], value: 0.5 }),
    part(new THREE.BoxGeometry(0.17, 0.07, 0.08), { at: [0, 0.91, 0.11], value: 0.04 }),
    part(new THREE.BoxGeometry(0.1, 0.28, 0.11), { at: [0.23, 0.61, 0.03], value: 0.78 }),
    part(new THREE.BoxGeometry(0.06, 0.06, 0.54), { at: [0.23, 0.6, 0.13], rotate: [-0.16, 0, 0], value: 0.05 }),
    part(new THREE.BoxGeometry(0.07, 0.14, 0.1), { at: [0.23, 0.55, -0.06], value: 0.07 }),
  ], 'miniature:friendly')
}

/** The purple horde: hunched, chunkier, horned, carrying a crude spear. */
function createEnemyMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.26, 0.29, 0.06, 12), { at: [0, 0.03, 0], value: 0.28 }),
    part(new THREE.BoxGeometry(0.31, 0.3, 0.24), { at: [0, 0.21, 0], value: 0.38 }),
    part(new THREE.BoxGeometry(0.4, 0.36, 0.28), { at: [0, 0.53, 0.02], rotate: [0.14, 0, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.54, 0.14, 0.3), { at: [0, 0.71, 0.01], value: 0.58 }),
    part(new THREE.SphereGeometry(0.15, 8, 6), { at: [0, 0.86, 0.05], value: 0.46 }),
    part(new THREE.ConeGeometry(0.05, 0.2, 6), { at: [0.1, 0.98, 0.02], rotate: [0, 0, -0.5], value: 0.72 }),
    part(new THREE.ConeGeometry(0.05, 0.2, 6), { at: [-0.1, 0.98, 0.02], rotate: [0, 0, 0.5], value: 0.72 }),
    part(new THREE.CylinderGeometry(0.035, 0.035, 1.02, 6), { at: [0.24, 0.5, -0.06], rotate: [0.55, 0, -0.16], value: 0.06 }),
    part(new THREE.ConeGeometry(0.07, 0.22, 4), { at: [0.32, 0.94, 0.2], rotate: [0.55, 0, -0.16], value: 0.5 }),
  ], 'miniature:enemy')
}

/** The elite: a taller champion standing on a raised stone plinth, caped, staff in hand. */
function createEliteMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.44, 0.5, 0.18, 18), { at: [0, 0.09, 0], value: 0.24 }),
    part(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 18), { at: [0, 0.21, 0], value: 0.42 }),
    part(new THREE.CylinderGeometry(0.26, 0.29, 0.06, 14), { at: [0, 0.27, 0], value: 0.3 }),
    part(new THREE.BoxGeometry(0.32, 0.38, 0.24), { at: [0, 0.49, 0], value: 0.4 }),
    part(new THREE.BoxGeometry(0.46, 0.62, 0.06), { at: [0, 0.82, -0.2], rotate: [-0.12, 0, 0], value: 0.16 }),
    part(new THREE.BoxGeometry(0.44, 0.44, 0.3), { at: [0, 0.89, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.68, 0.18, 0.34), { at: [0, 1.15, 0], value: 0.6 }),
    part(new THREE.SphereGeometry(0.16, 10, 8), { at: [0, 1.33, 0], value: 0.48 }),
    part(new THREE.BoxGeometry(0.2, 0.08, 0.09), { at: [0, 1.31, 0.13], value: 0.03 }),
    part(new THREE.ConeGeometry(0.06, 0.26, 6), { at: [0.13, 1.48, 0], rotate: [0, 0, -0.55], value: 0.8 }),
    part(new THREE.ConeGeometry(0.06, 0.26, 6), { at: [-0.13, 1.48, 0], rotate: [0, 0, 0.55], value: 0.8 }),
    part(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6), { at: [0.32, 1, 0.02], value: 0.05 }),
    part(new THREE.ConeGeometry(0.11, 0.26, 6), { at: [0.32, 1.86, 0.02], value: 0.95 }),
  ], 'miniature:elite')
}

export function createDioramaAssets(): DioramaAssets {
  const boardTexture = createBoardTexture()
  const frameTexture = createFrameTexture()
  const contactShadowTexture = createContactShadowTexture()
  const miniatures = {
    friendly: createFriendlyMiniature(),
    enemy: createEnemyMiniature(),
    elite: createEliteMiniature(),
  } as const
  const baseRingGeometry = new THREE.RingGeometry(0.49, 0.62, 32)
  const contactShadowGeometry = new THREE.PlaneGeometry(1.75, 1.75)
  const frameRailGeometry = new THREE.BoxGeometry(1, 1, 1)

  return {
    boardTexture,
    frameTexture,
    contactShadowTexture,
    miniatures,
    baseRingGeometry,
    contactShadowGeometry,
    frameRailGeometry,
    dispose: () => {
      boardTexture.dispose()
      frameTexture.dispose()
      contactShadowTexture.dispose()
      Object.values(miniatures).forEach((geometry) => geometry.dispose())
      baseRingGeometry.dispose()
      contactShadowGeometry.dispose()
      frameRailGeometry.dispose()
    },
  }
}
