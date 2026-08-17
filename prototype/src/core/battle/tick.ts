// §1.16 — the sixteen rows of the tick table, as one reducer.
//
// THE TABLE ITSELF IS IN `index.ts`, and the bare numbers below are annotations on the ORDER;
// the names say what each row does.
//
// WHAT THE GUARD ACTUALLY ENFORCES, since a wrong reading of it is worse than none:
// `tests/battle/battle-step-numbers.test.ts` greps `src/core/battle` and `tests/battle` for the
// forms `step(s) N` and `N단계`, and allows them in the table alone. A bare `// 6` matches
// nothing, so the guard permits one in ANY file — it does not reserve the annotation style for
// this reducer, and nothing does. What keeps the numbers here is the table's own sentence and a
// reader who has read it.
//
// What this file adds that the sixteen functions could not:
//
//   * THE ORDER, which is a rule and not an implementation detail — §1.16 exists because 구조
//     진행 after 피해 적용 and 구조 lock 판정 before 이동 are the two placements that make
//     §1.11 expressible without a lag field.
//   * THE FOUR CHOICES NO TYPE ENFORCES. `resolveSpawnRequests` where `resolveEnemyArrivals`
//     belongs, `advanceEnemyMovement` where `advanceAllEnemyMovement` belongs, a permuted
//     damage list, and a second `resolveTransitions` call for the verdict all type-check
//     perfectly. `tests/battle/battle-tick.test.ts` runs a whole battle and fails on each.
//   * §1.1's CLOCK GATE. "`paused`·`awaiting-upgrade`·hidden에서 증가하지 않는다" is not a
//     property any single rule can hold; it is a property of the loop, and putting it here
//     rather than in the facade means every driver — controller, harness, fixture — gets it.
//     `hidden` is the one this file cannot see: a visibility state is the shell's, and the
//     honest statement is that the core stops on the two modes it owns and batch G must not
//     call this while the tab is hidden. Nothing here can check that for it.
//
// WHAT IT RETURNS AND WHY. Every derived value of the tick is handed back rather than stored:
// `types.ts` reserves `BattleState` for what a LATER tick reads, and a trace field would change
// every digest in the project. I2 wants `damage.damageToFriendlies`, I6 wants the accounting,
// I13 wants the rescue completion, and batch F's policies want the transitions — all of it is
// here, none of it is state.

import { resolveEnemyAttacks, resolveFriendlyAttacks, advanceCooldowns } from './attacks'
import { applyDamage, type DamageOutcome } from './damage'
import { advanceAllEnemyMovement, resolveEliteCycle, resolveEnemyArrivals } from './elite'
import { applyBattleCommands, type BattleCommandSource, type InputApplication } from './input'
import { advanceCommandUnit, advanceMovement } from './movement'
import { resolveBattleOutcome } from './outcome'
import { advanceRescueProgress, resolveRescueLock, type RescueCompletion } from './rescue'
import { advanceTargeting } from './targeting'
import { resolveTransitions, type TransitionOutcome } from './transitions'
import { resolveKillAccounting, type UpgradeAccounting } from './upgrades'
import type { BattleMode, BattleState, DamageEvent } from './types'

/** A tick the clock gate refused. The commands were still applied — that is how a pause lifts. */
export type SkippedTick = {
  ran: false
  /** The mode that refused it, after the input was applied. */
  mode: BattleMode
  input: InputApplication
}

/**
 * A tick that ran, and everything it derived.
 *
 * A discriminated union rather than `TickTrace | null`, so that reading `transitions` off a
 * tick that never happened is a type error instead of a crash in a harness at seed 6.
 */
export type ResolvedTick = {
  ran: true
  /** The tick these rows resolved — the value BEFORE the increment, which is what §1.13's
   * round records and what I6 replays against. */
  tick: number
  input: InputApplication
  /** The command unit's actual displacement, arena clamp included. */
  commandDisplacement: number
  /** The three attack sources concatenated in §1.16's order, exactly as applied. */
  damageEvents: DamageEvent[]
  damage: DamageOutcome
  rescue: RescueCompletion | null
  transitions: TransitionOutcome
  accounting: UpgradeAccounting
}

export type TickResult = SkippedTick | ResolvedTick

/**
 * One tick of the battle, or none.
 *
 * `source` has no default. Batch C made `resolveRescueLock`'s events argument required so
 * that a loop which never wires §1.11's movement keydown cannot compile; the same argument
 * applies one level up, and this is the only place the events can be produced — they are the
 * return value of applying THIS tick's input, and nothing else in the project knows them.
 *
 * IT IS A SOURCE AND NOT AN ARRAY for the same reason. §1.15's pause release has a state half
 * and a device half, and a driver that hands over `queue.drain()` gets the first without the
 * second: the battle forgets the axis, the queue does not forget the keys, and the next press
 * comes out carrying a direction nobody is holding. `BattleInputQueue` is a source; a hand-built
 * batch becomes one through `commandBatch`, whose `applied` is a no-op because an array has no
 * device state to release. Passing the array itself does not type-check.
 */
export function advanceBattleTick(state: BattleState, source: BattleCommandSource): TickResult {
  // 1
  const input = applyBattleCommands(state, source.drain())
  // The device half of §1.15's pause release, before the gate below can return: it is part of
  // applying the input, not part of running the tick, and a paused tick runs nothing.
  source.applied(input)

  // §1.1: the clock does not advance in `paused` or `awaiting-upgrade` — nor before the run
  // starts, nor after it has a verdict. The input above has already landed, which is what lets
  // an `Escape` lift a pause and a card resume the battle on the very tick it unblocks.
  if (state.mode !== 'running') return { ran: false, mode: state.mode, input }

  const tick = state.combatTick

  // 2 — the composer, so the elite lands here too (§1.12) and tick 1800's draw order is fixed.
  resolveEnemyArrivals(state)
  // 3 — before movement, so the first locked tick already produces none.
  resolveRescueLock(state, input.events)
  // 4
  const commandDisplacement = advanceCommandUnit(state)
  // 5 — the composed enemy rule, so §1.12's approach runs and not only §1.9's two classes.
  advanceMovement(state, advanceAllEnemyMovement)
  // 6 — every standing body, unconditionally (§1.3).
  advanceCooldowns(state)
  // 7
  advanceTargeting(state)
  // 8, 9, 10 — the list is the concatenation of the three sources IN THIS ORDER, and 11
  // applies it in the order it is given.
  const damageEvents = [
    ...resolveFriendlyAttacks(state),
    ...resolveEnemyAttacks(state),
    ...resolveEliteCycle(state),
  ]
  // 11
  const damage = applyDamage(state, damageEvents)
  // 12 — reads the 피격 of THIS tick out of 11's outcome (§1.11).
  const rescue = advanceRescueProgress(state, damage)
  // 13
  const transitions = resolveTransitions(state)
  // 14 and 16 both read 13's return value: the kill count and the verdict are both facts
  // about the deaths of this tick, and asking the state again would answer "ever".
  const accounting = resolveKillAccounting(state, transitions)
  // 15
  state.combatTick += 1
  // 16
  resolveBattleOutcome(state, transitions)

  return {
    ran: true,
    tick,
    input,
    commandDisplacement,
    damageEvents,
    damage,
    rescue,
    transitions,
    accounting,
  }
}
