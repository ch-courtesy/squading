// The display-only projection batch G draws the v2 battle from (§6).
//
// ---------------------------------------------------------------------------
// WHY IT IS HERE AND NOT IN `core/battle/`
// ---------------------------------------------------------------------------
// `core/battle/battle.ts` says it is display-agnostic and means it: no camera, no
// snapshot, no frame timing. A camera lives in `BattleState`'s module only over the
// no-scratch rule's dead body, and §1.17's digest walks whatever is in that state. So the
// projection sits BESIDE the core, exactly where batch F put the policy projection
// (`core/harness/policy/view.ts`), and the dependency runs one way: this module imports
// `core/battle`, and nothing under `core/battle` imports this.
//
// ---------------------------------------------------------------------------
// WHY IT REUSES `core/types.ts`'s `RenderSnapshot` RATHER THAN INVENTING ONE
// ---------------------------------------------------------------------------
// §6 says to reuse the existing diorama renderer, and `RenderSnapshot` is that renderer's
// input contract — the same one the `?lab=renderers` comparison and the v1 game feed it. A
// second snapshot type would mean a second renderer or a converter, and the converter would
// be the place the two drift. What is NOT reused is v1's projection
// (`core/gameplay/snapshot.ts`): it reads `GameState`, which v2 does not have, and its
// camera is the whole 56x32 arena, which is the one thing §4.4 forbids ("카메라는 지휘
// 유닛을 추종한다").
//
// ---------------------------------------------------------------------------
// THE THREE SILHOUETTES ON THE HOSTILE SIDE
// ---------------------------------------------------------------------------
// §1.9 fields two enemy classes and §1.12 adds the elite, and a player who cannot tell a
// melee from a shooter cannot answer §4.5's third question ("어디에 멈출지 — 적 사거리
// 밖인지"). The renderer already paints three hostile archetypes, keyed by `UnitKind`:
// `enemy`, `enemy-commander` and `elite`. So the shooter is projected as
// `enemy-commander` — a NAME from v1's roster, carrying v2's shooter. It is a name reused,
// not a rule: nothing downstream reads it as a commander, and `LEADER_KINDS` gives it the
// base ring that makes "this one shoots back" readable at a glance.
//
// ---------------------------------------------------------------------------
// WHAT CROSSES THE BOUNDARY, AND WHAT DOES NOT
// ---------------------------------------------------------------------------
// `RenderUnit.hp01` is published for enemies as well as friendlies. It is NOT an enemy hp
// bar — the renderer scales its hit flash by the fraction of health a blow took, and reads a
// drop to zero as the death to topple. `core/harness/policy/view.ts` lists "enemy hp" among
// the things a POLICY may not read, and that list is about decisions; the flash is the
// player learning they hit something, which they learn by looking anyway.
//
// Cooldowns, target ids, slot bookkeeping, the spawn backlog, the prng streams and the
// remaining card pool are not here at all, for the reasons that file writes out.

import { DOWNED_TICKS, SOLDIER_RANGE } from '../battle/constants'
import { stageConfigOf, type StageId } from '../battle/stages'
import { rescueCandidateId } from '../battle/rescue'
import { enemiesById, friendliesById } from '../battle/state'
import type {
  BattleState,
  DamageCause,
  DamageEvent,
  EnemyKind,
  EnemyUnit,
  FriendlyUnit,
  Vec2,
} from '../battle/types'
import type {
  RenderActionEvent,
  RenderActionEventKind,
  RenderEffect,
  RenderSnapshot,
  RenderUnit,
  Squad,
  UnitKind,
} from '../types'

/**
 * §1.1's rate, written down on the DISPLAY side because that is the only side that needs
 * it: the core counts ticks and never seconds, and the controller is what turns wall-clock
 * milliseconds into 30 fixed steps a second.
 */
export const BATTLE_TICKS_PER_SECOND = 30

/** §4.4(b)'s 여유 — how much board is guaranteed beyond the ranges that decide a fight. */
export const VIEW_MARGIN = 4.0

/**
 * §4.4(b): "지휘 유닛 중심 반경 `병사 사거리 + 정예 범위 + 여유`의 월드 영역이 전부 뷰포트
 * 안". 정예 범위 is read as the blast footprint (`eliteBlastRadius`) — the elite's area
 * attack is the thing a player has to see the ground for; its approach range only decides
 * where the body stops, and the body is drawn wherever it is.
 *
 * A FUNCTION OF THE STAGE, not a constant: the blast radius is §2.2's "정예" axis, so a stage
 * with a bigger circle is a stage the camera has to guarantee more board for. `SOLDIER_RANGE`
 * and the margin are not a stage's.
 */
export function viewRequiredRadiusOf(stageId: StageId): number {
  return SOLDIER_RANGE + stageConfigOf(stageId).eliteBlastRadius + VIEW_MARGIN
}

/** Slack around a body the camera had to widen for, so it is inside the frame and not on it. */
export const VIEW_BODY_MARGIN = 1.5

/**
 * How long a dead body stays in the snapshot so the renderer can topple it.
 *
 * `BattleState` keeps every corpse for the whole run (§1.14 needs `deathTick`), and a
 * snapshot that carried all of them would grow one visual per kill — ~270 of them by tick
 * 2700 — and would drag the framing count off the sixteen bodies §4.4 is about. The renderer's
 * own death animation is 18 ticks; this is that, rounded up.
 */
export const DEATH_VISIBLE_TICKS = 24

const COMMAND_SQUAD: Squad = 'scarlet'
const SQUAD: Squad = 'teal'

const ENEMY_KIND_SILHOUETTE: Readonly<Record<EnemyKind, UnitKind>> = {
  melee: 'enemy',
  shooter: 'enemy-commander',
  elite: 'elite',
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function copy(position: Vec2): Vec2 {
  return { x: position.x, y: position.y }
}

/** A body the player can still see: standing, or down and worth running to. */
function isDrawnFriendly(unit: Readonly<FriendlyUnit>, tick: number): boolean {
  if (unit.life !== 'dead') return true
  return unit.deathTick !== null && tick - unit.deathTick <= DEATH_VISIBLE_TICKS
}

function isDrawnEnemy(unit: Readonly<EnemyUnit>, tick: number): boolean {
  if (unit.life === 'standing') return true
  return unit.deathTick !== null && tick - unit.deathTick <= DEATH_VISIBLE_TICKS
}

function friendlyState(
  state: Readonly<BattleState>,
  unit: Readonly<FriendlyUnit>,
): RenderUnit['state'] {
  if (unit.life === 'dead') return 'dead'
  if (unit.life === 'downed') return 'downed'
  if (state.rescue.active && unit.id === state.commandUnitId) return 'rescuing'
  return unit.targetId === null ? 'idle' : 'attacking'
}

function projectFriendly(state: Readonly<BattleState>, unit: Readonly<FriendlyUnit>): RenderUnit {
  const commands = unit.id === state.commandUnitId
  const squad = commands ? COMMAND_SQUAD : SQUAD
  return {
    id: unit.id,
    kind: commands ? 'commander' : 'soldier',
    team: squad,
    squad,
    x: unit.position.x,
    y: unit.position.y,
    facingRadians: 0,
    radius: commands ? 0.55 : 0.45,
    hp01: clamp01(unit.hp / unit.maxHp),
    fatigue01: 0,
    morale01: 1,
    state: friendlyState(state, unit),
  }
}

function projectEnemy(unit: Readonly<EnemyUnit>): RenderUnit {
  return {
    id: unit.id,
    kind: ENEMY_KIND_SILHOUETTE[unit.kind],
    team: 'enemy',
    squad: null,
    x: unit.position.x,
    y: unit.position.y,
    facingRadians: 0,
    radius: unit.kind === 'elite' ? 0.9 : 0.45,
    hp01: unit.life === 'standing' ? clamp01(unit.hp / unit.maxHp) : 0,
    fatigue01: 0,
    morale01: 1,
    state: unit.life === 'standing' && unit.targetId !== null ? 'attacking' : 'idle',
  }
}

/**
 * §4.4's framing, as the world rectangle the renderer is asked to guarantee.
 *
 * (a) is not a claim about the fifteen SLOTS — a follower that has fallen behind is still one
 * of the fifteen — so the rectangle is widened to whatever body is furthest out. Dead bodies
 * are left out because they are not drawn; including them would zoom the board out around a
 * corpse nobody can see.
 */
function frameAround(stageId: StageId, center: Vec2, bodies: readonly Vec2[]): {
  worldWidth: number
  worldHeight: number
} {
  const required = viewRequiredRadiusOf(stageId)
  let halfWidth = required
  let halfHeight = required
  for (const body of bodies) {
    halfWidth = Math.max(halfWidth, Math.abs(body.x - center.x) + VIEW_BODY_MARGIN)
    halfHeight = Math.max(halfHeight, Math.abs(body.y - center.y) + VIEW_BODY_MARGIN)
  }
  return { worldWidth: halfWidth * 2, worldHeight: halfHeight * 2 }
}

// ---------------------------------------------------------------------------
// THE PER-TICK CHANNEL (§액션 피드백)
// ---------------------------------------------------------------------------
// A blow is an EVENT, and `BattleState` holds no events: §1.17's no-scratch rule reserves the
// state for what a later tick reads, and one "attacks this tick" field would walk into all three
// seed digests and every recorded band. `advanceBattleTick` already hands its whole derived tick
// back as a `ResolvedTick`, so the channel is:
//
//     advanceBattleTick -> ResolvedTick -> the controller holds this frame's -> here
//
// which is why this function takes a SECOND ARGUMENT rather than reading anything new off the
// state. It is a display path: nothing here is authority, and `git diff -- src/core/battle` is
// empty for the whole of batch L.
//
// It is deliberately a STRUCTURAL type and not `ResolvedTick` itself. A `ResolvedTick` satisfies
// it — the controller passes one straight in, with no converter to drift — while this file stays
// honest about the three fields it actually reads, and a test can build one by hand.

/** What one resolved tick contributes to the screen. A `ResolvedTick` is one of these. */
export type BattleTickEvents = {
  readonly tick: number
  readonly damageEvents: readonly DamageEvent[]
  readonly transitions: {
    readonly enemyDeaths: readonly { readonly id: number }[]
    readonly friendlyDeaths: readonly number[]
    /**
     * §1.11's casualties, and they are NOT deaths. Read here only so that this comment can say
     * they were considered and left out: a downed body is the one §4.5 asks the player whether
     * to run for, and a body that has just burst into paper scraps is not a body anyone runs
     * for. The renderer already lays a downed figure on its side off `RenderUnit.state`.
     */
    readonly friendlyDowns: readonly number[]
  }
  /** §1.11's completion on this tick, or `null`. `ResolvedTick` has carried it since batch C. */
  readonly rescue?: { readonly targetId: number; readonly rescuerId: number } | null
}

/**
 * §액션 피드백 asks for a muzzle puff and it means a MUZZLE. The five authority causes carry the
 * distinction already, so the renderer never has to guess a weapon from a distance.
 *
 * `friendly-melee` (§1.4.2) is the reason the table is exhaustive over `DamageCause` rather than
 * a switch with a default: the day the authority grew a fifth weapon, `tsc` refused to compile
 * this file until the row existed. A default would have painted a muzzle puff on a blow landed
 * by hand, which is the exact thing §액션 피드백 forbids, and nothing would have failed.
 */
const ACTION_KIND_BY_CAUSE: Readonly<Record<DamageCause, RenderActionEventKind>> = {
  'friendly-attack': 'shot',
  'friendly-melee': 'melee',
  'shooter-shot': 'shot',
  'melee-contact': 'melee',
  'elite-blast': 'blast',
}

type BodyPoint = { readonly position: Vec2; readonly maxHp: number }

function bodyIndex(state: Readonly<BattleState>): Map<number, BodyPoint> {
  const index = new Map<number, BodyPoint>()
  for (const unit of state.friendlies) index.set(unit.id, unit)
  // Friendly ids run from 1 and enemy ids from `FIRST_ENEMY_ID`, so nothing is overwritten here.
  for (const enemy of state.enemies) index.set(enemy.id, enemy)
  return index
}

/**
 * The blows and the deaths of the ticks this frame ran, as display events.
 *
 * EVERY tick contributes and every event within it survives, in the authority's own order. That
 * is a choice, and the alternatives are worse: a browser frame regularly covers three ticks
 * (measured `steps: 3`), so "last tick only" would silently delete two thirds of every volley
 * and "merge per target" would turn three blows into one flash. Each event keeps its own `tick`,
 * which is what lets the renderer start a three-tick-old animation three ticks in rather than
 * restarting all of them at the frame edge.
 *
 * Positions are read from the state as it stands NOW — the end of the frame — not from where the
 * body was on the tick it fired. Sub-tick displacement is far below a figure's own width, and the
 * alternative is a lunge that starts somewhere the miniature visibly is not.
 */
function projectActionEvents(
  state: Readonly<BattleState>,
  ticks: readonly BattleTickEvents[],
): RenderActionEvent[] {
  if (ticks.length === 0) return []
  const events: RenderActionEvent[] = []
  const bodies = bodyIndex(state)

  const death = (tick: number, id: number): void => {
    const body = bodies.get(id)
    if (!body) return
    events.push({
      kind: 'death',
      tick,
      sourceId: null,
      sourceX: body.position.x,
      sourceY: body.position.y,
      targetId: id,
      targetX: body.position.x,
      targetY: body.position.y,
      strength01: 0,
    })
  }

  for (const resolved of ticks) {
    for (const blow of resolved.damageEvents) {
      const attacker = bodies.get(blow.attackerId)
      const target = bodies.get(blow.targetId)
      // Nothing is ever removed from `state.friendlies` or `state.enemies` — a corpse keeps its
      // slot for §1.14's `deathTick` — so within one run both lookups hold, and the guard is
      // here for a caller that mixed a tick from one battle with the state of another.
      if (!attacker || !target) continue
      events.push({
        kind: ACTION_KIND_BY_CAUSE[blow.cause],
        tick: resolved.tick,
        sourceId: blow.attackerId,
        sourceX: attacker.position.x,
        sourceY: attacker.position.y,
        targetId: blow.targetId,
        targetX: target.position.x,
        targetY: target.position.y,
        // Overkill is real in the authority and unpaintable: a flash cannot be 400% bright.
        strength01: target.maxHp > 0 ? clamp01(blow.amount / target.maxHp) : 0,
      })
    }
    for (const fallen of resolved.transitions.enemyDeaths) death(resolved.tick, fallen.id)
    for (const fallen of resolved.transitions.friendlyDeaths) death(resolved.tick, fallen)
    // §1.11's completion. `ResolvedTick.rescue` has carried it since batch C and nothing drew it,
    // so a body stood up in silence — the one beat in this game that costs a walk and 45 ticks of
    // standing still had no moment, while every blow and every death had one. `sourceId` is the
    // rescuer because the pair is the picture: somebody went and got somebody.
    if (resolved.rescue) {
      const revived = bodies.get(resolved.rescue.targetId)
      const rescuer = bodies.get(resolved.rescue.rescuerId)
      if (revived && rescuer) {
        events.push({
          kind: 'revive',
          tick: resolved.tick,
          sourceId: resolved.rescue.rescuerId,
          sourceX: rescuer.position.x,
          sourceY: rescuer.position.y,
          targetId: resolved.rescue.targetId,
          targetX: revived.position.x,
          targetY: revived.position.y,
          strength01: 1,
        })
      }
    }
  }
  return events
}

/**
 * The whole display state of one tick, for the renderer and nothing else.
 *
 * `ticks` is what the ticks THIS FRAME RAN resolved (see `projectActionEvents`). It defaults to
 * empty rather than to absent, so `actionEvents` is always published: the renderer reads the
 * presence of the array as "this projection accounts for every blow", and would otherwise fall
 * back to guessing hits out of `hp01` deltas and play each one twice.
 */
export function projectBattleSnapshot(
  state: Readonly<BattleState>,
  ticks: readonly BattleTickEvents[] = [],
): RenderSnapshot {
  const tick = state.combatTick
  const stage = stageConfigOf(state.stageId)
  const units: RenderUnit[] = []
  const framedBodies: Vec2[] = []
  // With no command unit on the board there is nothing to follow, so the camera sits on the
  // middle of the arena — which is a stage's rectangle now, not a module constant.
  let center: Vec2 = { x: stage.arenaWidth / 2, y: stage.arenaHeight / 2 }

  for (const unit of friendliesById(state)) {
    if (unit.id === state.commandUnitId) center = copy(unit.position)
    if (!isDrawnFriendly(unit, tick)) continue
    units.push(projectFriendly(state, unit))
    if (unit.life !== 'dead') framedBodies.push(unit.position)
  }

  for (const enemy of enemiesById(state)) {
    if (!isDrawnEnemy(enemy, tick)) continue
    units.push(projectEnemy(enemy))
  }

  const effects: RenderEffect[] = []
  const telegraphCenter = state.elite.telegraphCenter
  if (state.elite.attackPhase === 'telegraph' && telegraphCenter !== null) {
    effects.push({
      id: state.elite.enemyId ?? 0,
      kind: 'elite-telegraph',
      team: 'enemy',
      x: telegraphCenter.x,
      y: telegraphCenter.y,
      radius: stage.eliteBlastRadius,
      startedTick: tick,
      durationTicks: state.elite.telegraphRemaining,
    })
  }

  // EVERY BODY ON THE GROUND IS LIT, from the tick it falls until it stands or dies.
  //
  // The pickup pillar below is not this and cannot stand in for it: it attaches inside
  // `RESCUE_RANGE` 1.5, which is close enough that the decision has already been made. §1.4.1's
  // leash is 10.0 and §4.5's fourth question ("did you agonise over going back") lives in the
  // metres between — unmarked until now, which is why that question has never had an answer.
  //
  // `urgency01` carries §1.11's countdown because the countdown IS the decision: reach them
  // inside `DOWNED_TICKS` or they die. A light that says "someone is down" without saying "for
  // how much longer" leaves out the half that makes it a choice rather than a chore.
  for (const unit of state.friendlies) {
    if (unit.life !== 'downed') continue
    const remaining = Math.max(0, DOWNED_TICKS - unit.downedTicks)
    effects.push({
      id: unit.id,
      kind: 'downed-marker',
      team: SQUAD,
      x: unit.position.x,
      y: unit.position.y,
      startedTick: tick,
      durationTicks: remaining,
      urgency01: remaining / DOWNED_TICKS,
    })
  }

  // §1.11's two rescue reads, and they are two different things on screen. A lock in
  // progress marks BOTH ends, so the player can see who is being carried and who is stuck
  // carrying them. With no lock, the mark is the pickup highlight — the body `Space` would
  // pick up right now, which is the drawing `core/harness/policy/view.ts` made
  // `rescueCandidateId` conditional on.
  const rescueTargetId = state.rescue.active ? state.rescue.targetId : null
  const highlighted = rescueTargetId !== null
    ? [rescueTargetId, state.commandUnitId]
    : [rescueCandidateId(state)].filter((id): id is number => id !== null)
  for (const id of highlighted) {
    const unit = state.friendlies.find((body) => body.id === id)
    if (!unit) continue
    effects.push({
      id: unit.id,
      kind: 'rescue-signal',
      team: unit.id === state.commandUnitId ? COMMAND_SQUAD : SQUAD,
      x: unit.position.x,
      y: unit.position.y,
      startedTick: tick,
      durationTicks: Math.max(0, state.rescue.progress),
    })
  }

  return {
    tick,
    elapsedMs: (tick * 1000) / BATTLE_TICKS_PER_SECOND,
    units,
    projectiles: [],
    effects,
    actionEvents: projectActionEvents(state, ticks),
    camera: {
      centerX: center.x,
      centerY: center.y,
      ...frameAround(state.stageId, center, framedBodies),
    },
    // §1.7's arena, which is where play is confined and where the board's rail belongs. It is
    // NOT the camera rectangle: that follows the command unit, and a board drawn at its extent
    // paints a boundary that walks around with the player.
    playArea: {
      centerX: stage.arenaWidth / 2,
      centerY: stage.arenaHeight / 2,
      worldWidth: stage.arenaWidth,
      worldHeight: stage.arenaHeight,
    },
    // The renderer's diorama presentation is gated on this signal, and the command unit is
    // what wears it: the pulsing ring marks the body the player is driving.
    activeSquad: COMMAND_SQUAD,
  }
}
