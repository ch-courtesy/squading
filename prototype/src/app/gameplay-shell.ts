import { BATTLE_TICKS, ELITE_MAX_HP, TICKS_PER_SECOND, UPGRADE_XP } from '../core/gameplay/constants'
import { rescueTicks } from '../core/gameplay/rescue'
import type { BattleMode, FriendlyState, GameState, UpgradeId, Vec2 } from '../core/gameplay/types'
import type { Squad } from '../core/types'
import { createGameplayController, type GameplayController } from './gameplay-controller'

export type GameplayAppDependencies = {
  readonly createController?: () => GameplayController
}

const DEFAULT_SEED = 'squad-survivor'

// Normal play always runs the fixed seed above and never shows it — the design spec
// keeps seed information off every player-facing screen. The query parameter exists
// only so a browser playthrough can pin the same scenario the deterministic policy
// evidence is recorded against.
function resolveSeed(): string {
  return new URLSearchParams(window.location.search).get('seed') || DEFAULT_SEED
}

const SQUAD_LABELS: Record<Squad, string> = { teal: '청록', scarlet: '주홍' }

const UPGRADE_LABELS: Record<UpgradeId, { readonly name: string; readonly effect: string }> = {
  power: { name: '화력 강화', effect: '두 분대의 공격 피해 +30%' },
  march: { name: '기동 강화', effect: '두 분대의 이동 속도 +15%' },
  vigor: { name: '생존 강화', effect: '두 분대의 최대 체력 +25%' },
}

const FAILURE_CAUSES: Record<'all-units-lost' | 'elite-survived', string> = {
  'all-units-lost': '두 분대가 모두 쓰러졌습니다.',
  'elite-survived': '제한 시간 안에 정예 지휘관을 처치하지 못했습니다.',
}

const HUD_VISIBLE_MODES: readonly BattleMode[] = ['running', 'paused', 'awaiting-upgrade']

// The keyboard-only path through each mode's primary action: focusing it whenever
// the mode changes lets Enter/Space start, resume or restart without a mouse.
const PRIMARY_BUTTON_SELECTOR: Partial<Record<BattleMode, string>> = {
  ready: '[data-begin-battle]',
  paused: '[data-resume]',
  'awaiting-upgrade': '[data-upgrade-choice="0"]',
  won: '[data-restart]',
  lost: '[data-restart]',
}

const RENDERER_ERROR_MESSAGE = '전투 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function seconds(ticks: number): string {
  return (ticks / TICKS_PER_SECOND).toFixed(1)
}

function pointerTargetFrom(event: PointerEvent, bounds: DOMRect): Vec2 {
  const halfWidth = Math.max(1, bounds.width / 2)
  const halfHeight = Math.max(1, bounds.height / 2)
  return {
    x: clamp((event.clientX - bounds.left - halfWidth) / halfWidth, -1, 1),
    y: clamp((event.clientY - bounds.top - halfHeight) / halfHeight, -1, 1),
  }
}

function standingCount(state: Readonly<GameState>, squad: Squad): number {
  return state.friendlies.filter((friendly) => friendly.squad === squad && friendly.life === 'standing').length
}

function findRescueLock(state: Readonly<GameState>): FriendlyState | null {
  return state.friendlies.find((friendly) => friendly.rescueTargetId !== null) ?? null
}

function skeleton(): string {
  return `
    <main class="gameplay-shell">
      <p class="gp-error" role="alert" data-error hidden></p>

      <section class="gp-stage" data-stage aria-label="전투 화면"></section>

      <section class="gp-ready" data-ready>
        <p class="gp-eyebrow">SQUAD SURVIVOR</p>
        <h1>30초 분대 생존전</h1>
        <p class="gp-objective">30초 안에 정예 지휘관을 쓰러뜨리십시오.</p>
        <dl class="gp-controls">
          <div><dt>이동</dt><dd>WASD / 방향키 / 포인터 드래그</dd></div>
          <div><dt>분대 교대</dt><dd>Q 또는 Tab</dd></div>
          <div><dt>구조</dt><dd>쓰러진 병사 곁에서 Space 유지</dd></div>
        </dl>
        <p class="gp-squad-hint">주홍 분대는 화력에 강하고, 청록 분대는 구조와 생존에 강합니다.</p>
        <button type="button" class="gp-start" data-begin-battle>전투 시작</button>
      </section>

      <section class="gp-hud" data-hud hidden>
        <div class="gp-hud-row"><span class="gp-hud-label">남은 시간</span><span data-remaining aria-live="polite"></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">활성 분대</span><span data-active-squad></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">청록</span><span data-squad-status="teal"></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">주홍</span><span data-squad-status="scarlet"></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">교대 cooldown</span><span data-switch-cooldown></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">XP</span><span data-xp></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">구조</span><span data-rescue></span></div>
        <div class="gp-hud-row"><span class="gp-hud-label">정예 HP</span><span data-elite-hp></span></div>
        <p class="gp-switch-warning" data-switch-warning aria-live="assertive" hidden>Q로 분대를 전환하세요</p>
      </section>

      <section class="gp-pause-overlay" data-pause role="dialog" aria-modal="true" aria-label="일시정지" hidden>
        <p class="gp-pause-title">일시정지</p>
        <p>Escape를 누르거나 아래 버튼으로 재개하십시오.</p>
        <button type="button" data-resume>계속하기</button>
      </section>

      <section class="gp-upgrade-overlay" data-upgrade role="dialog" aria-modal="true" aria-label="강화 선택" hidden>
        <h2>강화를 선택하십시오</h2>
        <div class="gp-upgrade-cards">
          <button type="button" class="gp-upgrade-card" data-upgrade-choice="0">
            <span class="gp-key">1</span><strong data-upgrade-name="0"></strong><span data-upgrade-effect="0"></span>
          </button>
          <button type="button" class="gp-upgrade-card" data-upgrade-choice="1">
            <span class="gp-key">2</span><strong data-upgrade-name="1"></strong><span data-upgrade-effect="1"></span>
          </button>
          <button type="button" class="gp-upgrade-card" data-upgrade-choice="2">
            <span class="gp-key">3</span><strong data-upgrade-name="2"></strong><span data-upgrade-effect="2"></span>
          </button>
        </div>
      </section>

      <section class="gp-terminal-overlay" data-terminal role="dialog" aria-modal="true" aria-label="전투 결과" hidden>
        <h2 data-terminal-title></h2>
        <p data-terminal-cause></p>
        <dl class="gp-terminal-stats">
          <div><dt>처치</dt><dd data-kills></dd></div>
          <div><dt>구조</dt><dd data-rescues></dd></div>
          <div><dt>생존</dt><dd data-survivors></dd></div>
          <div><dt>선택 강화</dt><dd data-choice></dd></div>
        </dl>
        <button type="button" data-restart>다시 시작</button>
      </section>
    </main>
  `
}

export function mountApp(root: HTMLElement, dependencies: GameplayAppDependencies = {}): void {
  root.innerHTML = skeleton()

  const errorBanner = root.querySelector<HTMLElement>('[data-error]')!
  const stage = root.querySelector<HTMLElement>('[data-stage]')!
  const readyScreen = root.querySelector<HTMLElement>('[data-ready]')!
  const hud = root.querySelector<HTMLElement>('[data-hud]')!
  const pauseOverlay = root.querySelector<HTMLElement>('[data-pause]')!
  const upgradeOverlay = root.querySelector<HTMLElement>('[data-upgrade]')!
  const terminalOverlay = root.querySelector<HTMLElement>('[data-terminal]')!
  const switchWarning = root.querySelector<HTMLElement>('[data-switch-warning]')!
  const remaining = root.querySelector<HTMLElement>('[data-remaining]')!
  const activeSquadLabel = root.querySelector<HTMLElement>('[data-active-squad]')!
  const tealStatus = root.querySelector<HTMLElement>('[data-squad-status="teal"]')!
  const scarletStatus = root.querySelector<HTMLElement>('[data-squad-status="scarlet"]')!
  const switchCooldown = root.querySelector<HTMLElement>('[data-switch-cooldown]')!
  const xp = root.querySelector<HTMLElement>('[data-xp]')!
  const rescue = root.querySelector<HTMLElement>('[data-rescue]')!
  const eliteHp = root.querySelector<HTMLElement>('[data-elite-hp]')!
  const terminalTitle = root.querySelector<HTMLElement>('[data-terminal-title]')!
  const terminalCause = root.querySelector<HTMLElement>('[data-terminal-cause]')!
  const kills = root.querySelector<HTMLElement>('[data-kills]')!
  const rescues = root.querySelector<HTMLElement>('[data-rescues]')!
  const survivors = root.querySelector<HTMLElement>('[data-survivors]')!
  const choice = root.querySelector<HTMLElement>('[data-choice]')!
  const upgradeCards = [0, 1, 2].map((index) => ({
    name: root.querySelector<HTMLElement>(`[data-upgrade-name="${index}"]`)!,
    effect: root.querySelector<HTMLElement>(`[data-upgrade-effect="${index}"]`)!,
  }))

  const showRendererError = (message: string): void => {
    errorBanner.textContent = message
    errorBanner.hidden = false
  }

  const controller = dependencies.createController?.()
    ?? createGameplayController({
      host: stage,
      seed: resolveSeed(),
      onError: (error) => {
        console.error('[gameplay-shell] renderer error', error)
        showRendererError(RENDERER_ERROR_MESSAGE)
      },
    })

  root.querySelector<HTMLButtonElement>('[data-begin-battle]')?.addEventListener('click', () => controller.beginBattle())
  root.querySelector<HTMLButtonElement>('[data-resume]')?.addEventListener('click', () => controller.togglePause())
  root.querySelector<HTMLButtonElement>('[data-restart]')?.addEventListener('click', () => controller.restart())
  root.querySelectorAll<HTMLButtonElement>('[data-upgrade-choice]').forEach((button, index) => {
    button.addEventListener('click', () => controller.chooseUpgrade(index as 0 | 1 | 2))
  })

  stage.addEventListener('pointerdown', (event) => controller.pointerDown(pointerTargetFrom(event, stage.getBoundingClientRect())))
  stage.addEventListener('pointermove', (event) => controller.pointerMove(pointerTargetFrom(event, stage.getBoundingClientRect())))
  stage.addEventListener('pointerup', () => controller.pointerEnd())
  stage.addEventListener('pointercancel', () => controller.pointerEnd())
  stage.addEventListener('pointerleave', () => controller.pointerEnd())

  let previousMode: BattleMode | null = null

  const renderVisibility = (mode: BattleMode): void => {
    readyScreen.hidden = mode !== 'ready'
    hud.hidden = !HUD_VISIBLE_MODES.includes(mode)
    pauseOverlay.hidden = mode !== 'paused'
    upgradeOverlay.hidden = mode !== 'awaiting-upgrade'
    terminalOverlay.hidden = mode !== 'won' && mode !== 'lost'

    // Only move focus on an actual mode transition, never on every render (HUD
    // fields change ~60x/sec while a mode is showing) — otherwise focus would be
    // yanked away from whatever the player is doing inside the visible section.
    if (mode === previousMode) return
    previousMode = mode
    const selector = PRIMARY_BUTTON_SELECTOR[mode]
    if (selector) root.querySelector<HTMLElement>(selector)?.focus()
  }

  const renderHud = (state: Readonly<GameState>): void => {
    const remainingSeconds = clamp((BATTLE_TICKS - state.combatTick) / TICKS_PER_SECOND, 0, BATTLE_TICKS / TICKS_PER_SECOND)
    remaining.textContent = `${remainingSeconds.toFixed(1)}초`
    activeSquadLabel.textContent = SQUAD_LABELS[state.activeSquad]
    tealStatus.textContent = `${standingCount(state, 'teal')}명 · 피로 ${(state.squads.teal.fatigue * 100).toFixed(0)}%`
    scarletStatus.textContent = `${standingCount(state, 'scarlet')}명 · 피로 ${(state.squads.scarlet.fatigue * 100).toFixed(0)}%`
    switchCooldown.textContent = state.switchCooldown === 0 ? '교대 가능' : `${seconds(state.switchCooldown)}초`
    xp.textContent = `${state.stats.xp} / ${UPGRADE_XP}`

    const rescuer = findRescueLock(state)
    rescue.textContent = rescuer
      ? `#${rescuer.rescueTargetId} 구조 중 ${rescuer.rescueProgress}/${rescueTicks(rescuer.squad)}`
      : '구조 대상 없음'

    eliteHp.textContent = state.elite.spawned ? `${state.elite.hp.toFixed(1)} / ${ELITE_MAX_HP}` : '정예 대기 중'

    const showSwitchWarning = state.mode === 'running' && standingCount(state, state.activeSquad) === 0
    switchWarning.hidden = !showSwitchWarning
  }

  const renderUpgrade = (state: Readonly<GameState>): void => {
    state.upgrade.offered.forEach((id, index) => {
      const label = UPGRADE_LABELS[id]
      const card = upgradeCards[index]
      if (!card) return
      card.name.textContent = label.name
      card.effect.textContent = label.effect
    })
  }

  const renderTerminal = (state: Readonly<GameState>): void => {
    if (state.mode !== 'won' && state.mode !== 'lost') return
    const won = state.mode === 'won'
    terminalTitle.textContent = won ? '승리' : '패배'
    terminalCause.textContent = won
      ? '정예 지휘관을 처치했습니다.'
      : FAILURE_CAUSES[state.failureReason ?? 'elite-survived']
    kills.textContent = String(state.stats.kills)
    rescues.textContent = String(state.stats.rescues)
    survivors.textContent = String(state.friendlies.filter((friendly) => friendly.life !== 'dead').length)
    choice.textContent = state.upgrade.choice ? UPGRADE_LABELS[state.upgrade.choice].name : '없음'
  }

  const render = (state: Readonly<GameState>): void => {
    renderVisibility(state.mode)
    renderHud(state)
    renderUpgrade(state)
    renderTerminal(state)
  }

  controller.subscribe(render)
  void controller.start()
}
