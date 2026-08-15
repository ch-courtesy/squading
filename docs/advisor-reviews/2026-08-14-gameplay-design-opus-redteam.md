# Opus Advisor 적대적 리뷰 — 핵심 게임 루프 설계

- 모델: `claude-opus-5`
- 세션: `ac569e0b-f4e3-494f-b3eb-c8021ba52a55`
- 초기 판정: **REVISE**
- 최종 판정: **APPROVED** (`Critical 0 / Important 0 / Minor 0`)
- 초기 리뷰 비용: `$2.3352325`

## Critical 요약

1. 스폰 스케줄과 동시 접촉 적 수가 없어 유닛 수치표로 실제 난이도를 계산할 수 없다.
2. 보스 HP·속도·범위 공격 수치가 생존 병력에 따라 6초 처치 또는 처치 불가로 급변하며, 현재 수치로 보스 자체는 위협이 아니다.
3. 청록 사거리가 보스 범위 공격 반경보다 짧아 보스전에서 청록의 역할이 붕괴한다.
4. 비활성 분대를 제자리에 주차하면 적의 확정 표적이 되므로 교대·피로 메커니즘의 인센티브가 충돌한다.
5. 지휘관 이동 규칙이 없어 중앙에서 확정 사망하며 오라·사망 페널티가 상시 상태가 된다.
6. 피로·사기 증감률과 임계치가 없어 구현자가 핵심 밸런스를 즉흥 결정해야 한다.
7. 경험치 임계가 처치 속도와 맞지 않아 강화 4회가 초반에 연속 발생할 수 있다.
8. 고밀도 상황에서 분대 전체를 45 tick 정지시키는 구조는 성공 불가능하거나 비용이 과도하다.
9. 현재 입력 배관은 Space를 단발 소비하고 pointer를 영구 유지해 구조 홀드가 성립하지 않는다.
10. 레벨업 pause와 upgrade choice의 적용 tick이 정의되지 않아 replay 결정론이 깨진다.
11. 단일 PRNG 스트림을 카드·스폰·전투가 공유하면 강화 선택 비교가 RNG 발산으로 오염된다.

## Kill list

- 사기 시스템과 다중 지휘관 오라
- 실시간 3D renderer와 renderer 선택 UI
- 완전한 Phaser 시각 parity 작업
- 정예 적
- 관통·충격파·방어막·연속사격 등 복합 강화
- 다단계 피로
- 일반 플레이의 benchmark·JSON·품질·FPS HUD
- `enemyCount` 난이도 선택과 `applyOverrun()`
- 4회 이상 레벨업

## 권고 최소 루프

- 60초 전투
- 두 비대칭 분대, 지휘관·사기 제외
- 비활성 분대는 활성 분대를 추종
- 위치 기반 접촉 피해와 자동 공격
- 수행 병사 한 명만 정지하는 30 tick 구조
- 평면 스탯 강화 3회
- 40초 보스 등장, 60초 데드라인
- Three.js 2.5D 단일 renderer

## 필수 설계 수정

- 10초 구간별 스폰 수와 목표 동시 적 수 표
- 파생 TTK·생존 시간·레벨업 도달 시간 표
- 입력을 지속 상태와 단발 명령으로 분리하고 keyup·pointerup·pause reset 명시
- `awaiting-upgrade` 상태와 upgrade choice 적용 tick 명시
- spawn/cards/jitter PRNG 스트림 분리
- renderer용 `RenderSnapshot`과 HUD·규칙용 `GameState` 분리
- 승패 판정 우선순위 명시
- 다중 seed 정책 기반 에이전시 테스트

## 30초 수정 명세 재검토 이력

- 수정 대상: `docs/superpowers/specs/2026-08-14-squad-survivor-gameplay-design.md`
- 세션: `ac569e0b-f4e3-494f-b3eb-c8021ba52a55`
- 모델: `claude-opus-5`
- 1차 판정 `REVISE`: 비활성 분대의 정예 targeting과 TTK 표 불일치, 교대 누적 이득 부족, 정예 예고 중심·tick 순서·활성 분대 전멸 상태·spawn PRNG 소비 모호성을 수정했다.
- 2차 판정 `REVISE`: 같은 기저를 쓰는 정예 분리값, 접촉 슬롯 재표적, formation 전체 회피, 분대별 정예 사거리 진입, 정확한 예고·피해 tick, 구조 피격과 승패 우선순위를 수정했다.
- 3차 판정 `REVISE`: 세 정책이 선택하는 `power` 효과를 파생표에 전파하고 정예 HP 튜닝 범위를 좁히라는 국소 지적이었다.
- 사용자 요청에 따라 한도 이후에도 같은 Opus 세션에서 `지적 수정 → 재리뷰 → 이견 논쟁 → 판정 반영`을 반복했다. Advisor 최종 요약 기준 총 8개 수정 라운드에서 `Critical 12 / Important 13 / Minor 12`를 해소했다.
- 후속 반영: 일반 적 요청을 `97명`으로 바로잡고, 압박 구간의 `power` 적용 순증·backlog·cap 도달 tick을 재계산했다. 세 카드의 전투 영향표, 조기 정예 처치 시 예고 취소, 결정론 fixture의 종료 억제 범위, 무기립 상태의 적 정지, 적 이동 clamp와 formation PRNG 소비 경계를 추가했다.
- 논쟁 채택: HP `25`에서 강화 후 최소 병력을 `7/8명`으로 둔 계산은 잘못이므로 정예 HP `24.5`와 정책 시뮬레이션 기준을 유지했다. 전술 무입력은 강화 modal 때문에 tick 900 fixture가 될 수 없어 fixture가 `power`를 선택하도록 했다. 압박 구간의 과거 `0.15` 요청률 파생값과 downed tick의 연속 근사 표기는 교정했다.
- 논쟁 기각: 360 tick 전투 창은 건강 주홍의 10 tick, 청록의 18 tick 공격 간격으로 모두 나누어떨어지므로 해당 구간의 발사 횟수가 cooldown 위상에 따라 달라진다는 Worker 주장은 철회했다. 명세는 이 구간을 위상 독립 상수 산술로 유지한다.
- 최종 상태: Opus Advisor가 전체 명세와 산술을 다시 검사해 **`APPROVED`**를 반환했다. 최종 findings는 `Critical 0 / Important 0 / Minor 0`이다.
- 구현 시 주시사항: 8-seed 정책별 승률·병력 손실, 첫 downed `tick 350~600`, `march + 청록 활성`의 부분 화력 절충은 실제 결정론 시뮬레이션으로 측정한다. 이는 설계 finding이 아니라 구현 검증 항목이다.
