import { afterEach, expect, test } from 'vitest'

import { mountApp } from '../src/app/gameplay-shell'
import { rescueTicks } from '../src/core/gameplay/rescue'
import type { GameState } from '../src/core/gameplay/types'
import { createGameplayControllerStub } from './helpers/gameplay-controller-stub'

let root: HTMLDivElement

afterEach(() => {
  document.body.innerHTML = ''
})

function mount() {
  root = document.createElement('div')
  document.body.append(root)
  const controller = createGameplayControllerStub()
  mountApp(root, { createController: () => controller })
  return { root, controller }
}

function clone(state: GameState): GameState {
  return structuredClone(state)
}

test('shows the complete objective and controls before start', () => {
  const { root } = mount()
  expect(root.textContent).toContain('30초 안에 정예 지휘관을 쓰러뜨리십시오.')
  expect(root.textContent).toContain('WASD / 방향키 / 포인터 드래그')
  expect(root.textContent).toContain('Q 또는 Tab')
  expect(root.textContent).toContain('쓰러진 병사 곁에서 Space 유지')
})

test('never exposes renderer selection or performance HUD copy', () => {
  const { root } = mount()
  expect(root.textContent).not.toContain('Phaser 2D')
  expect(root.textContent).not.toMatch(/FPS|드로우콜|JSON 내보내기/)
})

test('renders running HUD fields from authority state', () => {
  const { root, controller } = mount()
  const state = clone(controller.getState())
  state.mode = 'running'
  state.combatTick = 300
  state.activeSquad = 'scarlet'
  state.switchCooldown = 45
  state.stats = { kills: 4, xp: 5, rescues: 1 }
  state.squads.teal.fatigue = 0.42
  state.squads.scarlet.fatigue = 0.1
  state.elite.spawned = true
  state.elite.hp = 10
  const rescuer = state.friendlies.find((friendly) => friendly.squad === 'scarlet' && friendly.id !== 9)!
  rescuer.rescueTargetId = 9
  rescuer.rescueProgress = 12
  controller.publish(state)

  expect(root.querySelector('[data-ready]')?.hasAttribute('hidden')).toBe(true)
  expect(root.querySelector('[data-hud]')?.hasAttribute('hidden')).toBe(false)
  expect(root.querySelector('[data-remaining]')?.textContent).toContain('20.0')
  expect(root.querySelector('[data-active-squad]')?.textContent).toContain('주홍')
  expect(root.querySelector('[data-squad-status="teal"]')?.textContent).toContain('42%')
  expect(root.querySelector('[data-squad-status="scarlet"]')?.textContent).toContain('10%')
  expect(root.querySelector('[data-switch-cooldown]')?.textContent).toContain('1.5')
  expect(root.querySelector('[data-xp]')?.textContent).toContain('5 / 16')
  // Pins both the rescue target id and the squad-specific rescueTicks() denominator,
  // not just "some digits appear" — this is the spec's exact "구조 대상·진행도" contract.
  expect(root.querySelector('[data-rescue]')?.textContent).toBe(`#9 구조 중 12/${rescueTicks('scarlet')}`)
  expect(root.querySelector('[data-elite-hp]')?.textContent).toContain('10.0')
})

test('shows the exact switch warning only while the active squad has zero standing', () => {
  const { root, controller } = mount()
  const state = clone(controller.getState())
  state.mode = 'running'
  state.activeSquad = 'scarlet'
  for (const friendly of state.friendlies) {
    if (friendly.squad === 'scarlet') friendly.life = 'dead'
  }
  controller.publish(state)

  expect(root.querySelector('[data-switch-warning]')?.hasAttribute('hidden')).toBe(false)
  expect(root.textContent).toContain('Q로 분대를 전환하세요')

  const recovered = clone(controller.getState())
  for (const friendly of recovered.friendlies) {
    if (friendly.squad === 'scarlet') friendly.life = 'standing'
  }
  controller.publish(recovered)

  expect(root.querySelector('[data-switch-warning]')?.hasAttribute('hidden')).toBe(true)
})

test('covers the battlefield with a paused overlay while keeping the HUD readable', () => {
  const { root, controller } = mount()
  const state = clone(controller.getState())
  state.mode = 'paused'
  controller.publish(state)

  expect(root.querySelector('[data-pause]')?.hasAttribute('hidden')).toBe(false)
  expect(root.querySelector('[data-hud]')?.hasAttribute('hidden')).toBe(false)
  expect(root.querySelector('[data-ready]')?.hasAttribute('hidden')).toBe(true)
})

test('renders the three offered upgrade cards with 1/2/3 keys and dispatches the chosen index', () => {
  const { root, controller } = mount()
  const chosen: number[] = []
  controller.chooseUpgrade = (index) => chosen.push(index)
  const state = clone(controller.getState())
  state.mode = 'awaiting-upgrade'
  state.upgrade = { offered: ['march', 'vigor', 'power'], choice: null, applied: false }
  controller.publish(state)

  const cards = root.querySelectorAll('[data-upgrade-choice]')
  expect(cards).toHaveLength(3)
  expect(root.querySelector('[data-upgrade-choice="0"]')?.textContent).toContain('1')
  expect(root.querySelector('[data-upgrade-choice="1"]')?.textContent).toContain('2')
  expect(root.querySelector('[data-upgrade-choice="2"]')?.textContent).toContain('3')

  root.querySelector<HTMLButtonElement>('[data-upgrade-choice="1"]')?.click()
  expect(chosen).toEqual([1])
})

test('shows the exact win terminal cause with kills, rescues, survivors and the chosen upgrade', () => {
  const { root, controller } = mount()
  const state = clone(controller.getState())
  state.mode = 'won'
  state.stats = { kills: 30, xp: 16, rescues: 2 }
  state.upgrade = { offered: ['power', 'march', 'vigor'], choice: 'power', applied: true }
  state.friendlies[0].life = 'dead'
  controller.publish(state)

  expect(root.querySelector('[data-terminal]')?.hasAttribute('hidden')).toBe(false)
  expect(root.querySelector('[data-kills]')?.textContent).toContain('30')
  expect(root.querySelector('[data-rescues]')?.textContent).toContain('2')
  expect(root.querySelector('[data-survivors]')?.textContent).toContain('15')
  expect(root.querySelector('[data-choice]')?.textContent).toContain('화력 강화')
})

test('shows a distinct terminal cause for each loss reason and restarts to the ready screen', () => {
  const { root, controller } = mount()
  const state = clone(controller.getState())
  state.mode = 'lost'
  state.failureReason = 'all-units-lost'
  controller.publish(state)
  expect(root.querySelector('[data-terminal-cause]')?.textContent).toContain('쓰러졌습니다')

  const timedOut = clone(controller.getState())
  timedOut.mode = 'lost'
  timedOut.failureReason = 'elite-survived'
  controller.publish(timedOut)
  expect(root.querySelector('[data-terminal-cause]')?.textContent).toContain('처치하지 못했습니다')

  root.querySelector<HTMLButtonElement>('[data-restart]')?.click()
  expect(root.querySelector('[data-ready]')?.hasAttribute('hidden')).toBe(false)
  expect(root.textContent).toContain('30초 안에 정예 지휘관을 쓰러뜨리십시오.')
})

test('focuses each mode\'s primary button on mount and on every mode transition, so Enter/Space can drive it without a mouse', () => {
  const { root, controller } = mount()

  // The stub's initial subscribe() publish already put us in 'ready' — mount()
  // itself must have focused the start button synchronously.
  expect(document.activeElement).toBe(root.querySelector('[data-begin-battle]'))

  const paused = clone(controller.getState())
  paused.mode = 'paused'
  controller.publish(paused)
  expect(document.activeElement).toBe(root.querySelector('[data-resume]'))

  const upgrade = clone(controller.getState())
  upgrade.mode = 'awaiting-upgrade'
  upgrade.upgrade = { offered: ['march', 'vigor', 'power'], choice: null, applied: false }
  controller.publish(upgrade)
  expect(document.activeElement).toBe(root.querySelector('[data-upgrade-choice="0"]'))

  const won = clone(controller.getState())
  won.mode = 'won'
  controller.publish(won)
  expect(document.activeElement).toBe(root.querySelector('[data-restart]'))

  const lost = clone(controller.getState())
  lost.mode = 'lost'
  lost.failureReason = 'all-units-lost'
  controller.publish(lost)
  expect(document.activeElement).toBe(root.querySelector('[data-restart]'))
})

test('does not steal focus back on repeated renders of the same mode', () => {
  const { root, controller } = mount()
  const paused = clone(controller.getState())
  paused.mode = 'paused'
  controller.publish(paused)
  expect(document.activeElement).toBe(root.querySelector('[data-resume]'))

  const elsewhere = document.createElement('button')
  document.body.append(elsewhere)
  elsewhere.focus()
  expect(document.activeElement).toBe(elsewhere)

  // Same mode, only a HUD-relevant field changed — must not re-focus [data-resume].
  const stillPaused = clone(controller.getState())
  stillPaused.mode = 'paused'
  stillPaused.combatTick = 42
  controller.publish(stillPaused)
  expect(document.activeElement).toBe(elsewhere)
})
