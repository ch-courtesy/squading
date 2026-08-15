export type Team = 'teal' | 'scarlet' | 'enemy'
export type Squad = Exclude<Team, 'enemy'>
export type UnitKind = 'commander' | 'soldier' | 'enemy-commander' | 'enemy' | 'elite'
export type UnitState =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'downed'
  | 'rescuing'
  | 'dead'

export type SimulationResult = 'running' | 'success' | 'failure'

export type SimulationInput = {
  moveX?: number
  moveY?: number
  switchSquad?: boolean
  rescue?: boolean
}

export type SimulationConfig = {
  readonly seed: string
  readonly enemyCount: 100 | 200 | 300
}

export type RenderUnit = {
  readonly id: number
  readonly kind: UnitKind
  readonly team: Team
  readonly squad: Squad | null
  readonly x: number
  readonly y: number
  readonly facingRadians: number
  readonly radius: number
  readonly hp01: number
  readonly fatigue01: number
  readonly morale01: number
  readonly state: UnitState
}

export type RenderProjectile = {
  readonly id: number
  readonly kind: 'friendly' | 'enemy'
  readonly ownerId: number
  readonly x: number
  readonly y: number
  readonly targetX: number
  readonly targetY: number
  readonly progress01: number
}

export type RenderEffect = {
  readonly id: number
  readonly kind: 'hit' | 'rescue' | 'morale-break' | 'rescue-signal' | 'elite-telegraph'
  readonly team: Team | null
  readonly x: number
  readonly y: number
  readonly startedTick: number
  readonly durationTicks: number
}

export type CameraState = {
  readonly centerX: number
  readonly centerY: number
  readonly worldWidth: number
  readonly worldHeight: number
}

export type RenderSnapshot = {
  readonly tick: number
  readonly elapsedMs: number
  readonly units: readonly RenderUnit[]
  readonly projectiles: readonly RenderProjectile[]
  readonly effects: readonly RenderEffect[]
  readonly camera: CameraState
  readonly activeSquad?: Squad
}

export interface Simulation {
  readonly result: SimulationResult
  readonly activeSquad: Squad
  step(input: SimulationInput): void
  getSnapshot(): RenderSnapshot
  restart(): void
}
