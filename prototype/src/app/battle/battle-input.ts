// DOM events to §1.15's inputs, by `event.code` and nothing else.
//
// THE WHOLE FILE IS KEYED ON `event.code` (§1.15: "모든 키는 `event.code`로 판정한다. IME 활성
// 상태에서도 동작해야 한다"). v1 shipped keyed on `event.key`, and a Korean IME reports `'ㅈ'`
// for the W key — every movement input in the game silently stopped working. `code` is the
// physical key and no IME rewrites it. There is no `key` fallback here on purpose: the fallback
// is what let the defect hide, and the facade takes codes anyway.
//
// §1.15's "OS 키 반복은 새 keydown이 아니다" is one line: a repeat returns before it reaches the
// battle. The queue would refuse a repeated movement key on its own, but `Space` and the card
// keys have no such guard, and a repeat there is a second press the player never made.

import { MOVE_KEY_VECTORS, PAUSE_KEY_CODE, RESCUE_KEY_CODE, UPGRADE_KEY_CODES } from '../../core/battle/input'
import type { BattleMode } from '../../core/battle/types'

/** Every code the battle answers to (§1.15). */
export const BATTLE_KEY_CODES: readonly string[] = [
  ...Object.keys(MOVE_KEY_VECTORS),
  RESCUE_KEY_CODE,
  ...UPGRADE_KEY_CODES,
  PAUSE_KEY_CODE,
]

const MOVE_CODES = new Set(Object.keys(MOVE_KEY_VECTORS))

export type BattleInputAdapterOptions = {
  readonly keyDown: (code: string) => void
  readonly keyUp: (code: string) => void
  readonly getMode: () => BattleMode
  readonly target?: Window
}

export interface BattleInputAdapter {
  attach(): void
  dispose(): void
}

/**
 * Which presses the page must not also act on.
 *
 * Arrow keys and `Space` scroll a document, and `Space` activates whatever button has focus —
 * the shell focuses one on every mode change, so an unguarded rescue key would restart the run.
 * Both are suppressed only while the battle is `running`, which is the one mode those keys mean
 * something in; in every other mode a keyboard-only player needs Space and the arrows to reach
 * and press the buttons the shell is showing.
 */
function shouldSuppress(code: string, mode: BattleMode): boolean {
  if (mode !== 'running') return false
  return MOVE_CODES.has(code) || code === RESCUE_KEY_CODE
}

export function createBattleInputAdapter(options: BattleInputAdapterOptions): BattleInputAdapter {
  const target = options.target ?? window
  let attached = false

  const onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code
    if (!BATTLE_KEY_CODES.includes(code)) return
    if (shouldSuppress(code, options.getMode())) event.preventDefault()
    // §1.15: a key the operating system is repeating for the player is not a new keydown, and
    // §1.11 must not get a second rescue-cancel event out of it.
    if (event.repeat) return
    options.keyDown(code)
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const code = event.code
    if (!BATTLE_KEY_CODES.includes(code)) return
    options.keyUp(code)
  }

  return {
    attach(): void {
      if (attached) return
      attached = true
      // Capture, so a focused button cannot swallow a movement key before the battle sees it.
      target.addEventListener('keydown', onKeyDown, true)
      target.addEventListener('keyup', onKeyUp, true)
    },
    dispose(): void {
      if (!attached) return
      attached = false
      target.removeEventListener('keydown', onKeyDown, true)
      target.removeEventListener('keyup', onKeyUp, true)
    },
  }
}
