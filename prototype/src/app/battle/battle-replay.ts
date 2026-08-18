// §4.3's input log, and the one function that applies it.
//
// "같은 seed·같은 입력 로그를 헤드리스 재생과 실시간 브라우저 재생에서 돌려 승패와 종료
// tick이 일치해야 한다." That is a comparison of two DRIVERS, so both have to push the same
// events through the same public verbs of the same facade. This module is those verbs, named
// once: the controller records what it did, and a replay does it again.
//
// IT RECORDS DEVICE EVENTS, NOT COMMANDS. `BattleInputQueue` owns which keys are down, and the
// `set-move` a key produces is a function of that set — so a log of commands would replay
// correctly only while the queue's device state happened to agree, and §1.15's pause release
// exists precisely to make it disagree. A log of key events rebuilds the set as it goes: the
// queue only remembers a key it ACCEPTED, so recording the accepted events and replaying them
// through the same verbs reconstructs the same held set, tick for tick.
//
// The step index, not `combatTick`, is what an entry is filed under. §1.1 stops the clock in
// `paused` and `awaiting-upgrade`, so several steps can share one tick and a tick-indexed log
// would collapse them into one batch — which applies §1.15's same-batch pause discard to
// commands that were never in the same batch.

import type { Battle } from '../../core/battle/battle'
import type { BattleCommand, PointerPhase } from '../../core/battle/input'
import type { Vec2 } from '../../core/battle/types'
import { projectBattleHud } from '../../core/battle-view/hud'

export type BattleInputEvent =
  | { kind: 'keyDown'; code: string }
  | { kind: 'keyUp'; code: string }
  | { kind: 'pointerDrag'; offset: Vec2; phase: PointerPhase }
  | { kind: 'pointerRelease' }
  /** A command with no device behind it — a button on the shell, or the hidden-tab pause. */
  | { kind: 'command'; command: BattleCommand }

/** One accepted input, against the step number it was accepted on. */
export type RecordedInput = { step: number; event: BattleInputEvent }

/** Push one recorded event at a battle. Returns whether §1.15 accepted it. */
export function applyBattleInput(battle: Battle, event: BattleInputEvent): boolean {
  switch (event.kind) {
    case 'keyDown':
      return battle.keyDown(event.code)
    case 'keyUp':
      return battle.keyUp(event.code)
    case 'pointerDrag':
      return battle.pointerDrag(event.offset, event.phase)
    case 'pointerRelease':
      return battle.pointerRelease()
    case 'command':
      return battle.enqueue(event.command)
  }
}

export type ReplayResult = {
  outcome: 'won' | 'lost' | 'undecided'
  endTick: number
  digest: string
}

/**
 * Re-run a log against a fresh battle of the same seed, one step at a time.
 *
 * `steps` is the number of steps the recorded run took, not the number of ticks: the loop has
 * to reproduce the paused and card-screen steps too, or the two runs stop being the same run.
 */
export function replayBattleInput(
  battle: Battle,
  log: readonly RecordedInput[],
  steps: number,
): ReplayResult {
  battle.start()
  for (let step = 0; step < steps; step += 1) {
    for (const entry of log) {
      if (entry.step === step) applyBattleInput(battle, entry.event)
    }
    battle.step()
  }
  const mode = battle.mode()
  return {
    outcome: mode === 'won' || mode === 'lost' ? mode : 'undecided',
    // Through the projection, like every other read outside the core (§6).
    endTick: projectBattleHud(battle.state()).tick,
    digest: battle.digest(),
  }
}
