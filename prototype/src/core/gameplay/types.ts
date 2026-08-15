import type { RenderSnapshot, Squad } from '../types'

export type BattleMode = 'ready' | 'running' | 'awaiting-upgrade' | 'paused' | 'won' | 'lost'
export type FailureReason = 'all-units-lost' | 'elite-survived' | null
export type UpgradeId = 'power' | 'march' | 'vigor'
export type GameplayFixture = 'determinism' | 'damage-events' | 'rescue-agency'
export type Vec2 = { readonly x: number; readonly y: number }
export type LifeState = 'standing' | 'downed' | 'dead'
export type PersistentInput = { move: Vec2; rescueHeld: boolean }

export type FriendlyState = {
  id: number
  squad: Squad
  hp: number
  maxHp: number
  life: LifeState
  position: Vec2
  formationOffset: Vec2
  attackCooldown: number
  targetId: number | null
  downedTicks: number
  rescueTargetId: number | null
  rescueProgress: number
}

export type NormalEnemyState = {
  id: number
  hp: number
  position: Vec2
  attackCooldown: number
  targetId: number | null
}

export type EliteState = {
  id: number
  spawned: boolean
  hp: number
  position: Vec2
  targetId: number | null
  telegraphCenter: Vec2 | null
  telegraphRemaining: number
  cycleIndex: number
  warningTicks: number[]
  damageTicks: number[]
}

export type DamageEvent = {
  sourceId: number
  targetId: number
  amount: number
  kind: 'contact' | 'elite-area'
}

export type SquadState = {
  fatigue: number
  exhausted: boolean
  lastCenter: Vec2
  lastDirection: Vec2
  damageMultiplier: number
  movementMultiplier: number
  hpMultiplier: number
}

export type UpgradeState = {
  offered: readonly UpgradeId[]
  choice: UpgradeId | null
  applied: boolean
}

export type GameState = {
  schemaVersion: 1
  rootSeed: string
  combatTick: number
  mode: BattleMode
  failureReason: FailureReason
  activeSquad: Squad
  switchCooldown: number
  prng: { spawn: number; cards: number; formation: number }
  wave: { cursor: number; requested: number; discarded: number }
  input: PersistentInput
  inputCursor: number
  pendingEvents: GameInputEvent[]
  squads: Record<Squad, SquadState>
  friendlies: FriendlyState[]
  normalEnemies: NormalEnemyState[]
  elite: EliteState
  damageEvents: DamageEvent[]
  stats: { kills: number; xp: number; rescues: number }
  upgrade: UpgradeState
}

export type GameInputEvent =
  | { readonly applyTick: 0; readonly sequence: number; readonly kind: 'start-battle' }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'set-move'; readonly x: number; readonly y: number }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'set-rescue'; readonly held: boolean }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'switch-squad' }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'choose-upgrade'; readonly index: 0 | 1 | 2 }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'toggle-pause' }

export interface GameplaySimulation {
  getState(): Readonly<GameState>
  getSnapshot(): RenderSnapshot
  getDigest(): string
  enqueue(event: GameInputEvent): void
  step(): void
  restart(): void
}
