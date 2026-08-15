import { createGameController, type GameController, type GameMode } from './game-controller'
import type { RendererKind } from '../renderers/contract'
import type { SimulationResult } from '../core/types'

type EnemyCount = '100' | '200' | '300'

type AppDependencies = {
  readonly webglSupported?: () => boolean
  readonly createController?: (options: {
    host: HTMLElement
    kind: RendererKind
    mode: GameMode
    config: { seed: string; enemyCount: 100 | 200 | 300 }
    onHud: (metrics: { fps: number; p95Ms: number; loadMs: number; activeUnits: number; drawCalls: number | null; textures: number | null; geometries: number | null; qualityLevel: string }) => void
  }) => Pick<GameController, 'start' | 'dispose'>
}

const defaultSettings = {
  renderer: '2d' as RendererKind,
  enemies: '100' as EnemyCount,
  seed: 'tabletop-001',
}

const rendererLabels: ReadonlyArray<[RendererKind, string, string]> = [
  ['2d', 'Phaser 2D', '가상 디오라마'],
  ['hybrid', 'Three.js 2.5D', '빌보드와 3D 지형'],
  ['3d', 'Three.js 3D', '실시간 미니어처'],
]

function readSettings(search: string) {
  const params = new URLSearchParams(search)
  const renderer = params.get('renderer')
  const enemies = params.get('enemies')
  const seed = params.get('seed')?.trim()
  const mode = params.get('mode')
  const forceRendererError = params.get('forceRendererError') === '1'

  return {
    renderer: rendererLabels.some(([kind]) => kind === renderer)
      ? (renderer as RendererKind)
      : defaultSettings.renderer,
    enemies: ['100', '200', '300'].includes(enemies ?? '')
      ? (enemies as EnemyCount)
      : defaultSettings.enemies,
    seed: seed?.slice(0, 64) || defaultSettings.seed,
    mode: mode === 'benchmark' ? ('benchmark' as const) : ('manual' as const),
    forceRendererError,
  }
}

export function mountApp(root: HTMLElement, dependencies: AppDependencies = {}): void {
  const settings = readSettings(window.location.search)
  const webglSupported = dependencies.webglSupported?.() ?? supportsWebGl()
  if (!webglSupported && settings.renderer !== '2d') settings.renderer = '2d'

  const renderSelection = (message?: string) => {
    root.innerHTML = `
      <main class="app-shell">
        <header class="hero">
          <p class="eyebrow">렌더러 선택 실험</p>
          <h1>테이블탑 렌더러 비교</h1>
          <p class="lede">동일한 분대 생존 전투를 세 가지 표현 방식으로 플레이하고 비교합니다.</p>
        </header>
        ${message ? `<p role="alert">${escapeAttribute(message)}</p>` : ''}
        <section class="panel" aria-labelledby="renderer-title">
          <h2 id="renderer-title">1. 렌더러 선택</h2>
          <div class="renderer-grid">
            ${rendererLabels
              .map(
                ([kind, label, description]) => `
                  <button
                    type="button"
                    class="renderer-card"
                    data-renderer="${kind}"
                    aria-pressed="${settings.renderer === kind}"
                    ${!webglSupported && kind !== '2d' ? 'disabled aria-describedby="webgl-reason"' : ''}
                  >
                    <strong>${label}</strong>
                    <span>${description}</span>
                  </button>
                `,
              )
              .join('')}
          </div>
          ${!webglSupported ? '<p id="webgl-reason">WebGL을 사용할 수 없어 2.5D와 3D 렌더러를 선택할 수 없습니다.</p>' : ''}
        </section>
        <section class="panel" aria-labelledby="settings-title">
          <h2 id="settings-title">2. 전투 조건</h2>
          <div class="settings-grid">
            <label>
              <span>적 수</span>
              <select id="enemy-count">
                ${(['100', '200', '300'] as const)
                  .map(
                    (count) => `<option value="${count}"${settings.enemies === count ? ' selected' : ''}>${count}명</option>`,
                  )
                  .join('')}
              </select>
            </label>
            <label>
              <span>시드</span>
              <input id="seed" value="${escapeAttribute(settings.seed)}" maxlength="64" />
            </label>
          </div>
          <button type="button" data-start-game>게임 시작</button>
        </section>
        <aside class="controls" aria-labelledby="controls-title">
          <h2 id="controls-title">조작 안내</h2>
          <p>이동: WASD 또는 방향키</p>
          <p>분대 전환: Tab</p>
          <p>구조: Space</p>
        </aside>
      </main>
    `

    root.querySelectorAll<HTMLButtonElement>('[data-renderer]').forEach((button) => {
      button.addEventListener('click', () => {
        settings.renderer = button.dataset.renderer as RendererKind
        root.querySelectorAll<HTMLButtonElement>('[data-renderer]').forEach((choice) => {
          choice.setAttribute('aria-pressed', String(choice === button))
        })
      })
    })

    root.querySelector<HTMLButtonElement>('[data-start-game]')?.addEventListener('click', () => {
      const enemyCount = Number(root.querySelector<HTMLSelectElement>('#enemy-count')?.value) as 100 | 200 | 300
      const seed = root.querySelector<HTMLInputElement>('#seed')?.value.trim().slice(0, 64) || defaultSettings.seed
      startGame({ seed, enemyCount })
    })
  }

  const startGame = (config: { seed: string; enemyCount: 100 | 200 | 300 }) => {
    const clearDiagnostics = () => {
      delete (window as Window & { __TABLETOP_DIAGNOSTICS__?: unknown }).__TABLETOP_DIAGNOSTICS__
    }
    clearDiagnostics()
    root.innerHTML = `
      <main class="app-shell game-shell">
        <section class="game-stage" aria-label="전투 화면"></section>
        <p data-hud>로딩 중…</p>
        <aside class="controls game-controls" aria-labelledby="game-controls-title">
          <h2 id="game-controls-title">조작 안내</h2>
          <p>이동: WASD 또는 방향키 또는 전장 클릭</p>
          <p>분대 전환: Tab 또는 버튼</p>
          <p>구조: Space</p>
          <div class="game-actions">
            <button type="button" data-switch-squad>분대 전환</button>
            <button type="button" data-restart>다시 시작</button>
            <button type="button" data-export-report>JSON 내보내기</button>
          </div>
          <p role="status" data-result>전투 진행 중</p>
        </aside>
      </main>
    `
    const stage = root.querySelector<HTMLElement>('.game-stage')!
    const hud = root.querySelector<HTMLElement>('[data-hud]')!
    const onHud = (metrics: { fps: number; p95Ms: number; loadMs: number; activeUnits: number; drawCalls: number | null; textures: number | null; geometries: number | null; qualityLevel: string }) => {
      hud.textContent = `FPS ${metrics.fps.toFixed(1)} · p95 ${metrics.p95Ms.toFixed(1)}ms · 로드 ${metrics.loadMs.toFixed(1)}ms · 활성 유닛 ${metrics.activeUnits} · 드로우콜 ${metrics.drawCalls ?? '—'} · 텍스처 ${metrics.textures ?? '—'} · 지오메트리 ${metrics.geometries ?? '—'} · 품질 ${metrics.qualityLevel}`
    }
    const updateResult = (result: SimulationResult) => {
      const resultNode = root.querySelector<HTMLElement>('[data-result]')
      if (!resultNode) return
      resultNode.textContent = result === 'success' ? '승리: 전장을 지켜냈습니다.' : result === 'failure' ? '전멸: 분대가 무너졌습니다.' : '전투 진행 중'
    }
    const controller = dependencies.createController?.({ host: stage, kind: settings.renderer, mode: settings.mode, config, onHud })
      ?? createGameController({
        host: stage,
        kind: settings.renderer,
        mode: settings.mode,
        config,
        loadRenderer: settings.forceRendererError
          ? async () => { throw new Error('forced renderer error') }
          : undefined,
        onHud,
        onError: (error) => {
          clearDiagnostics()
          renderSelection(error.message)
        },
        onState: updateResult,
      })
    stage.addEventListener('pointerdown', (event) => {
      const interactive = controller as GameController
      if (!('setPointer' in interactive)) return
      const bounds = stage.getBoundingClientRect()
      interactive.setPointer((event.clientX - bounds.left - bounds.width / 2) / Math.max(1, bounds.width / 2), (event.clientY - bounds.top - bounds.height / 2) / Math.max(1, bounds.height / 2))
    })
    root.querySelector<HTMLButtonElement>('[data-switch-squad]')?.addEventListener('click', () => {
      const interactive = controller as GameController
      if ('requestSquadSwitch' in interactive) interactive.requestSquadSwitch()
    })
    root.querySelector<HTMLButtonElement>('[data-restart]')?.addEventListener('click', () => {
      const interactive = controller as GameController
      if ('restart' in interactive) interactive.restart()
    })
    root.querySelector<HTMLButtonElement>('[data-export-report]')?.addEventListener('click', () => {
      const interactive = controller as GameController
      if (!('exportReport' in interactive)) return
      const blob = new Blob([interactive.exportReport()], { type: 'application/json' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `tabletop-${settings.renderer}-report.json`
      link.click()
      URL.revokeObjectURL(link.href)
    })
    const interactive = controller as GameController
    if ('getRendererDiagnostics' in interactive) {
      const diagnosticWindow = window as Window & { __TABLETOP_DIAGNOSTICS__?: Record<string, unknown> }
      const diagnostics: Record<string, unknown> = {
        get rendererType() { return (interactive.getRendererDiagnostics() as { rendererType?: string } | null)?.rendererType ?? 'canvas' },
        get instancedMesh() { return (interactive.getRendererDiagnostics() as { instancedMesh?: unknown } | null)?.instancedMesh ?? {} },
        get objectCount() { return (interactive.getRendererDiagnostics() as { objectCount?: number } | null)?.objectCount ?? 0 },
        get snapshotUnitIds() { return (interactive.getRendererDiagnostics() as { snapshotUnitIds?: readonly number[] } | null)?.snapshotUnitIds ?? [] },
        get snapshotUnits() { return (interactive.getRendererDiagnostics() as { snapshotUnits?: unknown } | null)?.snapshotUnits ?? [] },
        get teamTints() { return (interactive.getRendererDiagnostics() as { teamTints?: unknown } | null)?.teamTints ?? {} },
        get markers() { return (interactive.getRendererDiagnostics() as { markers?: unknown } | null)?.markers ?? {} },
        get yOrdered() { return (interactive.getRendererDiagnostics() as { yOrdered?: boolean } | null)?.yOrdered ?? false },
        get visualFrame() { return (interactive.getRendererDiagnostics() as { visualFrame?: unknown } | null)?.visualFrame ?? {} },
        get quality() { return (interactive.getRendererDiagnostics() as { quality?: unknown } | null)?.quality ?? {} },
        get qualityState() { return interactive.getQualityState() },
        get metrics() { return interactive.getHud() },
        get actualChildCount() { return (interactive.getRendererDiagnostics() as { actualChildCount?: number } | null)?.actualChildCount ?? 0 },
        get visualUnitCount() { return (interactive.getRendererDiagnostics() as { visualUnitCount?: number } | null)?.visualUnitCount ?? 0 },
        get generatedTextureCount() { return (interactive.getRendererDiagnostics() as { generatedTextureCount?: number } | null)?.generatedTextureCount ?? 0 },
        get unitDepthOrder() { return (interactive.getRendererDiagnostics() as { unitDepthOrder?: unknown } | null)?.unitDepthOrder ?? [] },
        get actualObjectCount() { return (interactive.getRendererDiagnostics() as { actualObjectCount?: number } | null)?.actualObjectCount ?? 0 },
        get visualEffectCount() { return (interactive.getRendererDiagnostics() as { visualEffectCount?: number } | null)?.visualEffectCount ?? 0 },
        get unitVisuals() { return (interactive.getRendererDiagnostics() as { unitVisuals?: unknown } | null)?.unitVisuals ?? [] },
        get worldBounds() { return (interactive.getRendererDiagnostics() as { worldBounds?: unknown } | null)?.worldBounds ?? {} },
        get camera() { return (interactive.getRendererDiagnostics() as { camera?: unknown } | null)?.camera ?? {} },
        get rescueSignalCount() { return (interactive.getRendererDiagnostics() as { rescueSignalCount?: number } | null)?.rescueSignalCount ?? 0 },
        get activeSquad() { return interactive.getActiveSquad() },
        get tick() { return interactive.getSnapshot().tick },
        get result() { return interactive.getResult() },
        get unitPositions() { return Object.fromEntries(interactive.getSnapshot().units.map((unit) => [String(unit.id), { x: unit.x, y: unit.y }])) },
        applyQuality: (level: 'full' | 'reduced-particles' | 'reduced-shadows' | 'low-dpr') => interactive.applyQuality(level),
        isYOrdered: (order: readonly { readonly id: number; readonly depth: number }[]) => (interactive.getRendererDiagnostics() as { isYOrdered?: (value: typeof order) => boolean } | null)?.isYOrdered?.(order) ?? false,
        exportReport: () => interactive.exportReport(),
        dispose: () => {
          interactive.dispose()
          clearDiagnostics()
        },
      }
      // Benchmark mode is intentionally the only production-visible diagnostic
      // surface.  This lets the capture script prove the fixed-tick protocol
      // against `vite preview` without exposing controls in normal play.
      if (import.meta.env.DEV || settings.mode === 'benchmark') diagnostics.advance = (ticks: number) => interactive.advanceForDiagnostics(ticks)
      if (settings.mode === 'benchmark') {
        diagnostics.switchRenderer = async (kind: RendererKind) => interactive.switchRenderer(kind)
        diagnostics.canvasCount = () => document.querySelectorAll('.game-stage canvas').length
        diagnostics.heapSample = () => {
          const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          return memory ? memory.usedJSHeapSize : null
        }
        diagnostics.gc = () => {
          const collect = (globalThis as typeof globalThis & { gc?: () => void }).gc
          if (!collect) return false
          collect()
          return true
        }
      }
      diagnosticWindow.__TABLETOP_DIAGNOSTICS__ = diagnostics
    }
    void controller.start().catch((error: unknown) => {
      controller.dispose()
      renderSelection(error instanceof Error ? error.message : '렌더러를 시작할 수 없습니다.')
    })
  }

  renderSelection()
}

function supportsWebGl(): boolean {
  const canvas = document.createElement('canvas')
  try {
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
