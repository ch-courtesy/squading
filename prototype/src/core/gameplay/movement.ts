import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  NORMAL_ENEMY_MOVE_SPEED,
  SCARLET_MOVE_SPEED,
  TEAL_MOVE_SPEED,
} from './constants'
import { movementMultiplier } from './squads'
import type { FriendlyState, GameState, Vec2 } from './types'

const FOLLOW_DISTANCE = 3.5
const FOLLOW_STOP_DISTANCE = 0.5

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(maximum, value))
}

function clampToArena(position: Vec2): Vec2 {
  return { x: clamp(position.x, ARENA_WIDTH), y: clamp(position.y, ARENA_HEIGHT) }
}

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x
  const y = left.y - right.y
  return x * x + y * y
}

function moveTowards(position: Vec2, target: Vec2, speed: number): Vec2 {
  const distance = Math.sqrt(distanceSquared(position, target))
  if (distance === 0 || distance <= speed) return clampToArena(target)
  return clampToArena({ x: position.x + (target.x - position.x) * speed / distance, y: position.y + (target.y - position.y) * speed / distance })
}

function standingFriendlies(state: GameState, squad?: FriendlyState['squad']): FriendlyState[] {
  return state.friendlies.filter((friendly) => friendly.life === 'standing' && (squad === undefined || friendly.squad === squad))
}

function centerOf(friendlies: readonly FriendlyState[]): Vec2 | null {
  if (friendlies.length === 0) return null
  const total = friendlies.reduce((sum, friendly) => ({ x: sum.x + friendly.position.x, y: sum.y + friendly.position.y }), { x: 0, y: 0 })
  return { x: total.x / friendlies.length, y: total.y / friendlies.length }
}

function normalized(direction: Vec2): Vec2 | null {
  const magnitude = Math.hypot(direction.x, direction.y)
  return magnitude === 0 ? null : { x: direction.x / magnitude, y: direction.y / magnitude }
}

function squadMoveSpeed(state: GameState, squad: FriendlyState['squad']): number {
  const base = squad === 'teal' ? TEAL_MOVE_SPEED : SCARLET_MOVE_SPEED
  return base * movementMultiplier(state, squad)
}

function updateLastCenter(state: GameState, squad: FriendlyState['squad']): Vec2 {
  const center = centerOf(standingFriendlies(state, squad))
  if (center) state.squads[squad].lastCenter = center
  return state.squads[squad].lastCenter
}

function moveActiveSquad(state: GameState): { center: Vec2; moved: boolean } {
  const squad = state.activeSquad
  const standing = standingFriendlies(state, squad)
  if (standing.length === 0) return { center: state.squads[squad].lastCenter, moved: false }

  const direction = normalized(state.input.move)
  if (!direction) return { center: updateLastCenter(state, squad), moved: false }

  state.squads[squad].lastDirection = direction
  const speed = squadMoveSpeed(state, squad)
  let moved = false
  for (const friendly of standing) {
    const position = clampToArena({ x: friendly.position.x + direction.x * speed, y: friendly.position.y + direction.y * speed })
    moved ||= position.x !== friendly.position.x || position.y !== friendly.position.y
    friendly.position = position
  }
  return { center: updateLastCenter(state, squad), moved }
}

function moveInactiveSquad(state: GameState, activeCenter: Vec2): void {
  const squad = state.activeSquad === 'teal' ? 'scarlet' : 'teal'
  const standing = standingFriendlies(state, squad)
  if (standing.length === 0) return

  const activeDirection = normalized(state.squads[state.activeSquad].lastDirection) ?? { x: 0, y: 1 }
  const followCenter = clampToArena({
    x: activeCenter.x - activeDirection.x * FOLLOW_DISTANCE,
    y: activeCenter.y - activeDirection.y * FOLLOW_DISTANCE,
  })
  const speed = Math.max(TEAL_MOVE_SPEED, SCARLET_MOVE_SPEED) + 0.02

  for (const friendly of standing) {
    const target = clampToArena({ x: followCenter.x + friendly.formationOffset.x, y: followCenter.y + friendly.formationOffset.y })
    if (Math.sqrt(distanceSquared(friendly.position, target)) > FOLLOW_STOP_DISTANCE) {
      friendly.position = moveTowards(friendly.position, target, speed)
    }
  }
  updateLastCenter(state, squad)
}

function selectNearestStandingFriendly(state: GameState, position: Vec2): FriendlyState | null {
  return standingFriendlies(state)
    .sort((left, right) => distanceSquared(left.position, position) - distanceSquared(right.position, position) || left.id - right.id)[0] ?? null
}

function moveNormalEnemies(state: GameState): void {
  for (const enemy of [...state.normalEnemies].sort((left, right) => left.id - right.id)) {
    if (enemy.hp <= 0) continue
    const target = state.friendlies.find((friendly) => friendly.id === enemy.targetId && friendly.life === 'standing')
      ?? selectNearestStandingFriendly(state, enemy.position)
    if (!target) {
      enemy.targetId = null
      continue
    }
    enemy.targetId = target.id
    enemy.position = moveTowards(enemy.position, target.position, NORMAL_ENEMY_MOVE_SPEED)
  }
}

export function advanceMovement(state: GameState): boolean {
  const active = moveActiveSquad(state)
  moveInactiveSquad(state, active.center)
  moveNormalEnemies(state)
  return active.moved
}
