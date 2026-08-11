# Claude CLI Advisor 전역 스킬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex가 `claude -p`로 읽기 전용 Claude Advisor 세션을 시작·재개하고, 기본 `fable` 실패 시 `opus`로 대체하며, 브리프와 검증 판정을 반복할 수 있는 개인 전역 `advisor` 스킬을 만든다.

**Architecture:** 저장소의 `skills/advisor`에 버전 관리 원본과 테스트를 두고, 최종 리뷰를 통과한 원본을 `/Users/courtesy/.codex/skills/advisor`에 설치한다. Codex Worker가 구현과 명령 실행을 소유하고, Claude Advisor는 `Read`, `Grep`, `Glob`만 사용해 브리프와 판정을 반환한다. 래퍼는 JSON 결과를 그대로 전달해 Worker가 `session_id`와 응답을 추출하도록 한다.

**Tech Stack:** Codex Skills, Bash 3.2 호환 셸, Claude Code CLI 2.1.226+, `jq`, `shellcheck`, Python `skill-creator` 검증 도구, `uv`/PyYAML

## Global Constraints

- 버전 관리 원본은 `skills/advisor`, 개인 전역 설치 경로는 `/Users/courtesy/.codex/skills/advisor`로 고정한다.
- 기본 모델은 `fable`, 기본 모델의 사용량 초과·이용 불가·과부하 시 대체 모델은 `opus`다.
- 사용자가 `fable` 이외의 모델을 명시하면 자동으로 다른 모델로 바꾸지 않는다.
- Advisor에는 `Read`, `Grep`, `Glob`만 제공하고 `Bash`, `Edit`, `Write`, 커밋 및 푸시를 허용하지 않는다.
- Advisor 응답은 `BRIEF`, `QUESTION`, `SKIP`, `APPROVED`, `REVISE`, `ESCALATE` 중 하나로 시작해야 한다.
- 사용자 질문에는 사용 가능한 구조화된 UI 질문 도구를 우선하고, 사용할 수 없을 때만 텍스트 질문을 사용한다.
- Worker는 사용자가 명시적으로 요청한 경우에만 커밋한다.
- 실제 Claude 호출은 인증·네트워크·사용량을 소비하므로 별도 사용자 승인 없이는 실행하지 않는다.
- 구현과 리뷰는 저장소의 원본을 대상으로 커밋하며, 최종 리뷰 전에는 개인 전역 경로에 설치하지 않는다.

---

### Task 1: 스킬 없는 기준 동작 기록

**Files:**
- Read: `/Users/Shared/workspaces/squading/docs/superpowers/specs/2026-08-12-claude-cli-advisor-skill-design.md`
- Do not create or modify files in this task.

**Interfaces:**
- Consumes: 승인된 설계의 상태 계약, 모델 대체 및 읽기 전용 제약
- Produces: 스킬이 없을 때 놓치는 동작을 확인한 기준 실패 기록

- [ ] **Step 1: 새 컨텍스트에서 기준 시나리오 실행**

스킬 경로를 알려주지 않은 새 에이전트에 다음 프롬프트를 그대로 전달한다.

```text
구현 작업을 외부 Claude Advisor의 감독 아래 진행해야 한다. claude -p를 사용하고 기본 모델은 fable, 사용량 초과 시 opus로 바꿔라. Advisor는 파일을 수정하면 안 되며 응답은 BRIEF/QUESTION/SKIP/APPROVED/REVISE/ESCALATE 상태 계약을 따라야 한다. 실제 호출은 하지 말고 정확한 실행 절차와 복구 절차를 제시하라.
```

- [ ] **Step 2: 기준 실패 여부 판정**

다음 중 하나라도 빠지면 RED로 기록한다.

```text
- claude -p --model fable 호출
- 사용량 초과 시 opus 재시도
- 최초 JSON 결과의 session_id 추출
- --resume을 이용한 동일 세션 통신
- Read/Grep/Glob 외 도구 차단
- 여섯 상태 태그의 분기와 최대 3회 REVISE
```

Expected: 최소 한 항목이 빠져 스킬이 필요한 기준 실패가 관찰된다. 모든 항목을 우연히 충족하면 더 강한 시나리오로 다시 실행해 세션 소실 복구 또는 명시 모델 보존 실패를 관찰한다.

---

### Task 2: 전역 스킬 스캐폴드와 실패하는 CLI 테스트

**Files:**
- Create: `skills/advisor/SKILL.md`
- Create: `skills/advisor/agents/openai.yaml`
- Create: `skills/advisor/scripts/advisor.sh`
- Create: `skills/advisor/tests/test-advisor.sh`

**Interfaces:**
- Consumes: `skill-creator/scripts/init_skill.py`
- Produces: `advisor.sh start [--model MODEL]` 및 `advisor.sh resume SESSION_ID [--model MODEL]`의 테스트 계약

- [ ] **Step 1: 스킬 디렉터리 초기화**

Run:

```bash
python3 /Users/courtesy/.codex/skills/.system/skill-creator/scripts/init_skill.py advisor \
  --path skills \
  --resources scripts \
  --interface 'display_name=Claude Advisor' \
  --interface 'short_description=Claude의 감독 아래 구현하고 결과를 검증합니다' \
  --interface 'default_prompt=Use $advisor to supervise this implementation with a read-only Claude Advisor.'
mkdir -p skills/advisor/tests
```

Expected: `SKILL.md`, `agents/openai.yaml`, `scripts/`, `tests/`가 존재한다.

- [ ] **Step 2: 래퍼 계약을 표현하는 테스트 작성**

`skills/advisor/tests/test-advisor.sh`에 다음 구조를 작성한다.

```bash
#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
subject="$skill_dir/scripts/advisor.sh"
scratch_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${scratch_dir:-}" && -d "$scratch_dir" ]]; then
    rm -rf -- "$scratch_dir"
  fi
}
trap cleanup EXIT

fake_claude="$scratch_dir/claude"
call_log="$scratch_dir/calls.log"
retry_marker="$scratch_dir/fable-failed"

cat >"$fake_claude" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$ADVISOR_TEST_LOG"

if [[ "${ADVISOR_FAKE_MODE:-success}" == "quota" && " $* " == *" --model fable "* && ! -f "$ADVISOR_RETRY_MARKER" ]]; then
  : >"$ADVISOR_RETRY_MARKER"
  echo "usage limit exceeded" >&2
  exit 1
fi

if [[ "${ADVISOR_FAKE_MODE:-success}" == "fail" ]]; then
  echo "authentication failed" >&2
  exit 23
fi

if [[ "${ADVISOR_FAKE_MODE:-success}" == "invalid" && ! -f "$ADVISOR_RETRY_MARKER" ]]; then
  : >"$ADVISOR_RETRY_MARKER"
  echo "not-json"
  exit 0
fi

printf '%s\n' '{"type":"result","result":"BRIEF\n검증 브리프","session_id":"session-123"}'
FAKE
chmod +x "$fake_claude"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() { [[ "$1" == *"$2"* ]] || fail "missing: $2"; }
reset_log() { : >"$call_log"; rm -f "$retry_marker"; }

reset_log
output="$(printf 'task context' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" "$subject" start)"
calls="$(cat "$call_log")"
assert_contains "$calls" "--model fable"
assert_contains "$calls" "--fallback-model opus"
assert_contains "$calls" "--permission-mode plan"
assert_contains "$calls" "--tools Read,Grep,Glob"
assert_contains "$output" '"session_id":"session-123"'

reset_log
printf 'quota context' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" ADVISOR_FAKE_MODE=quota "$subject" start >/dev/null
[[ "$(wc -l <"$call_log" | tr -d ' ')" == "2" ]] || fail "quota fallback must call twice"
assert_contains "$(tail -n 1 "$call_log")" "--model opus"

reset_log
printf 'explicit model' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" "$subject" start --model sonnet >/dev/null
[[ "$(wc -l <"$call_log" | tr -d ' ')" == "1" ]] || fail "explicit model must not retry"
assert_contains "$(cat "$call_log")" "--model sonnet"

reset_log
printf 'completion report' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" "$subject" resume session-123 >/dev/null
assert_contains "$(cat "$call_log")" "--resume session-123"

reset_log
output="$(printf 'invalid result' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" ADVISOR_FAKE_MODE=invalid "$subject" start)"
[[ "$(wc -l <"$call_log" | tr -d ' ')" == "2" ]] || fail "invalid JSON must retry once"
assert_contains "$output" '"session_id":"session-123"'

reset_log
set +e
failure="$(printf 'failure' | ADVISOR_CLAUDE_BIN="$fake_claude" ADVISOR_TEST_LOG="$call_log" ADVISOR_RETRY_MARKER="$retry_marker" ADVISOR_FAKE_MODE=fail "$subject" start 2>&1)"
status=$?
set -e
[[ "$status" == "23" ]] || fail "expected exit 23, got $status"
assert_contains "$failure" "authentication failed"

echo "PASS: advisor wrapper contract"
```

- [ ] **Step 3: 테스트 실행 권한 부여**

Run: `chmod +x skills/advisor/tests/test-advisor.sh`

- [ ] **Step 4: 테스트가 올바른 이유로 실패하는지 확인**

Run: `skills/advisor/tests/test-advisor.sh`

Expected: FAIL because `scripts/advisor.sh`가 아직 계약을 구현하지 않았다.

---

### Task 3: Claude CLI 세션 래퍼 구현

**Files:**
- Modify: `skills/advisor/scripts/advisor.sh`
- Test: `skills/advisor/tests/test-advisor.sh`

**Interfaces:**
- Consumes: stdin의 비어 있지 않은 Advisor 메시지, `start|resume`, 선택적 `--model`
- Produces: 성공 시 Claude JSON stdout, 실패 시 원래 stderr와 종료 코드

- [ ] **Step 1: 최소 래퍼 구현**

`advisor.sh`는 다음 계약으로 구현한다.

```bash
#!/usr/bin/env bash
set -euo pipefail

claude_bin="${ADVISOR_CLAUDE_BIN:-claude}"
mode="${1:-}"
[[ "$mode" == "start" || "$mode" == "resume" ]] || {
  echo "usage: advisor.sh start [--model MODEL] | advisor.sh resume SESSION_ID [--model MODEL]" >&2
  exit 64
}
shift

session_id=""
if [[ "$mode" == "resume" ]]; then
  session_id="${1:-}"
  [[ -n "$session_id" ]] || { echo "resume requires SESSION_ID" >&2; exit 64; }
  shift
fi

model="fable"
model_is_default=1
if [[ "${1:-}" == "--model" ]]; then
  model="${2:-}"
  [[ -n "$model" ]] || { echo "--model requires a value" >&2; exit 64; }
  model_is_default=0
  shift 2
fi
[[ "$#" == "0" ]] || { echo "unexpected arguments: $*" >&2; exit 64; }

command -v "$claude_bin" >/dev/null 2>&1 || {
  echo "Claude CLI not found: $claude_bin" >&2
  exit 127
}

prompt="$(cat)"
[[ -n "$prompt" ]] || { echo "advisor prompt must not be empty" >&2; exit 64; }

scratch_dir="$(mktemp -d)"
cleanup() {
  if [[ -n "${scratch_dir:-}" && -d "$scratch_dir" ]]; then
    rm -rf -- "$scratch_dir"
  fi
}
trap cleanup EXIT

run_once() {
  local selected_model="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local args=(-p --output-format json --permission-mode plan --tools "Read,Grep,Glob" --model "$selected_model")
  if [[ "$selected_model" == "fable" ]]; then
    args+=(--fallback-model opus)
  fi
  if [[ "$mode" == "resume" ]]; then
    args+=(--resume "$session_id")
  fi
  "$claude_bin" "${args[@]}" "$prompt" >"$stdout_file" 2>"$stderr_file"
}

valid_result() {
  jq -e '
    type == "object" and
    (.session_id | type == "string" and length > 0) and
    (.result | type == "string" and length > 0)
  ' "$1" >/dev/null 2>&1
}

stdout_file="$scratch_dir/stdout"
stderr_file="$scratch_dir/stderr"
set +e
run_once "$model" "$stdout_file" "$stderr_file"
status=$?
set -e

if [[ "$status" == "0" ]] && ! valid_result "$stdout_file"; then
  : >"$stdout_file"
  : >"$stderr_file"
  set +e
  run_once "$model" "$stdout_file" "$stderr_file"
  status=$?
  set -e
  if [[ "$status" == "0" ]] && ! valid_result "$stdout_file"; then
    echo "Claude CLI returned invalid JSON twice" >&2
    exit 65
  fi
fi

allow_opus_retry=0
if [[ "$model" == "fable" ]]; then
  allow_opus_retry=1
fi

if [[ "$status" != "0" && "$allow_opus_retry" == "1" ]] && \
   grep -Eiq 'usage[[:space:]-]*(limit|exceeded)|overload|not available|capacity' "$stderr_file"; then
  : >"$stdout_file"
  : >"$stderr_file"
  set +e
  run_once opus "$stdout_file" "$stderr_file"
  status=$?
  set -e
  if [[ "$status" == "0" ]] && ! valid_result "$stdout_file"; then
    echo "Claude CLI fallback returned invalid JSON" >&2
    exit 65
  fi
fi

cat "$stdout_file"
if [[ "$status" != "0" ]]; then
  cat "$stderr_file" >&2
fi
exit "$status"
```

명시적 `--model fable`도 사용자의 지정과 일치하므로 `opus` 대체를 허용한다. `model_is_default`는 향후 진단 메시지에만 사용하거나 불필요하면 제거해 ShellCheck 경고를 없앤다.

- [ ] **Step 2: 래퍼 테스트 실행**

Run: `skills/advisor/tests/test-advisor.sh`

Expected: `PASS: advisor wrapper contract`

- [ ] **Step 3: 정적 검사 실행**

Run: `shellcheck skills/advisor/scripts/advisor.sh skills/advisor/tests/test-advisor.sh`

Expected: exit 0 with no findings. `model_is_default`가 미사용이면 삭제한다.

---

### Task 4: Advisor 작업 프로토콜 작성

**Files:**
- Modify: `skills/advisor/SKILL.md`
- Test: `skills/advisor/tests/test-advisor.sh`

**Interfaces:**
- Consumes: 사용자 과제, 저장소 컨텍스트, `advisor.sh`의 JSON 결과
- Produces: 상태 태그에 따른 Worker 행동과 최대 3회 검증 루프

- [ ] **Step 1: SKILL.md frontmatter 작성**

```yaml
---
name: advisor
description: Use when the user asks for advisor supervision, independent implementation judgment, delegated verification, or requests to work under a Claude advisor.
---
```

- [ ] **Step 2: 역할과 호출 규칙 작성**

본문을 한국어 명령형으로 작성하고 다음 규칙을 모두 포함한다.

```text
- 호출 Codex는 Worker이고 Claude CLI 세션은 Advisor다.
- 실제 구현, 파일 변경, 명령 실행과 사용자 소통은 Worker가 소유한다.
- Advisor는 요구사항 분석, 브리프, 판단 질문, diff·테스트 결과 검증과 승인만 소유한다.
- 최초 메시지는 사용자 요청 원문, 탐색한 파일과 규약, 제약, 완료 기준을 포함한다.
- `printf '%s' "$prompt" | scripts/advisor.sh start [--model MODEL]`로 시작한다.
- JSON의 `.session_id`와 `.result`를 `jq -r`로 추출한다.
- 후속 메시지는 `scripts/advisor.sh resume SESSION_ID`로 같은 세션에 보낸다.
```

- [ ] **Step 3: Advisor 시스템 프롬프트 계약 작성**

SKILL.md 안에 Worker가 최초 메시지 앞에 붙일 다음 의미의 고정 프롬프트를 제공한다.

```text
너는 구현하지 않는 읽기 전용 Advisor다. 요구사항 분석, 작업 브리프, 판단 질문, Worker가 제공한 diff와 검증 결과의 판정만 수행한다. 모든 응답 첫 줄은 BRIEF, QUESTION, SKIP, APPROVED, REVISE, ESCALATE 중 하나다. BRIEF에는 목표·대상 파일·컨벤션·함정·정확한 검증 명령을 포함한다. REVISE에는 관찰 근거와 수정 브리프를 포함한다. 구현 파일을 수정하거나 커밋·푸시하지 않는다.
```

- [ ] **Step 4: 상태별 Worker 분기 작성**

```text
BRIEF     → 범위 내 구현 후 diff와 전체 검증 출력을 보고한다.
QUESTION  → 구조화된 UI 도구로 사용자에게 묻고 답을 그대로 resume한다.
SKIP      → Advisor 세션을 종료하고 Worker가 직접 처리한다.
APPROVED  → 최신 검증 근거와 함께 완료를 보고한다.
REVISE    → 라운드를 증가시키고 3회 이하에서 수정·재검증한다.
ESCALATE  → 상황과 선택지를 사용자에게 그대로 전달한다.
```

알 수 없는 태그는 동일 세션에 한 번 형식 교정을 요청하고, 다시 실패하면 중단한다. 세션 재개 실패 시 사용자 요청, 최신 브리프, 판정 이력, 현재 diff·검증 요약을 포함해 새 세션을 시작한다.

- [ ] **Step 5: 기계적 계약 테스트 재실행**

Run: `skills/advisor/tests/test-advisor.sh`

Expected: PASS.

---

### Task 5: UI 메타데이터 생성 및 스킬 구조 검증

**Files:**
- Modify: `skills/advisor/agents/openai.yaml`
- Read: `skills/advisor/SKILL.md`

**Interfaces:**
- Consumes: 최종 SKILL.md의 이름과 호출 목적
- Produces: Codex UI에서 발견 가능한 `advisor` 스킬 메타데이터

- [ ] **Step 1: openai.yaml 재생성**

Run:

```bash
python3 /Users/courtesy/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py \
  skills/advisor \
  --interface 'display_name=Claude Advisor' \
  --interface 'short_description=Claude의 감독 아래 구현하고 결과를 검증합니다' \
  --interface 'default_prompt=Use $advisor to supervise this implementation with a read-only Claude Advisor.'
```

Expected `agents/openai.yaml`:

```yaml
interface:
  display_name: "Claude Advisor"
  short_description: "Claude의 감독 아래 구현하고 결과를 검증합니다"
  default_prompt: "Use $advisor to supervise this implementation with a read-only Claude Advisor."
```

- [ ] **Step 2: Skill Creator 검증 실행**

Run:

```bash
uv run --with pyyaml python /Users/courtesy/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/advisor
```

Expected: skill is valid. 시스템 Python에는 PyYAML이 없으므로 반드시 `uv run --with pyyaml`을 사용한다.

- [ ] **Step 3: 플레이스홀더와 필수 계약 검사**

Run:

```bash
! rg -n 'TODO|TBD|\[TODO' skills/advisor
rg -n 'BRIEF|QUESTION|SKIP|APPROVED|REVISE|ESCALATE|fable|opus|구조화된 UI' skills/advisor/SKILL.md
```

Expected: 첫 명령 exit 0, 두 번째 명령이 모든 필수 키워드를 출력한다.

---

### Task 6: 스킬 동작 검증과 배포 확인

**Files:**
- Read: `skills/advisor/SKILL.md`
- Read: `skills/advisor/scripts/advisor.sh`
- Test: `skills/advisor/tests/test-advisor.sh`

**Interfaces:**
- Consumes: 완성된 전역 스킬과 기준 시나리오
- Produces: 기계적 검증 증거, 스킬 적용 시 행동 검증, 선택적 실제 Claude 스모크 결과

- [ ] **Step 1: 전체 로컬 검증 실행**

Run:

```bash
skills/advisor/tests/test-advisor.sh
shellcheck skills/advisor/scripts/advisor.sh skills/advisor/tests/test-advisor.sh
uv run --with pyyaml python /Users/courtesy/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/advisor
```

Expected: 세 명령 모두 exit 0.

- [ ] **Step 2: 새 에이전트에 완성된 스킬을 적용해 기준 시나리오 재실행**

새 에이전트에 다음 프롬프트를 전달한다.

```text
Use $advisor at skills/advisor to supervise a hypothetical implementation. Do not call the real Claude service. Explain the exact start, status-routing, verification, model-fallback, and session-recovery actions you would take.
```

Expected: Task 1의 여섯 항목을 모두 충족하고, 실제 Claude 호출이나 파일 변경은 수행하지 않는다.

- [ ] **Step 3: 새 합리화나 누락이 발견되면 최소 수정 후 재검증**

누락된 계약만 `SKILL.md`에 추가하고 Step 1과 Step 2를 다시 실행한다. 기계적 래퍼 동작이 바뀌면 먼저 실패하는 셸 테스트를 추가한다.

- [ ] **Step 4: 실제 Claude 스모크 테스트 승인 요청**

사용자에게 실제 `fable` 호출과 동일 세션 재개가 사용량을 소비함을 알리고 승인을 요청한다. 승인 전에는 실행하지 않는다.

- [ ] **Step 5: 승인된 경우에만 실제 스모크 테스트 실행**

Run:

```bash
mkdir -p /Users/courtesy/.codex/skills/advisor
cp -R skills/advisor/SKILL.md skills/advisor/agents skills/advisor/scripts /Users/courtesy/.codex/skills/advisor/
first_json="$(printf '%s' '읽기 전용 Advisor로서 첫 줄을 BRIEF로 시작하고 테스트용 한 줄 브리프만 반환하라.' | /Users/courtesy/.codex/skills/advisor/scripts/advisor.sh start)"
session_id="$(printf '%s' "$first_json" | jq -r '.session_id')"
printf '%s' '첫 줄을 APPROVED로 시작해 테스트 세션 종료를 승인하라.' | /Users/courtesy/.codex/skills/advisor/scripts/advisor.sh resume "$session_id"
```

Expected: 첫 결과의 `session_id`가 비어 있지 않고, 첫 응답은 `BRIEF`, 후속 응답은 `APPROVED`로 시작한다.

- [ ] **Step 6: 최종 설치 확인**

Run:

```bash
find /Users/courtesy/.codex/skills/advisor -maxdepth 3 -type f -print | sort
test -x skills/advisor/tests/test-advisor.sh
```

Expected global files:

```text
/Users/courtesy/.codex/skills/advisor/SKILL.md
/Users/courtesy/.codex/skills/advisor/agents/openai.yaml
/Users/courtesy/.codex/skills/advisor/scripts/advisor.sh
```

저장소의 `skills/advisor/tests/test-advisor.sh`는 실행 가능한 상태로 유지한다.

새 Codex 세션에서 `$advisor`가 자동 발견되지 않으면 현재 세션의 스킬 목록 캐시 문제로 보고 새 세션을 시작해 다시 확인한다. 파일을 다른 위치에 중복 설치하지 않는다.
