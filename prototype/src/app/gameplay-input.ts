import type { BattleMode, GameInputEvent, Vec2 } from '../core/gameplay/types'

const MOVE_KEYS: Record<string, readonly [number, number]> = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
}

const UPGRADE_KEYS: Record<string, 0 | 1 | 2> = { '1': 0, '2': 1, '3': 2 }

export type GameplayInputAdapterOptions = {
  readonly getTick: () => number
  readonly getMode: () => BattleMode
  readonly emit: (event: GameInputEvent) => void
  readonly nextSequence?: () => number
  readonly canSwitch?: () => boolean
  readonly target?: Window
}

export interface GameplayInputAdapter {
  attach(): void
  clearPersistent(): void
  pointerDown(target: Vec2): void
  pointerMove(target: Vec2): void
  pointerEnd(): void
  currentMovement(): Vec2
  dispose(): void
}

const ZERO: Vec2 = { x: 0, y: 0 }

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y)
  if (length === 0) return ZERO
  return { x: vector.x / length, y: vector.y / length }
}

function vecEquals(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y
}

// `event.key` carries the *typed character*, so a Korean IME reports 'ㅈ' for the W key
// and 'ㅂ' for Q and every movement and squad-switch input silently stops working — the
// state the game shipped in. `event.code` is the physical key and is layout- and
// IME-independent, so it is the primary source; `event.key` remains the fallback for
// events that carry no code (jsdom-dispatched test events, synthetic input).
const CODE_ALIASES: Record<string, string> = {
  KeyW: 'w',
  KeyA: 'a',
  KeyS: 's',
  KeyD: 'd',
  KeyQ: 'q',
  Space: ' ',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Numpad1: '1',
  Numpad2: '2',
  Numpad3: '3',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Tab: 'Tab',
  Escape: 'Escape',
}

// Lowercase single-character keys so Shift/CapsLock ('D' vs 'd') can't desync a
// keydown from its matching keyup and leave a movement key stuck in `pressedKeys`.
// Multi-character key names (Arrow*, Tab, Escape, ...) pass through unchanged.
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

function resolveKey(event: KeyboardEvent): string {
  return CODE_ALIASES[event.code] ?? normalizeKey(event.key)
}

export function createGameplayInputAdapter(options: GameplayInputAdapterOptions): GameplayInputAdapter {
  const target = options.target ?? window
  let localSequence = 0
  const nextSequence = options.nextSequence ?? (() => localSequence++)
  const canSwitch = options.canSwitch ?? (() => true)

  const pressedKeys = new Set<string>()
  let pointerActive = false
  let pointerTarget: Vec2 = ZERO
  let rescueHeld = false
  let lastEmittedMovement: Vec2 = ZERO
  let attached = false

  const isRunning = (): boolean => options.getMode() === 'running'

  const computeMovement = (): Vec2 => {
    if (pressedKeys.size > 0) {
      let x = 0
      let y = 0
      for (const key of pressedKeys) {
        const axis = MOVE_KEYS[key]
        if (!axis) continue
        x += axis[0]
        y += axis[1]
      }
      return normalize({ x, y })
    }
    if (pointerActive) return pointerTarget
    return ZERO
  }

  const syncMovement = (): void => {
    if (!isRunning()) return
    const movement = computeMovement()
    if (vecEquals(movement, lastEmittedMovement)) return
    lastEmittedMovement = movement
    options.emit({ applyTick: options.getTick(), sequence: nextSequence(), kind: 'set-move', x: movement.x, y: movement.y })
  }

  const setRescueHeld = (held: boolean): void => {
    if (rescueHeld === held) return
    rescueHeld = held
    if (!isRunning()) return
    options.emit({ applyTick: options.getTick(), sequence: nextSequence(), kind: 'set-rescue', held })
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = resolveKey(event)
    // Tab doubles as squad-switch only while running, so only swallow the browser's
    // native focus-cycling then. Every other mode (ready/paused/awaiting-upgrade/
    // won/lost) must leave Tab alone so a keyboard-only player can reach the
    // start/resume/upgrade/restart buttons the shell renders.
    if (key === 'Tab' && isRunning()) event.preventDefault()
    if (key in MOVE_KEYS) {
      event.preventDefault()
      if (!isRunning()) return
      pressedKeys.add(key)
      syncMovement()
      return
    }
    if (key === ' ') {
      event.preventDefault()
      if (event.repeat) return
      if (!isRunning()) return
      setRescueHeld(true)
      return
    }
    if (key === 'q' || key === 'Tab') {
      if (event.repeat) return
      if (!isRunning()) return
      if (!canSwitch()) return
      options.emit({ applyTick: options.getTick(), sequence: nextSequence(), kind: 'switch-squad' })
      return
    }
    if (key in UPGRADE_KEYS) {
      if (event.repeat) return
      if (options.getMode() !== 'awaiting-upgrade') return
      options.emit({ applyTick: options.getTick(), sequence: nextSequence(), kind: 'choose-upgrade', index: UPGRADE_KEYS[key] })
      return
    }
    if (key === 'Escape') {
      if (event.repeat) return
      const mode = options.getMode()
      if (mode !== 'running' && mode !== 'paused') return
      options.emit({ applyTick: options.getTick(), sequence: nextSequence(), kind: 'toggle-pause' })
    }
  }

  const onKeyUp = (event: KeyboardEvent): void => {
    const key = resolveKey(event)
    if (key in MOVE_KEYS) {
      pressedKeys.delete(key)
      syncMovement()
      return
    }
    if (key === ' ') setRescueHeld(false)
  }

  return {
    attach() {
      if (attached) return
      attached = true
      target.addEventListener('keydown', onKeyDown, true)
      target.addEventListener('keyup', onKeyUp)
    },
    clearPersistent() {
      pressedKeys.clear()
      pointerActive = false
      pointerTarget = ZERO
      rescueHeld = false
      lastEmittedMovement = ZERO
    },
    pointerDown(point) {
      if (!isRunning()) return
      pointerActive = true
      pointerTarget = point
      syncMovement()
    },
    pointerMove(point) {
      if (!pointerActive || !isRunning()) return
      pointerTarget = point
      syncMovement()
    },
    pointerEnd() {
      pointerActive = false
      pointerTarget = ZERO
      syncMovement()
    },
    currentMovement() {
      return computeMovement()
    },
    dispose() {
      if (!attached) return
      attached = false
      target.removeEventListener('keydown', onKeyDown, true)
      target.removeEventListener('keyup', onKeyUp)
    },
  }
}
