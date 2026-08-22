// What each of §4.1's policies actually does, as fixtures rather than as comments.
//
// The brief for this batch asks for the evidence in tests and not in prose: "판단 근거를 코드
// 주석이 아니라 테스트로 남겨라 — 각 행동이 실제로 일어나는 픽스처." So every claim `skilled`
// makes has a fixture where the behaviour happens, and every claim a VARIANT makes about not
// doing something is asserted in the same fixture where `skilled` does it — an absence measured
// where nothing would have happened anyway measures nothing.

import { describe, expect, it } from 'vitest'

import {
  ARRIVE_EPSILON,
  COMMANDER_MOVE_SPEED,
  DOWNED_TICKS,
  RESCUE_RANGE,
  RESCUE_TICKS,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import type { BattleCommand } from '../../src/core/battle/input'
import {
  POLICY_IDS,
  POLICY_OVERRIDES,
  POLICY_RULES,
  SKILLED_MODEL_IDS,
  SKILLED_RULES,
  policyFactory,
  type PolicyId,
} from '../../src/core/harness/policy/policies'
import type { FriendlyView, PolicyView } from '../../src/core/harness/policy/view'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  eliteBlastRadius: ELITE_BLAST_RADIUS,
  meleeRange: MELEE_RANGE,
  shooterRange: SHOOTER_RANGE,
} = stageConfigOf(1)

const ORIGIN = { x: 28, y: 16 }

function friendly(id: number, x: number, y: number, over: Partial<FriendlyView> = {}): FriendlyView {
  return {
    id,
    slotIndex: null,
    position: { x, y },
    hp: 1.4,
    maxHp: 1.4,
    life: 'standing',
    downedTicksRemaining: 0,
    ...over,
  }
}

function viewOf(over: Partial<PolicyView> = {}): PolicyView {
  return {
    stageId: 1,
    tick: 100,
    mode: 'running',
    ticksRemaining: 2600,
    command: friendly(1, ORIGIN.x, ORIGIN.y),
    friendlies: [],
    enemies: [],
    eliteTelegraph: null,
    rescue: null,
    rescueCandidateId: null,
    pendingUpgrade: null,
    kills: 0,
    ...over,
  }
}

/** A shooter placed `distance` to the east of the command unit. */
function shooterEast(distance: number, id = 101) {
  return { id, kind: 'shooter' as const, position: { x: ORIGIN.x + distance, y: ORIGIN.y } }
}

function meleeEast(distance: number, id = 201) {
  return { id, kind: 'melee' as const, position: { x: ORIGIN.x + distance, y: ORIGIN.y } }
}

function moveIn(commands: readonly BattleCommand[]): { x: number; y: number } | null {
  for (const command of commands) {
    if (command.kind === 'set-move') return command.move
  }
  return null
}

function decideOnce(id: PolicyId, view: PolicyView): BattleCommand[] {
  return policyFactory(id)('seed-a').decide(view)
}

describe('§4.1 `skilled` stops where the range advantage is', () => {
  it('walks in when the shooter is out of soldier range and backs off when it is inside its own', () => {
    const closing = moveIn(decideOnce('skilled', viewOf({ enemies: [shooterEast(6)] })))
    expect(closing).not.toBeNull()
    expect(closing!.x).toBeGreaterThan(0)

    const backing = moveIn(decideOnce('skilled', viewOf({ enemies: [shooterEast(4)] })))
    expect(backing).not.toBeNull()
    expect(backing!.x).toBeLessThan(0)
  })

  it('stands still inside the gap, and the stillness is a decision and not an empty fixture', () => {
    // 4.8 is inside `[SHOOTER_RANGE + 0.4 x advantage, SOLDIER_RANGE]` = [4.7, 5.0] at the
    // placeholders. The two cases above use the SAME fixture shape and do produce a command, so
    // an empty result here is the policy choosing to hold.
    expect(decideOnce('skilled', viewOf({ enemies: [shooterEast(4.8)] }))).toEqual([])
  })

  it('takes the band from the nearest SHOOTER while a melee is closer, and walks past the melee', () => {
    // §1.6's gap is a gap against a shooter and against nothing else — `SHOOTER_RANGE <
    // SOLDIER_RANGE` is the whole of it, and a melee has no range for the gap to be a gap
    // against. So WHICH body the band is measured from decides the SIGN of the step here.
    //
    // The melee is 0.95 east, inside the LOWER EDGE of every band, so a policy measuring against
    // the nearest body of any kind backs WEST off it. The shooter is 5.1 east, outside [4.7, 5.0], so a policy
    // measuring against the nearest shooter closes EAST on it. The magnitude names which body it
    // used: the step is the whole offset to the goal.
    const move = moveIn(
      decideOnce('skilled', viewOf({ enemies: [meleeEast(0.95), shooterEast(5.1)] })),
    )
    expect(move).not.toBeNull()
    expect(move!.x).toBeCloseTo(5.1, 9)

    // The mirror, so this is not a board on which east was the only answer available: the same
    // two distances on the other side, and the step comes out west.
    const mirrored = moveIn(
      decideOnce('skilled', viewOf({ enemies: [meleeEast(-0.95), shooterEast(-5.1)] })),
    )
    expect(mirrored).not.toBeNull()
    expect(mirrored!.x).toBeCloseTo(-5.1, 9)
  })

  it('falls back to the nearest body of any kind when there is no shooter on the board', () => {
    // The other branch of the same line. With no shooter there is no gap to hold, and the
    // fallback still keeps a melee at arm's length rather than standing in the middle of the
    // board — so this measures the `: view.enemies` fallback, not the filter above it.
    const meleeOnly = moveIn(decideOnce('skilled', viewOf({ enemies: [meleeEast(1)] })))
    expect(meleeOnly).not.toBeNull()
    expect(meleeOnly!.x).toBeLessThan(0)
  })

  it('holds when there is nothing on the board to stand relative to', () => {
    expect(decideOnce('skilled', viewOf({ enemies: [] }))).toEqual([])
  })
})

describe('§1.12 `skilled` leaves the telegraph, ahead of everything else', () => {
  it('runs out of the circle', () => {
    const view = viewOf({
      eliteTelegraph: { center: { x: ORIGIN.x - 0.5, y: ORIGIN.y }, radius: ELITE_BLAST_RADIUS },
    })
    const move = moveIn(decideOnce('skilled', view))

    expect(move).not.toBeNull()
    expect(move!.x).toBeGreaterThan(0)
  })

  it('drops the standoff to do it — the two point opposite ways in this fixture', () => {
    // The shooter is 6.0 east, so the standoff wants EAST. The telegraph centre is 0.5 east, so
    // the dodge wants WEST. Whichever sign comes out names the priority.
    const view = viewOf({
      enemies: [shooterEast(6)],
      eliteTelegraph: { center: { x: ORIGIN.x + 0.5, y: ORIGIN.y }, radius: ELITE_BLAST_RADIUS },
    })
    const move = moveIn(decideOnce('skilled', view))

    expect(move).not.toBeNull()
    expect(move!.x).toBeLessThan(0)
  })

  it('drops a rescue to do it as well, and it is the rescue that gets dropped', () => {
    // The priority §4.1's `skilled` asks its questions in, on the pair the order actually
    // separates: §1.12's blast is the only thing on the board that can take the whole formation
    // at once, so it is answered ahead of §1.11's countdown on a single body.
    //
    // The circle is centred 1.0 EAST of the command unit, so leaving it means walking west. The
    // body `Space` would pick up is already a candidate, so the other ordering stands still
    // inside the circle and holds the key instead.
    const body = friendly(4, ORIGIN.x + 1, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const both = viewOf({
      friendlies: [body],
      rescueCandidateId: body.id,
      eliteTelegraph: { center: { x: ORIGIN.x + 1, y: ORIGIN.y }, radius: ELITE_BLAST_RADIUS },
    })
    expect(decideOnce('skilled', both)).toEqual([
      { kind: 'set-move', move: { x: -1, y: 0 }, keydown: true },
    ])

    // The same board with the telegraph taken away: the rescue is live and it fires. So the
    // assertion above is the ordering deciding, not a board on which nothing wanted to rescue.
    const rescueOnly = viewOf({ friendlies: [body], rescueCandidateId: body.id })
    expect(decideOnce('skilled', rescueOnly)).toEqual([{ kind: 'set-rescue', held: true }])
  })

  it('keeps walking past the edge, because standing on the radius is not standing clear of it', () => {
    // §1.12 measures the impact against the FROZEN centre at impact time, so a body sitting on
    // the rim is one clamp away from being inside it. The dodge therefore runs until it is clear
    // by a margin, and this fixture is just outside the circle and still moving.
    const view = viewOf({
      enemies: [shooterEast(6)],
      eliteTelegraph: {
        center: { x: ORIGIN.x + ELITE_BLAST_RADIUS + 0.1, y: ORIGIN.y },
        radius: ELITE_BLAST_RADIUS,
      },
    })
    const move = moveIn(decideOnce('skilled', view))

    // The standoff in this fixture wants EAST, so a westward step is the margin deciding.
    expect(move).not.toBeNull()
    expect(move!.x).toBeLessThan(0)
  })

  it('ignores a circle it is already clear of, so the dodge is not simply always on', () => {
    const clear = ELITE_BLAST_RADIUS + 2
    const view = viewOf({
      enemies: [shooterEast(6)],
      eliteTelegraph: { center: { x: ORIGIN.x + clear, y: ORIGIN.y }, radius: ELITE_BLAST_RADIUS },
    })
    const move = moveIn(decideOnce('skilled', view))

    // Back to the standoff, which wants east.
    expect(move).not.toBeNull()
    expect(move!.x).toBeGreaterThan(0)
  })
})

describe('§1.11 `skilled` goes back for a body, and `abandons-downed` does not', () => {
  const downed = friendly(4, ORIGIN.x + 3, ORIGIN.y, {
    life: 'downed',
    downedTicksRemaining: DOWNED_TICKS,
  })

  it('walks toward a downed squadmate it can still reach in time', () => {
    const move = moveIn(decideOnce('skilled', viewOf({ friendlies: [downed], enemies: [shooterEast(6)] })))

    expect(move).not.toBeNull()
    expect(move!.x).toBeGreaterThan(0)
    expect(move!.y).toBe(0)
  })

  it('holds `Space` with a zero vector once the body is in range, which is what §1.11 locks on', () => {
    const commands = decideOnce(
      'skilled',
      viewOf({ friendlies: [downed], rescueCandidateId: downed.id, enemies: [shooterEast(4)] }),
    )

    // The standoff in this fixture wants to back away (4.0 is inside shooter range), so an empty
    // movement command is the rescue winning rather than nothing being asked of the policy.
    expect(commands).toEqual([{ kind: 'set-rescue', held: true }])
  })

  it('walks to the NEAREST body rather than the first one in id order', () => {
    // Two bodies, both reachable, in opposite directions — and the nearer one has the HIGHER id.
    // A walk that kept the first reachable row instead of the closest would point EAST here, so
    // the sign is the comparison deciding. §1.11 runs a countdown per body, which makes going to
    // the wrong one the difference between one rescue and none.
    const nearerHigherId = friendly(9, ORIGIN.x - 2, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    // Ascending id, which is the order `projectPolicyView` hands the roster out in.
    const move = moveIn(decideOnce('skilled', viewOf({ friendlies: [downed, nearerHigherId] })))
    expect(move).not.toBeNull()
    expect(move!.x).toBeLessThan(0)

    // The mirror: the same two distances and the same two directions, with only WHICH body is
    // nearer swapped. It comes out the other way, so the fixture above is not a board on which
    // west was the only answer available.
    const nearerLowerId = friendly(4, ORIGIN.x + 2, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const fartherHigherId = friendly(9, ORIGIN.x - 3, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const mirrored = moveIn(
      decideOnce('skilled', viewOf({ friendlies: [nearerLowerId, fartherHigherId] })),
    )
    expect(mirrored).not.toBeNull()
    expect(mirrored!.x).toBeGreaterThan(0)
  })

  it('breaks a tie between two equidistant bodies toward the LOWER id', () => {
    // The fixture above pins nearest-over-first; this one pins what happens when "nearest" does
    // not decide. `nearestEnemy`'s docblock calls the ascending-id tie-break "the tie-break §1.5,
    // §1.8 and §1.9 all use", and `reachableDownedFriendly` follows it by comparing with `>=` so
    // the first equidistant row survives. Relaxing that to `>` lets the later row displace the
    // earlier one, which is a policy that walks the other way on a board where the rule says it
    // should not — and until this fixture nothing anywhere held it.
    const lowerIdEast = friendly(4, ORIGIN.x + 3, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const higherIdWest = friendly(5, ORIGIN.x - 3, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    // Exactly equidistant: 3.0 either way, so distance cannot decide and only the id can.
    const move = moveIn(decideOnce('skilled', viewOf({ friendlies: [lowerIdEast, higherIdWest] })))
    expect(move).not.toBeNull()
    expect(move!.x).toBeGreaterThan(0)

    // Swap which side the lower id is on. If the answer were "east" rather than "the lower id",
    // this second board would come out east too.
    const lowerIdWest = friendly(4, ORIGIN.x - 3, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const higherIdEast = friendly(5, ORIGIN.x + 3, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const swapped = moveIn(
      decideOnce('skilled', viewOf({ friendlies: [lowerIdWest, higherIdEast] })),
    )
    expect(swapped).not.toBeNull()
    expect(swapped!.x).toBeLessThan(0)
  })

  it('keeps a lock that is already running after the body stops being a candidate', () => {
    // §1.11 re-tests "후보 존재" every tick and zeroes the progress on release, so a lock can
    // outlive the candidacy that established it — releasing `Space` here throws the progress
    // away. `rescueCandidateId` is null and there is no downed row in the view either, so the
    // running lock is the ONLY thing that can still be holding the key down.
    const locked = viewOf({
      enemies: [shooterEast(4)],
      rescue: { targetId: 4, progress: 12 },
      rescueCandidateId: null,
    })
    expect(decideOnce('skilled', locked)).toEqual([{ kind: 'set-rescue', held: true }])

    // The same board with no lock running: the standoff wants to back away from a shooter at 4.0,
    // and it does. So the assertion above is the branch deciding and not an empty fixture.
    const unlocked = viewOf({ enemies: [shooterEast(4)], rescue: null, rescueCandidateId: null })
    expect(moveIn(decideOnce('skilled', unlocked))!.x).toBeLessThan(0)
  })

  it('gives up on a body the countdown will not let it reach', () => {
    const doomed = friendly(4, ORIGIN.x + 20, ORIGIN.y, { life: 'downed', downedTicksRemaining: 10 })
    const reachable = friendly(4, ORIGIN.x + 20, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })

    // Same distance, same board, only the countdown differs — so this is the countdown deciding.
    expect(moveIn(decideOnce('skilled', viewOf({ friendlies: [reachable] })))!.x).toBeGreaterThan(0)
    expect(decideOnce('skilled', viewOf({ friendlies: [doomed] }))).toEqual([])
  })

  it('budgets the lock at the end of the walk and not only the walk', () => {
    // §1.11's countdown has to cover the WHOLE trip, and the lock is part of the trip: a body
    // reached with fewer than `RESCUE_TICKS` left is a body that dies under the lock, so walking
    // to it spends the run on nothing. The fixture above uses a distance where the walk alone
    // already blows the countdown, which leaves that term untested.
    //
    // Here the two boards differ ONLY in the countdown, and the gap between the two counts is
    // exactly `RESCUE_TICKS`. Derived from the constants rather than written out, so a sweep of
    // §1.2's speed or §1.11's lock carries the fixture with it.
    const distance = 5.5
    const walkTicks = (distance - RESCUE_RANGE) / COMMANDER_MOVE_SPEED
    const walkOnly = Math.ceil(walkTicks)
    const walkAndLock = Math.ceil(walkTicks + RESCUE_TICKS)

    // What makes `walkOnly` the discriminating count: it pays for the walk and not for the lock.
    expect(walkOnly).toBeGreaterThanOrEqual(walkTicks)
    expect(walkOnly).toBeLessThan(walkTicks + RESCUE_TICKS)

    const tooLate = friendly(4, ORIGIN.x + distance, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: walkOnly,
    })
    expect(decideOnce('skilled', viewOf({ friendlies: [tooLate] }))).toEqual([])

    const inTime = friendly(4, ORIGIN.x + distance, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: walkAndLock,
    })
    expect(moveIn(decideOnce('skilled', viewOf({ friendlies: [inTime] })))!.x).toBeGreaterThan(0)
  })

  it('`abandons-downed` sends no `set-rescue` in the fixture where `skilled` sends one', () => {
    const view = viewOf({ friendlies: [downed], rescueCandidateId: downed.id, enemies: [shooterEast(4)] })

    expect(decideOnce('skilled', view).some((command) => command.kind === 'set-rescue')).toBe(true)
    expect(decideOnce('abandons-downed', view).some((command) => command.kind === 'set-rescue')).toBe(false)
  })
})

describe('§4.1 the four other variants, each against the fixture where `skilled` acts', () => {
  it('`tactical-no-input` sends the card and nothing else', () => {
    const board = viewOf({ enemies: [shooterEast(4)] })
    expect(decideOnce('skilled', board).length).toBeGreaterThan(0)
    expect(decideOnce('tactical-no-input', board)).toEqual([])

    const card = viewOf({ pendingUpgrade: { round: 1, offered: ['firepower', 'mobility', 'rapid'] } })
    expect(decideOnce('tactical-no-input', card)).toEqual([{ kind: 'choose-upgrade', slot: 1 }])
  })

  it('`flees-always` runs from the nearest body of any kind, ties by ascending id', () => {
    // The shooter is nearer than the melee, and `skilled` would walk TOWARD it (6.0 > band).
    const board = viewOf({ enemies: [shooterEast(6), meleeEast(-9)] })
    expect(moveIn(decideOnce('skilled', board))!.x).toBeGreaterThan(0)
    expect(moveIn(decideOnce('flees-always', board))!.x).toBeLessThan(0)

    // Two bodies at the same distance in opposite directions: id 101 west, id 102 east. The
    // lower id wins the tie, so the flight goes east.
    const tie = viewOf({
      enemies: [
        { id: 101, kind: 'melee', position: { x: ORIGIN.x - 5, y: ORIGIN.y } },
        { id: 102, kind: 'melee', position: { x: ORIGIN.x + 5, y: ORIGIN.y } },
      ],
    })
    expect(moveIn(decideOnce('flees-always', tie))!.x).toBeGreaterThan(0)
  })

  it('`camps-in-place` moves only for the blast', () => {
    const standoff = viewOf({ enemies: [shooterEast(4)] })
    expect(moveIn(decideOnce('skilled', standoff))).not.toBeNull()
    expect(decideOnce('camps-in-place', standoff)).toEqual([])

    // §4.1's row names ONE reason, so the OTHER reason `skilled`'s intent can produce has to be
    // refused too, or the camper walks across the board. The body is 3.5 east — past
    // `RESCUE_RANGE`, so `Space` is not an option and only a walk would close it — and well
    // inside the countdown, so `skilled` sets off and the camper stays put.
    //
    // That is both reasons `camps-in-place` can ever be handed. The fourth `MoveReason`, `flee`,
    // comes from `flees-always`, which replaces `intent` instead of `allowsMove`, so no board
    // puts it in front of this filter.
    const body = friendly(4, ORIGIN.x + 3.5, ORIGIN.y, {
      life: 'downed',
      downedTicksRemaining: DOWNED_TICKS,
    })
    const approach = viewOf({ friendlies: [body], rescueCandidateId: null })
    expect(moveIn(decideOnce('skilled', approach))!.x).toBeGreaterThan(0)
    expect(decideOnce('camps-in-place', approach)).toEqual([])

    const blast = viewOf({
      enemies: [shooterEast(4)],
      eliteTelegraph: { center: { x: ORIGIN.x - 0.5, y: ORIGIN.y }, radius: ELITE_BLAST_RADIUS },
    })
    expect(moveIn(decideOnce('camps-in-place', blast))!.x).toBeGreaterThan(0)
  })

  it('`ignores-range` walks in where `skilled` backs off, and stops on contact', () => {
    const inside = viewOf({ enemies: [shooterEast(4)] })
    expect(moveIn(decideOnce('skilled', inside))!.x).toBeLessThan(0)
    expect(moveIn(decideOnce('ignores-range', inside))!.x).toBeGreaterThan(0)

    const contact = viewOf({ enemies: [shooterEast(MELEE_RANGE - 0.05)] })
    expect(decideOnce('ignores-range', contact)).toEqual([])
  })
})

describe('§3 the two `skilled` player models stand in different places', () => {
  it('the conservative one leaves the room the base model is happy with', () => {
    const view = viewOf({ enemies: [shooterEast(4.8)] })
    expect(decideOnce('skilled', view)).toEqual([])
    expect(moveIn(decideOnce('skilled-conservative', view))!.x).toBeLessThan(0)
  })

  it('the aggressive one stands where the base model would already be backing off', () => {
    const view = viewOf({ enemies: [shooterEast(SHOOTER_RANGE + 0.15)] })
    expect(moveIn(decideOnce('skilled', view))!.x).toBeLessThan(0)
    expect(decideOnce('skilled-aggressive', view)).toEqual([])
  })
})

describe('§3 a reposition holds its heading, and the three models re-aim on different clocks', () => {
  // THE OTHER HALF OF §3's SECOND VARIANT. v9 re-defined it on two axes — "어디에 멈출지(§1.6의
  // 사거리 격차 안 어디)와 얼마나 자주 다시 고를지" — and the block above only measures the first
  // one. This measures the second: how long a reposition keeps walking the way it set off before
  // it looks at the board again.
  //
  // Counted in DECISIONS rather than in ticks, because that is what the policy counts. The first
  // decision commits a heading; the next `commitTicks` decisions are handed the committed one
  // back; decision `commitTicks + 2` is the first that re-aims.

  /**
   * Send a model east, then move the shooter west, and report which decisions emitted a command.
   *
   * A held heading emits NOTHING, because it is already what the battle is holding — so the one
   * decision number that comes back is the one on which the model looked again.
   */
  function reAimsOnDecisions(id: PolicyId): number[] {
    const policy = policyFactory(id)('seed-a')

    // 6.0 is outside the upper edge of all three bands ([4.7, 5.0], [4.875, 5.0], [4.525, 4.75]),
    // so all three walk toward it.
    const first = moveIn(policy.decide(viewOf({ enemies: [shooterEast(6)] })))
    expect(first).not.toBeNull()
    expect(first!.x).toBeGreaterThan(0)

    const reAimed: number[] = []
    for (let decision = 2; decision <= 60; decision += 1) {
      // The same board mirrored: a model that re-aimed this decision walks WEST instead.
      const commands = policy.decide(viewOf({ enemies: [shooterEast(-6)] }))
      if (commands.length === 0) continue
      expect(moveIn(commands)!.x).toBeLessThan(0)
      reAimed.push(decision)
    }
    return reAimed
  }

  // The three numbers are written out rather than derived from `commitTicks`. What that buys has
  // been MEASURED, and it is less than an earlier version of this comment claimed: with
  // `reAimsOn` rewritten as `commitTicks + 2` and the pin at the top of the `it` removed, a
  // zeroed clock and a clock flattened onto `skilled`'s are BOTH still caught — by the sibling
  // assertion below, which fails at 4 < 0 and at 12 > 12. The derived expectation would pass;
  // the mutation would not, and coverage is measured in suites and not in single `it`s.
  //
  // So the literals are not what holds those mutations down, and `POLICY_RULES[id].commitTicks`
  // is pinned directly on the line above anyway. They are kept as a second, redundant statement
  // of where the three clocks sit today, because a reader of this block should be able to see the
  // numbers without going to look them up.
  const MODELS = [
    { id: 'skilled', commitTicks: 12, reAimsOn: 14 },
    { id: 'skilled-conservative', commitTicks: 30, reAimsOn: 32 },
    { id: 'skilled-aggressive', commitTicks: 4, reAimsOn: 6 },
  ] as const

  for (const model of MODELS) {
    it(`\`${model.id}\` holds its heading for ${model.commitTicks} decisions and re-aims on the next`, () => {
      expect(POLICY_RULES[model.id].commitTicks).toBe(model.commitTicks)
      // Exactly one decision in sixty emits anything: the heading is held until then, and it does
      // flip once the commitment runs out. Both halves are in the one assertion.
      expect(reAimsOnDecisions(model.id)).toEqual([model.reAimsOn])
    })
  }

  it('§3 the conservative model re-aims LESS often than the base one and the aggressive one MORE', () => {
    // The ordering is the spec claim; the three numbers above are only where it currently sits.
    // "보수적 변형(더 긴 standoff, 더 드문 재배치)과 공격적 변형(더 짧은 standoff, 더 잦은 재배치)".
    expect(POLICY_RULES['skilled-conservative'].commitTicks).toBeGreaterThan(
      POLICY_RULES.skilled.commitTicks,
    )
    expect(POLICY_RULES['skilled-aggressive'].commitTicks).toBeLessThan(
      POLICY_RULES.skilled.commitTicks,
    )
  })

  it('drops the commitment the moment the policy stops wanting to reposition', () => {
    // The commitment is not a timer that runs on regardless: it is dropped whenever the intent
    // stops being a standoff move, so an interruption re-aims on the very next decision instead
    // of eleven decisions later.
    const policy = policyFactory('skilled')('seed-a')
    expect(moveIn(policy.decide(viewOf({ enemies: [shooterEast(6)] })))!.x).toBeGreaterThan(0)

    // 4.8 is inside [4.7, 5.0], so this decision is a hold and the commitment goes with it.
    expect(policy.decide(viewOf({ enemies: [shooterEast(4.8)] }))).toEqual([
      { kind: 'set-move', move: { x: 0, y: 0 }, keydown: false },
    ])

    // Decision 3, not decision 14.
    expect(moveIn(policy.decide(viewOf({ enemies: [shooterEast(-6)] })))!.x).toBeLessThan(0)
  })
})

describe('the command stream a policy produces', () => {
  it('does not re-send an input the battle is already holding', () => {
    const policy = policyFactory('skilled')('seed-a')
    const view = viewOf({ enemies: [shooterEast(6)] })

    expect(policy.decide(view).length).toBe(1)
    expect(policy.decide(view)).toEqual([])
  })

  it('re-sends after §1.5 hands the body to somebody else', () => {
    const policy = policyFactory('skilled')('seed-a')
    const view = viewOf({ enemies: [shooterEast(6)] })
    expect(policy.decide(view).length).toBe(1)
    expect(policy.decide(view)).toEqual([])

    // §1.5 zeroes `state.input.move` on succession, so what the harness believes is held is
    // stale exactly here. Same geometry, different body.
    const promoted = viewOf({ command: friendly(2, ORIGIN.x, ORIGIN.y), enemies: [shooterEast(6)] })
    expect(policy.decide(promoted).length).toBe(1)
  })

  it('presses from rest with a keydown and changes heading without one', () => {
    const policy = policyFactory('flees-always')('seed-a')

    const first = policy.decide(viewOf({ enemies: [meleeEast(2)] }))
    expect(first).toEqual([{ kind: 'set-move', move: { x: -2, y: 0 }, keydown: true }])

    const second = policy.decide(viewOf({ enemies: [{ id: 201, kind: 'melee', position: { x: ORIGIN.x, y: ORIGIN.y + 2 } }] }))
    expect(second).toEqual([{ kind: 'set-move', move: { x: 0, y: -2 }, keydown: false }])
  })

  it('clamps an offset shorter than §1.15 admits to standing still', () => {
    const tiny = ARRIVE_EPSILON / 2
    const policy = policyFactory('flees-always')('seed-a')

    expect(
      policy.decide(viewOf({ enemies: [{ id: 201, kind: 'melee', position: { x: ORIGIN.x + tiny, y: ORIGIN.y } }] })),
    ).toEqual([])

    // The same fixture one epsilon further out does produce a command, so the clamp is a clamp
    // and not a policy that never moves for a melee.
    const wide = ARRIVE_EPSILON * 2
    const wider = policy.decide(
      viewOf({ enemies: [{ id: 201, kind: 'melee', position: { x: ORIGIN.x + wide, y: ORIGIN.y } }] }),
    )
    expect(wider.length).toBe(1)
    // The offset is the difference of two arena coordinates, so it carries the float residue of
    // `28 + 0.008 - 28` rather than a round `0.008`; the sign and the magnitude are the claim.
    expect(moveIn(wider)!.x).toBeCloseTo(-wide, 9)
  })

  it('never pauses, whatever the board looks like', () => {
    for (const id of [...POLICY_IDS, ...SKILLED_MODEL_IDS]) {
      const board = viewOf({
        enemies: [shooterEast(4), meleeEast(1)],
        friendlies: [friendly(4, ORIGIN.x + 3, ORIGIN.y, { life: 'downed', downedTicksRemaining: DOWNED_TICKS })],
        pendingUpgrade: { round: 1, offered: ['firepower', 'mobility', 'rapid'] },
      })
      for (const command of decideOnce(id, board)) {
        expect(command.kind).not.toBe('toggle-pause')
      }
    }
  })
})

describe('§4.1 "한 가지만 바꾼 변형" is true of the code, not only of the table', () => {
  it('replaces exactly one decision point per variant, and none for `skilled`', () => {
    const counted = Object.fromEntries(
      Object.entries(POLICY_OVERRIDES).map(([id, override]) => [id, Object.keys(override).length]),
    )

    expect(counted).toEqual({
      'tactical-no-input': 1,
      'flees-always': 1,
      'camps-in-place': 1,
      'ignores-range': 1,
      'abandons-downed': 1,
    })
    expect(Object.hasOwn(POLICY_OVERRIDES, 'skilled')).toBe(false)
  })

  it('shares every other hook with `skilled` BY REFERENCE, so no variant is a copy', () => {
    for (const id of POLICY_IDS) {
      const rules = POLICY_RULES[id]
      const replaced = new Set(Object.keys(POLICY_OVERRIDES[id] ?? {}))

      for (const key of ['intent', 'allowsMove', 'standoff', 'rescues', 'commitTicks'] as const) {
        if (replaced.has(key)) {
          expect(rules[key]).not.toBe(SKILLED_RULES[key])
        } else {
          expect(rules[key]).toBe(SKILLED_RULES[key])
        }
      }
      expect(rules.id).toBe(id)
    }
  })

  it('names the six of §4.1 and the two of §3, and nothing else', () => {
    expect([...POLICY_IDS]).toEqual([
      'tactical-no-input',
      'flees-always',
      'camps-in-place',
      'skilled',
      'ignores-range',
      'abandons-downed',
    ])
    expect([...SKILLED_MODEL_IDS]).toEqual(['skilled-conservative', 'skilled-aggressive'])
    expect(Object.keys(POLICY_RULES).length).toBe(POLICY_IDS.length + SKILLED_MODEL_IDS.length)
  })
})
