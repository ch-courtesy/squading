export type Team = 'teal' | 'scarlet' | 'enemy'
export type Squad = Exclude<Team, 'enemy'>
/**
 * The class signal, and the ONLY one the renderer gets — it draws a body per value here.
 *
 * `charger` is §1.2.1's front rank. It was a simulation-only class for four batches: reach 1.1,
 * damage paid on the tick it moved, and on the board a rifleman, because this union had no value
 * for it and `projectFriendly` had nothing to say. A class the player cannot see is a class the
 * player cannot use, so the union carries it now.
 */
export type UnitKind = 'commander' | 'soldier' | 'charger' | 'enemy-commander' | 'enemy' | 'elite'
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
  /**
   * `downed-marker` is the pin light §1.11's decision needs and `rescue-signal` is not.
   * `rescue-signal` marks the body `Space` would pick up RIGHT NOW (within `RESCUE_RANGE`
   * 1.5) — by the time it appears the choice is already made. The marker attaches the tick a
   * body falls, at any distance, because the leash is 10.0 and the whole span where "do I go
   * back" is a live question sits outside 1.5.
   */
  readonly kind:
    | 'hit'
    | 'rescue'
    | 'morale-break'
    | 'rescue-signal'
    | 'elite-telegraph'
    | 'downed-marker'
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
  /**
   * §1.11's countdown, as a fraction from 1 (just fell) to 0 (about to die). Only
   * `downed-marker` carries it: reaching a body in time or not is the whole decision, so the
   * time left is the decision's input and has to be on screen, not merely implied.
   */
  readonly urgency01?: number
}

/**
 * What one blow LOOKED like, for the frame it landed on.
 *
 * Distinct from `RenderEffect`, and the difference is lifetime. An effect is a THING ON THE
 * BOARD that persists across frames — the renderer keys its visual by `id` and keeps it until
 * the id stops appearing — so an effect that meant "this happened once, on tick 812" would
 * either leak a visual or collide with the id of the telegraph standing next to it. An action
 * event is consumed on the frame it arrives and never stored.
 *
 * `melee` and `shot` are separated because the spec's muzzle puff belongs to a gun: a
 * melee attacker that puffed smoke would be reading its own animation off the wrong verb.
 * `blast` is the elite's area strike, which has no attacker at the point of impact.
 */
/**
 * `revive` is §1.11's completion, and it is here because its absence was measurable in play: a
 * body stood up and the screen said nothing, so the thing the player had just spent a walk and
 * 45 ticks of standing still on had no moment. Death had one; the opposite of death did not.
 */
export type RenderActionEventKind = 'shot' | 'melee' | 'blast' | 'death' | 'revive'

export type RenderActionEvent = {
  readonly kind: RenderActionEventKind
  /** The simulation tick this happened on — NOT the frame it is delivered in (see below). */
  readonly tick: number
  /** Who struck. `null` for a `death`, which is a fact about one body and has no striker. */
  readonly sourceId: number | null
  readonly sourceX: number
  readonly sourceY: number
  readonly targetId: number
  readonly targetX: number
  readonly targetY: number
  /**
   * How big the blow was, as a fraction of the target's maximum health. `0` for a `death`,
   * which carries no damage of its own. Display-only: it scales a flash, never an outcome.
   */
  readonly strength01: number
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
  /**
   * Everything that HAPPENED in the ticks this frame ran, in the order the authority
   * resolved it. Every tick between two frames contributes its events; none are merged and
   * none are dropped, and each carries the `tick` it belongs to so a renderer can schedule
   * three ticks' worth of animation at three different ages instead of at the frame edge.
   *
   * THE ABSENCE OF THE FIELD IS ITSELF A SIGNAL, and it is the reason this is optional rather
   * than defaulted to `[]`. A projection that publishes it (the v2 battle) is promising the
   * renderer a complete account of the tick, so the renderer must not also guess events out of
   * snapshot deltas or every blow plays twice. A projection that omits it (v1's gameplay
   * snapshot, the `?lab=renderers` fixture) is promising nothing, and the renderer falls back
   * to inferring hits from a drop in `hp01`. An empty array therefore means "nothing happened",
   * which is not the same statement as `undefined`.
   */
  readonly actionEvents?: readonly RenderActionEvent[]
  readonly activeSquad?: Squad
}

export interface Simulation {
  readonly result: SimulationResult
  readonly activeSquad: Squad
  step(input: SimulationInput): void
  getSnapshot(): RenderSnapshot
  restart(): void
}
