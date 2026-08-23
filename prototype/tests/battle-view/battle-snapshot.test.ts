import { describe, expect, it } from 'vitest'

import {
  DOWNED_TICKS,
  RESCUE_RANGE,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { stageConfigOf } from '../../src/core/battle/stages'
import { digestBattleState } from '../../src/core/battle/digest'
import { FORMATION_MAX_SLOT_RADIUS } from '../../src/core/battle/formation'
import { COMMANDER_ID, ELITE_ID, createEnemy, createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'
import {
  VIEW_BODY_MARGIN,
  projectBattleSnapshot,
  viewRequiredRadiusOf,
} from '../../src/core/battle-view/snapshot'

/**
 * The stage numbers this fixture pins, read off the one stage there is.
 *
 * Campaign stage 0 moved these out of `constants.ts` (§2.2's per-stage axes). Aliased back to
 * their old spellings so the assertions below are the same assertions, against the same values.
 */
const {
  eliteBlastRadius: ELITE_BLAST_RADIUS,
  eliteSpawnTick: ELITE_SPAWN_TICK,
} = stageConfigOf(1)
/** §4.4(b)'s guaranteed radius, which is a stage's since the blast radius is. */
const VIEW_REQUIRED_RADIUS = viewRequiredRadiusOf(1)

function stateAt(seed = 'view-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

function unitOf(state: BattleState, id: number) {
  return state.friendlies.find((unit) => unit.id === id)!
}

describe('battle-view: the display-only projection (§6)', () => {
  it('projects the command unit apart from the fifteen it leads', () => {
    const snapshot = projectBattleSnapshot(stateAt())

    const commanders = snapshot.units.filter((unit) => unit.kind === 'commander')
    const soldiers = snapshot.units.filter((unit) => unit.kind === 'soldier')
    expect(commanders).toHaveLength(1)
    expect(soldiers).toHaveLength(15)
    expect(commanders[0].id).toBe(COMMANDER_ID)
    // The renderer's diorama presentation is gated on `activeSquad`, and the command
    // unit is the body that wears it — the pulsing ring is "the body you are driving".
    expect(snapshot.activeSquad).toBe(commanders[0].squad)
    expect(soldiers.every((unit) => unit.squad !== snapshot.activeSquad)).toBe(true)
  })

  it('gives the two enemy classes two different silhouettes', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(state, 101, 'melee', { x: 30, y: 16 }))
    state.enemies.push(createEnemy(state, 102, 'shooter', { x: 32, y: 16 }))

    const snapshot = projectBattleSnapshot(state)
    const melee = snapshot.units.find((unit) => unit.id === 101)!
    const shooter = snapshot.units.find((unit) => unit.id === 102)!

    expect(melee.team).toBe('enemy')
    expect(shooter.team).toBe('enemy')
    // §4.5's third question ("어디에 멈출지 — 적 사거리 밖인지") is unanswerable if the two
    // classes look the same, so they must not project to the same `kind`.
    expect(melee.kind).not.toBe(shooter.kind)
  })

  it('drops an enemy once its death animation has had its ticks', () => {
    const state = stateAt()
    const fresh = createEnemy(state, 101, 'melee', { x: 30, y: 16 })
    fresh.life = 'dead'
    fresh.hp = 0
    fresh.deathTick = 100
    const stale = createEnemy(state, 102, 'melee', { x: 31, y: 16 })
    stale.life = 'dead'
    stale.hp = 0
    stale.deathTick = 10
    state.enemies.push(fresh, stale)
    state.combatTick = 105

    const ids = projectBattleSnapshot(state).units.map((unit) => unit.id)
    expect(ids).toContain(101)
    expect(ids).not.toContain(102)
  })

  it('keeps the camera on the command unit and covers §4.4(b) around it', () => {
    const state = stateAt()
    unitOf(state, COMMANDER_ID).position = { x: 12, y: 9 }

    const { camera } = projectBattleSnapshot(state)
    expect(camera.centerX).toBe(12)
    expect(camera.centerY).toBe(9)
    // §4.4(b): 병사 사거리 + 정예 범위 + 여유.
    expect(VIEW_REQUIRED_RADIUS).toBeGreaterThanOrEqual(SOLDIER_RANGE + ELITE_BLAST_RADIUS)
    expect(camera.worldWidth / 2).toBeGreaterThanOrEqual(VIEW_REQUIRED_RADIUS)
    expect(camera.worldHeight / 2).toBeGreaterThanOrEqual(VIEW_REQUIRED_RADIUS)
  })

  it('publishes §1.7 arena as the board, which the camera is not', () => {
    const state = stateAt()
    unitOf(state, COMMANDER_ID).position = { x: 8, y: 6 }

    const { camera, playArea } = projectBattleSnapshot(state)
    expect(playArea).toEqual({ centerX: 28, centerY: 16, worldWidth: 56, worldHeight: 32 })
    // The two must not be the same rectangle, or the rail walks around with the player.
    expect(camera.worldWidth).toBeLessThan(playArea!.worldWidth)
    expect(camera.centerX).not.toBe(playArea!.centerX)
  })

  it('widens the camera for a body that has fallen behind the formation (§4.4a)', () => {
    const state = stateAt()
    const straggler = unitOf(state, 3)
    straggler.position = { x: 28 + VIEW_REQUIRED_RADIUS + 6, y: 16 }

    const { camera } = projectBattleSnapshot(state)
    const halfWidth = camera.worldWidth / 2
    expect(halfWidth).toBeGreaterThanOrEqual(VIEW_REQUIRED_RADIUS + 6)
    expect(Math.abs(straggler.position.x - camera.centerX) + VIEW_BODY_MARGIN).toBeLessThanOrEqual(halfWidth)
  })

  it('ignores a dead body when it sizes the camera, because a dead body is not drawn', () => {
    const state = stateAt()
    state.combatTick = 400
    const gone = unitOf(state, 4)
    gone.life = 'dead'
    gone.deathTick = 5
    gone.position = { x: 55, y: 31 }

    const { camera, units } = projectBattleSnapshot(state)
    expect(camera.worldWidth / 2).toBe(VIEW_REQUIRED_RADIUS)
    expect(units.some((unit) => unit.id === 4)).toBe(false)
  })

  it('draws §1.12 telegraph as the circle it damages, and only while it is running', () => {
    const state = stateAt()
    state.combatTick = ELITE_SPAWN_TICK + 10
    state.elite.enemyId = ELITE_ID
    state.elite.attackPhase = 'telegraph'
    state.elite.telegraphCenter = { x: 20, y: 12 }
    state.elite.telegraphRemaining = 30

    const telegraph = projectBattleSnapshot(state).effects.find((effect) => effect.kind === 'elite-telegraph')
    expect(telegraph).toBeDefined()
    expect(telegraph!.x).toBe(20)
    expect(telegraph!.y).toBe(12)
    expect(telegraph!.radius).toBe(ELITE_BLAST_RADIUS)

    state.elite.attackPhase = 'cooldown'
    expect(projectBattleSnapshot(state).effects.some((effect) => effect.kind === 'elite-telegraph')).toBe(false)
  })

  it('marks the body Space would pick up, which is what keeps §1.11 candidate id a number', () => {
    const state = stateAt()
    const body = unitOf(state, 5)
    body.life = 'downed'
    body.position = { x: 28 + RESCUE_RANGE / 2, y: 16 }

    const signals = projectBattleSnapshot(state).effects.filter((effect) => effect.kind === 'rescue-signal')
    expect(signals.map((effect) => effect.id)).toEqual([body.id])
  })

  it('signals both ends of a rescue that is under way', () => {
    const state = stateAt()
    const body = unitOf(state, 5)
    body.life = 'downed'
    body.position = { x: 28.5, y: 16 }
    state.rescue = { active: true, targetId: body.id, progress: 12 }

    const signals = projectBattleSnapshot(state).effects.filter((effect) => effect.kind === 'rescue-signal')
    expect(signals.map((effect) => effect.id).sort()).toEqual([COMMANDER_ID, body.id].sort())
  })

  it('never writes to the state it projects, and hands back no reference into it', () => {
    const state = stateAt()
    state.enemies.push(createEnemy(state, 101, 'shooter', { x: 33, y: 16 }))
    const body = unitOf(state, 5)
    body.life = 'downed'
    body.position = { x: 28.4, y: 16 }
    state.elite.attackPhase = 'telegraph'
    state.elite.telegraphCenter = { x: 20, y: 12 }
    state.elite.telegraphRemaining = 30
    const before = digestBattleState(state)

    const snapshot = projectBattleSnapshot(state)
    expect(digestBattleState(state)).toBe(before)

    // Every coordinate the snapshot carries is a copied number, so there is no object a
    // renderer could reach back through — including the one Vec2 the state does own.
    expect(snapshot.effects.some((effect) => effect.kind === 'elite-telegraph')).toBe(true)
    for (const effect of snapshot.effects) {
      expect(effect).not.toBe(state.elite.telegraphCenter)
      expect(typeof effect.x).toBe('number')
    }
    expect(snapshot.units.every((unit) => typeof unit.x === 'number')).toBe(true)
  })

  it('lights every downed body, at any distance, and none while all sixteen stand', () => {
    // THE NON-VACUITY IS THE POINT AND IT RUNS BOTH WAYS. Zero downed must give zero markers,
    // or a projection that emitted one unconditionally would pass the half of this that says
    // "a downed body is lit".
    const state = stateAt()
    const before = projectBattleSnapshot(state).effects.filter((e) => e.kind === 'downed-marker')
    expect(before).toEqual([])

    // Two bodies, one at arm's reach and one most of the leash away. The far one is the case
    // that matters: `rescue-signal` only ever attaches inside RESCUE_RANGE, so before this
    // marker existed the body you had to DECIDE about was the one with no mark on it.
    const commander = unitOf(state, COMMANDER_ID)
    const near = state.friendlies.find((unit) => unit.id !== COMMANDER_ID)!
    const far = state.friendlies.find((unit) => unit.id !== COMMANDER_ID && unit.id !== near.id)!
    for (const [unit, distance] of [[near, RESCUE_RANGE / 2], [far, 9]] as const) {
      unit.life = 'downed'
      unit.hp = 0
      unit.position = { x: commander.position.x + distance, y: commander.position.y }
    }
    near.downedTicks = 0
    far.downedTicks = Math.floor(DOWNED_TICKS / 2)

    const markers = projectBattleSnapshot(state).effects.filter((e) => e.kind === 'downed-marker')
    expect(markers.map((marker) => marker.id).sort()).toEqual([near.id, far.id].sort())

    // §1.11's countdown reaches the screen as a fraction, and it is the decision's input: the
    // half-drained body reads half. A marker without it would say "someone is down" and leave
    // out whether you can still get there.
    const byId = new Map(markers.map((marker) => [marker.id, marker]))
    expect(byId.get(near.id)!.urgency01).toBeCloseTo(1, 6)
    expect(byId.get(far.id)!.urgency01).toBeCloseTo(0.5, 2)

    // And the pickup pillar stays the SEPARATE, nearer signal — the far body has no say in it.
    const signals = projectBattleSnapshot(state).effects.filter((e) => e.kind === 'rescue-signal')
    expect(signals.map((signal) => signal.id)).toEqual([near.id])
  })

  it('keeps every slot of §1.4 inside the guaranteed region', () => {
    // The formation is what (a) is about, and it never needs the camera widened while the
    // followers are on their slots — that is what makes the widening above a straggler rule.
    expect(FORMATION_MAX_SLOT_RADIUS + VIEW_BODY_MARGIN).toBeLessThan(VIEW_REQUIRED_RADIUS)
  })
})
