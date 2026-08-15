import type { GameInputEvent, GameState } from './types'

function fnv1a(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

function byId<T extends { id: number }>(left: T, right: T): number {
  return left.id - right.id
}

function byEventOrder(left: GameInputEvent, right: GameInputEvent): number {
  return left.applyTick - right.applyTick || left.sequence - right.sequence
}

function normalize(value: unknown): unknown {
  if (typeof value === 'number') return Number(value.toFixed(6))
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    )
  }
  return value
}

export function canonicalizeAuthorityState(state: Readonly<GameState>): unknown {
  return normalize({
    ...state,
    pendingEvents: [...state.pendingEvents].sort(byEventOrder),
    friendlies: [...state.friendlies].sort(byId),
    normalEnemies: [...state.normalEnemies].sort(byId),
    damageEvents: [...state.damageEvents].sort(
      (left, right) => left.sourceId - right.sourceId || left.targetId - right.targetId || left.kind.localeCompare(right.kind),
    ),
  })
}

export function digestGameState(state: Readonly<GameState>): string {
  return fnv1a(JSON.stringify(canonicalizeAuthorityState(state)))
}
