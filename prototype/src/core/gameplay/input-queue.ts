import type { GameInputEvent } from './types'

export interface GameplayInputQueue {
  enqueue(event: GameInputEvent): void
  take(applyTick: number): GameInputEvent[]
  clear(): void
  readonly size: number
}

function copyEvent(event: GameInputEvent): GameInputEvent {
  return { ...event }
}

export function createGameplayInputQueue(): GameplayInputQueue {
  const events: GameInputEvent[] = []

  return {
    enqueue(event) {
      events.push(copyEvent(event))
      events.sort((left, right) => left.applyTick - right.applyTick || left.sequence - right.sequence)
    },
    take(applyTick) {
      const taken: GameInputEvent[] = []
      const remaining: GameInputEvent[] = []
      for (const event of events) {
        if (event.applyTick <= applyTick) taken.push(copyEvent(event))
        else remaining.push(event)
      }
      events.length = 0
      events.push(...remaining)
      return taken
    },
    clear() {
      events.length = 0
    },
    get size() {
      return events.length
    },
  }
}
