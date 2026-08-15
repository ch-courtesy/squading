import type { RenderSnapshot } from './types'

export function hashSnapshot(snapshot: RenderSnapshot): string {
  const serialized = JSON.stringify(snapshot)
  let hash = 2166136261

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
