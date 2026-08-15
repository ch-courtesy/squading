import { createGameplaySimulation } from '../../src/core/gameplay/simulation'
import { createInitialGameState } from '../../src/core/gameplay/state'
import type { FriendlyState, GameState, GameplaySimulation, NormalEnemyState } from '../../src/core/gameplay/types'
import type { Squad } from '../../src/core/types'

type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> }

export type MutableGameState = Mutable<GameState>
export type MutableFriendlyState = Mutable<FriendlyState>
export type MutableNormalEnemyState = Mutable<NormalEnemyState>

export function createStateFixture(seed = 'fixture'): MutableGameState {
  const state = structuredClone(createInitialGameState(seed)) as MutableGameState
  state.mode = 'running'
  return state
}

export function makeFriendly(id: number, squad: Squad, x: number, y: number): MutableFriendlyState {
  const hp = squad === 'teal' ? 1.2 : 0.75
  return { id, squad, hp, maxHp: hp, life: 'standing', position: { x, y }, formationOffset: { x: 0, y: 0 }, attackCooldown: 0, targetId: null, downedTicks: 0, rescueTargetId: null, rescueProgress: 0 }
}

export function makeNormalEnemy(id: number, x: number, y: number): MutableNormalEnemyState {
  return { id, hp: 1, position: { x, y }, attackCooldown: 0, targetId: null }
}

export const repeat = (count: number, action: () => void) => {
  for (let index = 0; index < count; index += 1) action()
}

export function startRunningGame(seed = 'fixture'): GameplaySimulation {
  const game = createGameplaySimulation({ seed })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  return game
}

export function advanceToTick(game: GameplaySimulation, target: number, onUpgrade: (game: GameplaySimulation) => void): void {
  while (game.getState().combatTick < target) {
    if (game.getState().mode === 'awaiting-upgrade') onUpgrade(game)
    game.step()
  }
}
