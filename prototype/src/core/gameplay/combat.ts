import {
  NORMAL_ENEMY_ATTACK_DAMAGE,
  NORMAL_ENEMY_ATTACK_INTERVAL,
  NORMAL_ENEMY_ATTACK_RANGE,
  SCARLET_ATTACK_DAMAGE,
  SCARLET_ATTACK_INTERVAL,
  SCARLET_ATTACK_RANGE,
  TEAL_ATTACK_DAMAGE,
  TEAL_ATTACK_INTERVAL,
  TEAL_ATTACK_RANGE,
} from './constants'
import type { FriendlyState, GameState, NormalEnemyState, Vec2 } from './types'

const CONTACT_SLOTS_PER_FRIENDLY = 2

function byId<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id
}

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

function standingFriendlies(state: GameState): FriendlyState[] {
  return state.friendlies.filter((friendly) => friendly.life === 'standing')
}

function findFriendly(state: GameState, id: number | null): FriendlyState | null {
  if (id === null) return null
  return standingFriendlies(state).find((friendly) => friendly.id === id) ?? null
}

function findNormalEnemy(state: GameState, id: number | null): NormalEnemyState | null {
  if (id === null) return null
  return state.normalEnemies.find((enemy) => enemy.id === id && enemy.hp > 0) ?? null
}

function friendlyAttackRange(friendly: FriendlyState): number {
  return friendly.squad === 'teal' ? TEAL_ATTACK_RANGE : SCARLET_ATTACK_RANGE
}

function friendlyAttackDamage(state: GameState, friendly: FriendlyState): number {
  const base = friendly.squad === 'teal' ? TEAL_ATTACK_DAMAGE : SCARLET_ATTACK_DAMAGE
  const inactiveMultiplier = friendly.squad === state.activeSquad ? 1 : 0.5
  return base * state.squads[friendly.squad].damageMultiplier * inactiveMultiplier
}

function friendlyAttackInterval(friendly: FriendlyState): number {
  return friendly.squad === 'teal' ? TEAL_ATTACK_INTERVAL : SCARLET_ATTACK_INTERVAL
}

export function selectTarget(state: GameState, friendly: FriendlyState): number | null {
  const rangeSquared = friendlyAttackRange(friendly) ** 2
  if (state.elite.spawned && state.elite.hp > 0 && distanceSquared(friendly.position, state.elite.position) <= rangeSquared) {
    return state.elite.id
  }
  return state.normalEnemies
    .filter((enemy) => enemy.hp > 0 && distanceSquared(friendly.position, enemy.position) <= rangeSquared)
    .sort((left, right) => distanceSquared(friendly.position, left.position) - distanceSquared(friendly.position, right.position) || left.id - right.id)[0]?.id ?? null
}

export function advanceAttackCooldowns(state: GameState): void {
  for (const friendly of state.friendlies) friendly.attackCooldown = Math.max(0, friendly.attackCooldown - 1)
  for (const enemy of state.normalEnemies) enemy.attackCooldown = Math.max(0, enemy.attackCooldown - 1)
}

export function advanceFriendlyAttacks(state: GameState): void {
  for (const friendly of [...state.friendlies].sort(byId)) {
    if (friendly.life !== 'standing' || friendly.attackCooldown > 0) continue

    const targetId = selectTarget(state, friendly)
    friendly.targetId = targetId
    if (targetId === null) continue

    const damage = friendlyAttackDamage(state, friendly)
    if (targetId === state.elite.id) {
      state.elite.hp = Math.max(0, state.elite.hp - damage)
    } else {
      const target = findNormalEnemy(state, targetId)
      if (!target) continue
      target.hp = Math.max(0, target.hp - damage)
    }
    friendly.attackCooldown = friendlyAttackInterval(friendly)
  }
}

function nearestStandingFriendly(state: GameState, position: Vec2, onlyWithOpenSlot: ReadonlyMap<number, number> | null): FriendlyState | null {
  return standingFriendlies(state)
    .filter((friendly) => onlyWithOpenSlot === null || (onlyWithOpenSlot.get(friendly.id) ?? 0) < CONTACT_SLOTS_PER_FRIENDLY)
    .sort((left, right) => distanceSquared(left.position, position) - distanceSquared(right.position, position) || left.id - right.id)[0] ?? null
}

export function assignNormalContactSlots(state: GameState): ReadonlySet<number> {
  const slotCounts = new Map<number, number>()
  const assigned = new Set<number>()

  for (const enemy of [...state.normalEnemies].filter((enemy) => enemy.hp > 0).sort(byId)) {
    let target = findFriendly(state, enemy.targetId)
    if (!target) {
      target = nearestStandingFriendly(state, enemy.position, null)
      enemy.targetId = target?.id ?? null
    }
    if (!target) continue

    const assignedCount = slotCounts.get(target.id) ?? 0
    if (assignedCount < CONTACT_SLOTS_PER_FRIENDLY) {
      slotCounts.set(target.id, assignedCount + 1)
      assigned.add(enemy.id)
      continue
    }

    const openSlotTarget = nearestStandingFriendly(state, enemy.position, slotCounts)
    enemy.targetId = openSlotTarget?.id ?? target.id
  }

  return assigned
}

export function advanceNormalAttacks(state: GameState): void {
  const assigned = assignNormalContactSlots(state)
  for (const enemy of [...state.normalEnemies].filter((enemy) => enemy.hp > 0).sort(byId)) {
    if (!assigned.has(enemy.id) || enemy.attackCooldown > 0) continue
    const target = findFriendly(state, enemy.targetId)
    if (!target || distanceSquared(enemy.position, target.position) > NORMAL_ENEMY_ATTACK_RANGE ** 2) continue

    target.hp = Math.max(0, target.hp - NORMAL_ENEMY_ATTACK_DAMAGE)
    enemy.attackCooldown = NORMAL_ENEMY_ATTACK_INTERVAL
    state.damageEvents.push({ sourceId: enemy.id, targetId: target.id, amount: NORMAL_ENEMY_ATTACK_DAMAGE, kind: 'contact' })
  }
}
