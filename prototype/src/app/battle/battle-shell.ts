// The v2 shell: the screen a person plays the commander battle on (§6, batch G).
//
// IT NEVER SEES `BattleState`. Everything it prints comes off `BattleHud`, everything it draws
// goes through the controller's `RenderSnapshot`, and everything the player does leaves as one
// of §1.15's public inputs. That is §6's boundary, and it is the one v1 lost — a shell that
// reads the authority ends up re-deriving rules next to it, and the copy drifts.
//
// The seed is not on any player-facing screen (it is a query parameter for the browser gates
// only), exactly as v1's shell decided and for the same reason.

import { COMBAT_TICK_LIMIT } from '../../core/battle/constants'
import type { BattleMode } from '../../core/battle/types'
import { BATTLE_TICKS_PER_SECOND } from '../../core/battle-view/snapshot'
import type { BattleHud, RosterEntryView } from '../../core/battle-view/hud'
import { createBattleController, type BattleController } from './battle-controller'
import { createBattleInputAdapter } from './battle-input'
import { pointerWorldOffset } from './battle-pointer'

export type BattleAppDependencies = {
  readonly createController?: (host: HTMLElement) => BattleController
}

const DEFAULT_SEED = 'commander-battle'

const HUD_VISIBLE_MODES: readonly BattleMode[] = ['running', 'paused', 'awaiting-upgrade']

const FAILURE_CAUSES: Record<'all-units-lost' | 'elite-survived', string> = {
  'all-units-lost': '분대가 전멸했습니다.',
  'elite-survived': '제한 시간 안에 정예를 처치하지 못했습니다.',
}

const LIFE_LABELS: Record<RosterEntryView['life'], string> = {
  standing: '전투 중',
  downed: '쓰러짐',
  dead: '전사',
}

// Keyboard-only play needs the primary action of each mode focused when that mode arrives.
const PRIMARY_BUTTON_SELECTOR: Partial<Record<BattleMode, string>> = {
  ready: '[data-battle-begin]',
  paused: '[data-battle-resume]',
  'awaiting-upgrade': '[data-battle-card="1"]',
  won: '[data-battle-restart]',
  lost: '[data-battle-restart]',
}

const RENDERER_ERROR_MESSAGE = '전투 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'

function resolveSeed(): string {
  return new URLSearchParams(window.location.search).get('seed') || DEFAULT_SEED
}

function seconds(value: number): string {
  return `${value.toFixed(1)}초`
}

function skeleton(): string {
  return `
    <main class="battle-shell">
      <p class="bt-error" role="alert" data-battle-error hidden></p>

      <section class="bt-stage" data-battle-stage aria-label="전투 화면"></section>

      <section class="bt-ready" data-battle-ready>
        <p class="bt-eyebrow">SQUAD SURVIVOR</p>
        <h1>90초 지휘관 전투</h1>
        <p class="bt-objective">90초 안에 정예를 쓰러뜨리십시오. 쓰러지면 옆 병사가 지휘를 잇습니다.</p>
        <dl class="bt-controls">
          <div><dt>이동</dt><dd>WASD / 방향키 / 포인터 드래그</dd></div>
          <div><dt>구조</dt><dd>쓰러진 병사 곁에서 Space 유지</dd></div>
          <div><dt>강화</dt><dd>1 2 3</dd></div>
          <div><dt>일시정지</dt><dd>Escape</dd></div>
        </dl>
        <button type="button" class="bt-start" data-battle-begin>전투 시작</button>
      </section>

      <section class="bt-hud" data-battle-hud hidden>
        <div class="bt-hud-row"><span class="bt-hud-label">남은 시간</span><span data-battle-remaining></span></div>
        <div class="bt-hud-row"><span class="bt-hud-label">처치</span><span data-battle-kills></span></div>
        <div class="bt-hud-row"><span class="bt-hud-label">구조</span><span data-battle-rescues></span></div>
        <div class="bt-hud-row"><span class="bt-hud-label">분대</span><span data-battle-squad></span></div>
        <div class="bt-hud-row"><span class="bt-hud-label">구조 상태</span><span data-battle-rescue></span></div>
        <div class="bt-hud-row"><span class="bt-hud-label">강화</span><span data-battle-chosen></span></div>
        <ul class="bt-roster" data-battle-roster aria-label="분대 명부"></ul>
      </section>

      <section class="bt-overlay" data-battle-pause role="dialog" aria-modal="true" aria-label="일시정지" hidden>
        <p class="bt-overlay-title">일시정지</p>
        <p>Escape를 누르거나 아래 버튼으로 재개하십시오.</p>
        <button type="button" data-battle-resume>계속하기</button>
      </section>

      <section class="bt-overlay" data-battle-upgrade role="dialog" aria-modal="true" aria-label="강화 선택" hidden>
        <h2>강화를 선택하십시오</h2>
        <div class="bt-cards">
          <button type="button" class="bt-card" data-battle-card="1">
            <span class="bt-key">1</span><strong data-battle-card-name="1"></strong><span data-battle-card-effect="1"></span>
          </button>
          <button type="button" class="bt-card" data-battle-card="2">
            <span class="bt-key">2</span><strong data-battle-card-name="2"></strong><span data-battle-card-effect="2"></span>
          </button>
          <button type="button" class="bt-card" data-battle-card="3">
            <span class="bt-key">3</span><strong data-battle-card-name="3"></strong><span data-battle-card-effect="3"></span>
          </button>
        </div>
      </section>

      <section class="bt-overlay bt-terminal" data-battle-terminal role="dialog" aria-modal="true" aria-label="전투 결과" hidden>
        <h2 data-battle-result-title></h2>
        <p data-battle-result-cause></p>
        <dl class="bt-result-stats">
          <div><dt>처치</dt><dd data-battle-result-kills></dd></div>
          <div><dt>구조</dt><dd data-battle-result-rescues></dd></div>
          <div><dt>생존</dt><dd data-battle-result-survivors></dd></div>
          <div><dt>지휘관</dt><dd data-battle-result-commander></dd></div>
          <div><dt>경과</dt><dd data-battle-result-elapsed></dd></div>
          <div><dt>선택 강화</dt><dd data-battle-result-cards></dd></div>
        </dl>
        <h3>전사자</h3>
        <ul class="bt-record" data-battle-casualties></ul>
        <h3>구조 기록</h3>
        <ul class="bt-record" data-battle-rescue-records></ul>
        <button type="button" data-battle-restart>다시 시작</button>
      </section>
    </main>
  `
}

export function mountApp(root: HTMLElement, dependencies: BattleAppDependencies = {}): void {
  root.innerHTML = skeleton()

  const pick = <T extends HTMLElement>(selector: string): T => root.querySelector<T>(selector)!
  const errorBanner = pick('[data-battle-error]')
  const stage = pick('[data-battle-stage]')
  const readyScreen = pick('[data-battle-ready]')
  const hud = pick('[data-battle-hud]')
  const pauseOverlay = pick('[data-battle-pause]')
  const upgradeOverlay = pick('[data-battle-upgrade]')
  const terminalOverlay = pick('[data-battle-terminal]')
  const remaining = pick('[data-battle-remaining]')
  const kills = pick('[data-battle-kills]')
  const rescues = pick('[data-battle-rescues]')
  const squad = pick('[data-battle-squad]')
  const rescue = pick('[data-battle-rescue]')
  const chosen = pick('[data-battle-chosen]')
  const roster = pick('[data-battle-roster]')
  const resultTitle = pick('[data-battle-result-title]')
  const resultCause = pick('[data-battle-result-cause]')
  const resultKills = pick('[data-battle-result-kills]')
  const resultRescues = pick('[data-battle-result-rescues]')
  const resultSurvivors = pick('[data-battle-result-survivors]')
  const resultCommander = pick('[data-battle-result-commander]')
  const resultElapsed = pick('[data-battle-result-elapsed]')
  const resultCards = pick('[data-battle-result-cards]')
  const casualties = pick('[data-battle-casualties]')
  const rescueRecords = pick('[data-battle-rescue-records]')

  const controller = dependencies.createController?.(stage)
    ?? createBattleController({
      host: stage,
      seed: resolveSeed(),
      onError: (error) => {
        console.error('[battle-shell] renderer error', error)
        errorBanner.textContent = RENDERER_ERROR_MESSAGE
        errorBanner.hidden = false
      },
    })

  pick<HTMLButtonElement>('[data-battle-begin]').addEventListener('click', () => controller.begin())
  pick<HTMLButtonElement>('[data-battle-resume]').addEventListener('click', () => controller.togglePause())
  pick<HTMLButtonElement>('[data-battle-restart]').addEventListener('click', () => controller.restart())
  root.querySelectorAll<HTMLButtonElement>('[data-battle-card]').forEach((button) => {
    button.addEventListener('click', () => controller.chooseUpgrade(Number(button.dataset.battleCard)))
  })

  const dragFrom = (event: PointerEvent, phase: 'down' | 'move'): void => {
    controller.pointerDrag(pointerWorldOffset(event, stage.getBoundingClientRect()), phase)
  }
  let dragging = false
  stage.addEventListener('pointerdown', (event) => {
    dragging = true
    dragFrom(event, 'down')
  })
  stage.addEventListener('pointermove', (event) => {
    if (dragging) dragFrom(event, 'move')
  })
  const endDrag = (): void => {
    dragging = false
    controller.pointerRelease()
  }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('pointerleave', endDrag)

  createBattleInputAdapter({
    keyDown: (code) => controller.keyDown(code),
    keyUp: (code) => controller.keyUp(code),
    getMode: () => controller.hud().mode,
  }).attach()

  let previousMode: BattleMode | null = null

  const renderVisibility = (mode: BattleMode): void => {
    readyScreen.hidden = mode !== 'ready'
    hud.hidden = !HUD_VISIBLE_MODES.includes(mode)
    pauseOverlay.hidden = mode !== 'paused'
    upgradeOverlay.hidden = mode !== 'awaiting-upgrade'
    terminalOverlay.hidden = mode !== 'won' && mode !== 'lost'

    // Only on an actual transition: the HUD is rewritten every frame, and moving focus every
    // frame would yank it out of whatever the player is doing inside the visible section.
    if (mode === previousMode) return
    previousMode = mode
    const selector = PRIMARY_BUTTON_SELECTOR[mode]
    if (selector) root.querySelector<HTMLElement>(selector)?.focus()
  }

  const renderRoster = (view: BattleHud): void => {
    // Rebuilt rather than diffed: sixteen rows, once a frame, and a diff would be a second
    // place for "who is downed" to be decided.
    roster.replaceChildren(
      ...view.roster.map((entry) => {
        const item = document.createElement('li')
        item.className = 'bt-roster-entry'
        item.dataset.rosterEntry = String(entry.id)
        item.dataset.life = entry.life
        if (entry.isCommand) item.dataset.command = 'true'
        if (entry.isRescueCandidate) item.dataset.rescueCandidate = 'true'
        const name = document.createElement('span')
        name.className = 'bt-roster-name'
        name.textContent = entry.isCommand ? `★ ${entry.name}` : entry.name
        const bar = document.createElement('span')
        bar.className = 'bt-roster-bar'
        const fill = document.createElement('span')
        fill.className = 'bt-roster-fill'
        fill.style.width = `${Math.round(entry.hp01 * 100)}%`
        bar.append(fill)
        bar.title = `${entry.hp.toFixed(2)} / ${entry.maxHp.toFixed(2)}`
        const state = document.createElement('span')
        state.className = 'bt-roster-state'
        state.textContent = entry.life === 'downed'
          ? `${LIFE_LABELS.downed} ${seconds(entry.downedTicksRemaining / BATTLE_TICKS_PER_SECOND)}`
          : LIFE_LABELS[entry.life]
        item.append(name, bar, state)
        return item
      }),
    )
  }

  const renderHud = (view: BattleHud): void => {
    remaining.textContent = seconds(view.secondsRemaining)
    kills.textContent = String(view.kills)
    rescues.textContent = String(view.rescues)
    squad.textContent = `생존 ${view.standing} · 쓰러짐 ${view.downed} · 전사 ${view.dead}`
    rescue.textContent = view.rescue
      ? `${view.rescue.targetName} 구조 중 ${view.rescue.progress}/${view.rescue.total}`
      : view.rescueCandidateId !== null
        ? 'Space로 구조'
        : view.rescueHeld
          ? 'Space 유지 중 · 대상 없음'
          : '구조 대상 없음'
    chosen.textContent = view.chosenCards.length === 0
      ? '없음'
      : view.chosenCards.map((card) => card.name).join(' · ')
    renderRoster(view)
  }

  const renderUpgrade = (view: BattleHud): void => {
    const cards = view.pendingUpgrade?.cards ?? []
    for (const slot of [1, 2, 3]) {
      const card = cards.find((entry) => entry.slot === slot)
      const button = root.querySelector<HTMLButtonElement>(`[data-battle-card="${slot}"]`)
      if (button) button.hidden = card === undefined
      root.querySelector(`[data-battle-card-name="${slot}"]`)!.textContent = card?.name ?? ''
      root.querySelector(`[data-battle-card-effect="${slot}"]`)!.textContent = card?.effect ?? ''
    }
  }

  const renderTerminal = (view: BattleHud): void => {
    if (view.mode !== 'won' && view.mode !== 'lost') return
    const won = view.mode === 'won'
    resultTitle.textContent = won ? '승리' : '패배'
    resultCause.textContent = won
      ? '정예를 처치했습니다.'
      : FAILURE_CAUSES[view.failureReason ?? 'elite-survived']
    resultKills.textContent = String(view.kills)
    resultRescues.textContent = String(view.rescues)
    resultSurvivors.textContent = String(view.standing)
    // §1.14's 지휘관 생존 여부 — the ORIGINAL commander, whoever ended up holding command.
    resultCommander.textContent = view.commanderSurvived ? '생존' : '전사·부상'
    resultElapsed.textContent = seconds(
      Math.min(view.tick, COMBAT_TICK_LIMIT) / BATTLE_TICKS_PER_SECOND,
    )
    resultCards.textContent = view.chosenCards.length === 0
      ? '없음'
      : view.chosenCards.map((card) => `${card.name}(${card.effect})`).join(' · ')

    casualties.replaceChildren(
      ...(view.casualties.length === 0
        ? [textItem('없음')]
        : view.casualties.map((entry) =>
            textItem(`${entry.name} — ${seconds(entry.deathTick / BATTLE_TICKS_PER_SECOND)}`),
          )),
    )
    rescueRecords.replaceChildren(
      ...(view.rescueRecords.length === 0
        ? [textItem('없음')]
        : view.rescueRecords.map((entry) => textItem(`${entry.name} ← ${entry.rescuers.join(', ')}`))),
    )
  }

  const render = (view: BattleHud): void => {
    renderVisibility(view.mode)
    renderHud(view)
    renderUpgrade(view)
    renderTerminal(view)
  }

  controller.subscribe(render)
  render(controller.hud())
  void controller.start()

  // The dev-only browser-test bridge (`assert-no-test-bridge.mjs` fails the build if it ever
  // reaches a production bundle). §4.3 compares this run against a headless replay of the same
  // log, and §4.4 asserts framing against world positions — neither is readable from the DOM.
  if (import.meta.env.DEV) {
    window.__SQUADING_TEST__ = {
      ...(window.__SQUADING_TEST__ ?? {}),
      battle: {
        seed: () => controller.seed(),
        hud: () => controller.hud(),
        snapshot: () => controller.snapshot(),
        inputLog: () => controller.inputLog(),
        stepCount: () => controller.stepCount(),
        digest: () => controller.digest(),
        frameSamples: () => controller.frameSamples(),
      },
    }
  }
}

function textItem(text: string): HTMLLIElement {
  const item = document.createElement('li')
  item.textContent = text
  return item
}
