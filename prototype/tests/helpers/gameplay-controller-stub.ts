import { createInitialGameState } from '../../src/core/gameplay/state'
import type { GameState } from '../../src/core/gameplay/types'
import type { GameplayController } from '../../src/app/gameplay-controller'

export function createGameplayControllerStub(): GameplayController & { publish(state: GameState): void } {
  let state = createInitialGameState('47')
  let listener: ((value: Readonly<GameState>) => void) | null = null
  return {
    start: async () => undefined,
    beginBattle: () => undefined,
    subscribe: (next) => {
      listener = next
      next(state)
      return () => {
        listener = null
      }
    },
    chooseUpgrade: () => undefined,
    togglePause: () => undefined,
    pointerDown: () => undefined,
    pointerMove: () => undefined,
    pointerEnd: () => undefined,
    restart: () => {
      state = createInitialGameState('47')
      listener?.(state)
    },
    getState: () => state,
    dispose: () => undefined,
    publish: (next) => {
      state = structuredClone(next)
      listener?.(state)
    },
  }
}
