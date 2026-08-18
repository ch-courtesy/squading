import { describe, expect, it } from 'vitest'

import {
  ELITE_BLAST_RADIUS,
  ELITE_SPAWN_TICK,
  RESCUE_RANGE,
  SOLDIER_RANGE,
} from '../../src/core/battle/constants'
import { digestBattleState } from '../../src/core/battle/digest'
import { FORMATION_MAX_SLOT_RADIUS } from '../../src/core/battle/formation'
import { COMMANDER_ID, ELITE_ID, createEnemy, createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'
import {
  VIEW_BODY_MARGIN,
  VIEW_REQUIRED_RADIUS,
  projectBattleSnapshot,
} from '../../src/core/battle-view/snapshot'

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
    state.enemies.push(createEnemy(101, 'melee', { x: 30, y: 16 }))
    state.enemies.push(createEnemy(102, 'shooter', { x: 32, y: 16 }))

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
    const fresh = createEnemy(101, 'melee', { x: 30, y: 16 })
    fresh.life = 'dead'
    fresh.hp = 0
    fresh.deathTick = 100
    const stale = createEnemy(102, 'melee', { x: 31, y: 16 })
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
    state.enemies.push(createEnemy(101, 'shooter', { x: 33, y: 16 }))
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

  it('keeps every slot of §1.4 inside the guaranteed region', () => {
    // The formation is what (a) is about, and it never needs the camera widened while the
    // followers are on their slots — that is what makes the widening above a straggler rule.
    expect(FORMATION_MAX_SLOT_RADIUS + VIEW_BODY_MARGIN).toBeLessThan(VIEW_REQUIRED_RADIUS)
  })
})
