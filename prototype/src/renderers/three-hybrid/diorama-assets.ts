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

/**
 * One archetype per `UnitKind`, because the spec asks for the CLASS to be readable from the
 * silhouette alone and `UnitKind` is exactly what the authority publishes about class:
 * `core/battle-view/snapshot.ts` maps §1.9's melee to `enemy` and its shooter to
 * `enemy-commander`. Before batch J both of those shared one body and were told apart by paint
 * only, and the player's command unit shared the trooper body with its own fifteen.
 */
export type MiniatureArchetype = 'command' | 'soldier' | 'melee' | 'shooter' | 'elite'

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
  // The box is what the health gauge is hung off: the bar has to clear the tallest point of
  // the body it belongs to, and reading that off the geometry keeps the two from drifting.
  merged.computeBoundingBox()
  return merged
}

/**
 * THE DETAIL BUDGET, and why the shapes below are the shapes they are.
 *
 * Every figure is merged into ONE buffer with ONE material, so a body is one draw call no
 * matter how many primitives went into it — the budget the spec fixes (four meshes per unit)
 * is untouched by anything in this section. What detail costs is vertices and build time, and
 * both are small at these segment counts.
 *
 * WHAT THE SHAPE HAS TO DO. The board is staged at a 30-degree elevation (`staging.ts`), so
 * the reader sees the top and the front of a figure and almost nothing of its profile. A
 * feature that only exists in side view is invisible here. Every class cue below is therefore
 * either a HORIZONTAL EXTENT (how wide, how far forward the outline reaches) or something on
 * top of the head, because those are the two things that survive the projection:
 *
 *   command   a standard on the back — a pole above every other head, with a flag panel and a
 *             crossbar that read as a rectangle offset from the body. Nothing else on the
 *             board carries one, which is the point: §1.4.1 sends the fifteen out to fight on
 *             their own, and picking the command unit out of a scattered board is now the
 *             renderer's problem rather than a nicety.
 *   soldier   the same trooper build with no standard: a rifle held ACROSS the chest, so the
 *             outline is a short bar over a compact body.
 *   melee     §1.9's charging class. Wide and hunched, a round shield on one arm and a broad
 *             cleaver on the other — a chunky blob with no thin protrusion.
 *   shooter   §1.9's ranged class. Narrow, hooded, with a long rifle held straight FORWARD:
 *             from above it is a needle sticking out of the outline, which is the one cue the
 *             melee blob can never be confused with.
 *   elite     already unmistakable at this scale — a plinth, half again the height, a staff.
 *             Batch J widens its mantle so the silhouette reads as broad from above too.
 */

/** A rank-and-file trooper: boots, torso, pauldrons, visored helmet, pack, rifle across. */
function createSoldierMiniature(): THREE.BufferGeometry {
  return merge([...trooperParts(), ...trooperRifleAcross()], 'miniature:soldier')
}

/**
 * The command unit: the trooper build, plus the standard that makes it findable at a glance.
 * The pole tops out well above every other head on the board and the flag hangs off its side,
 * so the cue survives both the head-on read and the top-down one.
 */
function createCommandMiniature(): THREE.BufferGeometry {
  return merge([
    ...trooperParts(),
    ...trooperRifleAcross(),
    // The standard: pole, crossbar, flag panel, and a pennant tail below it.
    part(new THREE.CylinderGeometry(0.032, 0.032, 1.5, 6), { at: [-0.2, 1.02, -0.2], value: 0.12 }),
    part(new THREE.BoxGeometry(0.06, 0.045, 0.34), { at: [-0.2, 1.72, -0.08], value: 0.14 }),
    part(new THREE.BoxGeometry(0.03, 0.42, 0.5), { at: [-0.2, 1.5, -0.03], value: 1 }),
    part(new THREE.BoxGeometry(0.03, 0.16, 0.24), { at: [-0.2, 1.21, 0.09], value: 0.72 }),
    part(new THREE.ConeGeometry(0.06, 0.16, 6), { at: [-0.2, 1.85, -0.2], value: 0.95 }),
    // A crest along the helmet, so the head reads as the officer's head from directly above.
    part(new THREE.BoxGeometry(0.045, 0.13, 0.3), { at: [0, 1.03, 0], value: 0.95 }),
  ], 'miniature:command')
}

/** Boots, torso, pauldrons, backpack, visored helmet. Feet at y = 0, facing +Z. */
function trooperParts(): THREE.BufferGeometry[] {
  return [
    part(new THREE.CylinderGeometry(0.27, 0.3, 0.07, 16), { at: [0, 0.035, 0], value: 0.3 }),
    part(new THREE.BoxGeometry(0.28, 0.34, 0.22), { at: [0, 0.24, 0], value: 0.4 }),
    part(new THREE.BoxGeometry(0.36, 0.36, 0.26), { at: [0, 0.59, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.54, 0.15, 0.3), { at: [0, 0.77, 0], value: 0.62 }),
    part(new THREE.BoxGeometry(0.2, 0.22, 0.1), { at: [0, 0.6, -0.17], value: 0.22 }),
    part(new THREE.SphereGeometry(0.14, 10, 8), { at: [0, 0.93, 0], value: 0.5 }),
    part(new THREE.BoxGeometry(0.17, 0.07, 0.08), { at: [0, 0.91, 0.11], value: 0.04 }),
  ]
}

/** Both arms up, rifle held level across the chest: a short bar over a compact outline. */
function trooperRifleAcross(): THREE.BufferGeometry[] {
  return [
    part(new THREE.BoxGeometry(0.1, 0.26, 0.12), { at: [0.23, 0.6, 0.06], value: 0.78 }),
    part(new THREE.BoxGeometry(0.1, 0.26, 0.12), { at: [-0.23, 0.6, 0.06], value: 0.78 }),
    part(new THREE.BoxGeometry(0.62, 0.06, 0.07), { at: [0.02, 0.63, 0.19], value: 0.05 }),
    part(new THREE.BoxGeometry(0.16, 0.1, 0.07), { at: [-0.16, 0.6, 0.19], value: 0.14 }),
  ]
}

/** §1.9's melee class: hunched and broad, round shield out front, cleaver overhead. */
function createMeleeMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.26, 0.29, 0.06, 12), { at: [0, 0.03, 0], value: 0.28 }),
    part(new THREE.BoxGeometry(0.34, 0.3, 0.26), { at: [0, 0.21, 0], value: 0.38 }),
    part(new THREE.BoxGeometry(0.44, 0.36, 0.32), { at: [0, 0.52, 0.03], rotate: [0.2, 0, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.66, 0.16, 0.34), { at: [0, 0.7, 0.02], value: 0.58 }),
    part(new THREE.SphereGeometry(0.15, 8, 6), { at: [0, 0.84, 0.07], value: 0.46 }),
    part(new THREE.ConeGeometry(0.055, 0.22, 6), { at: [0.12, 0.96, 0.04], rotate: [0, 0, -0.7], value: 0.72 }),
    part(new THREE.ConeGeometry(0.055, 0.22, 6), { at: [-0.12, 0.96, 0.04], rotate: [0, 0, 0.7], value: 0.72 }),
    // The shield: a wide disc carried flat-on to the front, which is what makes the outline
    // read broad from above instead of merely chunky.
    part(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 14), { at: [-0.3, 0.56, 0.2], rotate: [Math.PI / 2, 0, 0.2], value: 0.34 }),
    part(new THREE.SphereGeometry(0.08, 8, 6), { at: [-0.3, 0.56, 0.26], value: 0.62 }),
    // The cleaver: a short haft and a broad flat blade held up and out to the side.
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6), { at: [0.34, 0.72, -0.02], rotate: [0, 0, -0.3], value: 0.08 }),
    part(new THREE.BoxGeometry(0.28, 0.34, 0.05), { at: [0.46, 1.02, -0.02], rotate: [0, 0, -0.3], value: 0.5 }),
  ], 'miniature:melee')
}

/** §1.9's ranged class: narrow, hooded, a long rifle levelled straight forward. */
function createShooterMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.24, 0.27, 0.06, 12), { at: [0, 0.03, 0], value: 0.28 }),
    part(new THREE.BoxGeometry(0.24, 0.32, 0.2), { at: [0, 0.22, 0], value: 0.36 }),
    part(new THREE.BoxGeometry(0.3, 0.36, 0.22), { at: [0, 0.56, 0], value: 1 }),
    part(new THREE.BoxGeometry(0.42, 0.13, 0.24), { at: [0, 0.74, 0], value: 0.55 }),
    // A hood rather than horns: the head is a cone, not a ball, so the class is told apart
    // from the melee even where the weapon is hidden behind another figure.
    part(new THREE.ConeGeometry(0.16, 0.3, 8), { at: [0, 0.94, -0.02], value: 0.44 }),
    part(new THREE.BoxGeometry(0.16, 0.07, 0.08), { at: [0, 0.86, 0.11], value: 0.03 }),
    // The quiver on the back, angled so it reads as a second line from above.
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 6), { at: [-0.16, 0.68, -0.16], rotate: [0.3, 0, 0.25], value: 0.16 }),
    // Arms and the long barrel: the needle that no melee body has.
    part(new THREE.BoxGeometry(0.09, 0.09, 0.3), { at: [0.19, 0.6, 0.12], value: 0.74 }),
    part(new THREE.BoxGeometry(0.09, 0.09, 0.16), { at: [-0.16, 0.6, 0.2], value: 0.74 }),
    part(new THREE.CylinderGeometry(0.032, 0.032, 0.95, 6), { at: [0.06, 0.62, 0.44], rotate: [Math.PI / 2, 0, 0], value: 0.06 }),
    part(new THREE.BoxGeometry(0.09, 0.12, 0.22), { at: [0.06, 0.58, 0.08], value: 0.14 }),
    part(new THREE.ConeGeometry(0.05, 0.12, 6), { at: [0.06, 0.62, 0.94], rotate: [Math.PI / 2, 0, 0], value: 0.5 }),
  ], 'miniature:shooter')
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
    // The mantle: two swept plates off the pauldrons. At a 30-degree elevation the cape on
    // its back is nearly edge-on, and these are what carry that width into the top-down read.
    part(new THREE.BoxGeometry(0.34, 0.09, 0.4), { at: [0.42, 1.08, -0.06], rotate: [0, 0, 0.3], value: 0.3 }),
    part(new THREE.BoxGeometry(0.34, 0.09, 0.4), { at: [-0.42, 1.08, -0.06], rotate: [0, 0, -0.3], value: 0.3 }),
    part(new THREE.SphereGeometry(0.16, 10, 8), { at: [0, 1.33, 0], value: 0.48 }),
    part(new THREE.BoxGeometry(0.2, 0.08, 0.09), { at: [0, 1.31, 0.13], value: 0.03 }),
    part(new THREE.ConeGeometry(0.06, 0.26, 6), { at: [0.13, 1.48, 0], rotate: [0, 0, -0.55], value: 0.8 }),
    part(new THREE.ConeGeometry(0.06, 0.26, 6), { at: [-0.13, 1.48, 0], rotate: [0, 0, 0.55], value: 0.8 }),
    part(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 6), { at: [0.32, 1, 0.02], value: 0.05 }),
    part(new THREE.ConeGeometry(0.11, 0.26, 6), { at: [0.32, 1.86, 0.02], value: 0.95 }),
  ], 'miniature:elite')
}

// --- Health gauge ------------------------------------------------------------------------
// The bar over a miniature's head. It is display-only and reads `hp01` off the snapshot, which
// the authority already publishes, so nothing in the core changes to feed it.
//
// ONE MESH, because the spec's per-unit budget is four and the other three are spoken for. A
// track and a fill drawn as two meshes would be five. So both quads live in ONE geometry —
// eight vertices, two quads, vertex-coloured — and the fill's right edge is a POSITION that
// moves. That also settles the other half of the requirement: the value changes every tick, so
// the gauge cannot be baked into the merged body, and here it is a per-unit buffer of eight
// vertices that is rewritten only on the frames where the value actually moved.

export const GAUGE_WIDTH = 1.02
export const GAUGE_HEIGHT = 0.17
/** The dark border the track shows around the fill on all four sides. */
const GAUGE_BORDER = 0.05
const GAUGE_TRACK_VALUE = 0.055
/** The fill sits a hair in front of the track so the billboarded pair never z-fights. */
const GAUGE_FILL_DEPTH = 0.008

/**
 * A fresh gauge geometry — one per unit, since the fill is geometry rather than a uniform.
 * Eight vertices and four triangles; the caller owns it and must dispose it with the unit.
 */
export function createHealthGaugeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const halfWidth = GAUGE_WIDTH / 2
  const halfHeight = GAUGE_HEIGHT / 2
  const outerX = halfWidth + GAUGE_BORDER
  const outerY = halfHeight + GAUGE_BORDER
  const positions = new Float32Array([
    -outerX, outerY, 0, outerX, outerY, 0, outerX, -outerY, 0, -outerX, -outerY, 0,
    -halfWidth, halfHeight, GAUGE_FILL_DEPTH, halfWidth, halfHeight, GAUGE_FILL_DEPTH,
    halfWidth, -halfHeight, GAUGE_FILL_DEPTH, -halfWidth, -halfHeight, GAUGE_FILL_DEPTH,
  ])
  const colors = new Float32Array(8 * 3)
  for (let index = 0; index < 4; index += 1) {
    colors[index * 3] = GAUGE_TRACK_VALUE
    colors[index * 3 + 1] = GAUGE_TRACK_VALUE
    colors[index * 3 + 2] = GAUGE_TRACK_VALUE
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6])
  geometry.computeBoundingSphere()
  return geometry
}

/** Moves the fill's right edge. `fill01` is the snapshot's `hp01`, clamped. */
export function setHealthGaugeFill(geometry: THREE.BufferGeometry, fill01: number): void {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const halfWidth = GAUGE_WIDTH / 2
  const clamped = Number.isFinite(fill01) ? Math.max(0, Math.min(1, fill01)) : 0
  const right = -halfWidth + GAUGE_WIDTH * clamped
  position.setX(5, right)
  position.setX(6, right)
  position.needsUpdate = true
}

/** The fill fraction currently drawn, read back out of the geometry for assertions. */
export function readHealthGaugeFill(geometry: THREE.BufferGeometry): number {
  const position = geometry.attributes.position as THREE.BufferAttribute
  return (position.getX(5) + GAUGE_WIDTH / 2) / GAUGE_WIDTH
}

/** Repaints the fill's four vertices. The track keeps its own dark value. */
export function setHealthGaugeColor(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const attribute = geometry.attributes.color as THREE.BufferAttribute
  for (let index = 4; index < 8; index += 1) attribute.setXYZ(index, color.r, color.g, color.b)
  attribute.needsUpdate = true
}

export function createDioramaAssets(): DioramaAssets {
  const boardTexture = createBoardTexture()
  const frameTexture = createFrameTexture()
  const contactShadowTexture = createContactShadowTexture()
  const miniatures = {
    command: createCommandMiniature(),
    soldier: createSoldierMiniature(),
    melee: createMeleeMiniature(),
    shooter: createShooterMiniature(),
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
