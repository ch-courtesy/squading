import type { RenderEffect, RenderSnapshot, RenderUnit } from '../types'
import { ARENA_HEIGHT, ARENA_WIDTH, ELITE_AREA_RADIUS, ELITE_MAX_HP, TICKS_PER_SECOND } from './constants'
import { rescueTicks } from './rescue'
import type { FriendlyState, GameState, NormalEnemyState } from './types'

const byId = <T extends { id: number }>(left: T, right: T): number => left.id - right.id

function friendlyState(unit: FriendlyState): RenderUnit['state'] {
  if (unit.life === 'dead') return 'dead'
  if (unit.life === 'downed') return 'downed'
  if (unit.rescueTargetId !== null) return 'rescuing'
  return unit.targetId === null ? 'idle' : 'attacking'
}

function normalState(unit: NormalEnemyState): RenderUnit['state'] {
  return unit.targetId === null ? 'idle' : 'attacking'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function projectFriendly(state: Readonly<GameState>, unit: FriendlyState): RenderUnit {
  const fatigue = state.squads[unit.squad].fatigue
  return {
    id: unit.id,
    kind: 'soldier',
    team: unit.squad,
    squad: unit.squad,
    x: unit.position.x,
    y: unit.position.y,
    facingRadians: 0,
    radius: 0.45,
    hp01: clamp01(unit.hp / unit.maxHp),
    fatigue01: clamp01(fatigue),
    morale01: clamp01(1 - fatigue),
    state: friendlyState(unit),
  }
}

function projectNormal(unit: NormalEnemyState): RenderUnit {
  return {
    id: unit.id,
    kind: 'enemy',
    team: 'enemy',
    squad: null,
    x: unit.position.x,
    y: unit.position.y,
    facingRadians: 0,
    radius: 0.45,
    hp01: clamp01(unit.hp),
    fatigue01: 0,
    morale01: 1,
    state: normalState(unit),
  }
}

export function projectRenderSnapshot(state: Readonly<GameState>): RenderSnapshot {
  const units: RenderUnit[] = [
    ...state.friendlies.map((unit) => projectFriendly(state, unit)),
    ...state.normalEnemies.map(projectNormal),
  ]
  const effects: RenderEffect[] = []

  if (state.elite.spawned) {
    units.push({
      id: state.elite.id,
      kind: 'elite',
      team: 'enemy',
      squad: null,
      x: state.elite.position.x,
      y: state.elite.position.y,
      facingRadians: 0,
      radius: 0.8,
      hp01: clamp01(state.elite.hp / ELITE_MAX_HP),
      fatigue01: 0,
      morale01: 1,
      state: state.elite.targetId === null ? 'idle' : 'attacking',
    })
  }
  if (state.elite.telegraphCenter && state.elite.telegraphRemaining > 0) {
    effects.push({
      id: state.elite.id,
      kind: 'elite-telegraph',
      team: 'enemy',
      x: state.elite.telegraphCenter.x,
      y: state.elite.telegraphCenter.y,
      radius: ELITE_AREA_RADIUS,
      startedTick: state.combatTick,
      durationTicks: state.elite.telegraphRemaining,
    })
  }
  for (const rescuer of state.friendlies) {
    if (rescuer.rescueTargetId === null) continue
    const casualty = state.friendlies.find((friendly) => friendly.id === rescuer.rescueTargetId && friendly.life === 'downed')
    if (!casualty) continue
    // Both ends of the lock get a signal so the player can see who is being carried
    // *and* which soldier is stuck carrying them. Unit ids are unique, so the two
    // effects never collide in a renderer's per-id effect map.
    const remainingTicks = Math.max(0, rescueTicks(rescuer.squad) - rescuer.rescueProgress)
    for (const unit of [casualty, rescuer]) {
      effects.push({
        id: unit.id,
        kind: 'rescue-signal',
        team: unit.squad,
        x: unit.position.x,
        y: unit.position.y,
        startedTick: state.combatTick,
        durationTicks: remainingTicks,
      })
    }
  }

  return {
    tick: state.combatTick,
    elapsedMs: state.combatTick * 1000 / TICKS_PER_SECOND,
    units: units.sort(byId),
    projectiles: [],
    effects: effects.sort(byId),
    camera: { centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2, worldWidth: ARENA_WIDTH, worldHeight: ARENA_HEIGHT },
    activeSquad: state.activeSquad,
  }
}
