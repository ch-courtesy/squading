# 테이블탑 렌더러 비교 결과

## 결론 상태

Task 6에서 재현 가능한 비교 프로토콜과 로컬 자동 검증을 추가했다. Apple M4의 headed Chrome에서 10초 예열+60초 측정, 행별 새 browser context cold-load, GC 전후 heap, parity와 오류 복귀를 측정했다. 로컬 WebKit에서도 세 렌더러의 시작·종료·재시작을 확인했다. 공개 URL의 깨끗한 Chrome·Safari 검증만 배포 승인 대기다.

정량 기준을 모두 통과한 후보 가운데 **Three.js 2.5D 혼합을 최종 렌더러로 선택한다.** Phaser 2D 수준의 전투 가독성을 대체로 유지하면서 테이블탑 질감과 발표 효과가 가장 좋고, 실시간 3D보다 추가 모델·조명 제작 위험이 낮다. WebGL 불가 환경에는 Phaser Canvas 2D를 fallback으로 유지한다.

## 자동 비교 프로토콜

`prototype/scripts/benchmark.mjs`의 `createCapturePlan()`이 다음 조건을 고정한다.

| 항목 | 값 |
|---|---|
| 인구 | 적 100·200·300명 |
| 입력 | 같은 seed와 benchmark input log |
| 시뮬레이션 | 30Hz, 기본 1,800 tick 캡처 |
| 렌더러 | Phaser 2D, Three.js 2.5D, Three.js 3D |
| 성능 창 | 10초 예열 후 60초 측정 |
| 전환 | 같은 세션에서 10회 전환 및 dispose/GC 후 heap 확인 |
| 유효 GPU | `WEBGL_debug_renderer_info` vendor/renderer 기록; SwiftShader·llvmpipe·software renderer 무효 |
| 회복 | 품질 사다리 진입 후 안정화 창의 p95 회복 여부 |
| 실패 경계 | WebGL 비활성화와 강제 renderer 오류가 선택 화면으로 복귀 |

엔진 간 draw-call 숫자는 API·배칭·렌더러 내부 구현이 달라 순위를 매기지 않는다.

## 로컬 증거

- benchmark 정책 단위 테스트: 4/4
- renderer switching/강제 오류 복귀 브라우저 테스트: 1/1; 실제 로컬 자동 캡처 9행(100·200·300 × 3 renderer), 동일 페이지 전환 10/10, canvas teardown 10/10
- 로컬 캡처의 9행은 diagnostic advance를 고정해 9/9 tick·snapshot parity를 재현했다. 이 결과는 headless SwiftShader 표본이며 성능·GPU 선택 근거가 아니다.
- 전체 검증: Vitest 67/67, Playwright 30/30, TypeScript+Vite build, `git diff --check`
- 자동 캡처 artifact: `prototype/artifacts/benchmark-local.json`; 선택 결과는 `protocol-compliant-evidence-required` (headed hardware GPU·10초/60초·공개 URL 증거 미제공)
- 코드 생성 텍스처·메시만 사용하며 외부 이미지·음원·영상·폰트는 없다.

### Apple M4 headed Chrome 결과

`prototype/artifacts/benchmark-headed-m4.json` — Chrome for Testing 151, `ANGLE Metal Renderer: Apple M4`, 행별 새 browser context, 10초 예열+60초 샘플.

| 렌더러 | 100명 p95 | 200명 p95 | 300명 p95 | 300명 load | 300명 GC 후 heap Δ |
|---|---:|---:|---:|---:|---:|
| Phaser 2D | 18.3ms | 18.3ms | 18.3ms | 48ms | +0.96MB |
| Three.js 2.5D | 18.1ms | 18.1ms | 18.6ms | 47ms | +0.61MB |
| Three.js 3D | 18.4ms | 18.3ms | 18.3ms | 49ms | +1.11MB |

모든 행은 GPU 유효성, 동일 tick/snapshot parity와 품질 안정 상태를 통과했다. 10회 전환과 오류 복귀도 통과했다. 이 수치는 같은 기기의 단일 표본이며 엔진 간 draw-call 순위는 매기지 않는다.

### 정성 점수

같은 `tick=900`, 300명 캡처를 한 관찰자가 1~5점으로 평가했다. 캡처는 `prototype/artifacts/captures/`에 있다.

| 렌더러 | 지휘관·분대 | 구조 상태 | 적 지휘관 | 300명 경로 | 미니어처 촉감 | 공격·구조 만족감 | 발표 기억성 | 촉감+발표 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Phaser 2D | 5 | 4 | 4 | 5 | 3 | 3 | 3 | 6 |
| Three.js 2.5D | 5 | 4 | 4 | 4 | 5 | 4 | 5 | 10 |
| Three.js 3D | 2 | 2 | 2 | 3 | 4 | 3 | 3 | 7 |

2.5D는 가독성 4점 이상 조건을 통과하면서 촉감+발표 점수가 가장 높다. 3D는 현재 조명·색 대비가 부족하고 추가 제작비를 정당화할 만큼 우위가 없다.

전환 parity 테스트는 각 렌더러를 동일 `seed=task6-switch`, `mode=benchmark`, 2,500 diagnostic tick으로 실행해 snapshot unit 목록, 결과와 tick을 비교한다. 브라우저 프레임 경과 시간은 renderer별로 달라질 수 있으므로 첫 화면의 실시간 위치를 직접 비교하지 않는다.

## 선택 규칙

다음 순서로 통과한 렌더러를 선택한다.

1. 깨끗한 브라우저 시작과 핵심 장면 종료: 로컬 Chrome/WebKit에서 통과; 공개 URL 재확인 대기.
2. 200명 p95 ≤20ms: 세 렌더러 모두 통과.
3. 300명 p95 ≤33ms 및 품질 안정/회복: 세 렌더러 모두 통과.
4. 핵심 가독성 평균 ≥4: 2D와 2.5D 통과, 3D 탈락.
5. 촉감+발표 효과 합계: 2.5D 10점으로 최고.
6. 점수 차이가 1점 이하가 아니므로 제작비 tie-break는 적용하지 않는다.

전부 탈락하면 공유 코어 1회 최적화와 렌더러별 최대 2시간 최적화 후 같은 프로토콜로 재측정한다.

## 제작 비용 외삽

실측 전에는 순위를 정하지 않는다. 병과 1종을 코드 생성하는 기준으로 기록할 항목은 다음과 같다.

| 렌더러 | 병과 1종 제작 시간 | 3종 외삽 | 외부 에셋 비용 |
|---|---:|---:|---:|
| Phaser 2D | 약 2시간 | 약 6시간 | 0 (코드 생성 기준) |
| Three.js 2.5D | 약 2.5시간 | 약 7.5시간 | 0 (코드 생성 기준) |
| Three.js 3D | 약 4시간 | 약 12시간 | 0 (코드 생성 기준) |

위 시간은 현재 프록시 구현의 단일 작업자 기록을 바탕으로 한 외삽이며 실제 애니메이션·폴리싱 단계에서 변할 수 있다.

## 공개 검증 게이트

공개 저장소 생성, commit/push, Pages 활성화 및 URL 검증은 사용자의 명시 승인이 필요하다. 따라서 이 단계에서는 공개 URL을 만들거나 성공했다고 주장하지 않는다. 승인 후 깨끗한 Chrome과 Safari에서 URL을 열어 설치·로그인 없이 시작되는지, 안내·조작·게임 종료·재시작과 에셋 fallback을 기록한다.
