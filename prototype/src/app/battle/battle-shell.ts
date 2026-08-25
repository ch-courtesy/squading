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
import type { CampaignHud } from '../../core/campaign-view/hud'
import type { CampaignPhase } from '../../core/campaign/state'
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
        <!--
          THE TITLE, and it is the h1 rather than the eyebrow. The two lines used to be a label
          over a description — "SQUAD SURVIVOR" small, "90초 지휘관 전투" large — which is a start
          screen with no name on it. The game is called Squading; the description is what goes
          small.
        -->
        <h1 class="bt-title">Squading</h1>
        <p class="bt-eyebrow">90초 지휘관 전투</p>
        <p class="bt-objective">90초 안에 정예를 쓰러뜨리십시오. 쓰러지면 옆 병사가 지휘를 잇습니다.</p>
        <dl class="bt-controls">
          <div><dt>이동</dt><dd>WASD / 방향키 / 포인터 드래그</dd></div>
          <div><dt>구조</dt><dd>쓰러진 병사 곁에서 Space 유지</dd></div>
          <div><dt>강화</dt><dd>1 2 3</dd></div>
          <div><dt>일시정지</dt><dd>Escape</dd></div>
          <div><dt>소리</dt><dd>M</dd></div>
        </dl>
        <button type="button" class="bt-start" data-battle-begin>전투 시작</button>
        <button type="button" class="bt-sound" data-battle-sound aria-pressed="true">소리 켜짐</button>
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

      <section class="bt-overlay bt-transition" data-campaign-transition role="dialog" aria-modal="true" aria-label="스테이지 전환" hidden>
        <h2>스테이지 <span data-campaign-cleared-stage></span> 완료</h2>
        <dl class="bt-result-stats">
          <div><dt>누적 처치</dt><dd data-campaign-kills></dd></div>
          <div><dt>보유 강화</dt><dd data-campaign-cards></dd></div>
        </dl>
        <h3>분대 <span data-campaign-survivor-count></span></h3>
        <ul class="bt-record" data-campaign-survivors></ul>
        <h3>잃은 사람</h3>
        <ul class="bt-record" data-campaign-lost></ul>
        <button type="button" data-campaign-next>스테이지 <span data-campaign-next-stage></span> 시작</button>
      </section>

      <!--
        THE ENDING, and it is its own screen for a reason. A campaign that ran all seven stages and
        a campaign that died in stage 2 both leave the battle at won/lost, and putting them in one
        panel makes finishing the game look like losing it with a different heading. This one is
        shown for exactly one state: a campaign whose end is "complete".
      -->
      <section class="bt-overlay bt-ending" data-campaign-ending role="dialog" aria-modal="true" aria-labelledby="bt-ending-title" hidden>
        <div class="bt-ending-scroll">
          <p class="bt-eyebrow bt-ending-step" style="--step: 1">일곱 판</p>
          <h2 id="bt-ending-title" class="bt-ending-step" style="--step: 2">분대가 끝까지 갔다</h2>

          <ol class="bt-ending-stages bt-ending-step" style="--step: 3" data-campaign-ending-stages></ol>

          <dl class="bt-result-stats bt-ending-step" style="--step: 4">
            <div><dt>누적 처치</dt><dd data-campaign-ending-kills></dd></div>
            <div><dt>끝까지 선 인원</dt><dd data-campaign-ending-survivor-count></dd></div>
            <div><dt>잃은 인원</dt><dd data-campaign-ending-lost-count></dd></div>
          </dl>

          <h3 class="bt-ending-step" style="--step: 5">돌아온 사람</h3>
          <ul class="bt-record bt-ending-step" style="--step: 5" data-campaign-ending-survivors></ul>

          <!--
            §1.14 keeps every name, the tick it fell on and the stage it fell in. The memorial is
            the reason those three fields are in the authoritative state at all, and an ending that
            printed a casualty COUNT would throw away what the spec kept them for.
          -->
          <h3 class="bt-ending-step" style="--step: 6">돌아오지 못한 사람</h3>
          <ul class="bt-record bt-ending-memorial bt-ending-step" style="--step: 6" data-campaign-ending-fallen></ul>

          <h3 class="bt-ending-step" style="--step: 7">분대가 들고 끝낸 것</h3>
          <p class="bt-ending-cards bt-ending-step" style="--step: 7" data-campaign-ending-cards></p>

          <button type="button" class="bt-ending-step" style="--step: 8" data-campaign-ending-restart>다시 시작</button>
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

        <div class="bt-campaign-summary" data-campaign-summary>
          <h3 data-campaign-outcome></h3>
          <dl class="bt-result-stats">
            <div><dt>도달 스테이지</dt><dd data-campaign-reached></dd></div>
            <div><dt>누적 처치</dt><dd data-campaign-total-kills></dd></div>
            <div><dt>보유 강화</dt><dd data-campaign-held-cards></dd></div>
          </dl>
          <h3>캠페인 전사자</h3>
          <ul class="bt-record" data-campaign-fallen></ul>
        </div>

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
  const transitionOverlay = pick('[data-campaign-transition]')
  const clearedStage = pick('[data-campaign-cleared-stage]')
  const campaignKills = pick('[data-campaign-kills]')
  const campaignCards = pick('[data-campaign-cards]')
  const survivorCount = pick('[data-campaign-survivor-count]')
  const survivors = pick('[data-campaign-survivors]')
  const lost = pick('[data-campaign-lost]')
  const nextStage = pick('[data-campaign-next-stage]')
  const campaignOutcome = pick('[data-campaign-outcome]')
  const campaignReached = pick('[data-campaign-reached]')
  const campaignTotalKills = pick('[data-campaign-total-kills]')
  const campaignHeldCards = pick('[data-campaign-held-cards]')
  const campaignFallen = pick('[data-campaign-fallen]')
  const endingOverlay = pick('[data-campaign-ending]')
  const endingStages = pick('[data-campaign-ending-stages]')
  const endingKills = pick('[data-campaign-ending-kills]')
  const endingSurvivorCount = pick('[data-campaign-ending-survivor-count]')
  const endingLostCount = pick('[data-campaign-ending-lost-count]')
  const endingSurvivors = pick('[data-campaign-ending-survivors]')
  const endingFallen = pick('[data-campaign-ending-fallen]')
  const endingCards = pick('[data-campaign-ending-cards]')

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

  /**
   * The sound toggle, in one place.
   *
   * The button and the `M` key are the same call rather than two, because two would let the label
   * and the state disagree the first time only one of them was updated — `setEnabled` returns the
   * new state so there is nothing here to keep in sync.
   */
  const soundButton = pick<HTMLButtonElement>('[data-battle-sound]')
  const renderSound = (enabled: boolean): void => {
    soundButton.textContent = enabled ? '소리 켜짐' : '소리 꺼짐'
    soundButton.setAttribute('aria-pressed', String(enabled))
  }
  const toggleSound = (): void => {
    const audio = controller.audio()
    const next = audio.setEnabled(!audio.enabled())
    // A player who turns sound ON before the battle starts has given the gesture the autoplay
    // policy wants, so this is also a legitimate place to open the context.
    if (next) void audio.resume()
    renderSound(next)
  }
  soundButton.addEventListener('click', toggleSound)
  renderSound(controller.audio().enabled())
  pick<HTMLButtonElement>('[data-battle-resume]').addEventListener('click', () => controller.togglePause())
  // Campaign §1.4: 다시 시작 is a new campaign from stage 1, not a retry of the stage that ended.
  pick<HTMLButtonElement>('[data-battle-restart]').addEventListener('click', () => controller.restart())
  pick<HTMLButtonElement>('[data-campaign-ending-restart]').addEventListener('click', () => controller.restart())
  pick<HTMLButtonElement>('[data-campaign-next]').addEventListener('click', () => controller.advanceStage())
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

  // §1.15 owns the keys the BATTLE reads and `M` is not one of them. Muting is a property of this
  // shell, not of the run: routed through `controller.keyDown` it would be refused by the adapter's
  // own allow-list anyway, and if it were not, it would land in §4.3's input log and move the
  // digest — a replay that muted itself is a different recording of the same battle.
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyM' || event.repeat) return
    toggleSound()
  })

  createBattleInputAdapter({
    keyDown: (code) => controller.keyDown(code),
    keyUp: (code) => controller.keyUp(code),
    getMode: () => controller.hud().mode,
  }).attach()

  let previousMode: BattleMode | null = null
  let previousPhase: CampaignPhase | null = null

  const renderVisibility = (mode: BattleMode, campaign: CampaignHud): void => {
    // WHICH END SCREEN, and it is the campaign that decides rather than the battle. A stage that
    // ended is `won`/`lost` either way; what differs is whether the campaign has another stage for
    // the survivors (§1.1's transition) or has finished with them (§1.4/§1.5's end).
    const stageEnded = mode === 'won' || mode === 'lost'
    const cleared = campaign.phase === 'stage-cleared'
    // Finishing the game is not the same event as ending a stage, and it gets the screen instead
    // of the result panel rather than as well as it — two overlays over one board is a stack.
    const finished = campaign.end === 'complete'

    readyScreen.hidden = mode !== 'ready'
    hud.hidden = !HUD_VISIBLE_MODES.includes(mode)
    pauseOverlay.hidden = mode !== 'paused'
    upgradeOverlay.hidden = mode !== 'awaiting-upgrade'
    transitionOverlay.hidden = !cleared
    terminalOverlay.hidden = !stageEnded || cleared || finished
    endingOverlay.hidden = !finished

    // Only on an actual transition: the HUD is rewritten every frame, and moving focus every
    // frame would yank it out of whatever the player is doing inside the visible section.
    if (mode === previousMode && campaign.phase === previousPhase) return
    previousMode = mode
    previousPhase = campaign.phase
    const selector = finished
      ? '[data-campaign-ending-restart]'
      : cleared
        ? '[data-campaign-next]'
        : PRIMARY_BUTTON_SELECTOR[mode]
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

  /**
   * §1.1's transition screen: who is left, who was lost, what the squad carries.
   *
   * THE NAMES ARE WHY THIS SCREEN EXISTS. §1.14 gave the roster names so a loss reads as a person,
   * and this is the one screen where the loss is stated as a fact about the NEXT stage rather than
   * as the end of a run.
   *
   * IT IS UNREACHABLE IN PLAY TODAY, and that is a fact about `STAGES` having one row rather than
   * about this code: winning stage 1 completes the campaign, so `stage-cleared` never arrives.
   * `tests/app/battle-shell.test.ts` renders it from a campaign projection in that phase.
   */
  const renderTransition = (campaign: CampaignHud): void => {
    if (campaign.phase !== 'stage-cleared') return
    clearedStage.textContent = String(campaign.stageId)
    nextStage.textContent = campaign.nextStageId === null ? '' : String(campaign.nextStageId)
    campaignKills.textContent = String(campaign.kills)
    campaignCards.textContent = cardSummary(campaign)
    survivorCount.textContent = `${campaign.survivors.length}명`
    survivors.replaceChildren(
      ...campaign.survivors.map((entry) =>
        textItem(
          `${entry.isCommand ? '★ ' : ''}${entry.name} — ${entry.hp.toFixed(2)} / ${entry.maxHp.toFixed(2)}`,
        ),
      ),
    )
    lost.replaceChildren(...fallenItems(campaign))
  }

  /** §1.4/§1.5's end screen: how far the campaign got, and who it cost. */
  const renderCampaignSummary = (campaign: CampaignHud): void => {
    campaignOutcome.textContent =
      campaign.outcome === 'won'
        ? '캠페인 완료'
        : campaign.outcome === 'lost'
          ? '캠페인 종료'
          : '캠페인 진행 중'
    campaignReached.textContent = `${campaign.stageId} / ${campaign.stageCount}`
    campaignTotalKills.textContent = String(campaign.kills)
    campaignHeldCards.textContent = cardSummary(campaign)
    campaignFallen.replaceChildren(...fallenItems(campaign))
  }

  /**
   * §1.4's OTHER end — the one where the campaign ran out of stages because the squad won them.
   *
   * `end === 'complete'` is the only state that reaches here, and it is checked rather than
   * `outcome === 'won'` because those are not the same question: a campaign that ends with nobody
   * standing (`no-survivors`) has won its last stage too, and it is not this screen.
   */
  const renderEnding = (campaign: CampaignHud): void => {
    if (campaign.end !== 'complete') return
    endingStages.replaceChildren(
      ...Array.from({ length: campaign.stageCount }, (_, index) => {
        const item = document.createElement('li')
        item.textContent = String(index + 1)
        return item
      }),
    )
    endingKills.textContent = String(campaign.kills)
    endingSurvivorCount.textContent = `${campaign.survivors.length}명`
    endingLostCount.textContent = `${campaign.fallen.length}명`
    endingSurvivors.replaceChildren(
      ...(campaign.survivors.length === 0
        ? [textItem('없음')]
        : campaign.survivors.map((entry) =>
            textItem(`${entry.isCommand ? '★ ' : ''}${entry.name}`))),
    )
    endingFallen.replaceChildren(...fallenItems(campaign))
    endingCards.textContent = cardSummary(campaign)
  }

  const render = (view: BattleHud): void => {
    const campaign = controller.campaign()
    renderVisibility(view.mode, campaign)
    renderHud(view)
    renderUpgrade(view)
    renderTerminal(view)
    renderTransition(campaign)
    renderCampaignSummary(campaign)
    renderEnding(campaign)
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

function cardSummary(campaign: CampaignHud): string {
  if (campaign.cards.length === 0) return '없음'
  return campaign.cards.map((card) => `${card.name}(${card.effect})`).join(' · ')
}

/**
 * §1.14: the dead, BY NAME.
 *
 * The stage number rides along because a campaign is seven fights and "누가 죽었는지" is only half
 * the record without "어디에서".
 */
function fallenItems(campaign: CampaignHud): HTMLLIElement[] {
  if (campaign.fallen.length === 0) return [textItem('없음')]
  return campaign.fallen.map((entry) => textItem(`${entry.name} — 스테이지 ${entry.stageId}`))
}
