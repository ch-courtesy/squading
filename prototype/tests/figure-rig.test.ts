import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import {
  ARRIVE_EPSILON, COMMANDER_ATTACK_INTERVAL, COMMANDER_MELEE_INTERVAL, COMMANDER_MOVE_SPEED,
  MELEE_ATTACK_INTERVAL, MELEE_MOVE_SPEED, SHOOTER_MOVE_SPEED, SOLDIER_ATTACK_INTERVAL,
  SOLDIER_MOVE_SPEED,
} from '../src/core/battle/constants'
import { tickDurationAfter } from '../src/core/battle/upgrades'
import { CARD_EFFECTS } from '../src/core/battle/constants'
import { FIGURE_SCALE, createMiniatureGeometries, type MiniatureArchetype } from '../src/renderers/three-hybrid/diorama-assets'
import {
  RIG_ARM, RIG_HIP_L, RIG_HIP_R, RIG_JOINT_COUNT, RIG_OFF, RIG_ROOT, RIG_SHIN_L, RIG_SHIN_R,
  RIG_TORSO, STRIDE_CYCLE_DISTANCE, STRIDE_FULL_STEP, STRIDE_MIN_STEP,
  STRIKE_TICKS_COMMAND_MELEE, STRIKE_TICKS_MELEE, STRIKE_TICKS_RANGED, createRigMatrices,
  createRigPose, meleeSwing, phaseOffset, poseFigure, recoilCurve, restRigPose, rigMatrices,
  rigPivot, strideAmount, stridePhase,
} from '../src/renderers/three-hybrid/figure-rig'

/**
 * THE WALK, TESTED WITHOUT A SCREEN.
 *
 * A screenshot is a still and cannot show motion at all, so everything the brief asks to be
 * legible on screen is pinned here as a property of the pose maths instead: that the phase is a
 * function of the unit and the distance it walked and of nothing else, that the cadence follows
 * the authority's own move speeds, that a unit settled inside §1.4's dead-band does not stride,
 * and that a foot actually travels — which is the difference between a stride and a torso rock.
 */

const ARCHETYPES: readonly MiniatureArchetype[] = ['soldier', 'command', 'melee', 'shooter', 'elite']

const REST = {
  phase: 0,
  stride: 0,
  strike: -1,
  strikeRanged: true,
  aim: 0,
  hit: 0,
  hitBearing: 0,
} as const

/** Where the right foot sits, in pre-scale figure space, at a given point in the cycle. */
function footAt(archetype: MiniatureArchetype, phase: number, stride: number): THREE.Vector3 {
  const pose = createRigPose()
  poseFigure(pose, { ...REST, archetype, phase, stride })
  const matrices = createRigMatrices()
  rigMatrices(matrices, pose, archetype, 1)
  // The ankle end of the shin: the point that has to plant and lift.
  const knee = rigPivot(archetype, RIG_SHIN_R)
  return new THREE.Vector3(knee[0], 0.04, knee[2]).applyMatrix4(matrices[RIG_SHIN_R]!)
}

describe('stride phase', () => {
  it('is a pure function of the unit id and the distance the authority moved it', () => {
    // Same unit, same travel: the same phase, every time it is asked. No clock, no frame
    // count, no `Math.random` — §4.3's replay agreement and the screenshot regression both
    // depend on this and nothing else.
    for (const travel of [0, 0.37, 12.5, 1_000.25]) {
      for (const id of [1, 7, 16, 41]) {
        expect(stridePhase(id, travel)).toBe(stridePhase(id, travel))
      }
    }
    expect(stridePhase(3, 4)).not.toBe(stridePhase(4, 4))
  })

  it('gives sixteen soldiers sixteen different phases, spread over the whole cycle', () => {
    // A squad started in lockstep is not sixteen figures walking, it is one object vibrating.
    const offsets = Array.from({ length: 16 }, (_, index) => phaseOffset(index + 1))
    expect(new Set(offsets.map((value) => value.toFixed(6))).size).toBe(16)
    offsets.forEach((offset) => {
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(Math.PI * 2)
    })
    // And they are actually spread rather than merely distinct: every quarter of the cycle
    // holds at least one of the sixteen.
    const quarters = new Set(offsets.map((offset) => Math.floor(offset / (Math.PI / 2))))
    expect(quarters.size).toBe(4)
  })

  it('advances one full cycle per STRIDE_CYCLE_DISTANCE of authority movement', () => {
    const start = stridePhase(9, 0)
    expect(stridePhase(9, STRIDE_CYCLE_DISTANCE) - start).toBeCloseTo(Math.PI * 2, 10)
    expect(stridePhase(9, STRIDE_CYCLE_DISTANCE / 2) - start).toBeCloseTo(Math.PI, 10)
  })

  it('turns the authority move speeds into visibly different cadences', () => {
    // §1.3 makes the melee faster than the commander as a STRUCTURAL rule, and the brief asks
    // that the difference be visible. Phase is distance over `STRIDE_CYCLE_DISTANCE`, so the
    // cadence ratio IS the speed ratio — no separate speed term to drift out of agreement.
    const cyclesPerTick = (speed: number) => speed / STRIDE_CYCLE_DISTANCE
    const melee = cyclesPerTick(MELEE_MOVE_SPEED)
    const commander = cyclesPerTick(COMMANDER_MOVE_SPEED)
    const soldier = cyclesPerTick(SOLDIER_MOVE_SPEED)
    const shooter = cyclesPerTick(SHOOTER_MOVE_SPEED)
    expect(melee).toBeGreaterThan(commander)
    expect(commander).toBeGreaterThan(soldier)
    expect(soldier).toBeGreaterThan(shooter)
    // Not merely greater: 40% more steps a second than the squad it is chasing.
    expect(melee / soldier).toBeCloseTo(1.4, 6)
  })
})

describe('the settle', () => {
  it('takes the stride to exactly zero inside §1.4 ARRIVE_EPSILON', () => {
    // `moveTowards` stops a unit dead once it is within `ARRIVE_EPSILON` of its goal, and
    // otherwise moves it further than that. So "step over `ARRIVE_EPSILON`" is exactly "the
    // authority moved this unit", and the animation inherits §1.4's dead-band unchanged
    // instead of inventing a second, looser one.
    expect(STRIDE_MIN_STEP).toBe(ARRIVE_EPSILON)
    expect(strideAmount(0)).toBe(0)
    expect(strideAmount(ARRIVE_EPSILON)).toBe(0)
    expect(strideAmount(ARRIVE_EPSILON * 0.999)).toBe(0)
    expect(strideAmount(ARRIVE_EPSILON * 1.0001)).toBeGreaterThan(0)
    expect(strideAmount(STRIDE_FULL_STEP)).toBe(1)
    expect(strideAmount(SOLDIER_MOVE_SPEED)).toBe(1)
  })

  it('freezes a settled figure at rest rather than mid-swing, at every point in the cycle', () => {
    // The failure this guards against is a figure that stops walking but keeps its legs where
    // the cycle left them — a squad frozen mid-stride, which reads as a bug rather than as
    // §1.4's settle. `stride = 0` has to give the SCULPTED pose at any phase.
    const pose = createRigPose()
    for (const archetype of ARCHETYPES) {
      for (let step = 0; step < 16; step += 1) {
        poseFigure(pose, { ...REST, archetype, phase: (step / 16) * Math.PI * 2, stride: 0 })
        expect(Math.abs(pose.bounce)).toBe(0)
        for (const joint of [RIG_HIP_L, RIG_HIP_R, RIG_SHIN_L, RIG_SHIN_R, RIG_TORSO]) {
          expect(Math.abs(pose.angles[joint * 3]!)).toBe(0)
          expect(Math.abs(pose.angles[joint * 3 + 1]!)).toBe(0)
          expect(Math.abs(pose.angles[joint * 3 + 2]!)).toBe(0)
        }
      }
    }
  })

  it('holds a settled foot in exactly one place while a walking one travels', () => {
    for (const archetype of ARCHETYPES) {
      const settled = Array.from({ length: 12 }, (_, step) => footAt(archetype, (step / 12) * Math.PI * 2, 0))
      const spread = Math.max(...settled.map((foot) => foot.distanceTo(settled[0]!)))
      expect(spread).toBe(0)

      const walking = Array.from({ length: 48 }, (_, step) => footAt(archetype, (step / 48) * Math.PI * 2, 1))
      const zs = walking.map((foot) => foot.z)
      const ys = walking.map((foot) => foot.y)
      const reach = (Math.max(...zs) - Math.min(...zs)) * FIGURE_SCALE
      const lift = (Math.max(...ys) - Math.min(...ys)) * FIGURE_SCALE
      // A REAL STEP, not a rock. Measured in world units: the base ring is 1.24 across, so the
      // foot covers over a third of a base per cycle and comes clear of the board by about a
      // twentieth of the figure's own height. Measured values on the shipped constants are
      // reach 0.42-0.49 and lift 0.07-0.12.
      expect(reach).toBeGreaterThan(0.38)
      // The elite is deliberately shorter-striding — it walks on its own plinth, see
      // `STRIDE_SCALE` — so it clears less, and that is the one class held to a lower bar.
      expect(lift).toBeGreaterThan(archetype === 'elite' ? 0.06 : 0.1)
    }
  })

  it('never drives a foot below the board', () => {
    // Every stride formula is written to lift rather than to sink, because a miniature that
    // sinks into the table stops reading as a miniature standing on it.
    for (const archetype of ARCHETYPES) {
      const rest = footAt(archetype, 0, 0)
      for (let step = 0; step < 48; step += 1) {
        const foot = footAt(archetype, (step / 48) * Math.PI * 2, 1)
        expect(foot.y).toBeGreaterThanOrEqual(rest.y - 1e-9)
      }
    }
  })

  it('lifts the body without ever dropping it', () => {
    const pose = createRigPose()
    for (const archetype of ARCHETYPES) {
      for (let step = 0; step < 32; step += 1) {
        poseFigure(pose, { ...REST, archetype, phase: (step / 32) * Math.PI * 2, stride: 1 })
        expect(pose.bounce).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('walks the two legs in opposition', () => {
    // Both legs swinging together is a hop, not a walk.
    const pose = createRigPose()
    for (let step = 0; step < 12; step += 1) {
      poseFigure(pose, { ...REST, archetype: 'soldier', phase: (step / 12) * Math.PI * 2, stride: 1 })
      expect(pose.angles[RIG_HIP_L * 3]! + pose.angles[RIG_HIP_R * 3]!).toBeCloseTo(0, 12)
    }
  })

  it('bends a knee one way only', () => {
    const pose = createRigPose()
    for (const archetype of ARCHETYPES) {
      for (let step = 0; step < 64; step += 1) {
        poseFigure(pose, { ...REST, archetype, phase: (step / 64) * Math.PI * 2, stride: 1 })
        expect(pose.angles[RIG_SHIN_L * 3]).toBeGreaterThanOrEqual(0)
        expect(pose.angles[RIG_SHIN_R * 3]).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('the strike', () => {
  it('never lets an attack touch the legs', () => {
    // The composition rule, asserted rather than described: the lower body is the stride and
    // only the stride, so a soldier firing on the move keeps walking. §1.3 makes attacking
    // while moving the common case, so this is the ordinary frame and not an edge case.
    const walking = createRigPose()
    const firing = createRigPose()
    for (const archetype of ARCHETYPES) {
      for (let step = 0; step < 8; step += 1) {
        const phase = (step / 8) * Math.PI * 2
        poseFigure(walking, { ...REST, archetype, phase, stride: 1 })
        poseFigure(firing, { ...REST, archetype, phase, stride: 1, strike: 0.4, aim: 1 })
        expect(firing.bounce).toBe(walking.bounce)
        for (const joint of [RIG_HIP_L, RIG_HIP_R, RIG_SHIN_L, RIG_SHIN_R]) {
          expect(firing.angles[joint * 3]).toBe(walking.angles[joint * 3])
        }
      }
    }
  })

  it('swings a cleaver through wind-up, chop and recovery', () => {
    // A swing has to go BACK before it goes forward, reach further forward than it started,
    // and come home. A monotone ramp would be a nudge.
    expect(meleeSwing(0)).toBeCloseTo(0, 6)
    expect(meleeSwing(0.25)).toBeLessThan(-0.3)
    expect(meleeSwing(0.55)).toBeGreaterThan(1.4)
    expect(meleeSwing(1)).toBeCloseTo(0, 6)
    // And the blade actually travels: the arm's total sweep is over a right angle.
    const samples = Array.from({ length: 40 }, (_, step) => meleeSwing(step / 39))
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(Math.PI / 2)
  })

  it('kicks hardest on the tick the round left, and is absorbed from there', () => {
    // The kick peaks ON the authority's own damage tick rather than part-way into a curve, so
    // the volley §1.4 wants revealed reads at the resolution the ticks were resolved at.
    expect(recoilCurve(0)).toBe(1)
    expect(recoilCurve(0.5)).toBeCloseTo(0.25, 10)
    expect(recoilCurve(0.99)).toBeLessThan(0.01)
    expect(recoilCurve(1)).toBe(0)
    for (let step = 1; step < 20; step += 1) {
      expect(recoilCurve(step / 20)).toBeLessThan(recoilCurve((step - 1) / 20))
    }
  })

  it('brings a trooper rifle round to point down-range and a shooter barrel up level', () => {
    const pose = createRigPose()
    const matrices = createRigMatrices()
    // The trooper carries its rifle ACROSS the chest, so the aim is a yaw — and from the
    // overhead camera this game is read from, that bar swinging round is the clearest cue on
    // the board that a figure is shooting.
    const muzzle = new THREE.Vector3(0.42, 0.66, 0.21)
    poseFigure(pose, { ...REST, archetype: 'soldier', aim: 0 })
    rigMatrices(matrices, pose, 'soldier', 1)
    const carried = muzzle.clone().applyMatrix4(matrices[RIG_ARM]!)
    poseFigure(pose, { ...REST, archetype: 'soldier', aim: 1 })
    rigMatrices(matrices, pose, 'soldier', 1)
    const aimed = muzzle.clone().applyMatrix4(matrices[RIG_ARM]!)
    expect(carried.x).toBeCloseTo(0.42, 6)
    expect(aimed.z).toBeGreaterThan(carried.z + 0.15)
    expect(Math.abs(aimed.x)).toBeLessThan(Math.abs(carried.x))

    // The shooter already carries its barrel forward, so its REST is a lowered weapon and the
    // aim brings it level: the tip rises rather than swinging round.
    const tip = new THREE.Vector3(0.06, 0.66, 1.06)
    poseFigure(pose, { ...REST, archetype: 'shooter', aim: 0 })
    rigMatrices(matrices, pose, 'shooter', 1)
    const lowered = tip.clone().applyMatrix4(matrices[RIG_ARM]!)
    poseFigure(pose, { ...REST, archetype: 'shooter', aim: 1 })
    rigMatrices(matrices, pose, 'shooter', 1)
    const level = tip.clone().applyMatrix4(matrices[RIG_ARM]!)
    expect(level.y).toBeGreaterThan(lowered.y + 0.2)
    expect(level.y).toBeCloseTo(0.66, 6)
  })

  it('raises the shield while the cleaver is committed', () => {
    const pose = createRigPose()
    poseFigure(pose, { ...REST, archetype: 'melee', strike: -1, strikeRanged: false })
    expect(Math.abs(pose.angles[RIG_OFF * 3]!)).toBe(0)
    poseFigure(pose, { ...REST, archetype: 'melee', strike: 0.4, strikeRanged: false })
    expect(pose.angles[RIG_OFF * 3]).toBeGreaterThan(0.3)
  })

  it('flinches the torso of whoever took the blow', () => {
    const pose = createRigPose()
    poseFigure(pose, { ...REST, archetype: 'soldier', hit: 0 })
    const calm = pose.angles[RIG_TORSO * 3]!
    poseFigure(pose, { ...REST, archetype: 'soldier', hit: 1 })
    expect(pose.angles[RIG_TORSO * 3]).toBeLessThan(calm - 0.2)
  })

  it('flinches AWAY from where the blow came from, not always backwards', () => {
    // Batch M's flinch was one fixed backward tip whatever the bearing, on a body the renderer
    // is simultaneously shoving in the WORLD direction of the blow — so on a hit from behind the
    // torso leaned into the shove. The pitch is now `cos(bearing)` and the roll `sin(bearing)`.
    const pose = createRigPose()
    const read = (hitBearing: number) => {
      poseFigure(pose, { ...REST, archetype: 'soldier', hit: 1, hitBearing })
      return { pitch: pose.angles[RIG_TORSO * 3]!, roll: pose.angles[RIG_TORSO * 3 + 2]! }
    }

    const front = read(0)
    const behind = read(Math.PI)
    const right = read(Math.PI / 2)
    const left = read(-Math.PI / 2)

    // Front and back are opposite tips of the same size, and neither is a roll.
    expect(front.pitch).toBeLessThan(-0.2)
    expect(behind.pitch).toBeCloseTo(-front.pitch, 5)
    expect(Math.abs(front.roll)).toBeLessThan(1e-9)
    expect(Math.abs(behind.roll)).toBeLessThan(1e-9)
    // A blow from the side is a roll and not a pitch, and the two sides roll opposite ways.
    expect(Math.abs(right.pitch)).toBeLessThan(1e-9)
    expect(Math.abs(right.roll)).toBeGreaterThan(0.15)
    expect(left.roll).toBeCloseTo(-right.roll, 5)
  })

  it('drops the weapon carriage on a blow taken, and puts it back', () => {
    // The flinch has to be visible in the UPPER BODY of a posed figure, not only in the torso
    // angle: the carriage is what the eye follows at this scale.
    const pose = createRigPose()
    poseFigure(pose, { ...REST, archetype: 'soldier', hit: 0 })
    const carried = pose.angles[RIG_ARM * 3]!
    poseFigure(pose, { ...REST, archetype: 'soldier', hit: 1 })
    expect(pose.angles[RIG_ARM * 3]).toBeGreaterThan(carried + 0.2)
    poseFigure(pose, { ...REST, archetype: 'soldier', hit: 0 })
    expect(pose.angles[RIG_ARM * 3]).toBe(carried)
  })

  it('lets a body finish its swing while it is being hit', () => {
    // Composition, not replacement: the flinch is added under the strike rather than winning
    // over it, because a figure that restarted its swing every time the volley landed on it
    // would stutter through exactly the moments §1.4 wants read.
    const pose = createRigPose()
    const swingOnly = createRigPose()
    poseFigure(swingOnly, { ...REST, archetype: 'command', strike: 0.45, strikeRanged: false })
    poseFigure(pose, { ...REST, archetype: 'command', strike: 0.45, strikeRanged: false, hit: 1, hitBearing: 0 })
    // Float32 storage, so the tolerance is the buffer's and not the maths'.
    expect(pose.angles[RIG_ARM * 3]).toBeCloseTo(swingOnly.angles[RIG_ARM * 3]! + 0.26, 5)
  })
})

describe('§1.4.2 the command unit swings', () => {
  it('plays a swing and not a recoil, off the authority cause rather than the sculpt', () => {
    // The defect this closes: a command figure is a RIFLEMAN, so batch M's "does this archetype
    // swing" test said no and a `friendly-melee` blow came out as a rifle's kick. The branch is
    // `strikeRanged` now, which is `DamageEvent.cause` carried through the view.
    const swung = createRigPose()
    const shot = createRigPose()
    poseFigure(swung, { ...REST, archetype: 'command', strike: 0.55, strikeRanged: false })
    poseFigure(shot, { ...REST, archetype: 'command', strike: 0.55, strikeRanged: true })

    // The swing is a big forward chop; the recoil is a small backward kick. Opposite signs and
    // an order of magnitude apart, so no threshold has to be invented to tell them apart.
    expect(swung.angles[RIG_ARM * 3]).toBeGreaterThan(1.0)
    expect(shot.angles[RIG_ARM * 3]).toBeLessThan(0)
    expect(swung.angles[RIG_ARM * 3]! - shot.angles[RIG_ARM * 3]!).toBeGreaterThan(1.0)
  })

  it('sweeps the weapon through the target direction, wind-up first', () => {
    // The same three beats the cleaver gets — the shape is `meleeSwing`, shared — read off the
    // command rig so this is a statement about the figure the player drives.
    const pose = createRigPose()
    const armAt = (strike: number) => {
      poseFigure(pose, { ...REST, archetype: 'command', strike, strikeRanged: false })
      return pose.angles[RIG_ARM * 3]!
    }
    expect(armAt(0.15)).toBeLessThan(-0.2)
    expect(armAt(0.55)).toBeGreaterThan(1.4)
    expect(armAt(0.99)).toBeLessThan(0.1)
  })

  it('unwinds the aim yaw as the chop goes through, so the swing is not across its own chest', () => {
    // A command unit that has been firing holds its rifle yawed down-range. The chop has to take
    // the carriage back round, or the blade travels sideways across the body.
    const pose = createRigPose()
    poseFigure(pose, { ...REST, archetype: 'command', aim: 1, strike: -1, strikeRanged: false })
    const held = pose.angles[RIG_ARM * 3 + 1]!
    poseFigure(pose, { ...REST, archetype: 'command', aim: 1, strike: 0.55, strikeRanged: false })
    const chopping = pose.angles[RIG_ARM * 3 + 1]!
    expect(held).toBeLessThan(-0.8)
    expect(Math.abs(chopping)).toBeLessThan(Math.abs(held) - 0.5)
  })

  it('holds the carry pose across the branch, so switching weapons does not pop', () => {
    // The same `aim` with no blow in flight must give the same arm base whichever weapon the
    // last blow was — otherwise the frame a command unit first swings on jumps its rifle.
    const ranged = createRigPose()
    const melee = createRigPose()
    poseFigure(ranged, { ...REST, archetype: 'command', aim: 0.6, strike: -1, strikeRanged: true })
    poseFigure(melee, { ...REST, archetype: 'command', aim: 0.6, strike: -1, strikeRanged: false })
    expect([...melee.angles]).toEqual([...ranged.angles])
  })

  it('leaves the cleaver class exactly where it was', () => {
    // The melee archetype is folded in by archetype as well as by `strikeRanged`, so nothing can
    // hand a cleaver a rifle animation. Same pose either way.
    const byCause = createRigPose()
    const byArchetype = createRigPose()
    poseFigure(byCause, { ...REST, archetype: 'melee', strike: 0.4, strikeRanged: false })
    poseFigure(byArchetype, { ...REST, archetype: 'melee', strike: 0.4, strikeRanged: true })
    expect([...byArchetype.angles]).toEqual([...byCause.angles])
  })

  it('fits every strike curve inside the shortest interval the rules can produce for it', () => {
    // AN ANIMATION LONGER THAN ITS OWN INTERVAL NEVER FINISHES — every blow after the first
    // restarts it from its middle. §1.13's `연사` shortens all three intervals, so the ceiling
    // is the UPGRADED interval and not the anchor.
    const fastest = (interval: number) => tickDurationAfter(interval, CARD_EFFECTS.rapid)

    expect(STRIKE_TICKS_RANGED).toBeLessThanOrEqual(fastest(SOLDIER_ATTACK_INTERVAL))
    expect(STRIKE_TICKS_RANGED).toBeLessThanOrEqual(fastest(COMMANDER_ATTACK_INTERVAL))
    // The cleaver is an enemy and takes no cards, so its own interval is the ceiling.
    expect(STRIKE_TICKS_MELEE).toBeLessThan(MELEE_ATTACK_INTERVAL)
    expect(STRIKE_TICKS_COMMAND_MELEE).toBeLessThanOrEqual(fastest(COMMANDER_MELEE_INTERVAL))
    expect(STRIKE_TICKS_COMMAND_MELEE).toBeLessThan(COMMANDER_MELEE_INTERVAL)
  })
})

describe('the rig itself', () => {
  it('leaves the root identity so a base disc never walks', () => {
    const pose = createRigPose()
    const matrices = createRigMatrices()
    for (const archetype of ARCHETYPES) {
      poseFigure(pose, { ...REST, archetype, phase: 1.1, stride: 1, strike: 0.5 })
      rigMatrices(matrices, pose, archetype, FIGURE_SCALE)
      expect(matrices[RIG_ROOT]!.equals(new THREE.Matrix4())).toBe(true)
    }
  })

  it('is exactly the identity at rest, for every joint and every class', () => {
    const pose = createRigPose()
    const matrices = createRigMatrices()
    const identity = new THREE.Matrix4()
    for (const archetype of ARCHETYPES) {
      restRigPose(pose)
      rigMatrices(matrices, pose, archetype, FIGURE_SCALE)
      for (let joint = 0; joint < RIG_JOINT_COUNT; joint += 1) {
        matrices[joint]!.elements.forEach((value, index) => {
          expect(value).toBeCloseTo(identity.elements[index]!, 12)
        })
      }
    }
  })

  it('leaves each joint pivot exactly where it was sculpted', () => {
    // The whole point of a pivot: a hip that translates instead of rotating tears the leg out
    // of the body. Chained joints inherit their parent's motion, so only the root-parented
    // ones are fixed points, and those are the ones checked here.
    const pose = createRigPose()
    const matrices = createRigMatrices()
    for (const archetype of ARCHETYPES) {
      poseFigure(pose, { ...REST, archetype, phase: 2.2, stride: 1, strike: 0.5, aim: 1 })
      rigMatrices(matrices, pose, archetype, 1)
      for (const joint of [RIG_HIP_L, RIG_HIP_R, RIG_TORSO]) {
        const pivot = rigPivot(archetype, joint)
        const moved = new THREE.Vector3(pivot[0], pivot[1], pivot[2]).applyMatrix4(matrices[joint]!)
        expect(moved.distanceTo(new THREE.Vector3(pivot[0], pivot[1], pivot[2]))).toBeCloseTo(0, 12)
      }
    }
  })

  it('scales only the translation when the figure is scaled', () => {
    // `FIGURE_SCALE` is applied to the merged geometry, so the matrices have to act in that
    // scaled space while the pivots stay authored in the space the parts were placed in.
    // Conjugating a rigid transform by a uniform scale scales its translation and nothing else.
    const pose = createRigPose()
    const plain = createRigMatrices()
    const scaled = createRigMatrices()
    poseFigure(pose, { ...REST, archetype: 'soldier', phase: 0.9, stride: 1 })
    rigMatrices(plain, pose, 'soldier', 1)
    rigMatrices(scaled, pose, 'soldier', FIGURE_SCALE)
    for (let joint = 1; joint < RIG_JOINT_COUNT; joint += 1) {
      for (let index = 0; index < 12; index += 1) {
        expect(scaled[joint]!.elements[index]).toBeCloseTo(plain[joint]!.elements[index]!, 12)
      }
      for (let index = 12; index < 15; index += 1) {
        expect(scaled[joint]!.elements[index]).toBeCloseTo(plain[joint]!.elements[index]! * FIGURE_SCALE, 12)
      }
    }
  })

  it('writes into the buffers it was handed instead of returning new ones', () => {
    // This runs once per unit per frame, sixty units a frame, in the window with the least
    // headroom. Neither function may hand back a fresh object: the pose buffer, its angle array
    // and all eight matrices have to be the same objects two hundred poses later, so a caller
    // that keeps one set of scratch keeps it. (`hybrid-renderer.ts` keeps the input object too,
    // so the whole per-frame path allocates nothing.)
    const pose = createRigPose()
    const matrices = createRigMatrices()
    const angles = pose.angles
    const before = matrices.map((matrix) => matrix)
    const input = { ...REST, archetype: 'melee' as MiniatureArchetype, stride: 1, phase: 0, strike: -1 }
    for (let step = 0; step < 200; step += 1) {
      input.phase = step
      input.strike = (step % 20) / 20
      poseFigure(pose, input)
      rigMatrices(matrices, pose, 'melee', FIGURE_SCALE)
    }
    expect(pose.angles).toBe(angles)
    matrices.forEach((matrix, index) => expect(matrix).toBe(before[index]))
  })
})

describe('the baked geometry', () => {
  it('carries a joint index on every vertex of every body, and nothing outside the rig', () => {
    const miniatures = createMiniatureGeometries()
    for (const archetype of ARCHETYPES) {
      const geometry = miniatures[archetype]
      const joints = geometry.getAttribute('aJoint')
      expect(joints).toBeDefined()
      expect(joints.count).toBe(geometry.getAttribute('position').count)
      const seen = new Set<number>()
      for (let index = 0; index < joints.count; index += 1) {
        const value = joints.getX(index)
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(RIG_JOINT_COUNT)
        seen.add(value)
      }
      // Every body has a base that stays put, two legs that swing, a torso and a weapon.
      for (const joint of [RIG_ROOT, RIG_HIP_L, RIG_HIP_R, RIG_SHIN_L, RIG_SHIN_R, RIG_TORSO, RIG_ARM]) {
        expect(seen.has(joint)).toBe(true)
      }
    }
    // The shield is the melee class's alone.
    const offJoints = (archetype: MiniatureArchetype) => {
      const joints = miniatures[archetype].getAttribute('aJoint')
      let count = 0
      for (let index = 0; index < joints.count; index += 1) if (joints.getX(index) === RIG_OFF) count += 1
      return count
    }
    expect(offJoints('melee')).toBeGreaterThan(0)
    expect(offJoints('soldier')).toBe(0)
    expect(offJoints('elite')).toBe(0)
  })
})
