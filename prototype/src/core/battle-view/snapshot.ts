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

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ELITE_BLAST_RADIUS,
  SOLDIER_RANGE,
} from '../battle/constants'
import { rescueCandidateId } from '../battle/rescue'
import { enemiesById, friendliesById } from '../battle/state'
import type {
  BattleState,
  EnemyKind,
  EnemyUnit,
  FriendlyUnit,
  Vec2,
} from '../battle/types'
import type { RenderEffect, RenderSnapshot, RenderUnit, Squad, UnitKind } from '../types'

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
 * 안". 정예 범위 is read as the blast footprint (`ELITE_BLAST_RADIUS`) — the elite's area
 * attack is the thing a player has to see the ground for; its approach range only decides
 * where the body stops, and the body is drawn wherever it is.
 */
export const VIEW_REQUIRED_RADIUS = SOLDIER_RANGE + ELITE_BLAST_RADIUS + VIEW_MARGIN

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
function frameAround(center: Vec2, bodies: readonly Vec2[]): {
  worldWidth: number
  worldHeight: number
} {
  let halfWidth = VIEW_REQUIRED_RADIUS
  let halfHeight = VIEW_REQUIRED_RADIUS
  for (const body of bodies) {
    halfWidth = Math.max(halfWidth, Math.abs(body.x - center.x) + VIEW_BODY_MARGIN)
    halfHeight = Math.max(halfHeight, Math.abs(body.y - center.y) + VIEW_BODY_MARGIN)
  }
  return { worldWidth: halfWidth * 2, worldHeight: halfHeight * 2 }
}

const ARENA_CENTER: Vec2 = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 }

/** The whole display state of one tick, for the renderer and nothing else. */
export function projectBattleSnapshot(state: Readonly<BattleState>): RenderSnapshot {
  const tick = state.combatTick
  const units: RenderUnit[] = []
  const framedBodies: Vec2[] = []
  let center: Vec2 = ARENA_CENTER

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
      radius: ELITE_BLAST_RADIUS,
      startedTick: tick,
      durationTicks: state.elite.telegraphRemaining,
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
    camera: { centerX: center.x, centerY: center.y, ...frameAround(center, framedBodies) },
    // The renderer's diorama presentation is gated on this signal, and the command unit is
    // what wears it: the pulsing ring marks the body the player is driving.
    activeSquad: COMMAND_SQUAD,
  }
}
