# Codex 활용 기록

## 2026-08-15

### 분대 생존 수직 슬라이스 Task 1 — 권위 상태·named PRNG·입력 queue

- 목표: 이후 gameplay task가 공유할 초기 권위 상태, 세 개의 이름 있는 PRNG stream, 정렬·복사 입력 queue의 최소 계약을 고정한다.
- Codex 활용: Codebase Knowledge Graph로 기존 `createPrng`와 prototype 구조를 확인하고 `superpowers:test-driven-development` 절차로 foundation 테스트를 먼저 작성했다. RED에서 gameplay 모듈 부재를 확인한 뒤 타입·상수·초기 state·queue를 최소 구현했다. 읽기 전용 Advisor 호출은 시도했으나 Fable 사용량 제한과 Opus 호출 무응답으로 판정 근거를 받지 못해 승인으로 표시하지 않았다.
- 주요 산출물: `prototype/src/core/gameplay/types.ts`, `constants.ts`, `input-queue.ts`, `state.ts`, `prototype/src/core/prng.ts`의 `getState()`, foundation 테스트.
- 검증 근거: RED `npm test -- tests/core/gameplay-foundation.test.ts`에서 gameplay import 미해결 실패. GREEN foundation+determinism `2 files / 11 tests`, 전체 Vitest `8 files / 69 tests`, TypeScript·Vite build 통과, `git diff --check` 통과.
- 결정: state는 plain numeric PRNG state만 저장하고 `:spawn`, `:cards`, `:formation` stream을 분리했다. formation은 초기 16개 X/Y jitter만 소비하며, 초기 분대 중심은 teal `(21,13)`, scarlet `(27,13)`로 설계 수치에 맞췄다.
- 다음 단계: Task 2에서 이 state를 소비하는 simulation facade와 digest를 추가한다.

#### Task 1 fix round 1

- 목표: review에서 발견된 formation PRNG under-consumption과 mutable vector alias를 권위 state 경계에서 제거했다.
- 변경: 두 분대 16명 모두 별도의 formation PRNG X/Y jitter pair를 소비하도록 고쳤고, 각 `formationOffset`·`lastCenter`를 소유 객체로 복사했다. 16개 고유 offset object, 32회 PRNG 소비, sibling/constant mutation isolation을 테스트로 고정했다.
- 검증: foundation 4/4, foundation+determinism 13/13, 전체 Vitest 71/71, TypeScript·Vite build, `git diff --check` 통과. Vite 기존 large-chunk warning만 남았다.
- 산출물: fix commit `0f1ac7a` (`fix: isolate gameplay formation state`).

### 30초 수직 슬라이스 구현 계획

- 목표: 승인된 게임 명세를 기존 renderer 비교 프로토타입에 안전하게 연결할 task별 TDD·리뷰 계획으로 변환한다.
- Codex 활용: `superpowers:writing-plans`로 현재 core/controller/shell/renderer 경계를 조사하고 11개 독립 review gate로 분해했다. 읽기 전용 서브에이전트가 권위 코어, 앱·실제 입력, renderer·테스트 경계를 병렬로 대조했고 최종 명세 coverage·placeholder·type/command consistency는 controller가 직접 점검했다.
- 주요 결정: 구형 `simulation.ts`, `game-controller.ts`, `app-shell.ts`는 `?lab=renderers` 격리 경계로 보존한다. 새 gameplay는 `core/gameplay/`, `gameplay-controller.ts`, `gameplay-shell.ts`로 분리하고 기본 route에서 Three.js 2.5D만 동적 로드한다.
- Advisor: 기본 Opus(`claude-opus-5`) 세션 `22f8a387-7dd6-4cb3-a7d5-feb81970ca2c`에 계획 브리프를 요청했다. 조사 tool call 뒤 허용 태그 없이 `No response requested.`를 반환했고 한 번의 형식 교정에도 같은 응답이 반복되어 Advisor 스킬 규약에 따라 중단했다. 이번 계획을 Advisor 승인으로 표시하지 않는다.
- 독립 계획 리뷰: 첫 `REVISE`에서 미정의 fixture helper, 구조 double-hit 순증, ready/running 경계, paused 입력, unit/Playwright 단계 혼합, tuning gate와 exact UI copy를 지적했다. 공용 fixture API와 권위 타입을 정의하고 순증 `-29`, zero-time start, paused 무이벤트, 정확한 `Q로 분대를 전환하세요`를 반영했다. 재검토의 `wave.deferred`/`discarded` 불일치까지 고쳐 최종 `APPROVE`를 받았다.
- 산출물: `docs/superpowers/plans/2026-08-15-squad-survivor-vertical-slice-implementation.md`.
- 검증: 11개 task heading, 명세 13개 주요 절의 task 매핑, 금지 placeholder, package script 존재, `git diff --check`를 확인했다.
- 다음 단계: 격리 feature worktree를 만들고 `superpowers:subagent-driven-development`로 Task 1부터 구현·task review·fix loop를 연속 실행한다.

### 30초 분대 생존 수직 슬라이스 명세 개정

- 목표: 적대적 리뷰에서 구현 불가 판정을 받은 90초 설계를 실제 재미와 플레이어 에이전시를 먼저 검증하는 30초 수직 슬라이스로 축소한다.
- Codex 활용: `superpowers:brainstorming`으로 승인된 축소 방향을 명세화하고, Opus Advisor 세션 `ac569e0b-f4e3-494f-b3eb-c8021ba52a55`에서 스폰·전투 수치·입력·결정론·인수 기준을 반복 적대 검토했다. 지적을 수정하고 다음 라운드를 재개했으며, 이견은 계산과 상태 계약으로 논쟁한 뒤 옳은 결론을 명세에 반영했다.
- 주요 변경: 지휘관·사기·다중 성장·renderer parity를 제외했다. 두 8인 분대, 97회 일반 적 요청, 18초 정예, 교대 피로, 1인 홀드 구조, 3택 1회 강화, 분리 PRNG, 권위 상태 digest와 8-seed 에이전시 정책을 정확한 tick 계약으로 정의했다.
- Advisor 반영: 양 분대 정예 우선, HP·TTK 경계, contact slot 재표적, formation 단위 예고 회피, cooldown·사망·승패 순서, pause 입력 폐기, spawn PRNG 소비, 카드 영향표, 압박 backlog, 결정론 fixture, 무기립 적 정지와 이동 clamp를 보정했다. Advisor 최종 요약 기준 8개 라운드에서 `Critical 12 / Important 13 / Minor 12`를 해소했고 최종 `APPROVED (Critical 0 / Important 0 / Minor 0)`를 받았다.
- 논쟁 결과: Advisor의 HP 25·최소 병력 `7/8명` 계산, 전술 무입력 tick 900 fixture, 과거 압박률 파생값은 기각·교정했다. 반대로 360 tick 창의 발사 횟수가 cooldown 위상에 따라 달라진다는 Worker 주장은 10·18 tick 모두 정확히 나누어떨어진다는 Advisor 반론이 맞아 철회했다. 완전 무입력은 강화 modal에서 멈추므로 전술 무입력과 결정론 fixture가 `power`를 선택하도록 분리했다.
- 산출물: `docs/superpowers/specs/2026-08-14-squad-survivor-gameplay-design.md`, `docs/advisor-reviews/2026-08-14-gameplay-design-opus-redteam.md`.
- 검증: 일반 적 요청 97·event 35, 정예 drift guard TTK `329/411/308/369 tick`, 강화 후 이상 피해 `37.44`, 압박 backlog `9.6~12.7명`과 cap 도달 `tick 630~690`, spawn·예고 tick 수열, placeholder 검색과 `git diff --check`를 확인했다.
- 다음 단계: 사용자가 수정 명세를 검토·승인하면 `superpowers:writing-plans`로 구현 계획을 작성한다.

## 2026-08-14

### 성능 측정 선행 오류 정정과 게임 완성도 감사

- 목표: 렌더러 선택 전에 실제 게임이 Track 1 제출 수준으로 만들어졌는지 검증한다.
- Codex 활용: 코드·브라우저 화면·시뮬레이션 결과를 함께 감사했다. 무입력, 구조, 지속 이동, benchmark 입력을 적 100·200·300명에서 동일 seed로 비교했다.
- 결과: 100·200명은 입력과 무관하게 75초 승리하고 300명은 입력과 무관하게 tick 2175~2200에 전멸했다. 이동·분대 전환·구조가 승패를 실질적으로 바꾸지 않아 현재 산출물을 게임이 아닌 renderer 비교 기술 프로토타입으로 판정했다.
- 주요 산출물: `docs/reviews/2026-08-14-game-completeness-audit.md`.
- 결정: Three.js 2.5D 선택은 후보 방향으로만 유지하고, 성능 최적화·공개 배포보다 플레이어 agency·성장·지휘·구조·웨이브·게임 UI 구현을 우선한다.
- 다음 단계: 감사 문서의 순서대로 핵심 게임 루프를 재설계하고 TDD 구현한다.

### 분대 생존 게임 핵심 루프 설계 승인

- 목표: 기술 프로토타입을 실제 90초 분대 생존 게임으로 전환할 명확한 범위와 인수 기준을 확정한다.
- Codex 활용: `superpowers:brainstorming`으로 핵심 루프, 전투·성장, UI·기술 구조를 세 단계로 제안하고 사용자 승인을 받았다. Opus Advisor의 게임 완성도 감사에서 적 공격 부재, 위치 무관 자동전투, 무제한 구조, 죽은 피로·사기 수치와 잘못된 테스트 계약을 확인해 설계에 반영했다.
- 사용자 결정: 생존 성장과 두 분대 지휘를 결합한 1번 방향을 승인했다. Three.js 2.5D를 기본 표현으로, Phaser Canvas 2D를 fallback으로 유지한다.
- 주요 산출물: `docs/superpowers/specs/2026-08-14-squad-survivor-gameplay-design.md`.
- 다음 단계: 사용자 명세 검토 승인 후 구현 계획을 작성한다.

### 핵심 게임 루프 명세 이중 적대적 리뷰

- 목표: 구현 전에 설계가 실제 재미와 에이전시를 만들 수 있는지 공격적으로 검증한다.
- Codex 활용: 사용자 요청에 따라 Opus Advisor와 독립 서브에이전트가 같은 명세를 별도로 red-team했다. 두 리뷰 모두 파일을 수정하지 않았다.
- 결과: Opus는 `REVISE`, 서브에이전트는 `REJECT`를 판정했다. 공통 차단점은 스폰·보스 수치 불성립, Space/pointer/pause 입력 계약 부재, 결정론 digest 불완전, 역할 수치 모순, 과도한 renderer·사기·강화 범위, 인수 테스트 과적합 위험이다.
- 산출물: `docs/advisor-reviews/2026-08-14-gameplay-design-opus-redteam.md`, `docs/reviews/2026-08-14-gameplay-design-subagent-redteam.md`.
- 다음 단계: 30초 수직 슬라이스로 범위를 줄이고 입력·PRNG·권위 상태·스폰·파생 밸런스 표를 명세에 반영한 뒤 재리뷰한다.

### Apple M4 headed 비교와 최종 렌더러 선택

- 목표: 남은 하드웨어 GPU·cold-load·장시간 p95·WebKit 호환성 측정을 실행하고 최종 렌더러를 선택한다.
- Codex 활용: `systematic-debugging`과 TDD로 headed 측정의 `tick=0`, HUD p95 미노출, Three GPU probe 공백, 잘못된 16.67ms 선택 기준을 각각 재현·수정했다. 행별 새 browser context와 CDP GC로 cold-load·heap 증거를 만들었다.
- 검증: Apple M4 headed Chrome에서 9행 모두 10초 예열+60초 측정, parity·GPU·품질 안정 통과. 300명 p95는 2D 18.3ms, 2.5D 18.6ms, 3D 18.3ms다. 로컬 WebKit에서 세 렌더러 모두 300명 종료(tick 2200 failure)와 재시작을 통과했다.
- 산출물: `prototype/artifacts/benchmark-headed-m4.json`, `prototype/artifacts/captures/{2d,hybrid,3d}-tick-900.png`, renderer 비교 결과 문서.
- 결정: 설계 원문의 200명 ≤20ms·300명 ≤33ms 기준은 세 후보가 통과했다. 같은 tick 정성 평가에서 가독성과 테이블탑 촉감·발표 효과 균형이 가장 좋은 Three.js 2.5D를 최종 선택하고 Phaser Canvas 2D를 WebGL fallback으로 유지한다.
- 다음 단계: 사용자 승인 후 공개 URL에 배포하고 깨끗한 Chrome·Safari에서 최종 스모크를 수행한다.

### 테이블탑 비교 프로토타입 Task 6 — 자동 비교 프로토콜

- 목표: 세 렌더러를 같은 seed/tick으로 비교하고 전환·강제 오류·품질 회복·공개 검증을 기록할 수 있는 자동화 기반을 추가한다.
- 활용: TDD로 `benchmark.spec.ts`와 `renderer-switching.spec.ts`를 먼저 작성해 RED를 확인한 뒤 benchmark 정책 모듈과 강제 오류 URL 경계를 구현했다. Playwright·Vitest·Vite를 사용했다.
- 산출물: `prototype/scripts/benchmark.mjs`, 렌더러 전환/오류 복귀 브라우저 테스트, `docs/proposals/technology/05-renderer-comparison-results.md`, 라이선스 기록 보완.
- 검증: benchmark 단위 4/4, 전체 Vitest 67/67, Playwright 30/30, local artifact `prototype/artifacts/benchmark-local.json`의 9/9 parity·10/10 same-page 전환·canvas teardown. 실제 headed 하드웨어 GPU·빈 캐시·공개 Chrome/Safari URL은 권한과 장비가 없어 미측정으로 명시했다.
- 결정: draw-call은 엔진 간 순위를 매기지 않고, 공개 배포·최종 선택은 사용자 승인 후 같은 프로토콜로 수행한다.
- 다음 단계: Task 6 spec/code review와 Opus Advisor 검토 후 미측정 게이트를 채우거나 최종 렌더러를 선택한다.

## 2026-08-14

### 테이블탑 비교 프로토타입 Task 5 — Three.js 실시간 3D Advisor 승인

- 목표: 실제 Three.js 3D renderer를 구현하고 Phaser·Three hybrid와 결정론 gameplay parity를 확인한다.
- 활용: TDD subagent 구현, Playwright/Vitest/build 검증, 독립 사양 리뷰, 명시 Opus Advisor 검토를 사용했다.
- 결과: `InstancedMesh` 320 capacity, 코드 생성 저폴리 모델, 실제 matrix/tint·shadow·particle·resource diagnostics, WebGL 오류/정리와 3-way parity를 반영했다.
- 검증: Vitest 63/63, build, Playwright 29/29, `git diff --check`. Opus Advisor `b51f16f6-9c5c-47c5-b936-1eadaeeb6497`가 APPROVED(비용 약 $1.60, fallback 없음)했다.
- 다음 단계: Task 6에서 cold-load·GPU 성능·renderer switching·공개 clean-browser 검증을 자동화하고 최종 선택 보고서를 작성한다.

## 2026-08-13

### 테이블탑 비교 프로토타입 Task 5 — Three.js 실시간 3D

- 목표: 동일한 결정론 2D 전투 snapshot을 실제 Three.js 저폴리 실시간 3D `InstancedMesh` 장면으로 렌더링하고, Phaser·2.5D와 gameplay parity를 유지한다.
- Codex 활용: Codebase Knowledge Graph로 contract/controller/snapshot/renderer lifecycle을 확인하고, Playwright-only 3D renderer·play 명세를 먼저 작성했다. RED는 pending 3D loader로 canvas 부재와 missing module에서 3개 실패했다. 이후 코드 생성 6면 원뿔 미니어처, X/Z snapshot 매핑, per-instance matrix/vertex color diagnostics, actual `renderer.info`/shadow render target probe로 최소 구현했다.
- 사용 스킬·도구·Advisor: `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Playwright, Three.js, Vite. 사용자 지시에 따라 Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 주요 산출물: `prototype/src/renderers/three-3d/`, 실제 literal dynamic `3d` loader, generated low-poly model, instance matrix/base-tint/state-tint diagnostics, orthographic framing, particle·512px shadow target·DPR 1 quality hooks, WebGL-unavailable error path, 3D play/parity E2E와 asset license entry.
- 검증 근거: targeted 3D Playwright 7/7, TypeScript+Vite build, full Vitest·Playwright·diff check 결과는 Task 5 report에 기록한다. Direct populated dispose에서 canvas 0 및 nullable renderer-info baseline을 확인했고, identical benchmark에서 318개 snapshot unit·terminal result·tick가 Phaser와 hybrid 양쪽에 일치했다.
- 주요 결정: 상태 색은 actual instance vertex color로 표현하되, cross-renderer 비교용 `snapshotUnits`는 동일 core team tint와 snapshot-space X/Y를 보존한다. 모든 3D 모델·파티클은 코드 생성으로, 외부 에셋을 사용하지 않는다.
- 다음 단계: Task 6에서 세 renderer의 cold load, draw call 및 production URL 측정을 비교한다.

### 테이블탑 비교 프로토타입 Task 4 — Three.js 2.5D

- 목표: 동일 결정론 코어를 Three.js orthographic 2.5D tabletop으로 렌더링하고 Phaser와 parity를 검증한다.
- Codex 활용: Playwright RED에서 hybrid loader·bounds·billboard 문제를 확인하고, 사양 리뷰의 cross-renderer 비교 공백을 동일 seed/input-log exact parity 테스트로 보완했다. 코드 리뷰에서 실제 shadow target 미재생성과 whole-root billboard 왜곡을 runtime probe로 재현한 뒤 두 차례 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:requesting-code-review`, `superpowers:receiving-code-review`, `superpowers:verification-before-completion`, Playwright, Three.js, Vite, 명시 Opus Advisor.
- 주요 산출물: `prototype/src/renderers/three-hybrid/`, `three-shared/scene-utils.ts`, orthographic camera·billboard·generated cardboard mesh/material·rescue signal·resource diagnostics.
- 검증 근거: Vitest 63/63, TypeScript·Vite build, Playwright 22/22, `git diff --check` 성공. Phaser와 Three의 318개 unit position/tint와 exact terminal result/tick parity를 확인했다.
- Advisor 판단과 반영: 명시 `--model opus`로 `APPROVED`를 받았다. 실제 shadow target 512↔1024와 card-only billboard를 확인했으며, 527KB Three와 1.38MB Phaser chunks는 Task 6 cold-load 측정으로 이월했다. 비용 약 $1.64, fallback 없음.
- 다음 단계: Task 5 Three.js 실시간 3D renderer를 같은 contract와 parity 기준으로 구현한다.

### 테이블탑 비교 프로토타입 Task 4 — Three.js 2.5D 혼합

- 목표: 공유 2D snapshot·lifecycle·quality 계약을 실제 Three.js orthographic 2.5D 골판지 장면으로 구현한다.
- Codex 활용: Playwright-only renderer/play specs를 먼저 작성해 hybrid pending loader의 canvas 부재 RED를 확인했다. 이후 actual Three scene graph, camera projection, mesh normal, renderer.info resource metrics를 읽는 diagnostics로 구현·검증했다. 초기 고정 world bounds와 object `lookAt` billboard 오차를 browser RED로 재현해 shared snapshot camera bounds와 camera-quaternion billboard로 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Playwright, Vitest, Vite, npm registry. 사용자 지시에 따라 Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 주요 산출물: `three-hybrid` literal dynamic loader, code-generated CanvasTexture/cardboard meshes/materials, X/Z tabletop·orthographic camera·billboards·limited shadows·rescue-signal, actual `renderer.info` metrics, particles/shadow512/DPR1 quality hooks, hybrid input/result/restart/JSON E2E.
- 검증 근거: RED는 hybrid canvas 부재로 5 failed였다. 최종 `npm test` 63/63, build, hybrid Playwright 6/6, full Playwright 21/21, `git diff --check` 결과는 Task 4 report에 기록한다. dispose는 populated direct renderer의 DOM canvas 0, scene count 0과 actual metric null baseline을 확인했다.
- 사용자 결정: Three.js 0.185.1은 이미 npm latest exact version으로 lock되어 있었고, TypeScript declarations만 exact `@types/three` 0.185.4로 추가했다. 모든 2.5D assets는 코드 생성이며 license table에 기록했다.
- 다음 단계: Task 5 real-time 3D renderer 또는 Task 6 renderer comparison measurement에서 Three hybrid dynamic chunk와 Phaser cold load를 함께 비교한다.

### 테이블탑 비교 프로토타입 Task 4 Fix round 1 — cross-renderer terminal parity

- 목표: Phaser 2D와 Three hybrid가 같은 seed·benchmark input log에서 정확히 같은 terminal result·tick·snapshot-space unit position/tint를 갖는지 browser에서 직접 증명한다.
- Codex 활용: clean 2D/hybrid page의 `mode=benchmark` + DEV deterministic advance E2E를 먼저 작성했다. 첫 실행은 missing `snapshotUnits`가 undefined라 length assertion에서 RED가 됐고, undefined equality의 거짓 양성을 막도록 non-empty shape assertion을 유지했다. 각 engine's actual visual tint(Phaser Image tint, Three material color)를 renderer diagnostics에서 읽고 core snapshot X/Y와 조합하는 최소 bridge를 추가했다.
- 사용 스킬·도구·Advisor: `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Playwright, Vitest, Vite. 사용자 지시에 따라 Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 검증 근거: targeted RED 1 failure 후 GREEN 3/3, 전체 Vitest 63/63, build, full Playwright 22/22, `git diff --check` 성공. test는 terminal 318 units의 `{id,x,y,tint}` 배열과 result·tick 전체 동일성을 확인한다.
- 주요 결정: renderer-specific screen projection은 비교하지 않는다. 동일 `RendererBenchmark` input log가 core's benchmark source이고, actual engine tint와 shared snapshot-space coordinates를 비교 경계로 사용한다.

### 테이블탑 비교 프로토타입 Task 4 Fix round 2 — actual shadow target and tabletop billboard split

- 목표: quality `reduced-shadows`가 requested value뿐 아니라 실제 Three shadow render target을 512px로 바꾸고, billboard가 card만 회전시켜 floor shadow/marker footprint를 보존하도록 수정한다.
- Codex 활용: `receiving-code-review`와 `systematic-debugging`으로 live `DirectionalLight.shadow.map`과 unit child world transforms를 조사했다. Playwright RED는 actual target diagnostic undefined와 card/footprint transform diagnostic 부재로 재현했다. 이후 map dispose/null/re-render와 card-only quaternion을 최소 적용했다.
- 사용 스킬·도구·Advisor: `superpowers:receiving-code-review`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Playwright, Vitest, Vite. Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 검증 근거: targeted RED 2 failures 후 renderer E2E 4/4 GREEN, Vitest 63/63, build, full Playwright 22/22, `git diff --check` 성공. actual shadow target 512→1024 restore와 card center/floor normal/footprint invariants를 확인했다.

## 2026-08-13

### 테이블탑 비교 프로토타입 Task 3 — Phaser 2D

- 목표: 실제 Phaser 2D 골판지 디오라마를 공통 결정론 코어와 앱 lifecycle 계약 위에 연결한다.
- Codex 활용: Playwright를 먼저 작성해 pending loader, scene boot 소유권, one-shot 입력, diagnostics race를 RED로 확인했다. 독립 리뷰에서 실제 Phaser deferred destroy, 자기검증 diagnostics, Canvas capability, DPR backing과 logical viewport 분리를 재현하고 두 차례 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:requesting-code-review`, `superpowers:receiving-code-review`, `superpowers:verification-before-completion`, Playwright, Phaser 4.2.1, Vite, 명시 Opus Advisor.
- 주요 산출물: `prototype/src/renderers/phaser-2d/`, 실제 2D dynamic loader, 코드 생성 골판지 텍스처·그림자·marker, pointer/keyboard/Tab/button/restart/JSON UI, Canvas fallback과 diagnostics.
- 검증 근거: Vitest 63/63, TypeScript·Vite build, Phaser dynamic chunk, Playwright 15/15, `git diff --check` 성공. 실제 DPR2→low-DPR에서 backing만 줄고 CSS visual frame이 유지되는 RED→GREEN을 확인했다.
- Advisor 판단과 반영: 명시 `--model opus`로 `APPROVED`를 받았다. 1.38MB Phaser chunk는 Task 6 cold-load 측정으로 남기고, depth-y 상관과 production URL 검증은 후속으로 이월한다. 비용 약 $1.29, fallback 없음.
- 다음 단계: Task 4 Three.js 2.5D 혼합 renderer를 같은 snapshot·lifecycle·quality 계약으로 구현한다.

### 전역 Advisor 기본 모델 변경

- 목표: 개인 전역 `advisor`의 기본 Claude 모델을 `fable`에서 `opus`로 변경한다.
- Codex 활용: 전역 `SKILL.md`와 `advisor.sh`의 실제 기본 경로를 확인하고, 명시 모델 우선·읽기 전용·명시 `fable` 시 제한적 Opus fallback 계약을 유지한 채 기본값만 수정했다.
- 변경: `/Users/courtesy/.codex/skills/advisor/SKILL.md`의 기본 모델 지침과 `/Users/courtesy/.codex/skills/advisor/scripts/advisor.sh`의 `model="opus"`.
- 검증 근거: Bash 문법 검사와 ShellCheck 무출력.
- 사용자 결정: 이후 모델 미지정 Advisor 호출은 Opus를 사용한다. 명시 `--model fable` 호출은 기존 fallback 규칙을 따른다.

### 테이블탑 비교 프로토타입 Task 3 — Phaser 2D 가상 디오라마

- 목표: 공유 `GameRenderer` 계약을 실제 Phaser 4.2.1 2D 골판지 디오라마로 구현하고 처음부터 종료·재시작까지 브라우저에서 플레이 가능하게 만든다.
- Codex 활용: Playwright 계약·플레이 명세 6개를 먼저 작성해 pending 2D loader의 canvas 부재 RED를 확인했다. Phaser 비동기 scene boot 경계와 짧은 Tab 키 press의 one-shot 입력 누락을 E2E RED로 재현해, scene callback 소유권과 one-shot 입력 소비를 최소 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Playwright, Vitest, Vite. 사용자 지시에 따라 Advisor·외부 변경·커밋/push는 수행하지 않았다.
- 주요 산출물: 실제 `./phaser-2d` dynamic loader, Canvas 생성 텍스처/타원 그림자/Y depth renderer, readonly browser diagnostics, Canvas fallback, quality particle 50%·DPR 1.0, pointer·키보드·Tab/버튼 분대 전환, 종료·재시작·JSON export UI.
- 검증 근거: RED는 6개 E2E가 `.game-stage canvas` 부재로 실패했고, 중간 GREEN에서 Phaser scene boot와 Tab 입력 회귀를 각각 재현·수정했다. 최종 전체 Vitest·Playwright·build·diff 검증 결과는 Task 3 report에 기록한다.
- 주요 결정: Phaser에는 Three renderer용 shadow-map 단계를 억지로 적용하지 않고, particle visibility 50% 및 DPR diagnostics만 품질 단계로 반영했다. 모든 시각 에셋은 Canvas 코드 생성이며 라이선스 표에 기록했다.
- 다음 단계: Task 4 2.5D renderer가 동일 snapshot·입력·lifecycle 경계를 사용한다.

### 테이블탑 비교 프로토타입 Task 3 Fix round 1 — Phaser 정확성·수명주기 정정

- 목표: 독립 리뷰의 important 지적 6건(DPR, Y-order, metrics, stale mount, diagnostics cleanup, Canvas capability)을 실제 브라우저 행동으로 고정하고 수정한다.
- Codex 활용: `receiving-code-review`로 각 지적을 Phaser 4.2.1 source와 현재 구현에 대조하고, `systematic-debugging`으로 backing store·deferred destroy·display-list depth sort의 root cause를 확인했다. TDD로 Playwright RED 5건(및 cleanup line을 제거해 error-boundary RED 1건)을 확인한 뒤 각각 최소 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:receiving-code-review`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, Phaser source/types, Playwright, Vitest, Vite. 사용자 지시에 따라 Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 주요 산출물: DPR=2 backing canvas resize/restore, actual Phaser child·texture diagnostics 및 nullable draw calls, display-list 원본 Y order와 deterministic depth sort, mount token/settle ownership guard, explicit diagnostics disposal/error cleanup, injected WebGL-unavailable Canvas path.
- 검증 근거: Phaser renderer Playwright 7/7, 전체 Vitest 63/63, build, 전체 Playwright 15/15, `git diff --check` 성공. low-DPR의 actual `canvas.width` 감소와 full 복원, stale pre-create dispose 뒤 canvas/object 0, reverse depth order false, hybrid error/global cleanup을 확인했다.
- 다음 단계: Task 4도 scene diagnostics를 상수/추정치가 아니라 실제 engine resource state로 보고하고, deferred destruction ownership 경계를 같은 방식으로 테스트한다.

### 테이블탑 비교 프로토타입 Task 3 Fix round 2 — Phaser low-DPR 프레이밍 정정

- 목표: DPR=2에서 `low-dpr`가 backing store만 줄이고 게임의 CSS 시각 프레이밍·logical viewport·스프라이트 크기를 바꾸지 않도록 한다.
- Codex 활용: Phaser 4.2.1 `ScaleManager`, Canvas/WebGL renderer, camera source를 대조해 `resize(viewport × dpr)`가 logical `gameSize`도 바꾸는 root cause를 확인했다. Playwright RED에서 full `{2236×1084, unit CSS 20}`과 low `{1118×542, unit CSS 40}` 차이를 실제 scene scale/body display state로 재현한 뒤 최소 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`, Codebase Knowledge Graph, Phaser source, Playwright, Vitest, Vite. 사용자 지시에 따라 Advisor·커밋·push·외부 변경은 수행하지 않았다.
- 주요 산출물: logical `ScaleManager` viewport 고정, DPR별 backing canvas/renderer buffer 및 main camera viewport/zoom 동기화, CSS visual frame readonly diagnostics와 full→low-DPR→full Playwright regression.
- 검증 근거: RED는 unit CSS size 20→40 및 logical viewport 2×→1× 차이로 실패했다. 수정 후 targeted Phaser E2E와 build가 성공했으며, 전체 검증 결과는 Task 3 report에 기록한다.
- 다음 단계: 이후 renderer 품질 조정도 logical scene size와 backing resolution을 분리한 이 경계를 유지한다.

### 테이블탑 비교 프로토타입 Task 2

- 목표: 렌더러 수명주기 계약, 30Hz 코어+RAF 제어기, 품질 저하 단계와 측정·오류 복귀 기반을 만든다.
- Codex 활용: TDD로 신규 계약·metrics 모듈 부재 RED와 기존 셸의 WebGL/오류 경계 RED를 확인한 뒤 최소 구현했다. 구현 검토에서 RAF render 예외가 경계를 우회하는 원인을 찾아 별도 RED 회귀 테스트로 재현하고 controller→app 오류 전달로 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:requesting-code-review`, `superpowers:receiving-code-review`, `superpowers:verification-before-completion`, Vitest, Playwright, Vite, fable Advisor.
- 주요 산출물: `prototype/src/renderers/` 계약·동적 loader 경계, `src/app/game-controller.ts`, `src/metrics/` 프레임 p95·품질 사다리·JSON 보고서, WebGL 비활성화·HUD·오류 복귀를 갖춘 앱 셸, 11개 계약/metrics/app tests.
- 검증 근거: 최종 Vitest 63/63, TypeScript+Vite build와 동적 renderer chunk, Playwright 5/5, `git diff --check`를 확인했다. 최종 코드 리뷰 Critical 0·Important 0으로 Task 3 진행 가능 판정을 받았다.
- 주요 결정: 실제 Phaser/Three 엔진은 Task 3~5 범위이므로 registry는 향후 엔진 모듈을 동적으로 요청하는 경계만 제공하고, 현재 부재 엔진의 시작 실패는 선택 화면으로 안전하게 복귀한다. 품질 profile은 파티클 50%, shadow map 512px, DPR 1.0을 순서대로 누적한다.
- Advisor 판단과 반영: 최초 `REVISE`에서 설계와 달라진 비동기 mount, frame alpha, `collectMetrics()`와 texture·geometry 카운터를 복원하라고 지적했다. 지연 mount 소유권과 alpha 범위, 자원 카운터, HUD당 단일 metrics 수집을 테스트로 반영해 재판정 `APPROVED — Task 2`를 받았다. 두 호출 비용은 약 $0.77와 $0.71이며 Opus 대체는 없었다.
- 다음 단계: Task 3에서 Phaser 2D renderer가 같은 `GameRenderer` 계약과 quality profile을 구현한다.

### 테이블탑 비교 프로토타입 Task 2 Fix round 1

- 목표: 독립 사양 리뷰의 metrics 과부하 표본과 WebGL URL 우회 지적을 회귀 테스트로 고정하고 수정한다.
- Codex 활용: `receiving-code-review`로 현 구현을 검증하고 `systematic-debugging`으로 200ms frame과 `?renderer=hybrid`/WebGL false를 재현했다. TDD로 두 RED를 확인한 뒤 각각 한 번씩 최소 수정했다. Advisor/Claude는 사용자 지시에 따라 호출하지 않았다.
- 주요 산출물: 5 tick cap 초과 프레임 전체를 단 한 번 invalid/excluded 처리하는 controller 회귀 테스트와, WebGL 미지원 URL 선택을 2D로 정규화하는 app shell 회귀 테스트.
- 검증 근거: 첫 RED는 p95 200ms/FPS 5, 둘째 RED는 2D `aria-pressed=false`를 재현했다. 수정 후 개별 6/6·3/3 및 전체 Vitest 39/39, build, Playwright 5/5, `git diff --check`가 성공했다.
- 다음 단계: 추가 code reviewer 지적이 오면 같은 test-first fix round로 처리한다.

### 테이블탑 비교 프로토타입 Task 2 Fix round 2

- 목표: broad code review의 renderer lifecycle, stale RAF, session reset, cleanup error, dynamic import, time window, load time, report 숫자 정확성 지적을 검증·수정한다.
- Codex 활용: `receiving-code-review`와 `systematic-debugging`으로 각각 stale loader mount, stale callback 새 loop 합류, p95 누적·quality gap, JSON NaN 직렬화와 cleanup exception을 재현했다. TDD로 행동 기반 RED 8건과 추가 load/default-path RED를 확인한 뒤 최소 session generation·bounded metric·literal pending factory 변경으로 해결했다. Advisor/Claude 호출은 사용자 지시에 따라 하지 않았다.
- 주요 산출물: generation-token controller, stale loaded renderer cleanup, bounded timestamped FrameMetrics, strict continuous QualityLadder, first-success-render load timing, non-finite JSON report rejection, `pending-renderer` dynamic chunk placeholder.
- 검증 근거: targeted Vitest 28/28, 전체 Vitest 54/54, TypeScript+Vite build(동적 pending chunk 포함), Playwright 5/5, `git diff --check` 성공. fake는 double-dispose를 숨기지 않고 기존 host canvas·dispose 뒤 resize no-op도 검증했다.
- 다음 단계: Task 3의 실제 Phaser renderer가 pending factory를 대체하되 Task 2 lifecycle·metrics contract를 유지한다.

### 테이블탑 비교 프로토타입 Task 2 Fix round 3

- 목표: background tab 성능 표본을 비교·quality 입력에서 격리하고, 안정화 후 10초 recovery p95 판정을 설계 원문대로 노출한다.
- Codex 활용: TDD로 hidden visibility dependency 부재와 recovery frame API/outcome 부재 RED를 확인했다. 최소 visibility 주입과 timestamped recovery metrics를 추가하고, 5초 안정화 표본 제외·다음 10초 p95 평가를 행동 테스트로 고정했다. Advisor/Claude 호출은 사용자 지시에 따라 하지 않았다.
- 주요 산출물: `isVisible` controller 경계, hidden invalid sample 처리, `QualityState.recoveryOutcome/recoveryP95Ms`, `observeFrame` recovery window API와 `getQualityState` controller 조회.
- 검증 근거: hidden 3초 뒤 visible 16ms 표본의 p95/FPS·full quality, recovery 20/30ms의 `recovered`, NaN 제외 뒤 34ms의 `needs-downgrade`와 다음 stage를 확인했다. 전체 Vitest 58/58, build, Playwright 5/5, `git diff --check`가 성공했다.
- 다음 단계: Task 3 renderer가 recovery quality state를 HUD/진단에 소비할 수 있다.

### 테이블탑 비교 프로토타입 Task 2 Fix round 4 — Advisor 계약 정정

- 목표: 같은 fable Advisor 세션의 REVISE 판정에 따라 GameRenderer의 approved design contract만 복원한다.
- Codex 활용: `receiving-code-review`와 TDD로 alpha 누락, async mount와 stale ownership, legacy metrics method 및 HUD/report resource metric 누락을 RED로 재현했다. delayed mount dispose의 이중 cleanup도 추가 GREEN 검증에서 확인해 ownership flag로 고정했다. 사용자 지시에 따라 Advisor/Claude 추가 호출은 하지 않았다.
- 주요 산출물: `render(snapshot, alpha)`, async `mount`, `collectMetrics`, nullable textures/geometries HUD/JSON 및 non-finite rejection, fixed-step interpolation alpha와 stale delayed mount cleanup.
- 검증 근거: 타깃 36/36, 전체 Vitest 62/62, TypeScript+Vite build, Playwright 5/5, `git diff --check` 성공. 50ms frame의 remainder alpha≈0.5와 delayed mount dispose 후 RAF 0을 확인했다.
- 다음 단계: Task 3~5 renderer는 이 async mount·alpha·collectMetrics contract를 직접 구현한다.

### 테이블탑 비교 프로토타입 Task 2 Fix round 5 — atomic HUD metrics

- 목표: Advisor 후속 코드 리뷰의 같은 HUD frame에서 `collectMetrics()`가 6회 호출되는 성능·일관성 결함을 고정하고 수정한다.
- Codex 활용: mutating fake renderer로 published HUD 한 번에 6 collection RED를 재현하고 TDD로 controller의 단일 metric snapshot 재사용을 구현했다. quality 동기 변경도 재수집하지 않고 HUD quality field만 갱신한다. Advisor/Claude 호출은 하지 않았다.
- 검증 근거: target 21/21, 전체 Vitest 63/63, build, Playwright 5/5, `git diff --check` 성공. 동일 HUD의 draw calls/textures/geometries가 하나의 collection 결과임을 확인했다.

### 테이블탑 비교 프로토타입 Task 1

- 목표: 세 렌더러가 공유할 30Hz 결정론 전투 코어와 읽기 전용 `RenderSnapshot` 계약을 구현한다.
- Codex 활용: subagent-driven development와 TDD로 코어 모듈 부재 RED에서 시작하고, 사양·코드 리뷰를 분리해 반복했다. 리뷰에서 발견한 조기 전멸, 도달 불가 사기 붕괴, 비정상 숫자 오염, 외부 객체 별칭, 투사체·상태 수명과 약한 웨이브 단언을 회귀 테스트로 고정한 뒤 최소 수정했다.
- 사용 스킬·도구·Advisor: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:requesting-code-review`, `superpowers:receiving-code-review`, `superpowers:verification-before-completion`, Vitest, Playwright, Vite, fable Advisor.
- 주요 산출물: `prototype/src/core/`의 타입·PRNG·입력 로그·고정 스텝 시뮬레이션·스냅샷, `prototype/src/scenarios/renderer-benchmark.ts`, `prototype/tests/core/`의 결정론·시뮬레이션·고정 스텝 테스트.
- 검증 근거: 코어 26/26, 개발 E2E 5/5, `/squading/` Pages 경로 E2E 5/5, TypeScript 검사·Vite build와 `git diff --check` 성공. 동일 seed 최종 hash 일치, 100·200명 75초 성공, 300명 약 73초 전멸, 사기 붕괴·구조·투사체·25→50명 웨이브와 비유한 입력 거부를 확인했다. 최종 사양 리뷰는 Critical 0·Important 0·Minor 0이다.
- Advisor 판단과 반영: 동일 fable 세션이 `APPROVED — Task 1`을 반환했다. Task 2 renderer 입력 경계에 ID 정렬 단언을 중복하고, Task 6 보고서에 snapshot hash의 유효 범위를 같은 브라우저 런타임·코어 빌드로 명시하라는 비차단 조언을 후속 장부에 반영했다.
- 실제 Advisor 호출: `claude-fable-5`, 기존 세션 재개 1회, 읽기 전용 `Read,Grep,Glob`, 비용 약 $0.77. Opus 대체는 발생하지 않았다.
- 다음 단계: 승인 후 Task 2의 렌더러 계약·컨트롤러·품질 사다리·오류 경계를 구현한다. 공개 저장소와 Pages 생성은 사용자 승인 전까지 보류한다.

### 테이블탑 비교 프로토타입 Task 0

- 목표: 렌더러를 추가하기 전에 재현 가능한 Vite·TypeScript 앱 셸, 브라우저 테스트와 GitHub Pages 배포 기반을 만든다.
- Codex 활용: subagent-driven development로 Playwright 테스트를 먼저 작성해 앱 부재 RED를 확인하고, 구현 뒤 독립 사양·코드 리뷰를 병렬 수행했다. 리뷰의 production base, 테스트 없는 배포, mutable Action tag, URL seed, Pages 형태 불일치를 회귀 테스트와 수정으로 반복 해소했다.
- 사용 스킬·도구·Advisor: `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, `superpowers:requesting-code-review`, `superpowers:receiving-code-review`, Playwright, Vitest, Vite, GitHub CLI 진단, fable Advisor.
- 주요 산출물: `prototype/` 앱 셸·테스트·lockfile·Pages preview server, `.github/workflows/deploy-prototype.yml`, `docs/assets-license.md`.
- 검증 근거: build 성공, 개발 E2E 5/5, `/squading/` project Pages 5/5, `owner.github.io` root Pages 5/5, 사용자 지정 `/preview/` 5/5, audit 취약점 0, malformed URL 400 후 서버 생존, `git diff --check` 성공. 최종 코드 리뷰는 Critical 0·Important 0·Minor 1이다.
- 남은 사항: 공개 저장소 생성·커밋·push·Pages 활성화는 사용자 승인 전 수행하지 않았다. Task 1에서 코어 Vitest를 추가한 뒤 0-test 허용 옵션을 제거한다.

### 개인 전역 Claude Advisor 설치와 게임 설계 검토

- 목표: 기본 fable, 제한적 opus 대체, 읽기 전용 세션 재개와 증거 기반 승인 프로토콜을 갖춘 개인 전역 `advisor` 스킬을 설치하고 테이블탑 3렌더러 설계를 검토한다.
- Codex 활용: 가짜 Claude CLI로 오류 JSON·모델 대체·진단 보존·명시 모델·세션 복구를 TDD하고, 독립 코드 리뷰와 신선한 컨텍스트 검증을 반복했다. 설치 후 실제 fable Advisor 세션에서 렌더러 설계를 판정받았다.
- 사용 스킬·도구·Advisor: `skill-creator`, `superpowers:writing-skills`, `superpowers:test-driven-development`, `superpowers:receiving-code-review`, `superpowers:verification-before-completion`, 병렬 독립 리뷰, Claude fable Advisor.
- 주요 산출물: `/Users/courtesy/.codex/skills/advisor`, `docs/advisor-reviews/2026-08-13-tabletop-renderer-design-fable-review.md`, 개정 중인 테이블탑 렌더러 비교 설계.
- 검증 근거: Bash 3.2 계약 테스트, ShellCheck, 공식 skill validator, 17/17 프로토콜 forward-test, Critical·Important·Minor 0 독립 리뷰, 설치본 바이트 비교. 같은 fable 세션에 개정 diff와 검증 결과를 제출해 `APPROVED`를 받았다.
- Advisor 판단과 반영: 고정 틱·단일 RNG·전체 스냅샷 계약, 자동/수동 모드 분리, 동적 import, 측정 창과 누수 기준, 에셋 권리·비용 외삽, 승패·재시작·안내, 단계별 완료 기준을 추가했다. 비차단 조언인 `rescue-signal` 명명과 프레임당 최대 5틱 제한은 구현 계획에 반영한다.
- 실제 Advisor 호출: `claude-fable-5`, 동일 세션 2회, 읽기 전용 `Read,Grep,Glob`, 최종 비용 약 $1.07. Opus 대체는 발생하지 않았다.
- 구현 계획 검토: 같은 세션에서 공개 프리뷰 조기 검증, 안정 패키지 잠금, jsdom·브라우저 테스트 분리, headed GPU 측정, 품질 사다리와 오류 복귀 소유권을 보완해 `APPROVED`를 받았다. 이후 두 호출 비용은 약 $1.39와 $0.62였고 Opus 대체는 없었다.
- 다음 단계: 승인된 계획의 Task 0부터 subagent-driven development를 시작한다.

## 2026-08-12

### 대회 요구사항 조사

- 목표: OpenAI Game Builders Seoul Track 1의 게임 제작 요구사항을 확인한다.
- Codex 활용: 공식 행사 페이지와 참가 약관을 조사해 필수 웹 빌드, 공개 플레이 링크, Codex 활용, 심사 기준, 에셋 권리 조건을 정리했다.
- 사용 도구: 웹 탐색, 브라우저 지침.
- 산출물: 게임 구현 요구사항과 완료 검증 기준을 `AGENTS.md`에 반영했다.
- 다음 단계: 실제 게임 설계와 구현 시 요구사항 충족 여부를 지속해서 검증한다.

### 프로젝트 개발 지침 정리

- 목표: 코딩 에이전트와 게임 제작에 필요한 프로젝트 지침을 만든다.
- Codex 활용: 카파시의 관찰에서 도출된 개발 원칙, 구조화된 UI 질문 우선 원칙, Track 1 게임 요구사항을 한국어 명령형 지침으로 정리했다.
- 산출물: `AGENTS.md`.
- 사용자 결정: 부가 설명을 제거하고 실행 가능한 지침만 유지한다.

### Claude CLI Advisor 스킬 설계

- 목표: Codex가 별도의 Claude Advisor 감독 아래 구현과 검증을 수행하도록 한다.
- Codex 활용: Claude에 설치된 기존 `advisor` 스킬을 분석하고, 개인 전역 Codex 스킬로 이식하는 구조를 설계했다.
- 사용 스킬·도구: `superpowers:brainstorming`, `skill-creator`, `superpowers:writing-skills`, `superpowers:test-driven-development`, Claude CLI 도움말.
- 주요 결정: `claude -p`, 기본 `fable`, 사용량 초과 시 `opus`, 읽기 전용 Advisor, 상태 기반 검증 루프를 사용한다.
- 산출물: `docs/superpowers/specs/2026-08-12-claude-cli-advisor-skill-design.md`, `docs/superpowers/plans/2026-08-12-claude-cli-advisor-skill.md`.
- 검증 근거: Claude CLI 2.1.226에서 `-p`, `--model`, `--fallback-model`, `--resume`, 도구 제한 옵션을 확인했다.
- 다음 단계: 구현 계획을 검토한 뒤 전역 스킬을 테스트 우선으로 구현한다.

### 게임 레퍼런스 병렬 조사

- 목표: 사용자가 별도 스펙을 작성하지 않아도 비교 제안서를 보고 게임 방향을 선택할 수 있도록 한다.
- Codex 활용: 독립 조사 에이전트에 《뱀파이어 서바이벌》과 《퍼스트 퀸 4》의 시스템·페이싱·성장·기술·IP 안전성 분석을 병렬 위임했다.
- 사용 스킬·도구: `superpowers:dispatching-parallel-agents`, 병렬 에이전트, 웹 조사.
- 현재 결과: 《뱀파이어 서바이벌》의 이동 중심 생존 루프·성장·브라우저 성능 전략과 《퍼스트 퀸 4》의 지휘관 전환·AI 분대·피로·구조·사기 시스템을 각각 조사했다.
- 다음 단계: Advisor 스킬 구현과 검토를 마친 뒤 두 결과를 결합해 장르·콘셉트·아트·기술 제안서를 각각 여러 안으로 작성하고 Advisor의 평가를 받는다.

### 게임 방향 제안서와 아트 콘셉트 제작

- 목표: 사용자가 별도 스펙을 작성하지 않고도 리서치, 게임 콘셉트, 아트와 기술 방향을 비교해 선택할 수 있게 한다.
- Codex 활용: 두 병렬 리서치 결과를 결합해 두 분대 전장 생존 로그라이트를 제안하고, 아트 5안과 기술 4안을 비교 가능한 독립 문서로 정리했다.
- 사용 스킬·도구: `superpowers:brainstorming`, `imagegen`, 병렬 리서치 결과, 웹 근거 조사.
- 아트 산출물: 먹빛 전쟁 연대기, 네온 전술 홀로그램, 장난감 전쟁 디오라마, 스테인드글라스 종말전쟁, 32비트 전쟁 군상극의 16:9 콘셉트 이미지 각 1장.
- 문서 산출물: `docs/proposals/` 아래 리서치 2개, 결합 콘셉트 1개, 아트 제안서 5개, 기술 제안서 4개와 비교 인덱스.
- 검증 근거: 모든 생성 이미지는 1672×941 PNG이며 저장소 안으로 복사했다. 문서에는 원작 고유 표현을 사용하지 않는 IP 안전선과 대회용 브라우저 MVP 범위를 명시했다.
- 다음 단계: Advisor 스킬 리뷰·설치 후 제안서 전체를 자문하고, 사용자 선택을 구현 스펙으로 구체화한다.

### 테이블탑 3렌더러 비교 결정

- 목표: 장난감 전쟁 디오라마를 2D, 2.5D와 실시간 3D로 실제 비교한 뒤 최종 표현 기술을 고른다.
- 사용자 결정: 먹빛 방향도 선호했으나 병사 애착과 구조 표현이 강한 테이블탑 방향을 우선하고, 세 렌더러를 직접 비교한다.
- Codex 활용: 세 완성 게임을 만드는 대신 결정론적 2D 전투 코어와 읽기 전용 렌더 스냅샷을 공유하는 비교 구조를 설계했다.
- 주요 판단: 3D에서도 AI와 충돌은 2D 평면에서 계산하고 높이·그림자는 시각 표현에만 사용한다. 같은 시드, 카메라, 전투 tick과 프록시 에셋으로 비교한다.
- 산출물: `docs/superpowers/specs/2026-08-12-tabletop-renderer-comparison-design.md`.
- 다음 단계: 설계 검토 승인 후 구현 계획을 작성하고 Advisor 자문, SDD 구현과 독립 리뷰를 진행한다.
