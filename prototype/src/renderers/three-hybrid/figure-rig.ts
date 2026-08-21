import * as THREE from 'three'

import { ARRIVE_EPSILON } from '../../core/battle/constants'
import type { MiniatureArchetype } from './diorama-assets'

/**
 * THE MINIATURE RIG — how a figure that is ONE merged geometry moves its legs.
 *
 * The visuals spec fixes four meshes per unit (body, base ring, contact shadow, health gauge).
 * Splitting a limb into its own mesh would be a fifth, so the limbs are moved WHERE THEY ALREADY
 * ARE: every vertex of the merged body carries a joint index baked in at build time, and the
 * body's own vertex shader transforms it by that joint's matrix. One geometry, one material, one
 * draw call, and the legs still swing. `hybrid-renderer.ts` injects the shader; this file owns
 * the skeleton, the pose maths and the matrices, and it holds NO THREE.js scene state so the
 * whole of it is exercised headlessly by `tests/figure-rig.test.ts`.
 *
 * NOTHING HERE READS OR WRITES AUTHORITY STATE. The inputs are a unit id, a distance the
 * authority already moved that unit, and the display-only strike/aim/flinch timers the renderer
 * keeps in `UnitAnim`. No `Math.random` appears anywhere in this file, on purpose: the stride
 * phase has to be reproducible frame for frame or a screenshot regression is meaningless.
 */

export const RIG_ROOT = 0
export const RIG_HIP_L = 1
export const RIG_SHIN_L = 2
export const RIG_HIP_R = 3
export const RIG_SHIN_R = 4
export const RIG_TORSO = 5
/** The weapon carriage: the arms and whatever they hold. */
export const RIG_ARM = 6
/** The off hand: the melee class's shield. Identity everywhere else. */
export const RIG_OFF = 7
export const RIG_JOINT_COUNT = 8

/** Joint parents. `RIG_ROOT` has none, and a root vertex is never transformed at all. */
const RIG_PARENT: readonly number[] = [-1, RIG_ROOT, RIG_HIP_L, RIG_ROOT, RIG_HIP_R, RIG_ROOT, RIG_TORSO, RIG_TORSO]

/**
 * Joint pivots, in PRE-`FIGURE_SCALE` figure space — feet at y = 0, facing +Z — because that is
 * the space `diorama-assets.ts` authors the parts in and the space `MUZZLE_OFFSETS` is written
 * in. `rigMatrices` scales the translation on the way out, which is exact for a rigid transform:
 * conjugating `[R|t]` by a uniform scale `s` gives `[R|s·t]`.
 */
type JointPivots = readonly (readonly [number, number, number])[]

function trooperPivots(h: number): JointPivots {
  return [
    [0, 0, 0],
    [0.11, 0.385 * h, 0.01],
    [0.115, 0.25 * h, 0.01],
    [-0.11, 0.385 * h, 0.01],
    [-0.115, 0.25 * h, 0.01],
    [0, 0.4 * h, 0],
    [0, 0.7 * h, 0.02],
    [0, 0.7 * h, 0.02],
  ]
}

const PIVOTS: Readonly<Record<MiniatureArchetype, JointPivots>> = {
  soldier: trooperPivots(1),
  command: trooperPivots(1.06),
  melee: [
    [0, 0, 0],
    [0.16, 0.34, -0.02],
    [0.16, 0.22, -0.02],
    [-0.16, 0.34, -0.02],
    [-0.16, 0.22, -0.02],
    [0, 0.36, 0],
    [0.3, 0.8, 0],
    [-0.29, 0.68, 0.06],
  ],
  shooter: [
    [0, 0, 0],
    [0.08, 0.41, 0],
    [0.08, 0.25, 0],
    [-0.08, 0.41, 0],
    [-0.08, 0.25, 0],
    [0, 0.42, 0],
    [0, 0.66, 0.02],
    [0, 0.66, 0.02],
  ],
  elite: [
    [0, 0, 0],
    [0.11, 0.57, 0],
    [0.11, 0.45, 0],
    [-0.11, 0.57, 0],
    [-0.11, 0.45, 0],
    [0, 0.55, 0],
    [0.33, 1.15, 0.02],
    [0.33, 1.15, 0.02],
  ],
}

// --- Stride ------------------------------------------------------------------------------

/**
 * World distance covered by ONE full cycle — two steps, both feet planted once.
 *
 * CADENCE IS TIED TO SPEED BECAUSE PHASE IS TIED TO DISTANCE, not to the clock. A unit that
 * covers more ground per tick reaches the next foot plant sooner, with no speed term anywhere in
 * the formula: at the authority's 30 Hz, `SOLDIER_MOVE_SPEED` 0.1 gives 1.5 cycles a second,
 * `MELEE_MOVE_SPEED` 0.14 gives 2.1, and `SHOOTER_MOVE_SPEED` 0.06 gives 0.9. §1.3's structural
 * rule that the melee outruns the squad is therefore visible as a faster cadence, not merely as
 * a shorter distance per second — which is the whole reason the brief asks for it.
 *
 * Deriving phase from distance also means it cannot jump when the speed changes. A phase written
 * as `clock x rate(speed)` would teleport the legs the moment a unit slowed down, because the
 * whole elapsed clock gets re-multiplied.
 */
export const STRIDE_CYCLE_DISTANCE = 2

/**
 * Below this per-tick step the stride fades out; at or under `ARRIVE_EPSILON` there is none.
 *
 * §1.4's dead-band is the floor ON PURPOSE. `moveTowards` stops a unit dead once it is within
 * `ARRIVE_EPSILON` of its goal and otherwise moves it at least that far, so "step greater than
 * `ARRIVE_EPSILON`" is exactly "the authority moved this unit". A settled figure therefore
 * cannot stride, which is the jitter §1.4 exists to prevent, kept out of the animation too.
 */
export const STRIDE_MIN_STEP = ARRIVE_EPSILON
/** Per-tick step at which the stride is at full amplitude — half a soldier's move speed. */
export const STRIDE_FULL_STEP = 0.05

/** Hip swing at full stride, radians. Negative pitch swings a leg forward. */
const STRIDE_HIP = 0.5
/** Peak knee flex, radians. A knee only bends one way, so this is never negative. */
const STRIDE_KNEE = 1.15
/** Where in the cycle the knee is most flexed, relative to the hip's forward swing. */
const STRIDE_KNEE_PHASE = 0.55
/** Vertical lift at mid-stance, pre-scale figure units. Never negative: a figure is lifted and placed. */
const STRIDE_BOUNCE = 0.05
/** Torso roll into the planted foot, radians. */
const STRIDE_ROLL = 0.07
/** Constant forward lean while walking, radians. */
const STRIDE_LEAN = 0.13
/** Torso counter-yaw against the legs, radians. */
const STRIDE_TWIST = 0.07
/** Arm counter-swing, radians. */
const STRIDE_ARM = 0.3

/**
 * Per-class stride amplitude.
 *
 * The elite is the exception and the reason is its own geometry: it stands on a stone plinth
 * whose top disc is 0.01 under its boots, so a full-amplitude swing drives a foot through the
 * plinth it is standing on. At 0.6 the foot rises clear of the disc through the whole cycle.
 * The elite's cadence is untouched — only how far the legs travel.
 */
const STRIDE_SCALE: Readonly<Record<MiniatureArchetype, number>> = {
  soldier: 1,
  command: 1,
  melee: 1.05,
  shooter: 0.95,
  elite: 0.6,
}

/**
 * A per-unit phase offset in [0, 2π).
 *
 * Sixteen figures started at the same phase are not a squad walking, they are one object
 * oscillating. This is a fixed integer hash of the unit id — no `Math.random`, no renderer state,
 * no time — so the same unit is at the same point of its cycle on every replay of a tick.
 */
export function phaseOffset(unitId: number): number {
  let hash = Math.imul(unitId ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  hash ^= hash >>> 16
  return ((hash >>> 0) / 0x100000000) * Math.PI * 2
}

/** Stride phase in radians for a unit that has walked `travel` world units. */
export function stridePhase(unitId: number, travel: number): number {
  return phaseOffset(unitId) + (travel / STRIDE_CYCLE_DISTANCE) * Math.PI * 2
}

/** How much of the stride a unit taking `stepPerTick` world units of authority movement gets. */
export function strideAmount(stepPerTick: number): number {
  if (!(stepPerTick > STRIDE_MIN_STEP)) return 0
  return clamp01((stepPerTick - STRIDE_MIN_STEP) / (STRIDE_FULL_STEP - STRIDE_MIN_STEP))
}

// --- Strike ------------------------------------------------------------------------------

/** A shot: raise, fire, absorb the kick. Shorter than `SOLDIER_ATTACK_INTERVAL` (12 ticks). */
export const STRIKE_TICKS_RANGED = 8
/** A swing: wind up, chop through, recover. Shorter than `MELEE_ATTACK_INTERVAL` (15 ticks). */
export const STRIKE_TICKS_MELEE = 12
/**
 * Where in the ranged strike the round leaves the barrel: at the very start.
 *
 * THE SHOT IS THE EVENT, and the event is a tick the authority already resolved. Firing part-way
 * into a curve would put the muzzle flash a fraction of a tick after the damage that caused it,
 * and §1.4's volley rhythm — fifteen rifles whose first shots scatter and then converge — is
 * exactly a thing measured in fractions of a tick. So the kick peaks on the tick of the blow and
 * decays from there, and the puff is spawned at that same instant off that same pose.
 */
export const STRIKE_FIRE_FRACTION = 0
/** How long the weapon takes to come up to, and fall back from, the aim. */
export const AIM_RAISE_TICKS = 5
export const AIM_RELEASE_TICKS = 8

/**
 * Where the trooper's rifle ends up when aimed: swung off the chest to point down-range.
 *
 * SIGN CONVENTION for everything below, because it is easy to get backwards and the maths does
 * not care. Rotations are about the joint's own pivot in figure space, facing +Z:
 *   +X pitch  swings a point BELOW the pivot backwards (a leg) and a point IN FRONT of it DOWN
 *             (a barrel), and tips a point ABOVE the pivot forwards (a torso lean, a chop).
 *   -Y yaw    swings +X round to +Z: the rifle carried across the chest turns down-range.
 */
const AIM_TROOPER_YAW = -0.95
/**
 * The shooter carries its barrel level already, so its rest is a LOWERED weapon — but only just.
 *
 * SMALL ON PURPOSE, and the reason is the spec rather than taste. §미니어처 디테일 makes the
 * shooter's long forward barrel the one cue the melee blob can never be mistaken for, and it is a
 * TOP-DOWN cue: a barrel pitched down foreshortens to nothing from the staged camera. At 0.35 the
 * lineup shot showed the muzzle stabbing into the board and the needle gone. At 0.2 the weapon
 * still visibly comes up when the shooter fires, and the silhouette survives the rest of the time.
 */
const AIM_SHOOTER_REST_PITCH = 0.2
const AIM_ELITE_REST_PITCH = 0.14
/** Muzzle rise on the shot, radians. Negative because the barrel points forward. */
const RECOIL_PITCH = -0.34
/** Shoulder shove the kick puts through the torso, radians. */
const RECOIL_TORSO = 0.1
/** Melee wind-up (arm drawn back) and chop-through angles, radians. */
const SWING_WIND = 0.55
const SWING_CHOP = 1.55
/** How far the shield comes up across the body during a swing, radians. */
const SWING_GUARD = 0.5
/** Flinch a blow puts through the torso of whoever took it, radians. */
const FLINCH_TORSO = 0.3

/**
 * What a pose is computed from. Mutable and meant to be REUSED: this is filled in once per unit
 * per frame, sixty units a frame, and a fresh object literal per call would put sixty
 * short-lived objects a frame into the nursery in the window with the least headroom.
 * `createRigInput` makes the one the renderer keeps.
 */
export type RigInput = {
  archetype: MiniatureArchetype
  /** Stride phase in radians (`stridePhase`). */
  phase: number
  /** 0 settled, 1 at full class speed (`strideAmount`). */
  stride: number
  /** Progress through a strike, 0..1, or a negative number when no blow is in flight. */
  strike: number
  /** True for a shot, false for a blow landed by hand. */
  strikeRanged: boolean
  /** 0..1 weapon-raised blend, held between shots. */
  aim: number
  /** 0..1 flinch from a blow just taken. */
  hit: number
}

/**
 * Euler XYZ angles per joint, flat, plus the whole-figure lift. Mutable and reused: this is
 * written once per unit per frame and allocating here would allocate sixty times a frame.
 */
export type RigPose = {
  readonly angles: Float32Array
  /** Vertical lift of the whole figure, in pre-`FIGURE_SCALE` figure units. Never negative. */
  bounce: number
}

export function createRigInput(): RigInput {
  return { archetype: 'soldier', phase: 0, stride: 0, strike: -1, strikeRanged: true, aim: 0, hit: 0 }
}

export function createRigPose(): RigPose {
  return { angles: new Float32Array(RIG_JOINT_COUNT * 3), bounce: 0 }
}

/** The rest pose: every joint identity, the figure standing exactly as it was sculpted. */
export function restRigPose(pose: RigPose): void {
  pose.angles.fill(0)
  pose.bounce = 0
}

/**
 * WHAT MOVES WHAT, and the answer to "an attack that plays while the figure is walking must not
 * fight the walk" (§1.3 makes attack-while-moving the common case, not an edge case):
 *
 *   lower body  — hips and shins — comes ENTIRELY from the stride. A strike never touches them.
 *   upper body  — torso, weapon arm, off hand — is the stride's carry pose PLUS the strike,
 *                 added on top of it rather than replacing it. A soldier firing on the move
 *                 keeps its legs, its lean and its bounce, and the arms stop counter-swinging
 *                 in proportion to how far the weapon has come up (`aim`).
 *
 * So the two compose by owning different halves of the body, with one blend — the arm swing —
 * handing over to the aim as the weapon rises.
 */
export function poseFigure(pose: RigPose, input: RigInput): void {
  const angles = pose.angles
  angles.fill(0)
  const scale = STRIDE_SCALE[input.archetype]
  const stride = clamp01(input.stride) * scale
  const phase = input.phase

  // --- Lower body: the stride, and nothing else -------------------------------------------
  const swing = Math.sin(phase)
  const swingOther = Math.sin(phase + Math.PI)
  angles[RIG_HIP_L * 3] = -STRIDE_HIP * stride * swing
  angles[RIG_HIP_R * 3] = -STRIDE_HIP * stride * swingOther
  angles[RIG_SHIN_L * 3] = STRIDE_KNEE * stride * flex(phase)
  angles[RIG_SHIN_R * 3] = STRIDE_KNEE * stride * flex(phase + Math.PI)
  // Two lifts per cycle, at the two mid-stances. Held at or above zero so a foot is never
  // driven under the board — a miniature is lifted and placed, never sunk.
  pose.bounce = STRIDE_BOUNCE * stride * (0.5 + 0.5 * Math.cos(phase * 2))

  // --- Upper body: the carry pose, then the strike on top of it ---------------------------
  const aim = clamp01(input.aim)
  let torsoX = STRIDE_LEAN * stride - FLINCH_TORSO * input.hit
  let torsoY = -STRIDE_TWIST * stride * swing
  const torsoZ = STRIDE_ROLL * stride * swing

  // The arms stop counter-swinging as the weapon comes up: at a full aim the carriage is held
  // steady on the target while the legs keep running underneath it.
  let armX = STRIDE_ARM * stride * swing * (1 - aim)
  let armY = 0
  let armZ = 0
  let offX = -STRIDE_ARM * stride * swing * (1 - aim)
  const strike = input.strike

  if (input.archetype === 'melee') {
    // A swing, not a nudge: the arm is drawn back, chops through the facing direction, and
    // recovers. The shield comes up across the body while the weapon is committed.
    if (strike >= 0 && strike < 1) {
      const swingAngle = meleeSwing(strike)
      armX += swingAngle
      armZ += -0.35 * Math.max(0, swingAngle) / SWING_CHOP
      offX += SWING_GUARD * guardCurve(strike)
      torsoX += 0.22 * Math.max(0, swingAngle) / SWING_CHOP
      torsoY += -0.18 * Math.max(0, swingAngle) / SWING_CHOP
    }
  } else {
    // Ranged. `aim` is the weapon coming up to a level hold; `strike` is the shot that goes
    // through it. Both ride on top of whatever the stride left in the arms.
    if (input.archetype === 'soldier' || input.archetype === 'command') {
      // The rifle starts held across the chest, so the aim is a YAW that swings it down-range.
      // From directly overhead — the camera this game is actually read from — that is the bar
      // over the body rotating to point at the target, which is the clearest possible cue.
      armY += AIM_TROOPER_YAW * aim
    } else if (input.archetype === 'shooter') {
      armX += AIM_SHOOTER_REST_PITCH * (1 - aim)
    } else {
      armX += AIM_ELITE_REST_PITCH * (1 - aim)
    }
    if (strike >= 0 && strike < 1) {
      const kick = recoilCurve(strike)
      armX += RECOIL_PITCH * kick
      torsoX += -RECOIL_TORSO * kick
    }
  }

  angles[RIG_TORSO * 3] = torsoX
  angles[RIG_TORSO * 3 + 1] = torsoY
  angles[RIG_TORSO * 3 + 2] = torsoZ
  angles[RIG_ARM * 3] = armX
  angles[RIG_ARM * 3 + 1] = armY
  angles[RIG_ARM * 3 + 2] = armZ
  angles[RIG_OFF * 3] = offX
}

/**
 * Knee flex over one cycle: zero through the planted half, a single smooth bulge through the
 * swung half. `max(0, sin)^2` is that shape and costs one multiply.
 */
function flex(phase: number): number {
  const raw = Math.sin(phase + STRIDE_KNEE_PHASE)
  return raw > 0 ? raw * raw : 0
}

/** Wind up, chop through, recover. Returns the shoulder pitch in radians. */
export function meleeSwing(strike01: number): number {
  if (strike01 < 0.3) return -SWING_WIND * ease(strike01 / 0.3)
  if (strike01 < 0.55) {
    const t = ease((strike01 - 0.3) / 0.25)
    return -SWING_WIND + (SWING_CHOP + SWING_WIND) * t
  }
  return SWING_CHOP * (1 - ease((strike01 - 0.55) / 0.45))
}

/** The shield's rise: up early, held through the chop, down with the recovery. */
function guardCurve(strike01: number): number {
  if (strike01 < 0.25) return ease(strike01 / 0.25)
  if (strike01 < 0.6) return 1
  return 1 - ease((strike01 - 0.6) / 0.4)
}

/** A shot's kick: hard on the tick the round leaves, absorbed over the rest of the strike. */
export function recoilCurve(strike01: number): number {
  if (strike01 < STRIKE_FIRE_FRACTION || strike01 >= 1) return 0
  const t = (strike01 - STRIKE_FIRE_FRACTION) / (1 - STRIKE_FIRE_FRACTION)
  const fall = 1 - t
  return fall * fall
}

function ease(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

// --- Matrices ----------------------------------------------------------------------------

const pivotScratch = new THREE.Vector3()
const eulerScratch = new THREE.Euler()
const quaternionScratch = new THREE.Quaternion()
const unitScale = new THREE.Vector3(1, 1, 1)
const localScratch = new THREE.Matrix4()

/** Eight identity matrices, one per joint. Allocated per unit, written per frame. */
export function createRigMatrices(): THREE.Matrix4[] {
  return Array.from({ length: RIG_JOINT_COUNT }, () => new THREE.Matrix4())
}

/**
 * Writes the pose into `out` as the matrices the vertex shader applies, in POST-`FIGURE_SCALE`
 * space — the space the merged body's vertices actually live in.
 *
 * Each joint is `parent · T(pivot) · R(euler) · T(-pivot)`, which leaves its pivot fixed and
 * carries its children with it. `RIG_ROOT` is left identity: a root vertex — a base disc, the
 * elite's plinth — is exactly where it was sculpted.
 *
 * Allocation-free: every scratch object is module scope, and this runs once per unit per frame.
 */
export function rigMatrices(out: THREE.Matrix4[], pose: RigPose, archetype: MiniatureArchetype, figureScale: number): void {
  const pivots = PIVOTS[archetype]
  out[RIG_ROOT]!.identity()
  for (let joint = 1; joint < RIG_JOINT_COUNT; joint += 1) {
    const pivot = pivots[joint]!
    pivotScratch.set(pivot[0], pivot[1], pivot[2])
    eulerScratch.set(pose.angles[joint * 3]!, pose.angles[joint * 3 + 1]!, pose.angles[joint * 3 + 2]!)
    quaternionScratch.setFromEuler(eulerScratch)
    localScratch.compose(pivotScratch, quaternionScratch, unitScale)
    // `T(pivot) · R` composed above, then `· T(-pivot)` folded into the translation column.
    localScratch.elements[12] = pivot[0] - (localScratch.elements[0] * pivot[0] + localScratch.elements[4] * pivot[1] + localScratch.elements[8] * pivot[2])
    localScratch.elements[13] = pivot[1] - (localScratch.elements[1] * pivot[0] + localScratch.elements[5] * pivot[1] + localScratch.elements[9] * pivot[2])
    localScratch.elements[14] = pivot[2] - (localScratch.elements[2] * pivot[0] + localScratch.elements[6] * pivot[1] + localScratch.elements[10] * pivot[2])
    const parent = RIG_PARENT[joint]!
    if (parent === RIG_ROOT) out[joint]!.copy(localScratch)
    else out[joint]!.multiplyMatrices(out[parent]!, localScratch)
  }
  // The pivots above are pre-scale; the vertices are not. Conjugating a rigid transform by a
  // uniform scale only scales its translation, so this is exact rather than approximate.
  if (figureScale !== 1) {
    for (let joint = 1; joint < RIG_JOINT_COUNT; joint += 1) {
      const elements = out[joint]!.elements
      elements[12] *= figureScale
      elements[13] *= figureScale
      elements[14] *= figureScale
    }
  }
}

/** The pivot table, for tests and for the muzzle placement that has to agree with it. */
export function rigPivot(archetype: MiniatureArchetype, joint: number): readonly [number, number, number] {
  return PIVOTS[archetype]![joint]!
}
