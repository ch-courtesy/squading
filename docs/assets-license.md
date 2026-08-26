# 에셋 라이선스 기록

## 테이블탑 3렌더러 비교 프로토타입

| 에셋 | 출처/제작 방식 | 사용 조건 | 비고 |
|---|---|---|---|
| Task 0 앱 셸 시각 표현 | 프로젝트 CSS로 직접 작성 | 프로젝트 소스와 동일 | 외부 이미지·음원·영상·웹폰트 없음 |
| UI 폰트 | 사용자 기기의 시스템 폰트 | 번들/재배포하지 않음 | `system-ui`, Georgia 등 fallback만 지정 |
| Phaser 2D 골판지 유닛·타원 그림자·역할 마커·효과 텍스처 | `prototype/src/renderers/phaser-2d/procedural-assets.ts`에서 Canvas API로 코드 생성 | 프로젝트 소스와 동일 | 외부 이미지·음원·영상·웹폰트·생성형 이미지 없음 |
| Three.js 2.5D 골판지 유닛 텍스처·메시·그림자·역할 마커·효과 | `prototype/src/renderers/three-shared/scene-utils.ts`와 `three-hybrid/`에서 Canvas API와 Three.js 기하로 코드 생성 | 프로젝트 소스와 동일; Three.js MIT 라이선스 | 외부 이미지·메시·음원·영상 없음 |
| Three.js 3D 저폴리 미니어처·바닥·파티클 | `prototype/src/renderers/three-3d/procedural-models.ts`와 `three-renderer.ts`에서 Three.js 기본 기하로 코드 생성 | 프로젝트 소스와 동일; Three.js MIT 라이선스 | 외부 모델·텍스처·이미지·음원·영상 없음; 6면 원뿔 단일 유닛 모델 |

이후 렌더러에 추가하는 코드 생성 텍스처·메시·이펙트와 외부 에셋은 제작 단계별로 이 표에 추가한다.

## 분대 생존 수직 슬라이스 gameplay 시각 요소

| 에셋 | 출처/제작 방식 | 사용 조건 | 비고 |
|---|---|---|---|
| 정예 지휘관 카드 | 기존 골판지 유닛 카드(`three-shared/scene-utils.ts`의 Canvas 텍스처)를 1.25배로 확대해 재사용 | 프로젝트 소스와 동일; Three.js MIT 라이선스 | 새 텍스처·모델 없음 |
| 정예 area telegraph 원 | `three-hybrid/hybrid-renderer.ts`에서 `THREE.RingGeometry`로 코드 생성(반지름 1 밴드를 스냅샷의 실제 반경으로 스케일) | 프로젝트 소스와 동일; Three.js MIT 라이선스 | 외부 이미지·셰이더 없음; 색은 소스에 직접 적은 상수 |
| 전투불능 카드 표현 | 기존 유닛 카드를 눕히고(회전 π/2) 낮춘 뒤 기존 마커 링을 함께 노출 | 프로젝트 소스와 동일 | 새 기하·텍스처 없음 |
| 활성 분대 마커 | 기존 `markerGeometry` 링을 분대 tint 색으로 재사용 | 프로젝트 소스와 동일 | 새 기하·텍스처 없음 |
| 구조 신호(`rescue-signal`) | 기존 `effectGeometry` 링을 분대 tint 색으로 재사용; 구조 대상과 구조자 양쪽에 각각 표시 | 프로젝트 소스와 동일 | 새 기하·텍스처 없음 |

gameplay 표현은 전부 기존 코드 생성 자산과 Three primitive만 사용하며, 외부 런타임 의존성·이미지·모델·음원·웹폰트를 추가하지 않았다.

## Task 6 비교 측정 산출물

- `prototype/scripts/benchmark.mjs`의 비교 계획·JSON 결과: 외부 에셋 없음; 프로젝트 소스와 동일한 라이선스 조건.
- GPU vendor/renderer 문자열: 측정 환경 진단 정보로만 기록하며, 이미지·음원·폰트·모델을 재배포하지 않는다.

## 사운드 (분대 생존 — 전투 오디오)

| 에셋 | 출처/제작 방식 | 사용 조건 | 비고 |
|---|---|---|---|
| 효과음 전부 (사격·베기·폭발·사망·기립·카드·승리·패배·UI·엔딩 종지) | `prototype/src/audio/battle-audio.ts`에서 WebAudio 오실레이터·필터·노이즈로 런타임 합성 | 프로젝트 소스와 동일 | 외부 음원 파일 없음. 노이즈는 파일 안에 고정 시드 LCG로 생성하므로 같은 전투가 같은 소리를 낸다 |
| 합성 BGM (폴백) | 같은 파일에서 합성. 곡 파일을 못 받으면 이것이 재생된다 | 프로젝트 소스와 동일 | 외부 음원 없음 |
| **BGM 곡 — "Awake! (Megawall-10)"** | **OpenGameArt.org, 작자 `cynicmusic`** — https://opengameart.org/content/awake-megawall-10 | **CC0 1.0 (퍼블릭 도메인 헌정)** — 저작자 표시 의무 없음. 페이지의 License(s) 항목이 CC0 단독임을 확인했다 | `prototype/public/audio/bgm-awake.mp3` (1.9MB, 57초, 루프 재생). 재인코딩·편집 없이 원본 그대로 번들에 포함 |

**선정 과정.** OpenGameArt의 CC0 필터 목록에서 라이선스 블록만 좁혀 파싱해 **CC0 단독인 것만** 후보로 뒀다. CC0와 CC-BY-SA가 섞여 표기된 항목(예: `battle-theme-a`)은 어느 파일에 어느 조건이 걸리는지 페이지만으로 확정할 수 없어 제외했다. 여섯 곡을 실제로 들어보고 하나를 골랐으며, 선택되지 않은 다섯 곡은 저장소에 남기지 않았다.

**폰트·이미지·영상은 여전히 없다.** 이 프로젝트가 번들에 포함하는 외부 저작물은 위 BGM 파일 하나뿐이다.
