import { BATTLE_TICKS, ELITE_AREA_DAMAGE, ELITE_AREA_RADIUS, ELITE_MOVE_SPEED } from './constants'
import type { GameState, Vec2 } from './types'

const ELITE_SPAWN_TICK = 540
const FIRST_WARNING_TICK = 570
const LAST_DAMAGE_TICK = 880
const CYCLE_TICKS = 40
const WARNING_TICKS = 30

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

function moveTowards(position: Vec2, target: Vec2, speed: number): Vec2 {
  const distance = Math.sqrt(distanceSquared(position, target))
  if (distance === 0 || distance <= speed) return { x: target.x, y: target.y }
  return { x: position.x + (target.x - position.x) * speed / distance, y: position.y + (target.y - position.y) * speed / distance }
}

function nextSpawnFloat(state: GameState['prng']): number {
  let value = state.spawn >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.spawn = value >>> 0
  return state.spawn / 0x1_0000_0000
}

function activeCenter(state: GameState): Vec2 {
  return state.squads[state.activeSquad].lastCenter
}

function isWarningTick(tick: number): boolean {
  return tick >= FIRST_WARNING_TICK && tick <= LAST_DAMAGE_TICK - WARNING_TICKS && (tick - FIRST_WARNING_TICK) % CYCLE_TICKS === 0
}

function isDamageTick(tick: number): boolean {
  return tick >= FIRST_WARNING_TICK + WARNING_TICKS && tick <= LAST_DAMAGE_TICK && (tick - (FIRST_WARNING_TICK + WARNING_TICKS)) % CYCLE_TICKS === 0
}

export function spawnElite(state: GameState, tick: number): void {
  if (tick !== ELITE_SPAWN_TICK || state.elite.spawned || state.elite.hp <= 0) return
  const center = activeCenter(state)
  const angle = nextSpawnFloat(state.prng) * Math.PI * 2
  state.elite.spawned = true
  state.elite.position = { x: center.x + Math.cos(angle) * 5, y: center.y + Math.sin(angle) * 5 }
}

export function advanceElite(state: GameState, tick: number): void {
  if (!state.elite.spawned || state.elite.hp <= 0) return

  state.elite.position = moveTowards(state.elite.position, activeCenter(state), ELITE_MOVE_SPEED)
  if (isWarningTick(tick)) {
    state.elite.telegraphCenter = { ...activeCenter(state) }
    state.elite.telegraphRemaining = WARNING_TICKS
    state.elite.cycleIndex = (tick - FIRST_WARNING_TICK) / CYCLE_TICKS
    state.elite.warningTicks.push(tick)
    return
  }
  if (isDamageTick(tick)) {
    const center = state.elite.telegraphCenter
    if (center) {
      for (const friendly of state.friendlies) {
        if (friendly.life !== 'standing' || distanceSquared(friendly.position, center) > ELITE_AREA_RADIUS ** 2) continue
        friendly.hp = Math.max(0, friendly.hp - ELITE_AREA_DAMAGE)
        state.damageEvents.push({ sourceId: state.elite.id, targetId: friendly.id, amount: ELITE_AREA_DAMAGE, kind: 'elite-area' })
      }
      state.elite.damageTicks.push(tick)
    }
    state.elite.telegraphCenter = null
    state.elite.telegraphRemaining = 0
    return
  }
  if (state.elite.telegraphRemaining > 0) state.elite.telegraphRemaining -= 1
}

export function handleEliteDeath(state: GameState): boolean {
  if (!state.elite.spawned || state.elite.hp > 0) return false
  state.elite.spawned = false
  state.elite.targetId = null
  state.elite.telegraphCenter = null
  state.elite.telegraphRemaining = 0
  state.elite.cycleIndex = 0
  return true
}

export function resolveOutcome(state: GameState): void {
  if (state.mode !== 'running') return
  handleEliteDeath(state)
  if (state.elite.hp <= 0) {
    state.mode = 'won'
    state.failureReason = null
    return
  }
  if (!state.friendlies.some((friendly) => friendly.life === 'standing')) {
    state.mode = 'lost'
    state.failureReason = 'all-units-lost'
    return
  }
  if (state.combatTick === BATTLE_TICKS) {
    state.mode = 'lost'
    state.failureReason = 'elite-survived'
  }
}
