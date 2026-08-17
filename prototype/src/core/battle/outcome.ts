// §1.16 승패 판정 — the verdict step (see the step table in `index.ts`).
//
// One rule, three clauses, in §1.16's stated priority: `won > lost > awaiting-upgrade`, with
// `all-units-lost > elite-survived` inside the defeat clause.
//
// It is its own module because the three clauses come from three different sections and no one
// of them owns the arbitration: §1.12 gives victory ("정예 처치 시 즉시 승리") and the timeout
// ("`tick 2700`까지 생존하면 패배"), §1.5 gives `all-units-lost`, and §1.13 gives the pause. The
// priority itself is §1.16's, and it is the whole reason this is not three `if`s scattered
// across three steps.
//
// It reads the transition step's RETURN VALUE rather than the state, because both defeat inputs
// are events of this tick: an elite row is `dead` for the rest of the run, so "the elite died"
// asked of the state would be true forever and could not be distinguished from "the elite died
// nine ticks ago", and `allUnitsLost` is not a field at all (see `types.ts`'s no-scratch rule).
//
// It runs AFTER the tick increment, which is what makes the timeout comparison exact: the run
// is over when the clock has reached `COMBAT_TICK_LIMIT`, so a kill that lands on the tick which
// becomes 2700 still wins — the priority above says so, and the fixture pins it.

import { COMBAT_TICK_LIMIT } from './constants'
import type { TransitionOutcome } from './transitions'
import { upgradeIsPending } from './upgrades'
import type { BattleState } from './types'

function eliteDied(transitions: Readonly<TransitionOutcome>): boolean {
  for (const death of transitions.enemyDeaths) {
    if (death.kind === 'elite') return true
  }
  return false
}

/**
 * The whole step. Writes `mode`, `result` and `failureReason` and nothing else — the transition
 * step deliberately leaves all three alone so that the verdict is decided in one place.
 *
 * A battle that is neither won, lost nor waiting for a card is left exactly as it was: this
 * function must not "helpfully" set `running`, because §1.15's `paused` is a mode it has no
 * business overwriting.
 */
export function resolveBattleOutcome(
  state: BattleState,
  transitions: Readonly<TransitionOutcome>,
): void {
  // §1.12: killing the elite ends the run immediately, ahead of every defeat — including a
  // roster that was wiped out in the same tick.
  if (eliteDied(transitions)) {
    state.mode = 'won'
    state.result = 'won'
    state.failureReason = null
    return
  }

  // §1.16: "패배 원인 우선순위: `all-units-lost` > `elite-survived`."
  if (transitions.allUnitsLost) {
    state.mode = 'lost'
    state.result = 'lost'
    state.failureReason = 'all-units-lost'
    return
  }

  if (state.combatTick >= COMBAT_TICK_LIMIT) {
    state.mode = 'lost'
    state.result = 'lost'
    state.failureReason = 'elite-survived'
    return
  }

  // §1.13: the battle waits here for `1` `2` `3`. §1.1 stops the clock in this mode, and
  // `chooseUpgradeCard` is what returns it to `running`.
  if (upgradeIsPending(state)) state.mode = 'awaiting-upgrade'
}
