import { beforeEach, describe, expect, it } from 'vitest'

import { createInitialBattleState } from '../../src/core/battle/state'
import type { BattleState } from '../../src/core/battle/types'
import { projectBattleHud, type BattleHud } from '../../src/core/battle-view/hud'
import { projectBattleSnapshot } from '../../src/core/battle-view/snapshot'
import type { BattleController } from '../../src/app/battle/battle-controller'
import { mountApp } from '../../src/app/battle/battle-shell'

type Calls = {
  begin: number
  restart: number
  togglePause: number
  upgrades: number[]
  keysDown: string[]
  keysUp: string[]
}

type Stub = {
  controller: BattleController
  calls: Calls
  publish(state: BattleState): void
}

function stubController(initial: BattleState): Stub {
  const calls: Calls = { begin: 0, restart: 0, togglePause: 0, upgrades: [], keysDown: [], keysUp: [] }
  let state = initial
  const listeners = new Set<(hud: BattleHud) => void>()

  const controller: BattleController = {
    start: async () => {},
    begin: () => {
      calls.begin += 1
    },
    restart: () => {
      calls.restart += 1
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hud: () => projectBattleHud(state),
    snapshot: () => projectBattleSnapshot(state),
    seed: () => 'stub',
    digest: () => 'stub-digest',
    keyDown: (code) => calls.keysDown.push(code),
    keyUp: (code) => calls.keysUp.push(code),
    pointerDrag: () => {},
    pointerRelease: () => {},
    chooseUpgrade: (slot) => calls.upgrades.push(slot),
    togglePause: () => {
      calls.togglePause += 1
    },
    inputLog: () => [],
    stepCount: () => 0,
    frameSamples: () => [],
    dispose: () => {},
  }

  return {
    controller,
    calls,
    publish(next: BattleState): void {
      state = next
      const hud = projectBattleHud(next)
      listeners.forEach((listener) => listener(hud))
    },
  }
}

function running(seed = 'shell-a'): BattleState {
  const state = createInitialBattleState(seed)
  state.mode = 'running'
  return state
}

function mount(state: BattleState): { root: HTMLElement; stub: Stub } {
  const root = document.createElement('div')
  document.body.append(root)
  const stub = stubController(state)
  mountApp(root, { createController: () => stub.controller })
  return { root, stub }
}

describe('the v2 shell prints the projection and sends §1.15 inputs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('opens on the ready screen with the stage mounted and the HUD away', () => {
    const { root } = mount(createInitialBattleState('shell-ready'))
    expect(root.querySelector<HTMLElement>('[data-battle-ready]')!.hidden).toBe(false)
    expect(root.querySelector<HTMLElement>('[data-battle-hud]')!.hidden).toBe(true)
    expect(root.querySelector('[data-battle-stage]')).not.toBeNull()
  })

  it('starts the run from the button a keyboard can reach', () => {
    const { root, stub } = mount(createInitialBattleState('shell-ready'))
    const begin = root.querySelector<HTMLButtonElement>('[data-battle-begin]')!
    expect(document.activeElement).toBe(begin)
    begin.click()
    expect(stub.calls.begin).toBe(1)
  })

  it('draws sixteen named chips with an hp bar that shows both halves', () => {
    const state = running()
    const hurt = state.friendlies.find((unit) => unit.id === 4)!
    hurt.hp = hurt.maxHp / 2
    const { root, stub } = mount(state)
    stub.publish(state)

    const chips = root.querySelectorAll<HTMLElement>('[data-roster-entry]')
    expect(chips).toHaveLength(16)
    const commandChips = [...chips].filter((chip) => chip.dataset.command === 'true')
    expect(commandChips).toHaveLength(1)
    expect(commandChips[0].textContent).toContain('★')

    const hurtChip = root.querySelector<HTMLElement>('[data-roster-entry="4"]')!
    expect(hurtChip.querySelector<HTMLElement>('.bt-roster-fill')!.style.width).toBe('50%')
    expect(hurtChip.querySelector<HTMLElement>('.bt-roster-bar')!.title)
      .toBe(`${hurt.hp.toFixed(2)} / ${hurt.maxHp.toFixed(2)}`)
  })

  it('marks the chip Space would pick up (§1.11)', () => {
    const state = running()
    const body = state.friendlies.find((unit) => unit.id === 6)!
    body.life = 'downed'
    body.position = { x: 28.4, y: 16 }
    const { root, stub } = mount(state)
    stub.publish(state)

    const marked = [...root.querySelectorAll<HTMLElement>('[data-roster-entry]')]
      .filter((chip) => chip.dataset.rescueCandidate === 'true')
      .map((chip) => chip.dataset.rosterEntry)
    expect(marked).toEqual(['6'])
    expect(root.querySelector('[data-battle-rescue]')!.textContent).toBe('Space로 구조')
  })

  it('says Space registered even with nobody to pick up', () => {
    const state = running()
    state.input.spaceHeld = true
    const { root, stub } = mount(state)
    stub.publish(state)
    expect(root.querySelector('[data-battle-rescue]')!.textContent).toBe('Space 유지 중 · 대상 없음')
  })

  it('reads a movement key by `event.code` even when an IME rewrote `event.key`', () => {
    const { stub } = mount(running())
    // The exact shape of the v1 defect: a Korean IME reports 'ㅈ' for the W key.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'ㅈ', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'ㅈ', bubbles: true }))
    expect(stub.calls.keysDown).toEqual(['KeyW'])
    expect(stub.calls.keysUp).toEqual(['KeyW'])
  })

  it('drops an OS key repeat, which §1.15 says is not a new keydown', () => {
    const { stub } = mount(running())
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true, bubbles: true }))
    expect(stub.calls.keysDown).toEqual(['Space'])
  })

  it('leaves keys this game does not use to the page', () => {
    const { stub } = mount(running())
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))
    expect(stub.calls.keysDown).toEqual([])
  })

  it('shows the three cards §1.13 offered, on the keys that choose them', () => {
    const state = running()
    state.mode = 'awaiting-upgrade'
    state.upgrades.rounds.push({ round: 1, tick: 300, offered: ['firepower', 'rapid', 'cohesion'], chosen: null })
    const { root, stub } = mount(state)
    stub.publish(state)

    expect(root.querySelector<HTMLElement>('[data-battle-upgrade]')!.hidden).toBe(false)
    expect(root.querySelector('[data-battle-card-name="1"]')!.textContent).toBe('화력')
    expect(root.querySelector('[data-battle-card-name="3"]')!.textContent).toBe('결속')
    root.querySelector<HTMLButtonElement>('[data-battle-card="2"]')!.click()
    expect(stub.calls.upgrades).toEqual([2])
  })

  it('builds §1.14 result screen and restarts from it', () => {
    const state = running()
    state.mode = 'lost'
    state.result = 'lost'
    state.failureReason = 'elite-survived'
    state.combatTick = 2700
    state.stats = { kills: 200, rescues: 2 }
    const fallen = state.friendlies.find((unit) => unit.id === 9)!
    fallen.life = 'dead'
    fallen.deathTick = 900
    const revived = state.friendlies.find((unit) => unit.id === 10)!
    revived.rescuedByIds = [1]

    const { root, stub } = mount(state)
    stub.publish(state)

    expect(root.querySelector('[data-battle-result-title]')!.textContent).toBe('패배')
    expect(root.querySelector('[data-battle-result-cause]')!.textContent)
      .toBe('제한 시간 안에 정예를 처치하지 못했습니다.')
    expect(root.querySelector('[data-battle-result-kills]')!.textContent).toBe('200')
    expect(root.querySelector('[data-battle-result-rescues]')!.textContent).toBe('2')
    expect(root.querySelector('[data-battle-result-elapsed]')!.textContent).toBe('90.0초')
    expect(root.querySelector('[data-battle-casualties]')!.textContent).toContain('30.0초')
    expect(root.querySelector('[data-battle-rescue-records]')!.textContent).toContain('←')
    expect(root.querySelector('[data-battle-result-commander]')!.textContent).toBe('생존')

    root.querySelector<HTMLButtonElement>('[data-battle-restart]')!.click()
    expect(stub.calls.restart).toBe(1)
  })

  it('never prints an enemy hit point, because §1 draws no enemy hp bar', () => {
    const state = running()
    state.combatTick = 1900
    const { root, stub } = mount(state)
    stub.publish(state)
    expect(root.textContent).not.toContain('정예 HP')
  })
})
