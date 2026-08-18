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
  /**
   * World-space footprint radius for effects that cover ground rather than mark a
   * point. Renderers must draw the area at this size instead of mirroring a balance
   * constant of their own.
   */
  readonly radius?: number
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
  /** What must be on screen. It moves when the camera follows something. */
  readonly camera: CameraState
  /**
   * The board itself — the world region the rules confine play to.
   *
   * Separate from `camera` because a FOLLOWING camera makes them different things, and drawing
   * the board at the camera's extent then paints the arena boundary as a rail that walks around
   * with the player. v1 and the renderer lab publish one static rectangle that is both, and omit
   * this; the renderer falls back to `camera`, which is exactly what they had. The v2 commander
   * battle follows its command unit and publishes its arena here.
   */
  readonly playArea?: CameraState
  readonly activeSquad?: Squad
}

export interface Simulation {
  readonly result: SimulationResult
  readonly activeSquad: Squad
  step(input: SimulationInput): void
  getSnapshot(): RenderSnapshot
  restart(): void
}
