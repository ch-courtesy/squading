import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { RIG_ARM, RIG_HIP_L, RIG_HIP_R, RIG_OFF, RIG_SHIN_L, RIG_SHIN_R, RIG_TORSO } from './figure-rig'

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
  /** Non-uniform stretch applied before rotation — a squashed dome, a flattened plate. */
  readonly scale?: readonly [number, number, number]
  /**
   * Linear paint value the part multiplies the archetype tint by. 1 is the fully
   * painted team colour, low values read as dark gunmetal or shadowed underside, and
   * values ABOVE 1 read as a lit edge — a pauldron rim catching the key.
   */
  readonly value: number
  /**
   * Optional per-channel bias on top of `value`, so a part can leave the team hue without
   * leaving the team colour behind.
   *
   * The vertex colour multiplies the material's faction tint, so a part cannot be given an
   * absolute colour without also giving up the tint — and the tint is what tells teal from
   * scarlet from purple with ONE shared geometry per archetype. Skewing the channels instead
   * pulls a part warm (leather, brass) or cold (steel) while it still rides the faction paint.
   * Kept mild on purpose: a hard skew turns a purple raider green.
   */
  readonly bias?: readonly [number, number, number]
  /**
   * Which rig joint carries this part (`figure-rig.ts`). Baked per vertex at build time and
   * read by the body's own vertex shader, which is how a limb moves without becoming a second
   * mesh — the spec budgets four meshes a unit and all four are already spoken for.
   *
   * Defaults to `RIG_ROOT`, which is identity forever: a base disc does not walk.
   */
  readonly joint?: number
}

/**
 * Bakes a flat paint value into the part as vertex colours, then places it. Every part
 * therefore carries the same attribute set (position, normal, uv, color, aJoint) which is what
 * lets the whole figure merge into one buffer with a single material.
 */
function part(geometry: THREE.BufferGeometry, placement: Placement): THREE.BufferGeometry {
  const count = geometry.attributes.position.count
  const colors = new Float32Array(count * 3)
  const [biasR, biasG, biasB] = placement.bias ?? [1, 1, 1]
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = placement.value * biasR
    colors[index * 3 + 1] = placement.value * biasG
    colors[index * 3 + 2] = placement.value * biasB
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const joints = new Float32Array(count)
  if (placement.joint) joints.fill(placement.joint)
  geometry.setAttribute('aJoint', new THREE.BufferAttribute(joints, 1))
  if (placement.scale) geometry.scale(placement.scale[0], placement.scale[1], placement.scale[2])
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
 * WHAT THE SHAPE HAS TO DO. Batch K dropped the staged elevation to 23 degrees (`staging.ts`),
 * which changed the answer: the reader now sees the FRONT of a figure as well as its top, so a
 * chest, a stance and a weapon carried forward all survive the projection where before only
 * horizontal extent and headgear did. Every class cue below is therefore built in three places
 * at once — outline from above, outline from the front, and value:
 *
 *   command   a standard on the back — a pole above every other head, with a flag panel and a
 *             crossbar that read as a rectangle offset from the body. Nothing else on the
 *             board carries one, which is the point: §1.4.1 sends the fifteen out to fight on
 *             their own, and picking the command unit out of a scattered board is now the
 *             renderer's problem rather than a nicety. It also stands a head taller and wears
 *             a pale sash across the chest, so the front read carries it too.
 *   soldier   the same trooper build with no standard: a rifle held ACROSS the chest, so the
 *             outline is a short bar over a compact body.
 *   melee     §1.9's charging class. Wide and hunched, a round shield out front and a broad
 *             cleaver overhead — a chunky blob with no thin protrusion, leaning into the
 *             charge so the lean itself is visible from the front.
 *   shooter   §1.9's ranged class. Narrow, hooded, with a long rifle held straight FORWARD:
 *             from above it is a needle sticking out of the outline, which is the one cue the
 *             melee blob can never be confused with. Standing tall and thin against the
 *             melee's crouch.
 *   elite     already unmistakable at this scale — a plinth, half again the height, a staff.
 *             Batch J widened its mantle so the silhouette reads as broad from above too.
 *
 * VALUE IS THE OTHER HALF. A figure whose every part carries the same paint value is a
 * single-colour blob at 90 screen pixels no matter how it was sculpted — which is what the
 * previous pass looked like. So the parts are keyed: armour at the full faction tint, plate
 * edges and helmet crests ABOVE it, boots, packs and belts well below it, and weapons close to
 * black. `bias` skews a few of them warm or cold without leaving the faction hue.
 */

/** Paint keys shared by every figure, so the light-to-dark rhythm is the same across classes. */
const PAINT = {
  /** The moulded base disc, and the darkest thing on the figure after the weapons. */
  base: 0.16,
  boot: 0.12,
  leg: 0.28,
  /** The main painted armour. Below 1 so the lit plates above it have somewhere to go. */
  armour: 0.88,
  /**
   * A plate edge, a crest, a breastplate catching the key. Well above 1 on purpose: the whole
   * figure is 90 screen pixels tall, and a value ratio under about 2:1 between its plates and
   * its body reads as one flat colour at that size — which is what the previous pass looked
   * like. The tone curve rolls the top of this off rather than clipping it.
   */
  edge: 1.75,
  /**
   * A gentler lift, for a LARGE surface or for a body whose faction tint is already light.
   * `edge` is sized for a small accent on a saturated paint; spread across a plinth or a mantle
   * on the elite's lavender it clips to white and the body loses its faction with it.
   */
  trim: 1.18,
  belt: 0.2,
  pack: 0.24,
  helmet: 0.5,
  visor: 0.04,
  weapon: 0.07,
  /** Wooden hafts and leather straps: dark, and warm rather than tinted. */
  leather: 0.3,
} as const

/** Warm skew for leather and wood; cold skew for bare steel. Mild, so the faction hue survives. */
const WARM: readonly [number, number, number] = [1.3, 1.02, 0.72]
const COLD: readonly [number, number, number] = [0.86, 0.98, 1.24]

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
    ...trooperParts({ height: 1.06 }),
    ...trooperRifleAcross(1.06),
    // A pale sash across the chest — the front-facing half of the officer read, now that the
    // camera shows a chest at all.
    part(new THREE.BoxGeometry(0.42, 0.1, 0.29), { at: [0, 0.62, 0.01], rotate: [0, 0, 0.5], value: PAINT.edge, joint: RIG_TORSO }),
    // The standard: pole, crossbar, flag panel, and a pennant tail below it. Strapped to the
    // back, so it rides the torso — it sways with the walk and never with the rifle.
    part(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), { at: [-0.21, 1.08, -0.21], value: PAINT.leather, bias: WARM, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.06, 0.045, 0.34), { at: [-0.21, 1.82, -0.09], value: PAINT.weapon, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.03, 0.44, 0.52), { at: [-0.21, 1.59, -0.04], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.03, 0.17, 0.25), { at: [-0.21, 1.29, 0.09], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.ConeGeometry(0.06, 0.17, 6), { at: [-0.21, 1.96, -0.21], value: PAINT.edge, joint: RIG_TORSO }),
    // A crest along the helmet, so the head reads as the officer's head from directly above.
    part(new THREE.BoxGeometry(0.045, 0.14, 0.31), { at: [0, 1.12, 0], value: PAINT.edge, joint: RIG_TORSO }),
  ], 'miniature:command')
}

/**
 * Boots, legs, a leaning torso, pauldrons, backpack and a visored helmet. Feet at y = 0,
 * facing +Z. `height` scales the whole figure vertically so the command unit can stand a
 * head taller than the fifteen without a second set of parts.
 */
function trooperParts(options: { height?: number } = {}): THREE.BufferGeometry[] {
  const h = options.height ?? 1
  const at = (x: number, y: number, z: number) => [x, y * h, z] as const
  return [
    // The moulded round base every miniature is cast on. It sits just inside the base ring.
    part(new THREE.CylinderGeometry(0.34, 0.38, 0.055, 18), { at: [0, 0.027, 0], value: PAINT.base }),
    part(new THREE.CylinderGeometry(0.3, 0.33, 0.03, 18), { at: [0, 0.068, 0], value: PAINT.edge }),
    // Two legs in a braced stance, which is what makes the figure read as standing rather than
    // as a cylinder — the gap between them is visible now that the camera is low.
    //
    // SPLIT AT THE KNEE in batch M, because a rigid leg swinging from the hip reads as a plank
    // and the lift is what makes a stride a stride. Thigh and shin overlap by ~0.02 so the joint
    // never opens a gap when the knee flexes, and the boot rides the shin.
    part(new THREE.BoxGeometry(0.13, 0.16, 0.16), { at: at(0.11, 0.315, 0.01), rotate: [0, 0, -0.07], value: PAINT.leg, joint: RIG_HIP_L }),
    part(new THREE.BoxGeometry(0.13, 0.16, 0.16), { at: at(-0.11, 0.315, 0.01), rotate: [0, 0, 0.07], value: PAINT.leg, joint: RIG_HIP_R }),
    part(new THREE.BoxGeometry(0.125, 0.19, 0.155), { at: at(0.115, 0.165, 0.01), rotate: [0, 0, -0.07], value: PAINT.leg, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.125, 0.19, 0.155), { at: at(-0.115, 0.165, 0.01), rotate: [0, 0, 0.07], value: PAINT.leg, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.16, 0.09, 0.22), { at: at(0.12, 0.06, 0.03), value: PAINT.boot, bias: WARM, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.16, 0.09, 0.22), { at: at(-0.12, 0.06, 0.03), value: PAINT.boot, bias: WARM, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.32, 0.07, 0.24), { at: at(0, 0.4, 0), value: PAINT.belt, bias: WARM, joint: RIG_TORSO }),
    // The torso leans into the fight rather than standing to attention.
    part(new THREE.BoxGeometry(0.36, 0.36, 0.25), { at: at(0, 0.6, 0.015), rotate: [0.1, 0, 0], value: PAINT.armour, joint: RIG_TORSO }),
    // Breastplate: the lit face the front read hangs off.
    part(new THREE.BoxGeometry(0.26, 0.24, 0.07), { at: at(0, 0.63, 0.14), rotate: [0.1, 0, 0], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.56, 0.14, 0.3), { at: at(0, 0.78, 0), value: PAINT.armour, joint: RIG_TORSO }),
    // Pauldron caps, angled so each one catches the key differently from the shoulder under it.
    part(new THREE.BoxGeometry(0.2, 0.1, 0.26), { at: at(0.23, 0.83, 0), rotate: [0, 0, 0.32], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.2, 0.1, 0.26), { at: at(-0.23, 0.83, 0), rotate: [0, 0, -0.32], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.24, 0.26, 0.12), { at: at(0, 0.63, -0.19), value: PAINT.pack, bias: WARM, joint: RIG_TORSO }),
    part(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 8), { at: at(0, 0.94, 0), value: PAINT.visor, joint: RIG_TORSO }),
    // A HELMET, not a ball. The skull is a squashed dome, the brim rings it all the way round,
    // and a neck guard hangs off the back — so the head still reads as armoured when the figure
    // has turned away from the camera, which at this elevation happens constantly.
    part(new THREE.SphereGeometry(0.15, 10, 7), { at: at(0, 1.01, -0.01), scale: [1, 0.86, 1.04], value: PAINT.helmet, bias: COLD, joint: RIG_TORSO }),
    part(new THREE.CylinderGeometry(0.175, 0.185, 0.05, 12), { at: at(0, 0.96, -0.01), value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.22, 0.12, 0.06), { at: at(0, 0.96, -0.15), rotate: [-0.5, 0, 0], value: PAINT.helmet, bias: COLD, joint: RIG_TORSO }),
    // Brow and visor slit: two horizontal bars, and the dark one is the face.
    part(new THREE.BoxGeometry(0.26, 0.05, 0.1), { at: at(0, 1.06, 0.08), value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.2, 0.07, 0.09), { at: at(0, 0.99, 0.12), value: PAINT.visor, joint: RIG_TORSO }),
  ]
}

/**
 * Both arms up, rifle held level across the chest: a short bar over a compact outline.
 *
 * The whole assembly is ONE joint (`RIG_ARM`), pivoting at the middle of the chest rather than
 * at either shoulder, so the aim rotates the weapon and both arms together instead of tearing
 * the off arm away from its socket. From the overhead camera the cue is unmistakable: the bar
 * across the body swings round to point down-range.
 */
function trooperRifleAcross(height = 1): THREE.BufferGeometry[] {
  const y = (value: number) => value * height
  return [
    part(new THREE.BoxGeometry(0.11, 0.28, 0.13), { at: [0.24, y(0.62), 0.07], value: PAINT.leg, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.11, 0.28, 0.13), { at: [-0.24, y(0.62), 0.07], value: PAINT.leg, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.66, 0.07, 0.08), { at: [0.02, y(0.66), 0.2], value: PAINT.weapon, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.19, 0.11, 0.08), { at: [-0.17, y(0.63), 0.2], value: PAINT.leather, bias: WARM, joint: RIG_ARM }),
    // Muzzle, forward of the hands, so the weapon has an end from the front as well as above.
    part(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 6), { at: [0.34, y(0.66), 0.2], rotate: [0, 0, Math.PI / 2], value: PAINT.weapon, joint: RIG_ARM }),
  ]
}

/** §1.9's melee class: hunched and broad, round shield out front, cleaver overhead. */
function createMeleeMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.34, 0.38, 0.055, 16), { at: [0, 0.027, 0], value: PAINT.base }),
    part(new THREE.CylinderGeometry(0.3, 0.33, 0.03, 16), { at: [0, 0.068, 0], value: PAINT.edge }),
    // A wide crouched stance — legs splayed, weight forward. The gap between the legs and the
    // lean are both front-read cues the melee has and the shooter does not. Split at the knee
    // in batch M, like the trooper's.
    part(new THREE.BoxGeometry(0.15, 0.14, 0.17), { at: [0.16, 0.275, -0.02], rotate: [0, 0, -0.22], value: PAINT.leg, joint: RIG_HIP_L }),
    part(new THREE.BoxGeometry(0.15, 0.14, 0.17), { at: [-0.16, 0.275, -0.02], rotate: [0, 0, 0.22], value: PAINT.leg, joint: RIG_HIP_R }),
    part(new THREE.BoxGeometry(0.145, 0.16, 0.165), { at: [0.16, 0.15, -0.02], rotate: [0, 0, -0.22], value: PAINT.leg, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.145, 0.16, 0.165), { at: [-0.16, 0.15, -0.02], rotate: [0, 0, 0.22], value: PAINT.leg, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.18, 0.09, 0.24), { at: [0.2, 0.06, 0.01], value: PAINT.boot, bias: WARM, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.18, 0.09, 0.24), { at: [-0.2, 0.06, 0.01], value: PAINT.boot, bias: WARM, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.46, 0.38, 0.34), { at: [0, 0.53, 0.05], rotate: [0.3, 0, 0], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.3, 0.24, 0.08), { at: [0, 0.55, 0.21], rotate: [0.3, 0, 0], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.7, 0.17, 0.36), { at: [0, 0.72, 0.03], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.24, 0.11, 0.3), { at: [0.29, 0.78, 0.03], rotate: [0, 0, 0.36], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.24, 0.11, 0.3), { at: [-0.29, 0.78, 0.03], rotate: [0, 0, -0.36], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.SphereGeometry(0.16, 8, 6), { at: [0, 0.87, 0.08], value: PAINT.helmet, bias: COLD, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.24, 0.07, 0.1), { at: [0, 0.85, 0.19], value: PAINT.visor, joint: RIG_TORSO }),
    part(new THREE.ConeGeometry(0.055, 0.24, 6), { at: [0.13, 1, 0.05], rotate: [0, 0, -0.7], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.ConeGeometry(0.055, 0.24, 6), { at: [-0.13, 1, 0.05], rotate: [0, 0, 0.7], value: PAINT.edge, joint: RIG_TORSO }),
    // The shield: a wide disc carried flat-on to the front, which is what makes the outline
    // read broad from above instead of merely chunky. It is the off hand, and it comes up
    // across the body while the cleaver is committed.
    part(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 14), { at: [-0.31, 0.56, 0.24], rotate: [Math.PI / 2, 0, 0.2], value: PAINT.leather, bias: WARM, joint: RIG_OFF }),
    part(new THREE.TorusGeometry(0.28, 0.035, 6, 14), { at: [-0.31, 0.56, 0.28], rotate: [0, 0, 0], value: PAINT.edge, joint: RIG_OFF }),
    part(new THREE.SphereGeometry(0.085, 8, 6), { at: [-0.31, 0.56, 0.3], value: PAINT.edge, joint: RIG_OFF }),
    // The cleaver: a short haft and a broad flat blade held up and out to the side. Haft, blade
    // and edge all ride `RIG_ARM`, which is what swings.
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.44, 6), { at: [0.36, 0.74, -0.04], rotate: [0, 0, -0.3], value: PAINT.leather, bias: WARM, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.3, 0.36, 0.05), { at: [0.49, 1.05, -0.04], rotate: [0, 0, -0.3], value: PAINT.weapon, bias: COLD, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.07, 0.34, 0.055), { at: [0.61, 1.09, -0.04], rotate: [0, 0, -0.3], value: PAINT.edge, joint: RIG_ARM }),
  ], 'miniature:melee')
}

/** §1.9's ranged class: narrow, hooded, a long rifle levelled straight forward. */
function createShooterMiniature(): THREE.BufferGeometry {
  return merge([
    part(new THREE.CylinderGeometry(0.31, 0.35, 0.055, 16), { at: [0, 0.027, 0], value: PAINT.base }),
    part(new THREE.CylinderGeometry(0.27, 0.3, 0.03, 16), { at: [0, 0.068, 0], value: PAINT.edge }),
    // Narrow, upright, feet close together — the opposite stance to the melee's crouch.
    part(new THREE.BoxGeometry(0.11, 0.18, 0.14), { at: [0.08, 0.325, 0], value: PAINT.leg, joint: RIG_HIP_L }),
    part(new THREE.BoxGeometry(0.11, 0.18, 0.14), { at: [-0.08, 0.325, 0], value: PAINT.leg, joint: RIG_HIP_R }),
    part(new THREE.BoxGeometry(0.105, 0.2, 0.135), { at: [0.08, 0.16, 0], value: PAINT.leg, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.105, 0.2, 0.135), { at: [-0.08, 0.16, 0], value: PAINT.leg, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.13, 0.08, 0.2), { at: [0.08, 0.05, 0.02], value: PAINT.boot, bias: WARM, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.13, 0.08, 0.2), { at: [-0.08, 0.05, 0.02], value: PAINT.boot, bias: WARM, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.3, 0.4, 0.22), { at: [0, 0.6, 0], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.2, 0.24, 0.07), { at: [0, 0.62, 0.13], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.44, 0.14, 0.24), { at: [0, 0.8, 0], value: PAINT.armour, joint: RIG_TORSO }),
    // A hood rather than a helmet: the head is a cone, not a ball, so the class is told apart
    // from the melee even where the weapon is hidden behind another figure.
    part(new THREE.ConeGeometry(0.17, 0.34, 8), { at: [0, 1.02, -0.02], value: PAINT.helmet, bias: COLD, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.17, 0.08, 0.09), { at: [0, 0.94, 0.12], value: PAINT.visor, joint: RIG_TORSO }),
    // The quiver on the back, angled so it reads as a second line from above.
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.38, 6), { at: [-0.17, 0.72, -0.17], rotate: [0.3, 0, 0.25], value: PAINT.leather, bias: WARM, joint: RIG_TORSO }),
    // Arms and the long barrel: the needle that no melee body has. The whole assembly is the
    // weapon carriage, so the rest pose is a LOWERED barrel and the aim brings it level.
    part(new THREE.BoxGeometry(0.1, 0.1, 0.32), { at: [0.2, 0.64, 0.13], value: PAINT.leg, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.1, 0.1, 0.17), { at: [-0.17, 0.64, 0.21], value: PAINT.leg, joint: RIG_ARM }),
    part(new THREE.CylinderGeometry(0.032, 0.032, 1, 6), { at: [0.06, 0.66, 0.47], rotate: [Math.PI / 2, 0, 0], value: PAINT.weapon, joint: RIG_ARM }),
    part(new THREE.BoxGeometry(0.1, 0.13, 0.24), { at: [0.06, 0.61, 0.09], value: PAINT.leather, bias: WARM, joint: RIG_ARM }),
    part(new THREE.ConeGeometry(0.05, 0.13, 6), { at: [0.06, 0.66, 1], rotate: [Math.PI / 2, 0, 0], value: PAINT.edge, joint: RIG_ARM }),
  ], 'miniature:shooter')
}

/** The elite: a taller champion standing on a raised stone plinth, caped, staff in hand. */
function createEliteMiniature(): THREE.BufferGeometry {
  return merge([
    // THE ELITE IS PAINTED DOWN, not up. It is the largest body on the board, it wears the
    // lightest faction tint, and it is under fire from fifteen rifles at once — so it carries
    // the same lit-plate rhythm as everything else at `trim` rather than `edge`, and keeps
    // `edge` for the four small accents that have to punch. At `edge` throughout, every broad
    // surface on it clipped and the one body a player must never lose track of came out white.
    part(new THREE.CylinderGeometry(0.44, 0.5, 0.18, 18), { at: [0, 0.09, 0], value: PAINT.base }),
    part(new THREE.CylinderGeometry(0.36, 0.4, 0.06, 18), { at: [0, 0.21, 0], value: PAINT.trim }),
    part(new THREE.CylinderGeometry(0.26, 0.29, 0.06, 14), { at: [0, 0.27, 0], value: PAINT.base }),
    part(new THREE.BoxGeometry(0.16, 0.14, 0.18), { at: [0.11, 0.505, 0], value: PAINT.leg, joint: RIG_HIP_L }),
    part(new THREE.BoxGeometry(0.16, 0.14, 0.18), { at: [-0.11, 0.505, 0], value: PAINT.leg, joint: RIG_HIP_R }),
    part(new THREE.BoxGeometry(0.155, 0.16, 0.175), { at: [0.11, 0.365, 0], value: PAINT.leg, joint: RIG_SHIN_L }),
    part(new THREE.BoxGeometry(0.155, 0.16, 0.175), { at: [-0.11, 0.365, 0], value: PAINT.leg, joint: RIG_SHIN_R }),
    part(new THREE.BoxGeometry(0.36, 0.4, 0.26), { at: [0, 0.68, 0], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.28, 0.3, 0.08), { at: [0, 0.7, 0.15], value: PAINT.trim, joint: RIG_TORSO }),
    // The cape.
    part(new THREE.BoxGeometry(0.5, 0.72, 0.06), { at: [0, 0.86, -0.22], rotate: [-0.12, 0, 0], value: PAINT.leather, bias: WARM, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.46, 0.42, 0.3), { at: [0, 0.99, 0], value: PAINT.armour, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.7, 0.18, 0.34), { at: [0, 1.22, 0], value: PAINT.armour, joint: RIG_TORSO }),
    // The mantle: two swept plates off the pauldrons. At this elevation the cape on its back is
    // nearly edge-on, and these are what carry that width into the top-down read.
    part(new THREE.BoxGeometry(0.36, 0.1, 0.42), { at: [0.44, 1.16, -0.06], rotate: [0, 0, 0.3], value: PAINT.trim, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.36, 0.1, 0.42), { at: [-0.44, 1.16, -0.06], rotate: [0, 0, -0.3], value: PAINT.trim, joint: RIG_TORSO }),
    part(new THREE.SphereGeometry(0.17, 10, 8), { at: [0, 1.4, 0], value: PAINT.helmet, bias: COLD, joint: RIG_TORSO }),
    part(new THREE.BoxGeometry(0.22, 0.09, 0.1), { at: [0, 1.38, 0.14], value: PAINT.visor, joint: RIG_TORSO }),
    part(new THREE.ConeGeometry(0.06, 0.28, 6), { at: [0.14, 1.56, 0], rotate: [0, 0, -0.55], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.ConeGeometry(0.06, 0.28, 6), { at: [-0.14, 1.56, 0], rotate: [0, 0, 0.55], value: PAINT.edge, joint: RIG_TORSO }),
    part(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 6), { at: [0.33, 1.08, 0.02], value: PAINT.leather, bias: WARM, joint: RIG_ARM }),
    part(new THREE.TorusGeometry(0.13, 0.032, 6, 12), { at: [0.33, 1.9, 0.02], value: PAINT.edge, joint: RIG_ARM }),
    part(new THREE.ConeGeometry(0.1, 0.24, 6), { at: [0.33, 2.06, 0.02], value: PAINT.edge, joint: RIG_ARM }),
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

// SIZED DOWN IN BATCH K, on the controller's call. The bar carried more visual weight than the
// miniature it belonged to — wider than the figure was tall, with a heavy border around it — and
// on a board of sixteen friendlies it was the first thing the eye landed on. The INFORMATION is
// unchanged: every friendly still wears one, a damaged hostile still wears one, and the fill is
// still `hp01` exactly. Only the weight came down: two thirds the width, half the height, a
// hairline keyline instead of a border, and it hangs closer to the head (`GAUGE_HEADROOM`).
export const GAUGE_WIDTH = 0.66
export const GAUGE_HEIGHT = 0.085
/** A hairline of dark track showing around the fill, enough to hold the bar's shape apart from
 * the board behind it without drawing an outline of its own. */
const GAUGE_BORDER = 0.016
const GAUGE_TRACK_VALUE = 0.045
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

/**
 * The five merged bodies, and nothing else.
 *
 * Split out of `createDioramaAssets` so the geometry can be built where there is no canvas: the
 * textures need a 2D context and a headless test has none, but what the rig is baked into is
 * pure `BufferGeometry`. `tests/figure-rig.test.ts` checks the joint attribute through this.
 */
export function createMiniatureGeometries(): Readonly<Record<MiniatureArchetype, THREE.BufferGeometry>> {
  return {
    command: createCommandMiniature(),
    soldier: createSoldierMiniature(),
    melee: createMeleeMiniature(),
    shooter: createShooterMiniature(),
    elite: createEliteMiniature(),
  }
}

export function createDioramaAssets(): DioramaAssets {
  const boardTexture = createBoardTexture()
  const frameTexture = createFrameTexture()
  const contactShadowTexture = createContactShadowTexture()
  const miniatures = createMiniatureGeometries()
  const baseRingGeometry = new THREE.RingGeometry(0.49, 0.62, 32)
  // Tightened in batch K. This is the soft AMBIENT-OCCLUSION patch directly under a figure, not
  // its cast shadow — the key light throws the real one, and now that the key runs a much higher
  // key-to-fill ratio the cast shadow carries the weight. At the old size the two read as a
  // single grey puddle around every base.
  const contactShadowGeometry = new THREE.PlaneGeometry(1.15, 1.15)
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
