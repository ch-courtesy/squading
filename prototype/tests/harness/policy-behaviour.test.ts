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
  DOWNED_TICKS,
  ELITE_BLAST_RADIUS,
  MELEE_RANGE,
  SHOOTER_RANGE,
} from '../../src/core/battle/constants'
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

  it('measures against the nearest shooter even with a melee in its face', () => {
    const view = viewOf({ enemies: [meleeEast(-1), shooterEast(6)] })
    const move = moveIn(decideOnce('skilled', view))

    // The melee sits 1.0 to the WEST. A policy positioning against the nearest body of any kind
    // would run east away from it and also east toward the shooter — so the discriminating test
    // is the melee-only board below, where the two answers point opposite ways.
    expect(move).not.toBeNull()
    expect(move!.x).toBeGreaterThan(0)

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
