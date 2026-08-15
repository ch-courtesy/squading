# 테이블탑 비교 프로토타입 Task 1 — Fable Advisor 검토

- 날짜: 2026-08-13
- 모델: `claude-fable-5`
- 세션: `9d66b1b0-9a67-4ffb-aa82-242026102a47`
- 판정: `APPROVED — Task 1`
- 비용: 약 $0.77
- Opus 대체: 없음

## 판정 근거

- `RenderSnapshot`과 하위 타입의 읽기 전용 필드 및 `rescue-signal` 계약이 설계와 일치한다.
- FNV-1a 시드 해시와 xorshift32, zero-state 방어를 사용하고 코어에 `Math.random`이 없다.
- 테스트가 동일·상이 seed, 객체 복사, ID 정렬, 5틱 상한, 75초 승패, 재시작, 구조, 투사체 수명, 상태 복귀, 적 웨이브, 효과 수명, 피로와 사기 붕괴를 포함한다.
- 코어 26/26, TypeScript·Vite build, 개발·Pages E2E 각 5/5와 diff-check 근거가 현재 파일 상태와 모순되지 않는다.

## 비차단 조언

- Task 2의 fake renderer 입력 계약에서도 snapshot 배열의 ID 오름차순을 단언한다.
- Task 6 비교 보고서에 snapshot hash의 유효 범위를 같은 브라우저 런타임과 같은 코어 빌드로 명시한다.
- Task 0의 공개 Pages URL은 사용자 승인 대기 중인 외부 게이트로 유지한다.
