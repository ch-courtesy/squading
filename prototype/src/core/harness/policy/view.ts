// The observation projection §4.1's policies read (batch F).
//
// A POLICY NEVER READS `BattleState`. It reads what `projectPolicyView` builds, and nothing
// else. The reason is §4.1 itself: each policy stands in for a PLAYER, and the invariants are
// claims about what a player can and cannot do. A policy that reads a shooter's cooldown dodges
// on a frame no human could see, and an I4 that passes on the strength of that dodge is a claim
// about the harness rather than about the game.
//
// ---------------------------------------------------------------------------
// WHAT IS IN THE VIEW, and why each item is something the player has
// ---------------------------------------------------------------------------
//   tick, mode              the HUD's clock and the pause/card screen the player is looking at.
//   ticksRemaining          §1.1's 90-second limit counted down; a run clock is on screen.
//   command                 the body the player drives — position, hp/maxHp (an hp bar shows
//                           both), `life`, and the downed countdown §1.11 races.
//   friendlies              the other fifteen, same fields plus `slotIndex`: §1.4's formation is
//                           drawn, so which body sits in which slot is visible geometry.
//   enemies                 position and `kind` for every LIVING enemy. Shape and place are
//                           what a body on screen is; the list omits the dead because a dead
//                           body is not drawn.
//   eliteTelegraph          §1.12's warning circle — centre and radius, the two numbers that
//                           make it a circle on the ground. Null when no telegraph is running.
//   rescue                  §1.11's lock in progress: its target and its progress bar.
//   rescueCandidateId       which body `Space` would pick up. `rescue.ts` states that the
//                           renderer has to show this, and it is a function of positions the
//                           view already carries.
//   pendingUpgrade          §1.13's three offered cards — the card screen, literally.
//   kills                   §1.13's kill counter, which the upgrade thresholds are read off.
//
// ---------------------------------------------------------------------------
// WHAT IS NOT IN THE VIEW, and why each one is not on the screen
// ---------------------------------------------------------------------------
//   enemy hp / maxHp        no enemy hp bar is specified anywhere in §1; "this one is nearly
//                           dead" is not a fact the player is handed.
//   enemy attackCooldown    the frame an enemy will fire on. Reading it buys a dodge no human
//                           reaction time can produce, which is the defect this file exists for.
//   enemy targetId,         §1.9's slot bookkeeping. It says who is about to be shot before the
//   contactSlotOwnerId      shot; the player learns it by being shot.
//   friendly attackCooldown the same argument on the friendly side, and no §1 rule draws it.
//   friendly targetId       likewise: which body is shooting which enemy is not a drawn line.
//   telegraph countdown     §1.12 fixes the circle's centre and radius as the warning. It does
//                           not say the remaining ticks are displayed, so a policy that timed
//                           its exit to the frame would be assuming a HUD nobody specified.
//   spawn backlog, the      §1.10's supply schedule. Knowing where the next wave is queued is
//   next request tick,      knowing the future; the player sees enemies when they arrive.
//   discard counters
//   prng stream state       §1.17's streams. The whole rest of the run, in three numbers.
//   remaining card pool     §1.13 deals three cards from what is left. The order of the rest is
//                           the next card screen, before it happens.
//   rootSeed                names the run; a policy that keyed off it would be a lookup table.
//
// The two lists above are the standard for adding a field later: not "is it useful" but "is it
// on the screen". `tests/harness/policy-view.test.ts` pins both — the key set of every row, and
// the named absences.
//
// THE PROJECTION DOES NOT WRITE. Every position is copied and every array is rebuilt, so a
// policy cannot reach back through the view and move a body. The fixture asserts that by digest.

import {
  COMBAT_TICK_LIMIT,
  DOWNED_TICKS,
  ELITE_BLAST_RADIUS,
  type CardId,
} from '../../battle/constants'
import { rescueCandidateId } from '../../battle/rescue'
import { enemiesById, friendliesById } from '../../battle/state'
import { pendingUpgradeRound } from '../../battle/upgrades'
import type {
  BattleMode,
  BattleState,
  EnemyKind,
  FriendlyUnit,
  LifeState,
  Vec2,
} from '../../battle/types'

/** A body on the friendly side, as the screen shows it. */
export type FriendlyView = {
  id: number
  /**
   * §1.4's slot this body follows, or null for the body the player is driving — the command
   * unit has no slot to follow, it IS the centre the slots hang off.
   */
  slotIndex: number | null
  position: Vec2
  hp: number
  maxHp: number
  life: LifeState
  /**
   * §1.11's countdown, or 0 for a body that is not downed.
   *
   * `life` rather than a `downed` boolean because a boolean reports a DEAD body as `false`,
   * which reads as "fine" — the one state where the difference decides whether running over
   * there is worth anything.
   */
  downedTicksRemaining: number
}

/** A living enemy, as the screen shows it: a shape in a place. */
export type EnemyView = {
  id: number
  kind: EnemyKind
  position: Vec2
}

/** §1.12's warning circle while it is on the ground. */
export type EliteTelegraphView = {
  center: Vec2
  radius: number
}

/** §1.11's lock in progress. */
export type RescueView = {
  targetId: number
  progress: number
}

/** §1.13's card screen. */
export type UpgradeChoiceView = {
  round: number
  offered: readonly CardId[]
}

export type PolicyView = {
  tick: number
  mode: BattleMode
  ticksRemaining: number
  /** Null only if no body holds command, which §1.5 makes a one-tick or terminal state. */
  command: FriendlyView | null
  /** The rest of the roster — fifteen rows for §1.4's fifteen slots. */
  friendlies: readonly FriendlyView[]
  enemies: readonly EnemyView[]
  eliteTelegraph: EliteTelegraphView | null
  rescue: RescueView | null
  rescueCandidateId: number | null
  pendingUpgrade: UpgradeChoiceView | null
  kills: number
}

function copyPosition(position: Vec2): Vec2 {
  return { x: position.x, y: position.y }
}

function slotIndexOf(state: Readonly<BattleState>, unitId: number): number | null {
  for (const assignment of state.slotAssignments) {
    if (assignment.unitId === unitId) return assignment.slotIndex
  }
  return null
}

function projectFriendly(state: Readonly<BattleState>, unit: FriendlyUnit): FriendlyView {
  return {
    id: unit.id,
    slotIndex: slotIndexOf(state, unit.id),
    position: copyPosition(unit.position),
    hp: unit.hp,
    maxHp: unit.maxHp,
    life: unit.life,
    downedTicksRemaining: unit.life === 'downed' ? DOWNED_TICKS - unit.downedTicks : 0,
  }
}

/**
 * The read-only projection a policy decides from.
 *
 * Rows come out in ascending id — the order every tie-break in §1.5, §1.8 and §1.9 uses — so a
 * policy that walks the list and keeps the first match breaks ties the way the rules do.
 */
export function projectPolicyView(state: Readonly<BattleState>): PolicyView {
  let command: FriendlyView | null = null
  const friendlies: FriendlyView[] = []

  for (const unit of friendliesById(state)) {
    const projected = projectFriendly(state, unit)
    if (unit.id === state.commandUnitId) command = projected
    else friendlies.push(projected)
  }

  const enemies: EnemyView[] = []
  for (const enemy of enemiesById(state)) {
    if (enemy.life !== 'standing') continue
    enemies.push({ id: enemy.id, kind: enemy.kind, position: copyPosition(enemy.position) })
  }

  const telegraphCenter = state.elite.telegraphCenter
  const eliteTelegraph =
    state.elite.attackPhase === 'telegraph' && telegraphCenter !== null
      ? { center: copyPosition(telegraphCenter), radius: ELITE_BLAST_RADIUS }
      : null

  const round = pendingUpgradeRound(state)

  return {
    tick: state.combatTick,
    mode: state.mode,
    ticksRemaining: COMBAT_TICK_LIMIT - state.combatTick,
    command,
    friendlies,
    enemies,
    eliteTelegraph,
    rescue:
      state.rescue.active && state.rescue.targetId !== null
        ? { targetId: state.rescue.targetId, progress: state.rescue.progress }
        : null,
    rescueCandidateId: rescueCandidateId(state),
    pendingUpgrade: round === null ? null : { round: round.round, offered: [...round.offered] },
    kills: state.stats.kills,
  }
}
