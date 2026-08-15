# 테이블탑 3렌더러 비교 프로토타입 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Each implementation task uses superpowers:test-driven-development, then independent spec/code review before the next task.

**Goal:** 하나의 결정론적 분대 생존 전투 코어를 Phaser 2D, Three.js 2.5D, Three.js 3D로 렌더링해 같은 URL에서 플레이·측정·비교하고 최종 렌더러를 선택한다.

**Architecture:** Vite가 공통 TypeScript 코어와 앱 셸을 로드하고 각 렌더러는 동적 import한다. 코어는 30Hz 고정 스텝, 단일 시드 PRNG, 안정적인 ID 순서와 입력 로그를 소유한다. 렌더러는 불변 `RenderSnapshot`만 받아 표시하며 게임 판정을 수정하지 않는다.

**Tech Stack:** Node 22, npm, Vite, TypeScript, Vitest, Playwright, Phaser, Three.js, GitHub Pages. Task 0에서 `npm view <pkg> version dist-tags --json`으로 최신 안정 태그를 확인하고 정확한 버전을 lockfile과 README에 기록한다. 프리릴리스는 사용하지 않으며 Phaser 4가 안정 `latest`가 아니면 Phaser 3의 최신 안정판을 사용한다.

**Scope:** 성장 선택·캠페인·영구 저장·완성 오디오를 제외한다. 코드로 생성한 프록시 기하·텍스처만 사용하며 모든 에셋 출처를 기록한다. 각 렌더러와 전용 프록시는 최대 8 작업시간이다.

## 테스트 환경

- Vitest `jsdom`: 코어, PRNG, 입력 로그, metrics, quality ladder와 fake renderer 계약만 실행한다.
- Playwright Chromium: Phaser·Three.js 실제 WebGL/Canvas renderer의 통합 테스트를 실행한다. 렌더러 테스트 파일(`phaser-renderer.spec.ts`, `hybrid-renderer.spec.ts`, `three-renderer.spec.ts`)은 Playwright 전용이다.
- 렌더러 단언은 픽셀 일치가 아니라 장면 진단 API의 객체 수, 위치, tint, billboard 방향, instance matrix와 자원 카운터를 사용한다.
- 성능 판정은 Playwright headed 시스템 Chrome에서만 실행한다. 일반 CI/headless 결과는 기능 회귀용이며 FPS 선택 근거로 쓰지 않는다.

---

### Task 0: 프로젝트 기반과 배포 가능한 앱 셸

**Files:**
- Create: `prototype/package.json`
- Create: `prototype/package-lock.json`
- Create: `prototype/tsconfig.json`
- Create: `prototype/vite.config.ts`
- Create: `prototype/playwright.config.ts`
- Create: `prototype/.gitignore`
- Create: `prototype/README.md`
- Create: `prototype/index.html`
- Create: `prototype/src/main.ts`
- Create: `prototype/src/app/app-shell.ts`
- Create: `prototype/src/app/styles.css`
- Create: `prototype/tests/app-shell.spec.ts`
- Create: `docs/assets-license.md`

**Interfaces:** `mountApp(root: HTMLElement): void`; `?renderer=2d|hybrid|3d&enemies=100|200|300&seed=...`

1. Playwright 테스트를 먼저 작성해 제목, 3개 렌더러 버튼, 적 수·시드 설정, 조작 안내, 잘못된 URL의 기본값 복구를 단언한다.
2. 테스트가 앱 부재로 실패하는지 실행한다.
3. 패키지의 안정 dist-tag를 확인해 lockfile로 고정하고 버전·선택 근거를 README에 기록한다. `.gitignore`에 `node_modules`, `dist`, `test-results`, Playwright 산출물을 추가하고 `npx playwright install chromium`을 실행한다.
4. 최소 Vite/TS 앱 셸과 접근 가능한 선택 UI를 구현한다. 아직 렌더러를 import하지 않는다.
5. GitHub Pages를 대상으로 저장소 이름에서 Vite `base`를 설정하고 `npm run deploy` 또는 GitHub Actions Pages 배포 명령을 추가한다. 원격이 없으면 `gh`로 사용자 소유 public 저장소를 생성해 `origin`으로 연결한 뒤 배포한다.
6. `npm run build`, `npm run test`, `npm run test:e2e`를 실행하고 공개 Pages URL을 새 Chromium에서 확인한다.

**완료:** 프로덕션 빌드가 생성되고 공개 GitHub Pages URL을 새 브라우저에서 열어 앱 셸과 안내를 볼 수 있다.

### Task 1: 결정론적 전투 코어와 시나리오

**Files:**
- Create: `prototype/src/core/types.ts`
- Create: `prototype/src/core/prng.ts`
- Create: `prototype/src/core/input-log.ts`
- Create: `prototype/src/core/simulation.ts`
- Create: `prototype/src/core/snapshot.ts`
- Create: `prototype/src/scenarios/renderer-benchmark.ts`
- Create: `prototype/tests/core/*.test.ts`

**Interfaces:** `createSimulation(config)`, `step(input)`, `getSnapshot()`, `restart()`, `SimulationResult`; `RenderEffect.kind` uses `rescue-signal`.

1. 같은 seed+input의 snapshot hash 일치, 다른 seed 차이, `Math.random` 미사용, ID 순서, 75초 성공, 전멸 실패, 재시작을 실패 테스트로 작성한다.
2. xorshift32 PRNG, 숫자 ID, 30Hz 코어, 두 8인 분대, 지휘관, 적 웨이브, 자동 공격, 피로, 구조, 사기 붕괴의 최소 상태 전이를 구현한다.
3. 프레임 누적 루프 유틸을 작성한다. 프레임당 최대 5틱만 처리하고 초과 누적 시간을 버리며 해당 성능 표본을 무효로 표시한다.
4. `RenderSnapshot`의 모든 배열을 ID 오름차순으로 직렬화하고 이펙트 수명을 tick으로 관리한다.
5. `npm run test -- core`와 타입 검사를 실행한다.

**완료:** 반복 실행의 최종 snapshot hash가 같고 승패·재시작·5틱 상한 테스트가 통과한다.

### Task 2: 렌더러 계약, 앱 루프와 측정 기반

**Files:**
- Create: `prototype/src/renderers/contract.ts`
- Create: `prototype/src/renderers/registry.ts`
- Create: `prototype/src/app/game-controller.ts`
- Create: `prototype/src/metrics/frame-metrics.ts`
- Create: `prototype/src/metrics/quality-ladder.ts`
- Create: `prototype/src/metrics/report.ts`
- Create: `prototype/tests/renderer-contract.test.ts`
- Create: `prototype/tests/metrics.test.ts`

**Interfaces:** `GameRenderer` includes `applyQuality(level)`; `RendererMetrics`; `loadRenderer(kind)` dynamic import; `exportReport()`.

1. fake renderer로 mount/render/resize/dispose, 이중 dispose, 캔버스·리스너 기준선 복귀, 동적 import, p95 계산, 무효 표본 제외와 `applyQuality` 테스트를 먼저 작성한다.
2. 코어 30Hz와 RAF 렌더 루프를 연결하고 자동 벤치마크/수동 플레이를 분리한다.
3. 3초 연속 p95 > 33ms이면 파티클 50%, 그림자 512px, DPR 1.0 순으로 적용하는 quality ladder를 구현한다. 적용 뒤 5초 안정화와 10초 회복 창을 상태로 노출한다.
4. FPS, p95, 로드 시간, 활성 유닛, 엔진별 draw-call 참고값, 품질 단계를 HUD와 JSON에 기록한다.
5. WebGL 지원을 감지해 2.5D·3D 버튼을 비활성화하고 이유를 표시한다. 렌더러 mount/render 오류는 error boundary가 포착해 앱을 중단하지 않고 선택 화면으로 복귀한다.
6. renderer 전환 시 dispose 후 동일 seed·시나리오를 재시작한다.
7. 전체 단위 테스트와 타입 검사를 실행한다.

**완료:** fake renderer 계약과 측정 JSON이 통과하고 자동/수동 결과가 구분된다.

### Task 3: Phaser 2D 가상 디오라마

**Files:**
- Create: `prototype/src/renderers/phaser-2d/index.ts`
- Create: `prototype/src/renderers/phaser-2d/phaser-renderer.ts`
- Create: `prototype/src/renderers/phaser-2d/procedural-assets.ts`
- Create: `prototype/tests/phaser-renderer.spec.ts`
- Create: `prototype/tests/phaser-play.spec.ts`

1. Playwright에서 snapshot fixture의 장면 객체 수·분대 tint·지휘관·구조 대상·적 지휘관 표시, dispose 멱등성, Canvas fallback 테스트를 먼저 작성한다.
2. 코드 생성 텍스처, Y 정렬, 크기, 타원 그림자로 골판지 디오라마를 구현한다.
3. 이동(WASD/화살표·포인터), 분대 전환(Tab/버튼), 성공·실패·재시작, 항상 보이는 안내를 연결한다.
4. quality hook으로 효과 스프라이트 수를 100%에서 50%로 낮추고 DPR 단계를 적용한다.
5. 100·200·300명 URL과 JSON 내보내기 Playwright 테스트를 통과시킨다.
6. `docs/assets-license.md`에 코드 생성 에셋을 기록한다.

**완료:** 300명 장면을 수동 플레이해 성공 또는 실패·재시작까지 진행하고 2D 계약 테스트가 통과한다.

### Task 4: Three.js 2.5D 혼합

**Files:**
- Create: `prototype/src/renderers/three-hybrid/index.ts`
- Create: `prototype/src/renderers/three-hybrid/hybrid-renderer.ts`
- Create: `prototype/src/renderers/three-shared/scene-utils.ts`
- Create: `prototype/tests/hybrid-renderer.spec.ts`
- Create: `prototype/tests/hybrid-play.spec.ts`

1. Playwright에서 같은 fixture의 장면 객체 수·위치·tint, 등가 월드 영역, 지휘관 화면 높이 ±10%, billboard 방향, dispose 자원 기준 테스트를 먼저 작성한다.
2. 직교 카메라, 코드 생성 골판지 메시, 2D 병사 billboard, 제한된 그림자와 rescue signal을 구현한다.
3. quality hook으로 파티클, 그림자 512px, DPR 1.0 단계를 적용한다.
4. Three.js `renderer.info.render.calls`와 자원 카운터를 보고한다.
5. 2D와 같은 입력·승패·재시작 E2E를 실행하고 같은 tick을 캡처한다.

**완료:** 2.5D가 동일 snapshot fixture와 플레이 흐름을 렌더링하고 계약·프레이밍 테스트가 통과한다.

### Task 5: Three.js 실시간 3D

**Files:**
- Create: `prototype/src/renderers/three-3d/index.ts`
- Create: `prototype/src/renderers/three-3d/three-renderer.ts`
- Create: `prototype/src/renderers/three-3d/procedural-models.ts`
- Create: `prototype/tests/three-renderer.spec.ts`
- Create: `prototype/tests/three-play.spec.ts`

1. Playwright에서 같은 fixture, 유닛별 instance matrix·tint, 1,500 삼각형 제한, 등가 프레이밍, dispose 테스트를 먼저 작성한다.
2. 저폴리 미니어처와 적을 `InstancedMesh`, 상태별 색·스케일·기울기로 구현한다.
3. quality hook으로 파티클, 그림자 512px, DPR 1.0 단계를 적용한다.
4. 3D 전용 자원·드로우콜과 품질 저하를 보고한다.
5. 같은 입력·승패·재시작 E2E와 동일 tick 캡처를 실행한다.

**완료:** 3D가 동일 fixture와 플레이 흐름을 렌더링하고 instance·계약·프레이밍 테스트가 통과한다.

### Task 6: 자동 비교, 공개 검증과 선택 보고서

**Files:**
- Create: `prototype/scripts/benchmark.mjs`
- Create: `prototype/tests/renderer-switching.spec.ts`
- Create: `prototype/tests/benchmark.spec.ts`
- Create: `docs/proposals/technology/05-renderer-comparison-results.md`
- Modify: `docs/assets-license.md`
- Modify: `docs/codex-usage-log.md`

1. 자동 모드 100·200·300명, 같은 seed/tick 캡처, 빈 캐시 load, 10회 전환·GC·heap, 품질 회복 창, WebGL 비활성화와 강제 렌더러 오류 뒤 선택 화면 복귀 테스트를 작성한다.
2. 시스템 Chrome을 headed·하드웨어 GPU로 실행해 프로덕션 빌드의 10초 예열+60초를 측정한다. `WEBGL_debug_renderer_info`의 GPU vendor/renderer를 JSON에 저장하고 SwiftShader·software renderer 표본은 무효 처리한다.
3. 정성 점수와 병과 1종 제작량 외삽표를 작성한다. draw-call은 엔진 간 순위를 매기지 않는다.
4. 선택 규칙 1~6을 적용한다. 전원 탈락이면 공유 코어 1회와 렌더러별 2시간 이내 최적화 후 재측정한다.
5. 공개 URL을 깨끗한 Chrome·Safari에서 검증하고 조작 안내·플레이 종료·재시작을 확인한다. 코드 생성 정책이 에셋 로드 실패 fallback을 대체했음을 보고서에 기록한다.
6. Codex/Advisor/서브에이전트 활용과 검증 근거를 사용 기록에 갱신한다.

**완료:** 비교 결과·캡처·라이선스·제작 비용·공개 URL과 최종 렌더러 선택 근거가 남는다.

## 리뷰 루프

각 Task마다 다음 순서를 반복한다.

1. implementer 서브에이전트가 실패 테스트를 확인하고 최소 구현한다.
2. spec reviewer가 설계·Task 완료 기준을 검토한다.
3. code-quality reviewer가 결함·누수·과잉 구현을 검토한다.
4. REVISE이면 같은 Task 안에서 수정·전체 재검증 후 재리뷰한다.
5. 모든 현재 검증 결과와 diff를 같은 fable Advisor 세션 또는 복구 세션에 제출한다. `APPROVED` 뒤 다음 Task로 이동한다.

커밋은 사용자가 명시적으로 요청할 때만 수행한다.
