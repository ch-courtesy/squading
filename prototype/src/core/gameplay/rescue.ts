import { DOWNED_TICKS, RESCUE_RANGE, SCARLET_RESCUE_TICKS, TEAL_RESCUE_TICKS } from './constants'
import type { FriendlyState, GameState, Vec2 } from './types'

function byId<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id
}

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

export function rescueTicks(squad: FriendlyState['squad']): number {
  return squad === 'teal' ? TEAL_RESCUE_TICKS : SCARLET_RESCUE_TICKS
}

function clearRescueLock(rescuer: FriendlyState): void {
  rescuer.rescueTargetId = null
  rescuer.rescueProgress = 0
}

function clearRescueLocks(state: GameState): void {
  for (const friendly of state.friendlies) clearRescueLock(friendly)
}

function activeCasualty(state: GameState): FriendlyState | null {
  return state.friendlies
    .filter((friendly) => friendly.squad === state.activeSquad && friendly.life === 'downed')
    .sort((left, right) => left.downedTicks - right.downedTicks || byId(left, right))[0] ?? null
}

function activeRescuer(state: GameState, casualty: FriendlyState): FriendlyState | null {
  return state.friendlies
    .filter((friendly) => (
      friendly.squad === state.activeSquad
      && friendly.life === 'standing'
      && distanceSquared(friendly.position, casualty.position) <= RESCUE_RANGE ** 2
    ))
    .sort((left, right) => (
      distanceSquared(left.position, casualty.position) - distanceSquared(right.position, casualty.position)
      || byId(left, right)
    ))[0] ?? null
}

function lockedRescuer(state: GameState): { rescuer: FriendlyState; casualty: FriendlyState } | null {
  const rescuer = state.friendlies
    .filter((friendly) => friendly.rescueTargetId !== null)
    .sort(byId)[0]
  if (!rescuer || rescuer.rescueTargetId === null) return null
  const casualty = state.friendlies.find((friendly) => friendly.id === rescuer.rescueTargetId)
  if (
    !casualty
    || rescuer.life !== 'standing'
    || casualty.life !== 'downed'
    || rescuer.squad !== state.activeSquad
    || casualty.squad !== state.activeSquad
    || distanceSquared(rescuer.position, casualty.position) > RESCUE_RANGE ** 2
  ) {
    clearRescueLocks(state)
    return null
  }
  for (const friendly of state.friendlies) {
    if (friendly !== rescuer && friendly.rescueTargetId !== null) clearRescueLock(friendly)
  }
  return { rescuer, casualty }
}

export function prepareRescueLock(state: GameState, held = state.input.rescueHeld): boolean {
  if (!held) {
    clearRescueLocks(state)
    return false
  }

  const casualty = activeCasualty(state)
  const rescuer = casualty ? activeRescuer(state, casualty) : null
  if (!casualty || !rescuer) {
    clearRescueLocks(state)
    return false
  }

  const previousProgress = rescuer.rescueTargetId === casualty.id ? rescuer.rescueProgress : 0
  clearRescueLocks(state)
  rescuer.rescueTargetId = casualty.id
  rescuer.rescueProgress = previousProgress
  return true
}

export function advanceRescueProgress(state: GameState, held = state.input.rescueHeld): boolean {
  if (!prepareRescueLock(state, held)) return false
  const lock = lockedRescuer(state)
  if (!lock) return false
  lock.rescuer.rescueProgress += 1
  return true
}

function applyRescueDamage(state: GameState): void {
  const lock = lockedRescuer(state)
  if (!lock) return
  const hits = state.damageEvents.filter((event) => event.targetId === lock.rescuer.id).length
  lock.rescuer.rescueProgress = Math.max(0, lock.rescuer.rescueProgress - hits * 15)
}

function downNewCasualties(state: GameState): ReadonlySet<number> {
  const newlyDowned = new Set<number>()
  for (const friendly of state.friendlies) {
    if (friendly.life !== 'standing' || friendly.hp > 0) continue
    friendly.life = 'downed'
    friendly.hp = 0
    friendly.downedTicks = DOWNED_TICKS
    clearRescueLock(friendly)
    newlyDowned.add(friendly.id)
  }
  return newlyDowned
}

function completeRescue(state: GameState): void {
  const lock = lockedRescuer(state)
  if (!lock || lock.rescuer.rescueProgress < rescueTicks(lock.rescuer.squad)) return
  lock.casualty.life = 'standing'
  lock.casualty.downedTicks = 0
  lock.casualty.hp = lock.casualty.maxHp * state.squads[lock.casualty.squad].hpMultiplier * 0.5
  clearRescueLock(lock.rescuer)
  state.stats.rescues += 1
}

function advanceDownedTimers(state: GameState, newlyDowned: ReadonlySet<number>): void {
  for (const friendly of state.friendlies) {
    if (friendly.life !== 'downed' || newlyDowned.has(friendly.id)) continue
    if (friendly.downedTicks <= 1) {
      friendly.life = 'dead'
      friendly.downedTicks = 0
      clearRescueLock(friendly)
    } else {
      friendly.downedTicks -= 1
    }
  }
}

export function resolveRescueAndDownedTimers(state: GameState): void {
  applyRescueDamage(state)
  const newlyDowned = downNewCasualties(state)
  if (lockedRescuer(state)) completeRescue(state)
  advanceDownedTimers(state, newlyDowned)
  state.damageEvents = []
}
