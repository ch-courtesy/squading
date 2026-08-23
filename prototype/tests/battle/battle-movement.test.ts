// Movement fixtures: the arena clamp (§1.7), formation following and the settle
// dead-band (§1.4), and the composition of the 추종·적 이동 step (§1.16).
//
// §1.6 removed cover, so the fixtures that pinned x-then-y sliding, union ejection, the
// slot pull, the pull latch and the 30-tick stuck counter are gone with the rules. What
// remains is deliberately small. The arena edge is the only thing that can turn movement
// input into zero displacement; under v6~v8 that made it the witness for §1.3's stop test,
// and now that §1.3 has no stop test it is just the clamp reporting honestly.

import { describe, expect, it } from 'vitest'

import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  COMMANDER_START,
  FOLLOW_MAX_SPEED,
  SOLDIER_MOVE_SPEED,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import { createBattle } from '../../src/core/battle/battle'
import {
  FORMATION_MAX_SLOT_RADIUS,
  FORMATION_SLOTS,
  slotPosition,
} from '../../src/core/battle/formation'
import {
  NO_ENEMY_MOVEMENT,
  advanceCommandUnit,
  advanceFormationFollow,
  advanceMovement,
  clampToArena,
  engagementBearingOf,
  moveEnemyTowards,
  selectEngagementTargetId,
  stepMove,
} from '../../src/core/battle/movement'
import { createEnemy, createInitialBattleState, findFriendly ,
  RIFLEMAN_IDS,
} from '../../src/core/battle/state'
import type { BattleState , Vec2 } from '../../src/core/battle/types'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  arenaHeight: ARENA_HEIGHT,
  arenaWidth: ARENA_WIDTH,
  leashRadius: LEASH_RADIUS,
  meleeMoveSpeed: MELEE_MOVE_SPEED,
  shooterRange: SHOOTER_RANGE,
} = stageConfigOf(1)

function slotTarget(state: BattleState, unitId: number): { x: number; y: number } {
  const assignment = state.slotAssignments.find((entry) => entry.unitId === unitId)!
  const command = findFriendly(state, state.commandUnitId)!
  return slotPosition(command.position, assignment.slotIndex)
}

/** The slot index §1.4 seated a unit in — the one fact these fixtures keep needing. */
function slotIndexOfUnit(state: BattleState, unitId: number): number {
  return state.slotAssignments.find((row) => row.unitId === unitId)!.slotIndex
}

function bandGoalFor(state: BattleState, unitId: number, target: Vec2, edge: number): Vec2 {
  const assignment = state.slotAssignments.find((row) => row.unitId === unitId)!
  const slot = FORMATION_SLOTS[assignment.slotIndex]
  const length = Math.hypot(slot.x, slot.y)
  return { x: target.x + (slot.x / length) * edge, y: target.y + (slot.y / length) * edge }
}

describe('§1.7 the arena clamp is the whole movement boundary', () => {
  it('clamps a step to the arena on both axes', () => {
    // The arena is a stage number now (§2.2), so the boundary is read off the state the step
    // belongs to rather than off a module constant.
    const state = createInitialBattleState('seed-a')
    expect(stepMove(state, { x: 0.05, y: 0.05 }, -1, -1)).toEqual({ x: 0, y: 0 })
    expect(stepMove(state, { x: 55.9, y: 31.9 }, 1, 1)).toEqual({ x: ARENA_WIDTH, y: ARENA_HEIGHT })
    expect(clampToArena(state, -3, 40)).toEqual({ x: 0, y: ARENA_HEIGHT })
  })

  it('does not otherwise interfere: an interior step lands exactly where asked', () => {
    // Nothing between (20,10) and (20.2, 10.4) any more — no rectangle, no slide, no
    // ejection.
    const state = createInitialBattleState('seed-a')
    const result = stepMove(state, { x: 20, y: 10 }, 0.2, 0.4)
    expect(result.x).toBeCloseTo(20.2, 12)
    expect(result.y).toBeCloseTo(10.4, 12)
  })
})

describe('§1.4 formation following', () => {
  it('leaves a follower already on its slot with displacement exactly 0', () => {
    // `createInitialBattleState` seats all 15 soldiers on their slots (§1.4), so this is
    // the state of the squad at tick 0.
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const before = { ...unit.position }

    advanceFormationFollow(state)
    expect(unit.position).toEqual(before)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('does not jitter inside the arrival dead-band: the position is byte-identical for 100 ticks', () => {
    // §1.4's stated reason, and now its only one: "점근하며 미세 진동하는 것을 막는다."
    // 0.003 < ARRIVE_EPSILON 0.004, so the follower must not move AT ALL — not "move a
    // little", which is what an asymptotic approach looks like tick after tick.
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    const parked = { x: target.x + 0.003, y: target.y }
    unit.position = { ...parked }

    for (let tick = 1; tick <= 100; tick += 1) {
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(parked)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('closes exactly onto the slot just outside the dead-band', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    // 0.01 > ARRIVE_EPSILON 0.004 and 0.01 <= FOLLOW_MAX_SPEED 0.13, so the step is the
    // whole distance and the follower lands on the slot. Whether it also fires on this tick
    // is no longer a question the displacement answers (§1.3).
    unit.position = { x: target.x + 0.01, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.lastDisplacement).toBeCloseTo(0.01, 12)
    expect(ARRIVE_EPSILON).toBeLessThan(0.01)
  })

  it('moves at the follower speed cap when far from the slot', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 1, y: target.y }

    advanceFormationFollow(state)
    // 1.0 away, capped at FOLLOW_MAX_SPEED = 0.1 x 1.30 = 0.13.
    expect(unit.position.x).toBeCloseTo(target.x + 1 - FOLLOW_MAX_SPEED, 12)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
  })

  it('never overshoots the slot', () => {
    const state = createInitialBattleState('seed-a')
    const unit = findFriendly(state, 4)!
    const target = slotTarget(state, 4)
    unit.position = { x: target.x + 0.05, y: target.y }

    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(target.x, 12)
    expect(unit.lastDisplacement).toBeCloseTo(0.05, 12)
  })

  it('does not move the command unit or non-standing units', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    const downed = findFriendly(state, 5)!
    downed.life = 'downed'
    const commandBefore = { ...command.position }
    // Parked far off its slot: a standing follower would close on it, a downed one is
    // left exactly where it fell.
    downed.position = { x: 1, y: 1 }

    advanceFormationFollow(state)
    expect(command.position).toEqual(commandBefore)
    expect(downed.position).toEqual({ x: 1, y: 1 })
    expect(downed.lastDisplacement).toBe(0)
  })

  it('aims at command unit + offset with no pull and no latch', () => {
    // The slot is a pure function of the command unit's position now. Two ticks of
    // standing still therefore give the follower the same fixed target, which is what
    // §1.4's dead-band needs in order to produce an exact 0.
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: 10, y: 10 }
    const assignment = state.slotAssignments.find((entry) => entry.unitId === 2)!
    const slot = FORMATION_SLOTS[assignment.slotIndex]

    expect(slotTarget(state, 2)).toEqual({ x: 10 + slot.x, y: 10 + slot.y })
    expect(Object.keys(assignment).sort()).toEqual(['slotIndex', 'unitId'])
  })
})

describe('§1.4.1 leash engagement — the soldiers fight for themselves', () => {
  // WHAT THESE ARE MEASURED AGAINST. `LEASH_RADIUS` is 10.0, the band is
  // `[SHOOTER_RANGE 4.5, SOLDIER_RANGE 5.0]`, the follow cap is 0.13 and the command unit
  // starts at (28, 16). Every distance below is hand-computed off those four numbers, so a
  // tuning pass that moves any of them fails these loudly instead of quietly re-deriving.
  //
  // `advanceFormationFollow` is called directly rather than through a tick, because §1.16
  // runs 대상 선택 AFTER 추종·적 이동: what this step engages against is a target it derives
  // itself, and driving a whole tick would hide which of the two picked it.

  /** Soldier 2 holds slot 0, `(-2.2, -1.1)` — so its rest position is `(25.8, 14.9)`. */
  /**
 * §1.2.1: a RIFLEMAN, and it has to be one for these fixtures to mean anything.
 *
 * This was id 2, back when every soldier was the same body. Id 2 now holds §1.4's front rank,
 * which makes it a skirmisher — and a skirmisher's §1.4.1 band inverts to "close to contact"
 * precisely because it does not outrange the shooter. Every band test below is about the OTHER
 * case, the one §1.6's advantage applies to, so it has to name the class that has it.
 *
 * The first rifleman holds slot 5, `(-2.2, 0.0)`, whose bearing is exactly `(-1, 0)` — which
 * makes the hand-computed goals below simpler than they were on slot 0's `1/sqrt(5)` diagonal.
 */
const SOLDIER = RIFLEMAN_IDS[0]

/**
 * §1.4.1's goal for `SOLDIER` against a target, DERIVED from the lattice rather than typed out.
 *
 * These fixtures used to hand-compute `1/sqrt(5)` because slot 0's offset is a diagonal. That
 * number was the slot's, not the rule's, and it broke the moment §1.2.1 moved which slot this
 * unit holds — the same trap this project keeps rediscovering: pin the relation, not the value.
 * Reading the bearing off `FORMATION_SLOTS` states what §1.4.1 actually says, and survives the
 * next change to the lattice.
 */

  it('leaves its slot for an enemy inside the leash, and stays for one outside', () => {
    // The contrast IS the evidence that the leash exists: same board, same soldier, one
    // enemy moved from 7.0 to 11.0 away from the command unit. Batch H used 9.0 for the far
    // half; batch I raised `LEASH_RADIUS` to 10.0, so 9.0 is now INSIDE and the far case had to
    // move out with it.
    const inside = createInitialBattleState('seed-a')
    inside.enemies = [createEnemy(inside, 101, 'melee', { x: COMMANDER_START.x + 7, y: 16 })]
    const engaged = findFriendly(inside, SOLDIER)!
    const slot = { ...engaged.position }
    // Derived: the slot §1.4 gave this unit, not the coordinates slot 0 used to have.
    expect(slot).toEqual(slotPosition(COMMANDER_START, slotIndexOfUnit(inside, SOLDIER)))

    advanceFormationFollow(inside)
    // 9.2655 away from the enemy at (35, 16), so it closes at the follow cap.
    expect(engaged.position.x).toBeGreaterThan(slot.x)
    expect(engaged.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)

    const outside = createInitialBattleState('seed-a')
    outside.enemies = [createEnemy(outside, 101, 'melee', { x: COMMANDER_START.x + 11, y: 16 })]
    const held = findFriendly(outside, SOLDIER)!
    const heldSlot = { ...held.position }

    advanceFormationFollow(outside)
    expect(held.position).toEqual(heldSlot)
    expect(held.lastDisplacement).toBe(0)
    // Not a fluke of the epsilon: the enemy is 11.0 out and the leash is 10.0.
    expect(LEASH_RADIUS).toBeGreaterThan(7)
    expect(LEASH_RADIUS).toBeLessThan(11)
  })

  it('walks to its OWN POINT on the band and stops there, not onto the enemy (§1.6)', () => {
    // Enemy at (31, 16): 3.0 from the command unit, so well inside the leash.
    //
    // v10 PINNED A DIFFERENT POINT HERE and this fixture is the edit that says so. It used to
    // assert the soldier stopped 5.0 away ALONG THE LINE IT HAPPENED TO STAND ON, which is the
    // rule that let fifteen soldiers stack on one spot. v11 gives the goal an angle as well as
    // a distance, and the angle is this soldier's own slot offset.
    //
    // HAND-COMPUTED. Slot 0 is `(-2.2, -1.1) = 1.1 x (-2, -1)`, and `|(-2, -1)| = sqrt(5)`, so
    // the bearing is `(-2/sqrt(5), -1/sqrt(5))` exactly. The far edge is `SOLDIER_RANGE 5.0`, so
    // the goal is `(31, 16) + 5 x bearing = (31 - 2*sqrt(5), 16 - sqrt(5))`.
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(state, 101, 'melee', { x: 31, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    unit.position = { x: 31 - 5.3, y: 16 }

    const goal = bandGoalFor(state, SOLDIER, { x: 31, y: 16 }, SOLDIER_RANGE)
    for (let tick = 0; tick < 100; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(goal.x, 12)
    expect(unit.position.y).toBeCloseTo(goal.y, 12)

    // The distance is still the band's far edge — the angle changed, the radius did not.
    const distance = Math.hypot(31 - unit.position.x, 16 - unit.position.y)
    expect(distance).toBeCloseTo(SOLDIER_RANGE, 12)
    // §1.6's gap, per unit: it shoots and a shooter at the same spot could not shoot back.
    expect(distance).toBeGreaterThan(SHOOTER_RANGE)

    // And it holds: on its own point the displacement is exactly 0, not "small".
    advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(goal.x, 12)
    expect(unit.position.y).toBeCloseTo(goal.y, 12)
    expect(unit.lastDisplacement).toBe(0)
  })

  it('moves to its own bearing even when it is ALREADY inside the band (v11)', () => {
    // v10 held still here — anywhere in `[4.5, 5.0]` was a resting place, whatever the angle.
    // That is exactly the rule that produced the knot, so v11 must NOT hold: a soldier at the
    // right distance and the wrong angle has somewhere to go.
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(state, 101, 'melee', { x: 31, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    // 4.7 is strictly between 4.5 and 5.0 — v10's dead-band, dead centre.
    const parked = { x: 31 - 4.7, y: 16 }
    unit.position = { ...parked }

    advanceFormationFollow(state)
    expect(unit.position).not.toEqual(parked)
    expect(unit.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)

    // And where it goes is its slot's bearing, not "somewhere else".
    for (let tick = 0; tick < 100; tick += 1) advanceFormationFollow(state)
    const goal = bandGoalFor(state, SOLDIER, { x: 31, y: 16 }, SOLDIER_RANGE)
    expect(unit.position.x).toBeCloseTo(goal.x, 12)
    expect(unit.position.y).toBeCloseTo(goal.y, 12)

    // THEN it holds, exactly. The dead-band did not disappear; it moved to the goal point.
    for (let tick = 1; tick <= 50; tick += 1) {
      const settled = { ...unit.position }
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(settled)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('returns to its slot when the target is gone, and settles without jitter', () => {
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(state, 101, 'melee', { x: 34, y: 16 })]
    const unit = findFriendly(state, SOLDIER)!
    const slot = { ...unit.position }

    for (let tick = 0; tick < 20; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeGreaterThan(slot.x + 2)

    // The enemy dies. §1.4.1: no candidate, so the follow rule of §1.4 takes over again.
    state.enemies = []
    for (let tick = 0; tick < 200; tick += 1) advanceFormationFollow(state)
    expect(unit.position.x).toBeCloseTo(slot.x, 12)
    expect(unit.position.y).toBeCloseTo(slot.y, 12)

    // §1.4's dead-band, on the return: exactly still, for fifty more ticks.
    for (let tick = 1; tick <= 50; tick += 1) {
      const settled = { ...unit.position }
      advanceFormationFollow(state)
      expect(unit.position, `tick ${tick}`).toEqual(settled)
      expect(unit.lastDisplacement, `tick ${tick}`).toBe(0)
    }
  })

  it('anchors the leash to the COMMAND UNIT, not to the soldier and not to its slot', () => {
    // THE design point of §1.4.1. Both halves put the same soldier at (29, 16) and the same
    // enemy at (35, 16) — 6.0 apart, so the soldier is outside its own range and would
    // close on the enemy if the leash were measured from itself. Only the command unit moves.
    function board(commandX: number) {
      const state = createInitialBattleState('seed-a')
      findFriendly(state, state.commandUnitId)!.position = { x: commandX, y: 16 }
      state.enemies = [createEnemy(state, 101, 'melee', { x: 35, y: 16 })]
      const unit = findFriendly(state, SOLDIER)!
      unit.position = { x: 29, y: 16 }
      return { state, unit }
    }

    // Command unit at (28, 16): 7.0 from the enemy, inside the leash. The soldier engages
    // and walks AWAY from its slot at (25.8, 14.9), toward the enemy.
    const near = board(28)
    advanceFormationFollow(near.state)
    expect(near.unit.position.x).toBeGreaterThan(29)

    // Command unit at (10, 16): 25.0 from the enemy, outside it. Nothing about the soldier
    // or the enemy changed, and it walks the other way, back to its slot.
    //
    // Only x is asserted. The y half used to read "< 16" because slot 0 sits a row forward;
    // §1.2.1 moved this fixture to a rifleman on slot 5, whose offset is `(-2.2, 0)` and whose
    // slot y IS 16. Retreat is the x axis here, and asserting a y that the slot does not have
    // would be testing the seat rather than the leash.
    const far = board(10)
    advanceFormationFollow(far.state)
    expect(far.unit.position.x).toBeLessThan(29)
  })

  it('never leashes the command unit itself — player input is its only mover (§1.4.1)', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, state.commandUnitId)!
    state.enemies = [createEnemy(state, 101, 'melee', { x: command.position.x + 3, y: command.position.y })]
    const before = { ...command.position }

    advanceFormationFollow(state)
    expect(command.position).toEqual(before)
    expect(command.lastDisplacement).toBe(0)
    // 3.0 is inside the band's near edge, so every soldier around it is backing off — this
    // is the tick on which a leashed command unit would be most obvious.
    expect(findFriendly(state, SOLDIER)!.lastDisplacement).toBeGreaterThan(0)
  })

  it('moves the leash centre with §1.5 succession', () => {
    // Enemy at (44, 10): 17.09 from the original commander at (28, 16) and 4.0 from soldier
    // 5 at (40, 10). The soldier under test sits at (38, 10), 6.0 from the enemy.
    function board(commandUnitId: number) {
      const state = createInitialBattleState('seed-a')
      state.commandUnitId = commandUnitId
      findFriendly(state, 5)!.position = { x: 40, y: 10 }
      state.enemies = [createEnemy(state, 101, 'melee', { x: 44, y: 10 })]
      const unit = findFriendly(state, SOLDIER)!
      unit.position = { x: 38, y: 10 }
      return { state, unit }
    }

    // Command with the original commander: the enemy is off the leash, so the soldier walks
    // back toward its slot at (25.8, 14.9) — leftward.
    const beforeSuccession = board(1)
    advanceFormationFollow(beforeSuccession.state)
    expect(beforeSuccession.unit.position.x).toBeLessThan(38)

    // §1.5 hands command to soldier 5. Same enemy, same soldier, and now it engages.
    const afterSuccession = board(5)
    advanceFormationFollow(afterSuccession.state)
    expect(afterSuccession.unit.position.x).toBeGreaterThan(38)
  })
})

describe('§1.4.1 v11 — the bearing is the slot`s, so the squad spreads around the target', () => {
  // WHAT THESE ARE MEASURED AGAINST, all four numbers hand-carried from `constants.ts` and
  // `formation.ts`: the band's far edge is `SOLDIER_RANGE 5.0`, the follow cap is 0.13, the
  // command unit starts at (28, 16), and slots go to soldier ids in ascending order, so soldier
  // `2 + k` holds `FORMATION_SLOTS[k]`.
  //
  //   soldier  2 -> slot  0 = (-2.2, -1.1) = 1.1 x (-2, -1),  bearing (-2, -1)/sqrt(5)
  //   soldier  6 -> slot  4 = ( 2.2, -1.1) = 1.1 x ( 2, -1),  bearing ( 2, -1)/sqrt(5)
  //   soldier 16 -> slot 14 = ( 0.0,  2.2),                   bearing ( 0,  1)
  //
  // Every goal below is `enemy + 5 x bearing` written out in that exact closed form, so a tuning
  // pass that moves `SOLDIER_RANGE` or an edit that moves the lattice fails these loudly.

  const ENEMY = { x: 31, y: 16 }

  // §1.2.1: THESE HAVE TO BE RIFLEMEN, and the reason is the thing the block is about.
  //
  // The fixture shows two soldiers on ONE target standing at two points of its ring, which is
  // §1.4.1 v11's bearing rule. A skirmisher does not stand on a ring at all — its band inverts
  // to "close to contact" because it does not outrange the shooter — so a front-rank body would
  // fail these for a reason that has nothing to do with bearings. Ids 2 and 6 held the front
  // rank as of §1.2.1; the first and last riflemen carry the two distinct bearings this needs.
  const WEST = RIFLEMAN_IDS[0]
  const NORTH = RIFLEMAN_IDS[RIFLEMAN_IDS.length - 1]

  const goalOf = (state: BattleState, unitId: number): Vec2 =>
    bandGoalFor(state, unitId, ENEMY, SOLDIER_RANGE)

  function boardWithOneEnemy() {
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(state, 101, 'melee', { ...ENEMY })]
    return state
  }

  it('stands two soldiers biting the SAME target on two different points of its ring', () => {
    // This is the defect, in one fixture. Under v10 both of these walked to the same place,
    // because the band said 5.0 and said nothing about which 5.0.
    const state = boardWithOneEnemy()
    const left = findFriendly(state, WEST)!
    const north = findFriendly(state, NORTH)!

    for (let tick = 0; tick < 200; tick += 1) advanceFormationFollow(state)

    expect(left.position.x).toBeCloseTo(goalOf(state, WEST).x, 12)
    expect(left.position.y).toBeCloseTo(goalOf(state, WEST).y, 12)
    expect(north.position.x).toBeCloseTo(goalOf(state, NORTH).x, 12)
    expect(north.position.y).toBeCloseTo(goalOf(state, NORTH).y, 12)

    // Both on the ring, and NOT on each other. The chord comes from the two goals rather than
    // from a written-out bearing pair — same reason as `bandGoalFor`: the old form spelled out
    // `(-2,-1)/sqrt(5)`, which was slot 0's geometry and not the rule's, and §1.2.1 moving this
    // fixture off the front rank made it wrong.
    expect(Math.hypot(ENEMY.x - left.position.x, ENEMY.y - left.position.y)).toBeCloseTo(5, 12)
    expect(Math.hypot(ENEMY.x - north.position.x, ENEMY.y - north.position.y)).toBeCloseTo(5, 12)
    const chord = Math.hypot(
      goalOf(state, WEST).x - goalOf(state, NORTH).x,
      goalOf(state, WEST).y - goalOf(state, NORTH).y,
    )
    expect(Math.hypot(left.position.x - north.position.x, left.position.y - north.position.y)).toBeCloseTo(chord, 12)
    expect(chord).toBeGreaterThan(SOLDIER_RANGE)
  })

  it('walks a soldier whose slot is on the FAR side straight through the target', () => {
    // §1.6 removed terrain and this game has no unit collision, so "past the enemy" is not a
    // special case — it is the same straight walk to a goal that happens to be on the other side.
    // A rifleman whose slot bearing points EAST, so its goal is past the enemy from here.
    // Id 6 held that role before §1.2.1 put it in the front rank.
    const state = boardWithOneEnemy()
    const EAST = RIFLEMAN_IDS.find((id) => goalOf(state, id).x > ENEMY.x)!
    const unit = findFriendly(state, EAST)!
    unit.position = { x: 26, y: 16 }
    expect(unit.position.x).toBeLessThan(ENEMY.x)

    let closest = Infinity
    for (let tick = 0; tick < 200; tick += 1) {
      advanceFormationFollow(state)
      closest = Math.min(closest, Math.hypot(ENEMY.x - unit.position.x, ENEMY.y - unit.position.y))
    }

    // It ended up on the other side of the body it was walking at.
    expect(unit.position.x).toBeGreaterThan(ENEMY.x)
    expect(unit.position.x).toBeCloseTo(goalOf(state, EAST).x, 12)
    expect(unit.position.y).toBeCloseTo(goalOf(state, RIFLEMAN_IDS[1]).y, 12)
    // And it went THROUGH rather than around: the straight line from (26, 16) to the goal passes
    // within 1.2 of the enemy, well inside the near edge nothing is allowed to sit at.
    expect(closest).toBeLessThan(SHOOTER_RANGE)
  })

  it('gives every slot a unit bearing — and only TWELVE of the fifteen are distinct', () => {
    // THE SPEC'S PREMISE IS OFF BY THREE, and this fixture is where that is written down rather
    // than assumed. §1.4.1 v11 says "슬롯 15개가 서로 다른 방향을 가지므로 병사들은 표적 주위에
    // 자연히 퍼진다". Fifteen slots do not have fifteen different directions: three PAIRS of the
    // lattice are collinear with the origin, so they normalise to the same bearing and the two
    // soldiers in each pair walk to the SAME point when they share a target.
    //
    //   slots  5 (-2.2, 0.0) and  6 (-1.1, 0.0)  -> (-1, 0)
    //   slots  7 ( 1.1, 0.0) and  8 ( 2.2, 0.0)  -> ( 1, 0)
    //   slots 11 ( 0.0, 1.1) and 14 ( 0.0, 2.2)  -> ( 0, 1)
    //
    // Twelve points on the ring instead of fifteen is still the difference between a knot and a
    // cordon, so this batch does not change the lattice for it — changing the lattice is a §1.4
    // edit and this is a §1.4.1 batch. It is recorded, not hidden.
    const bearings = FORMATION_SLOTS.map((_, index) => engagementBearingOf(index)!)
    expect(bearings.every((bearing) => bearing !== null)).toBe(true)
    for (const bearing of bearings) {
      expect(Math.hypot(bearing.x, bearing.y)).toBeCloseTo(1, 12)
    }

    const distinct = new Set(bearings.map((b) => `${b.x.toFixed(12)},${b.y.toFixed(12)}`))
    expect(distinct.size).toBe(12)
    expect(engagementBearingOf(5)).toEqual(engagementBearingOf(6))
    expect(engagementBearingOf(7)).toEqual(engagementBearingOf(8))
    expect(engagementBearingOf(11)).toEqual(engagementBearingOf(14))

    // THE ZERO-VECTOR BRANCH. `movement.ts` says it is unreachable and `constants.ts` asserts it
    // at module load; this is the same fact from the other side. `null` comes back only for an
    // index that is not a slot at all.
    expect(FORMATION_SLOTS.every((slot) => Math.hypot(slot.x, slot.y) > 0)).toBe(true)
    expect(engagementBearingOf(FORMATION_SLOTS.length)).toBeNull()
    expect(engagementBearingOf(-1)).toBeNull()
  })
})

describe('§1.4.1 v11 — measured on a real run, not on a board', () => {
  /**
   * §4.1's `tactical-no-input` driven through the facade, sampling what the defect was measured
   * with: how many soldiers are engaged, how many live enemies are inside the leash, and how far
   * the furthest standing soldier is from the command unit.
   */
  function sample(seed: string, untilTick: number) {
    const battle = createBattle(seed)
    battle.start()
    const rows = new Map<number, { engaged: number; inLeash: number; maxDistance: number }>()
    let leashTotal = 0
    let ticks = 0
    let minMaxWhileFullyEngaged = Infinity
    let maxDistinctTargets = 0
    let fullyEngagedTicks = 0
    const ticksAtLattice: number[] = []
    const ticksTighterThanLattice: number[] = []

    while (battle.state().combatTick < untilTick) {
      if (battle.mode() === 'won' || battle.mode() === 'lost') break
      if (battle.mode() === 'awaiting-upgrade') battle.enqueue({ kind: 'choose-upgrade', slot: 1 })
      battle.step()

      const state = battle.state()
      const command = findFriendly(state, state.commandUnitId)!
      const targets = new Set<number>()
      let engaged = 0
      let maxDistance = 0
      for (const unit of state.friendlies) {
        if (unit.id === state.commandUnitId || unit.life !== 'standing') continue
        const target = selectEngagementTargetId(state, unit)
        if (target !== null) {
          engaged += 1
          targets.add(target)
        }
        maxDistance = Math.max(
          maxDistance,
          Math.hypot(unit.position.x - command.position.x, unit.position.y - command.position.y),
        )
      }
      const inLeash = state.enemies.filter(
        (enemy) =>
          enemy.life === 'standing' &&
          Math.hypot(enemy.position.x - command.position.x, enemy.position.y - command.position.y) <=
            LEASH_RADIUS,
      ).length

      leashTotal += inLeash
      ticks += 1
      maxDistinctTargets = Math.max(maxDistinctTargets, targets.size)
      if (engaged === 15) {
        fullyEngagedTicks += 1
        minMaxWhileFullyEngaged = Math.min(minMaxWhileFullyEngaged, maxDistance)
        if (maxDistance < FORMATION_MAX_SLOT_RADIUS) ticksTighterThanLattice.push(state.combatTick)
        else if (maxDistance === FORMATION_MAX_SLOT_RADIUS) ticksAtLattice.push(state.combatTick)
      }
      rows.set(state.combatTick, { engaged, inLeash, maxDistance })
    }

    return {
      rows,
      meanInLeash: leashTotal / ticks,
      minMaxWhileFullyEngaged,
      maxDistinctTargets,
      fullyEngagedTicks,
      ticksAtLattice,
      ticksTighterThanLattice,
    }
  }

  it('does NOT reassemble the squad into a knot tighter than the formation it replaced', () => {
    // THE REGRESSION GUARD FOR THIS BATCH'S DEFECT, and the defect was exactly a number getting
    // SMALLER. v10 measured, on this seed and this policy, a greatest-distance-from-the-command-
    // unit of 1.87 / 2.53 / 3.02 / 0.45 / 2.75 at t100/200/300/500/600 — with all fifteen engaged
    // from t200 on, and 0.45 at t500 INSIDE the 2.460 slot lattice.
    //
    // NOT VACUOUS, and the values are here so that can be checked rather than trusted: v11 with
    // batch I's two balance edits measures 9.48 / 10.93 / 10.94 / 11.31 / 11.35 at the same five
    // ticks. (With the bearing alone, before `LEASH_RADIUS` went to 10.0, it was
    // 7.87 / 9.07 / 8.39 / 9.27 / 8.95 — already wider than the lattice everywhere.)
    //
    // The five numbers were 10.41 / 10.64 / 10.26 / 11.85 / 11.21 until tuning batch 1 moved
    // stage 1's spawn and engage radii; a further-out spawn ring is a different set of bodies to
    // walk toward at any given tick. What the fixture is about — the squad is WIDER than the
    // lattice, never narrower — is unchanged, and so is every assertion below.
    const run = sample('seed-a', 601)
    const measured: number[] = []
    for (const tick of [100, 200, 300, 500, 600]) {
      const row = run.rows.get(tick)!
      expect(row, `tick ${tick}`).toBeDefined()
      expect(row.engaged, `tick ${tick}`).toBe(15)
      expect(row.maxDistance, `tick ${tick}`).toBeGreaterThan(FORMATION_MAX_SLOT_RADIUS)
      measured.push(Number(row.maxDistance.toFixed(2)))
    }
    expect(measured).toEqual([9.48, 10.93, 10.94, 11.31, 11.35])

    // And it is not a spike at five sampled ticks. Over the first 600 ticks all fifteen are
    // engaged on 536 of them, and on EXACTLY ONE of those — t30, the first tick anything is
    // engaged at all, before anyone has taken a step toward a goal — is the squad still only as
    // wide as the lattice. (t23 and 561 before tuning batch 1 pushed the spawn ring out: the
    // first body arrives seven ticks later and there are 25 fewer fully-engaged ticks in the
    // window, which is the same one-line cause and not a second effect.) It is never NARROWER than the lattice, which is the shape the defect
    // took, and from t24 on it is strictly wider on all 560.
    expect(run.minMaxWhileFullyEngaged).toBeGreaterThanOrEqual(FORMATION_MAX_SLOT_RADIUS)
    expect(run.ticksTighterThanLattice).toEqual([])
    expect(run.ticksAtLattice).toEqual([30])
    expect(run.fullyEngagedTicks).toBe(536)
  })

  it('supplies more than one target for the bearings to spread across (§1.10)', () => {
    // THE OTHER HALF, and neither works alone: fifteen bodies and one reachable enemy is a ring
    // of fifteen around one point whatever the angles are.
    //
    // MEASURED. The batch aimed at a mean of 5 live enemies inside `LEASH_RADIUS`, and over a
    // whole `tactical-no-input`/`seed-a` run it is 5.14 against batch H's 1.75 — which reaches it,
    // and reaches it on BOTH of this batch's balance edits together. Neither is enough alone:
    // `requestInterval` 9/7/5 at `LEASH_RADIUS` 8.0 gives 4.54, and `LEASH_RADIUS` 10.0 at the old
    // 12/9/7 gives 4.38. Averaged over the eight policies x three seeds the same two halves give
    // 3.4~4.2 and 2.9~4.1, and only both together clear 5 on every policy (4.8~5.8).
    //
    // THE WINDOW BELOW IS WHERE THE GAIN IS SMALLEST, on purpose, and it is where the number is
    // still short: over the first 900 ticks it is 1.87, against 1.61 with the leash at 8.0 and
    // 1.15 at batch H's values. An enemy has to cross from `SPAWN_RADIUS` inward before it counts
    // here, and the early game is the part of the run where the squad is at full strength and
    // kills them on the way in. §5 stage 3 owns the curve that would fix that.
    //
    // It was 2.04 before tuning batch 1 pushed the spawn ring out from 13.0 to 14.0 and the engage
    // radius from 10.0 to 11.0. A longer walk in is a smaller standing population inside a leash
    // that did not move, so this number going DOWN is the direct cost of that edit, paid in the
    // window it was already weakest in. It still clears the floor this fixture guards.
    const run = sample('seed-a', 901)
    expect(run.meanInLeash).toBeCloseTo(1.8713, 3)
    expect(run.meanInLeash).toBeGreaterThan(1.8)
    // What the bearings actually get to spread across: five distinct targets at the peak, where
    // the same window at batch H's supply and leash peaks at three. It was six before tuning
    // batch 1's spawn ring moved out, and the point of the fixture is the comparison with three.
    expect(run.maxDistinctTargets).toBe(5)
  })
})

describe('§1.4 slot assignment', () => {
  it('is never recomputed when the command unit changes', () => {
    const state = createInitialBattleState('seed-a')
    const before = state.slotAssignments.map((entry) => ({ ...entry }))

    state.commandUnitId = 5
    state.input.move = { x: 1, y: 0 }
    for (let tick = 0; tick < 10; tick += 1) {
      advanceCommandUnit(state)
      advanceFormationFollow(state)
    }

    expect(state.slotAssignments.map((entry) => entry.unitId)).toEqual(
      before.map((entry) => entry.unitId),
    )
    expect(state.slotAssignments.map((entry) => entry.slotIndex)).toEqual(
      before.map((entry) => entry.slotIndex),
    )
  })

  it('leaves the command unit slot vacant instead of reshuffling', () => {
    const state = createInitialBattleState('seed-a')
    state.commandUnitId = 5
    const slotOfFive = state.slotAssignments.find((entry) => entry.unitId === 5)!.slotIndex
    advanceFormationFollow(state)

    const occupants = state.slotAssignments.filter((entry) => entry.slotIndex === slotOfFive)
    expect(occupants).toHaveLength(1)
    expect(occupants[0].unitId).toBe(5)
  })
})

describe('§1.16 지휘 유닛 이동: command unit movement', () => {
  it('moves at the role speed and normalizes diagonal input', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 1 }

    const displacement = advanceCommandUnit(state)
    // 0.115 / sqrt(2) = 0.081317...
    expect(command.position.x).toBeCloseTo(COMMANDER_START.x + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
    expect(command.position.y).toBeCloseTo(COMMANDER_START.y + COMMANDER_MOVE_SPEED / Math.SQRT2, 12)
    expect(displacement).toBeCloseTo(COMMANDER_MOVE_SPEED, 12)
  })

  it('uses the soldier speed when a soldier holds command', () => {
    const state = createInitialBattleState('seed-a')
    state.commandUnitId = 7
    state.input.move = { x: 1, y: 0 }
    expect(advanceCommandUnit(state)).toBeCloseTo(SOLDIER_MOVE_SPEED, 12)
  })

  it('does not move with a zero input vector', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    const before = { ...command.position }
    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual(before)
    expect(command.lastDisplacement).toBe(0)
  })

  it('does not move while the rescue lock is held (§1.11 seam)', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    state.input.move = { x: 1, y: 0 }
    state.rescue = { active: true, targetId: 3, progress: 4 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual({ x: COMMANDER_START.x, y: COMMANDER_START.y })
  })

  it('gives input-with-no-displacement at the arena edge', () => {
    // The last remaining way to hold a movement input and still have displacement 0. It has
    // no effect on the unit's firepower (§1.3); `battle-combat.test.ts` pins that half.
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: ARENA_WIDTH, y: 16 }
    state.input.move = { x: 1, y: 0 }

    expect(advanceCommandUnit(state)).toBe(0)
    expect(command.position).toEqual({ x: ARENA_WIDTH, y: 16 })
    expect(command.lastDisplacement).toBe(0)
  })

  it('clamps a partial step at the edge and reports the clamped displacement', () => {
    const state = createInitialBattleState('seed-a')
    const command = findFriendly(state, 1)!
    command.position = { x: 55.9, y: 16 }
    state.input.move = { x: 1, y: 0 }

    // 55.9 + 0.115 = 56.015 -> clamped to 56, so the real displacement is 0.1.
    const displacement = advanceCommandUnit(state)
    expect(command.position.x).toBe(ARENA_WIDTH)
    expect(displacement).toBeCloseTo(0.1, 10)
    expect(displacement).toBeLessThan(COMMANDER_MOVE_SPEED)
  })
})

describe('§1.16 추종·적 이동 composition', () => {
  it('runs followers and then enemies, and nothing else', () => {
    const state = createInitialBattleState('seed-a')
    const follower = findFriendly(state, 2)!
    const target = slotTarget(state, 2)
    follower.position = { x: target.x + 1, y: target.y }
    state.enemies = [createEnemy(state, 101, 'melee', { x: 40, y: 16 })]

    const order: string[] = []
    advanceMovement(state, (battle) => {
      // The follower has already moved by the time the enemy rule runs.
      order.push(battle.friendlies[1].lastDisplacement > 0 ? 'after-follow' : 'before-follow')
      moveEnemyTowards(battle, battle.enemies[0], { x: 0, y: 16 }, MELEE_MOVE_SPEED)
    })

    expect(order).toEqual(['after-follow'])
    expect(follower.lastDisplacement).toBeCloseTo(FOLLOW_MAX_SPEED, 12)
    expect(state.enemies[0].position.x).toBeCloseTo(40 - MELEE_MOVE_SPEED, 12)
  })

  it('NO_ENEMY_MOVEMENT is an explicit choice, not a default', () => {
    const state = createInitialBattleState('seed-a')
    state.enemies = [createEnemy(state, 101, 'melee', { x: 40, y: 16 })]
    advanceMovement(state, NO_ENEMY_MOVEMENT)
    expect(state.enemies[0].position).toEqual({ x: 40, y: 16 })
    expect(state.enemies[0].lastDisplacement).toBe(0)
  })
})

describe('§1.7 moveEnemyTowards', () => {
  it('steps at its speed, never overshoots, and clamps to the arena', () => {
    const state = createInitialBattleState('seed-a')
    const enemy = createEnemy(state, 101, 'melee', { x: 10, y: 16 })
    expect(moveEnemyTowards(state, enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(
      MELEE_MOVE_SPEED,
      12,
    )
    expect(enemy.position.x).toBeCloseTo(10 + MELEE_MOVE_SPEED, 12)

    // Closer than one step: land exactly on the target.
    enemy.position = { x: 19.99, y: 16 }
    expect(moveEnemyTowards(state, enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(0.01, 12)
    expect(enemy.position.x).toBeCloseTo(20, 12)

    // Already there: displacement exactly 0, and no counter to bump any more.
    expect(moveEnemyTowards(state, enemy, { x: 20, y: 16 }, MELEE_MOVE_SPEED)).toBe(0)
    expect(Object.keys(enemy)).not.toContain('zeroDisplacementTicks')

    // The arena edge clamps, and the displacement reported is the clamped one.
    enemy.position = { x: ARENA_WIDTH - 0.02, y: 16 }
    expect(moveEnemyTowards(state, enemy, { x: 60, y: 16 }, MELEE_MOVE_SPEED)).toBeCloseTo(0.02, 10)
    expect(enemy.position.x).toBe(ARENA_WIDTH)
  })
})
