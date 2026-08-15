# 테이블탑 비교 프로토타입 Task 2 — Fable Advisor 검토

- 날짜: 2026-08-13
- 모델: `claude-fable-5`
- 세션: `9d66b1b0-9a67-4ffb-aa82-242026102a47`
- 최초 판정: `REVISE`
- 재판정: `APPROVED — Task 2`
- 비용: 최초 약 $0.77, 재판정 약 $0.71
- Opus 대체: 없음

## 최초 수정 요구

- 승인 설계대로 비동기 `mount()`를 사용하고 지연 mount의 세대 소유권을 검증한다.
- `render(snapshot, alpha)`로 30Hz 코어의 프레임 보간값을 전달하되 snapshot에는 넣지 않는다.
- `collectMetrics()` 명칭을 설계와 통일하고 draw call·texture·geometry 카운터를 제공한다.

## 반영 및 승인 근거

- 비동기 mount 완료·거부·전환 경쟁과 정확히 한 번 dispose를 회귀 테스트로 고정했다.
- 보간 alpha의 유한성, `[0, 1)` 범위와 0.5 잔여값을 검증했다.
- HUD·JSON에 자원 카운터를 추가하고 null 외 비유한 값을 거부했다.
- 한 HUD 프레임에서 `collectMetrics()`를 정확히 한 번 호출해 원자적인 카운터를 사용한다.
- Vitest 63/63, TypeScript·Vite build, Playwright 5/5, `git diff --check`가 통과했다.

## Task 3 조언

- Phaser 통합 테스트는 jsdom이 아니라 Playwright 전용으로 둔다.
- 픽셀 일치 대신 장면 진단 API의 객체 수·tint·Y 정렬을 단언한다.
- Phaser 품질 단계는 효과 스프라이트 50%와 DPR 단계를 사용한다.
- 코드 생성 텍스처를 에셋 라이선스 문서에 기록한다.
