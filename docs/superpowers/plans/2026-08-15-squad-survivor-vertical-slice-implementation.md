# 스쿼딩 30초 수직 슬라이스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 renderer 비교 프로토타입을 보존하면서, 승인된 명세의 두 분대 지휘·교대·구조·성장·정예전을 갖춘 결정론적 30초 브라우저 게임을 기본 진입점으로 만든다.

**Architecture:** 기존 `simulation.ts`, `game-controller.ts`, `app-shell.ts`는 renderer 비교 lab의 회귀 경계로 유지한다. 새 권위 게임은 `core/gameplay/`, 새 DOM 입력·RAF 경계는 `app/gameplay-controller.ts`, 새 화면은 `app/gameplay-shell.ts`가 소유하며, 둘 다 기존 `GameRenderer`의 표시 전용 `RenderSnapshot` 계약을 재사용한다. `main.ts`는 기본 경로에서 gameplay shell만 동적 로드하고 `?lab=renderers`에서만 기존 비교 shell을 동적 로드한다.

**Tech Stack:** TypeScript 7.0.2, Vite 8.2.1, Vitest 4.1.10 + jsdom, Playwright 1.62.1, Three.js 0.185.1, 기존 `GameRenderer` 계약

## Global Constraints

- 권위 전투는 정확히 30Hz, `combatTick 0..900`이며 `paused`, `awaiting-upgrade`, hidden 상태에서는 증가하지 않는다.
- 명세의 14단계 tick 순서와 `won > lost > awaiting-upgrade` 우선순위를 바꾸지 않는다.
- 루트 seed에서 `spawn`, `cards`, `formation` PRNG를 분리하고 전투 판정에는 난수를 사용하지 않는다.
- 결정론은 renderer snapshot hash가 아니라 전체 권위 `GameState` digest로 판정한다.
- 일반 플레이는 Three.js 2.5D 하나만 로드하며 renderer 선택, `enemyCount`, benchmark JSON, FPS·품질 HUD를 노출하지 않는다.
- Phaser·Three 3D·benchmark 코드는 삭제하지 않고 `?lab=renderers` 격리 경로에서 기존 테스트와 함께 보존한다.
- 외부 runtime dependency와 외부 asset을 추가하지 않는다. 새 시각 요소는 기존 코드 생성 자산과 Three primitive만 사용한다.
- 모든 gameplay 변경은 RED를 먼저 확인하고, task별 targeted GREEN 뒤 전체 Vitest·build를 실행한다.
- 작업은 dirty `main`을 직접 수정하지 않는 격리 worktree/feature branch에서 수행한다. SDD task commit은 해당 로컬 branch에만 만들며 push·merge는 사용자 승인 전 수행하지 않는다.
- Task 8의 밸런스가 실패하면 명세가 허용한 압박 회당 요청 `3..5`, 일반 적 피해 `0.07..0.12`, 정예 HP `(23.9, 26.8]`, exhausted 간격 배율 `1.5..2.0` 안에서만 조정하고 파생표와 검증을 함께 갱신한다.
- 각 task의 구현·검증·review가 끝날 때 `docs/codex-usage-log.md`에 목표, 사용한 subagent/skill, RED/GREEN 근거, review 판정과 다음 task를 추가한다.

---

## 파일 구조

새 gameplay 경계:

```text
prototype/src/core/gameplay/
  types.ts            권위 상태·입력 event·공개 simulation 타입
  constants.ts        승인된 수치와 spawn/telegraph 표
  input-queue.ts      sequence 정렬, cursor, 지속 입력 상태
  state.ts            초기 roster·named PRNG stream·restart
  movement.ts         formation, 활성 이동, 비활성 추종, enemy clamp
  combat.ts           표적 재선택, cooldown, 접촉 slot, 즉시 피해
  squads.ts           교대 cooldown, 피로, exhausted 배율
  rescue.ts           downed/dead timer와 단일 rescuer hold
  progression.ts      XP 16, 카드 순서와 power/march/vigor 적용
  elite.ts            정예 추적, 고정 telegraph, 범위 피해
  snapshot.ts         GameState -> RenderSnapshot 표시 projection
  digest.ts           정렬·6자리 정규화한 권위 digest
  simulation.ts       14단계 tick reducer와 public facade
prototype/src/scenarios/
  gameplay-policies.ts public command만 만드는 세 에이전시 정책
prototype/src/app/
  gameplay-controller.ts RAF·DOM input·pause/hidden과 renderer lifecycle
  gameplay-shell.ts    시작·HUD·강화·pause·결과 UI
```

기존 renderer lab 경계:

```text
prototype/src/core/simulation.ts
prototype/src/app/game-controller.ts
prototype/src/app/app-shell.ts
prototype/src/scenarios/renderer-benchmark.ts
```

위 파일은 gameplay 규칙의 소스가 아니다. 필요한 shared renderer type 확장만 `core/types.ts`와 `renderers/contract.ts`에 가한다.

### Task 1: 권위 상태, named PRNG와 입력 queue

**Files:**
- Create: `prototype/src/core/gameplay/types.ts`
- Create: `prototype/src/core/gameplay/constants.ts`
- Create: `prototype/src/core/gameplay/input-queue.ts`
- Create: `prototype/src/core/gameplay/state.ts`
- Modify: `prototype/src/core/prng.ts`
- Test: `prototype/tests/core/gameplay-foundation.test.ts`

**Interfaces:**
- Consumes: 기존 `createPrng(seed)`의 결정론적 xorshift 구현.
- Produces: `Vec2`, `GameState`, `GameInputEvent`, `PersistentInput`, `GameplayFixture`, `createInitialGameState(seed, fixture?)`, `createGameplayInputQueue()`, state를 노출하는 `Prng.getState()`.

- [ ] **Step 1: 초기 권위 상태와 입력 정렬 RED 테스트 작성**

```ts
test('starts at tick zero with scarlet active and three independent streams', () => {
  const state = createInitialGameState('47')
  expect(state).toMatchObject({ combatTick: 0, mode: 'ready', activeSquad: 'scarlet' })
  expect(state.friendlies.filter(unit => unit.squad === 'teal')).toHaveLength(8)
  expect(state.friendlies.filter(unit => unit.squad === 'scarlet')).toHaveLength(8)
  expect(Object.keys(state.prng)).toEqual(['cards', 'formation', 'spawn'])
})

test('orders same-tick commands by sequence and copies payloads', () => {
  const queue = createGameplayInputQueue()
  queue.enqueue({ applyTick: 3, sequence: 2, kind: 'switch-squad' })
  queue.enqueue({ applyTick: 3, sequence: 1, kind: 'set-rescue', held: true })
  expect(queue.take(3).map(event => event.sequence)).toEqual([1, 2])
})
```

- [ ] **Step 2: foundation 테스트가 모듈 부재로 실패하는지 실행**

Run: `cd prototype && npm test -- tests/core/gameplay-foundation.test.ts`

Expected: FAIL with unresolved imports from `src/core/gameplay/*`.

- [ ] **Step 3: 정확한 권위 타입과 상수 구현**

```ts
export type BattleMode = 'ready' | 'running' | 'awaiting-upgrade' | 'paused' | 'won' | 'lost'
export type FailureReason = 'all-units-lost' | 'elite-survived' | null
export type UpgradeId = 'power' | 'march' | 'vigor'
export type GameplayFixture = 'determinism' | 'damage-events'
export type Vec2 = { readonly x: number; readonly y: number }
export type LifeState = 'standing' | 'downed' | 'dead'
export type PersistentInput = { move: Vec2; rescueHeld: boolean }
export type FriendlyState = {
  id: number; squad: Squad; hp: number; maxHp: number; life: LifeState
  position: Vec2; formationOffset: Vec2; attackCooldown: number; targetId: number | null
  downedTicks: number; rescueTargetId: number | null; rescueProgress: number
}
export type NormalEnemyState = {
  id: number; hp: number; position: Vec2; attackCooldown: number; targetId: number | null
}
export type EliteState = {
  id: number; spawned: boolean; hp: number; position: Vec2; targetId: number | null
  telegraphCenter: Vec2 | null; telegraphRemaining: number; cycleIndex: number
  warningTicks: number[]; damageTicks: number[]
}
export type DamageEvent = { sourceId: number; targetId: number; amount: number; kind: 'contact' | 'elite-area' }
export type SquadState = {
  fatigue: number; exhausted: boolean; lastCenter: Vec2; lastDirection: Vec2
  damageMultiplier: number; movementMultiplier: number; hpMultiplier: number
}
export type UpgradeState = {
  offered: readonly UpgradeId[]; choice: UpgradeId | null; applied: boolean
}
export type GameState = {
  schemaVersion: 1; rootSeed: string; combatTick: number; mode: BattleMode
  failureReason: FailureReason; activeSquad: Squad; switchCooldown: number
  prng: { spawn: number; cards: number; formation: number }
  wave: { cursor: number; requested: number; discarded: number }
  input: PersistentInput; inputCursor: number; pendingEvents: GameInputEvent[]
  squads: Record<Squad, SquadState>; friendlies: FriendlyState[]
  normalEnemies: NormalEnemyState[]; elite: EliteState
  damageEvents: DamageEvent[]
  stats: { kills: number; xp: number; rescues: number }
  upgrade: UpgradeState
}
export type GameInputEvent =
  | { readonly applyTick: 0; readonly sequence: number; readonly kind: 'start-battle' }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'set-move'; readonly x: number; readonly y: number }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'set-rescue'; readonly held: boolean }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'switch-squad' }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'choose-upgrade'; readonly index: 0 | 1 | 2 }
  | { readonly applyTick: number; readonly sequence: number; readonly kind: 'toggle-pause' }

export interface GameplaySimulation {
  getState(): Readonly<GameState>
  getSnapshot(): RenderSnapshot
  getDigest(): string
  enqueue(event: GameInputEvent): void
  step(): void
  restart(): void
}
```

`GameState.prng`는 `{ spawn: number; cards: number; formation: number }`의 plain 숫자 상태만 보관한다. simulation runtime이 세 `Prng` 객체를 소유하고 각 소비 직후 대응 숫자를 동기화하므로 digest가 함수나 객체 identity에 의존하지 않는다.

`constants.ts`에는 30Hz, 900 tick, arena `48×27`, 16명 roster, 60 tick 교대 cooldown, fatigue `1/450`·회복 `1/300`, 표의 HP·속도·피해·간격·사거리, downed 240 tick, 구조 30/45 tick을 그대로 선언한다.

authority simulation은 spec의 `ready` 상태도 소유한다. 시작 화면에서는 `ready/tick 0`이고 `start-battle`을 적용한 직후 `running/tick 0/scarlet`이 되어 “전투 시작 직후” 계약을 만족한다. `start-battle`, `toggle-pause`, `choose-upgrade`는 `enqueue()` 호출 안에서 같은 `combatTick`의 sequence 순으로 즉시 처리하되 combat tick을 증가시키지 않는 zero-time control event다. 이동·구조·교대 event만 다음 running `step()`까지 pending queue에 남는다.

- [ ] **Step 4: PRNG 상태 노출과 named seed 파생 구현**

`Prng`에 `getState(): number`를 추가하고 `createPrng(`${rootSeed}:spawn`)`, `:cards`, `:formation`을 각각 만든다. `formation`은 초기 16회 X/Y offset 생성 이후 소비하지 않는다. 기존 `createPrng` 사용자 테스트도 그대로 통과시킨다.

- [ ] **Step 5: foundation targeted GREEN과 전체 unit GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-foundation.test.ts tests/core/determinism.test.ts`

Expected: both files PASS; 기존 PRNG 호출자 regression 없음.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/prng.ts prototype/src/core/gameplay prototype/tests/core/gameplay-foundation.test.ts docs/codex-usage-log.md
git commit -m "feat: define authoritative gameplay state"
```

### Task 2: 권위 digest와 14단계 simulation facade

**Files:**
- Create: `prototype/src/core/gameplay/digest.ts`
- Create: `prototype/src/core/gameplay/snapshot.ts`
- Create: `prototype/src/core/gameplay/simulation.ts`
- Modify: `prototype/src/core/types.ts`
- Create: `prototype/tests/helpers/gameplay-fixtures.ts`
- Test: `prototype/tests/core/gameplay-determinism.test.ts`

**Interfaces:**
- Consumes: Task 1의 `GameState`, queue와 named PRNG state.
- Produces: `createGameplaySimulation({ seed, fixture? })`, `digestGameState(state)`, sorted `RenderSnapshot`; Task 3~8이 phase reducer를 연결할 `GameplayStepPhases` 내부 경계; 테스트 전용 `createStateFixture`, `makeFriendly`, `makeNormalEnemy`, `repeat`, `startRunningGame`, `advanceToTick`.

- [ ] **Step 1: digest 완전성과 무효 입력 atomicity RED 테스트 작성**

```ts
test('includes queued events, cooldowns and named prng state in the digest', () => {
  const game = createGameplaySimulation({ seed: 'digest' })
  const before = game.getDigest()
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'switch-squad' })
  expect(game.getDigest()).not.toBe(before)
})

test('start-battle changes ready to running without consuming tick zero', () => {
  const game = createGameplaySimulation({ seed: '47' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  expect(game.getState()).toMatchObject({ combatTick: 0, mode: 'running', activeSquad: 'scarlet' })
})

test.each([Number.NaN, Infinity, -Infinity])('rejects %s without state mutation', value => {
  const game = createGameplaySimulation({ seed: 'finite' })
  const before = game.getDigest()
  expect(() => game.enqueue({ applyTick: 0, sequence: 1, kind: 'set-move', x: value, y: 0 })).toThrow(TypeError)
  expect(game.getDigest()).toBe(before)
})
```

- [ ] **Step 2: digest 테스트 RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-determinism.test.ts`

Expected: FAIL because gameplay simulation and digest do not exist.

- [ ] **Step 3: 정렬·6자리 정규화 digest 구현**

```ts
export function digestGameState(state: Readonly<GameState>): string {
  const canonical = canonicalizeAuthorityState(state, value =>
    typeof value === 'number' ? Number(value.toFixed(6)) : value,
  )
  return fnv1a(JSON.stringify(canonical))
}
```

canonical object에는 schema version, seed, mode/result/reason, tick, 세 PRNG state, wave/input cursor·pending events, squads, 모든 friendly/normal/elite fields, stats와 upgrade fields를 포함한다. 모든 entity/event 배열을 숫자 ID와 `(applyTick, sequence)` 순서로 정렬한다.

- [ ] **Step 4: 14단계 facade와 표시 snapshot projection 구현**

`step()`은 `running`이 아닐 때 combat phase를 실행하지 않는다. zero-time control event는 Task 1 계약대로 `enqueue()`에서 처리한다. 내부 함수 호출 순서를 `cooldowns → input → spawn → commands/upgrades → fatigue → movement → rescue-progress → friendly-attacks → normal-attacks → elite-telegraph → rescue/death/xp → tick++ → outcome → upgrade-entry`로 고정한다. 초기 단계에서는 각 phase가 no-op이어도 호출 순서 test hook으로 증명한다.

`core/types.ts`에는 기존 union을 깨지 않도록 `UnitKind`에 `elite`, `RenderEffect.kind`에 `elite-telegraph`를 추가하고 `RenderSnapshot.activeSquad?: Squad`를 추가한다.

- [ ] **Step 5: 이후 task가 임의 API를 만들지 않도록 test fixture helper 구현**

```ts
export function createStateFixture(seed = 'fixture'): MutableGameState {
  const state = structuredClone(createInitialGameState(seed)) as MutableGameState
  state.mode = 'running'
  return state
}

export function makeFriendly(id: number, squad: Squad, x: number, y: number): FriendlyState {
  const hp = squad === 'teal' ? 1.2 : 0.75
  return { id, squad, hp, maxHp: hp, life: 'standing', position: { x, y }, formationOffset: { x: 0, y: 0 }, attackCooldown: 0, targetId: null, downedTicks: 0, rescueTargetId: null, rescueProgress: 0 }
}

export function makeNormalEnemy(id: number, x: number, y: number): NormalEnemyState {
  return { id, hp: 1, position: { x, y }, attackCooldown: 0, targetId: null }
}

export const repeat = (count: number, action: () => void) => {
  for (let index = 0; index < count; index += 1) action()
}

export function startRunningGame(seed = 'fixture'): GameplaySimulation {
  const game = createGameplaySimulation({ seed })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  return game
}

export function advanceToTick(game: GameplaySimulation, target: number, onUpgrade: (game: GameplaySimulation) => void): void {
  while (game.getState().combatTick < target) {
    if (game.getState().mode === 'awaiting-upgrade') onUpgrade(game)
    game.step()
  }
}
```

`MutableGameState`, `FriendlyState`, `NormalEnemyState`는 production `types.ts`의 exported authority types를 mapped mutable test alias로 사용한다. 이후 task의 RED test는 이 파일의 helper만 사용하고 별도 이름의 미정의 fixture API를 만들지 않는다.

- [ ] **Step 6: 동일 seed/restart/checkpoint GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-determinism.test.ts tests/core/gameplay-foundation.test.ts && npm run build`

Expected: digest tests PASS and TypeScript build PASS.

- [ ] **Step 7: task commit**

```bash
git add prototype/src/core/gameplay prototype/src/core/types.ts prototype/tests/helpers/gameplay-fixtures.ts prototype/tests/core/gameplay-determinism.test.ts docs/codex-usage-log.md
git commit -m "feat: add deterministic gameplay reducer"
```

### Task 3: 위치 이동, 추종, 표적 선택과 접촉 피해

**Files:**
- Create: `prototype/src/core/gameplay/movement.ts`
- Create: `prototype/src/core/gameplay/combat.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Test: `prototype/tests/core/gameplay-combat.test.ts`

**Interfaces:**
- Consumes: mutable authority entities and approved constants.
- Produces: `advanceMovement(state)`, `advanceFriendlyAttacks(state)`, `advanceNormalAttacks(state)`, deterministic `selectTarget` and two-slot assignment.

- [ ] **Step 1: movement/target/slot RED tests 작성**

```ts
test('clamps enemy movement to the target without overshoot', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.01, 0)]
  advanceMovement(state)
  expect(state.normalEnemies[0].position).toEqual({ x: 0, y: 0 })
})

test('reselects a dead target before the next id-ordered attack', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0), makeFriendly(2, 'scarlet', 0, 0)]
  state.normalEnemies = [makeNormalEnemy(101, 0.5, 0), makeNormalEnemy(102, 0.6, 0)]
  state.normalEnemies[0].hp = 0.11
  advanceFriendlyAttacks(state)
  expect(state.normalEnemies.map(enemy => enemy.hp)).toEqual([0, 0.89])
})

test('only the two lowest enemy ids damage one friendly', () => {
  const state = createStateFixture()
  state.friendlies = [makeFriendly(1, 'scarlet', 0, 0)]
  state.normalEnemies = [101, 102, 103].map(id => makeNormalEnemy(id, 0.5, 0))
  advanceNormalAttacks(state)
  expect(state.damageEvents.map(event => event.sourceId)).toEqual([101, 102])
})
```

- [ ] **Step 2: combat 테스트 RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-combat.test.ts`

Expected: FAIL with missing movement/combat exports.

- [ ] **Step 3: active movement와 inactive follow 구현**

활성 기립 병사는 정규화한 입력과 formation offset을 유지해 이동하고 arena 안으로 clamp한다. 비활성 분대는 마지막 이동 방향 반대 3.5 unit 목표를 `max(upgraded squad speeds)+0.02`로 추종하며 0.5 unit 안에서 정지한다. 기립 병사 0인 분대는 마지막 유효 중심을 보존한다.

- [ ] **Step 4: deterministic targeting과 두 접촉 slot 구현**

양 분대는 정예가 사거리 안이면 정예를 먼저, 아니면 거리·ID 순 일반 적을 선택한다. 일반 적은 거리·friendly ID 순 표적을 추적하고, 접촉 slot은 적 ID 오름차순으로 최대 2개만 할당한다. 세 번째 적은 같은 tick에 공격하지 않고 다음 tick에 빈 slot이 있는 최근접 기립 병사로 재표적한다. 기립 병사가 없으면 target ID를 `null`로 만들고 정지한다.

- [ ] **Step 5: cooldown·inactive damage와 arena GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-combat.test.ts tests/core/gameplay-determinism.test.ts`

Expected: target revalidation, overkill removal, 2-slot limit, no-standing stop and bounds tests PASS.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/gameplay prototype/tests/core/gameplay-combat.test.ts docs/codex-usage-log.md
git commit -m "feat: add positional squad combat"
```

### Task 4: 교대 cooldown과 한 단계 피로

**Files:**
- Create: `prototype/src/core/gameplay/squads.ts`
- Modify: `prototype/src/core/gameplay/combat.ts`
- Modify: `prototype/src/core/gameplay/movement.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Test: `prototype/tests/core/gameplay-squads.test.ts`

**Interfaces:**
- Consumes: `switch-squad` event와 squad authority state.
- Produces: `applySquadSwitch`, `advanceFatigue`, `movementMultiplier`, `attackInterval`; Task 5 rescue가 active squad를 조회한다.

- [ ] **Step 1: cooldown/fatigue/agency RED tests 작성**

```ts
test('rejects switch before 60 ticks and accepts it on tick 60', () => {
  const game = startRunningGame('switch')
  game.enqueue({ applyTick: 0, sequence: 1, kind: 'switch-squad' })
  game.step()
  repeat(58, () => game.step())
  game.enqueue({ applyTick: 59, sequence: 2, kind: 'switch-squad' })
  game.step()
  expect(game.getState().activeSquad).toBe('teal')
  game.enqueue({ applyTick: 60, sequence: 3, kind: 'switch-squad' })
  game.step()
  expect(game.getState().activeSquad).toBe('scarlet')
})

test('exhausts after 270 active ticks and fully recovers after 180 inactive ticks', () => {
  const state = createStateFixture()
  state.activeSquad = 'scarlet'
  state.input.move = { x: 1, y: 0 }
  repeat(270, () => advanceFatigue(state))
  expect(state.squads.scarlet.exhausted).toBe(true)
  state.activeSquad = 'teal'
  repeat(180, () => advanceFatigue(state))
  expect(state.squads.scarlet).toMatchObject({ fatigue: 0, exhausted: false })
})
```

- [ ] **Step 2: squad tests RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-squads.test.ts`

Expected: FAIL with missing squad reducer.

- [ ] **Step 3: cooldown과 fixed-point fatigue 구현**

교대 성공 시 cooldown 60을 설정하고 다음 tick부터 단계 1에서 감소시킨다. cooldown 중 event는 폐기한다. 활성 분대가 이동·공격·구조 중이면 `1/450`, 비활성은 `1/300`을 회복하고 `0.60` 경계에서 exhausted를 토글한다.

- [ ] **Step 4: exhausted 배율과 명시적 무기립 교대 구현**

exhausted는 활성 이동 `×0.70`, 공격 간격 `×1.80`만 적용한다. inactive follow에는 적용하지 않는다. 활성 분대가 전멸해도 자동 교대하지 않고 명시적 switch 뒤에만 생존 분대가 입력을 받는다.

- [ ] **Step 5: controlled target 30초 피해 비교 GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-squads.test.ts tests/core/gameplay-combat.test.ts`

Expected: 교대 정책 피해가 주홍 단독과 청록 단독보다 각각 20% 이상 높고 모든 boundary test PASS.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/gameplay prototype/tests/core/gameplay-squads.test.ts docs/codex-usage-log.md
git commit -m "feat: add squad switching and fatigue"
```

### Task 5: downed, dead와 홀드 구조

**Files:**
- Create: `prototype/src/core/gameplay/rescue.ts`
- Modify: `prototype/src/core/gameplay/combat.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Modify: `prototype/src/core/gameplay/snapshot.ts`
- Test: `prototype/tests/core/gameplay-rescue.test.ts`

**Interfaces:**
- Consumes: persistent `rescueHeld`, active squad와 피해 event.
- Produces: `advanceRescueProgress`, `resolveRescueAndDownedTimers`, rescue target/rescuer/progress와 `rescue-signal` snapshot effect.

- [ ] **Step 1: 거리·29/30·44/45·피격 RED tests 작성**

```ts
test('does not lock a remote casualty after 90 held ticks', () => {
  const state = createStateFixture()
  const rescuer = makeFriendly(1, 'teal', 0, 0)
  const downed = makeFriendly(2, 'teal', 2, 0)
  downed.life = 'downed'
  downed.hp = 0
  downed.downedTicks = 240
  state.friendlies = [rescuer, downed]
  state.activeSquad = 'teal'
  repeat(90, () => advanceRescueProgress(state, true))
  expect(rescuer).toMatchObject({ rescueTargetId: null, rescueProgress: 0 })
})

test.each([['teal', 29, 30], ['scarlet', 44, 45]] as const)(
  '%s completes only on the exact hold boundary', (squad, before, complete) => {
    const state = createStateFixture()
    const rescuer = makeFriendly(1, squad, 0, 0)
    const casualty = makeFriendly(2, squad, 1, 0)
    casualty.life = 'downed'; casualty.hp = 0; casualty.downedTicks = 240
    state.friendlies = [rescuer, casualty]; state.activeSquad = squad
    repeat(before, () => { advanceRescueProgress(state, true); resolveRescueAndDownedTimers(state) })
    expect(casualty.life).toBe('downed')
    advanceRescueProgress(state, true); resolveRescueAndDownedTimers(state)
    expect(casualty.life).toBe('standing')
    expect(state.stats.rescues).toBe(1)
  },
)
```

- [ ] **Step 2: rescue tests RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-rescue.test.ts`

Expected: FAIL with missing rescue reducer.

- [ ] **Step 3: deterministic target/rescuer와 hold 구현**

남은 downed timer·ID로 target을, 거리·ID로 active rescuer 한 명을 정한다. rescuer만 단계 6 이동과 단계 8 공격에서 제외한다. release·거리 이탈·rescuer downed·target dead는 progress를 0으로 만들고 lock을 해제한다.

- [ ] **Step 4: 같은 tick 피해 감소와 완료 우선순위 구현**

단계 7에서 `+1`, 일반 접촉 피격마다 `-15`, 정예 범위 피격마다 `-15`를 하한 0으로 적용한다. 구조 완료를 downed timer 감소보다 먼저 판정하고, 완료 HP는 적용된 최대 HP의 50%다. 새 downed timer는 다음 tick부터 감소한다.

- [ ] **Step 5: rescue GREEN과 snapshot effect 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-rescue.test.ts tests/core/gameplay-combat.test.ts`

Expected: exact hold boundaries, one rescuer stop, 접촉 단독 순증 `-14`와 contact+elite double-hit 순증 `-29`(감소량 30), completion-before-expiry and render effect tests PASS.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/gameplay prototype/tests/core/gameplay-rescue.test.ts docs/codex-usage-log.md
git commit -m "feat: add deterministic hold rescue"
```

### Task 6: spawn table, XP 16과 한 번의 3택 강화

**Files:**
- Create: `prototype/src/core/gameplay/progression.ts`
- Modify: `prototype/src/core/gameplay/constants.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Test: `prototype/tests/core/gameplay-progression.test.ts`

**Interfaces:**
- Consumes: kill/XP 집계, `spawn`/`cards` streams, `choose-upgrade` event.
- Produces: `spawnForTick`, `recordNormalKill`, `enterUpgradeIfEligible`, `applyUpgradeChoice`, `applyPendingUpgrade`, public offered order와 applied multipliers.

- [ ] **Step 1: 97 requests/cap/XP/card RED tests 작성**

```ts
test('defines 35 spawn events requesting exactly 97 normal enemies', () => {
  expect(SPAWN_TABLE).toHaveLength(35)
  expect(SPAWN_TABLE.reduce((sum, event) => sum + event.count, 0)).toBe(97)
  expect(SPAWN_TABLE.at(-1)).toEqual({ tick: 870, count: 2 })
})

test('discards capped requests while consuming one spawn angle per request', () => {
  const state = createStateFixture()
  state.normalEnemies = Array.from({ length: 20 }, (_, index) => makeNormalEnemy(101 + index, 0, 0))
  const before = state.prng.spawn
  spawnForTick(state, 360)
  expect(state.normalEnemies).toHaveLength(20)
  expect(state.prng.spawn).not.toBe(before)
  expect(state.wave.discarded).toBe(4)
})

test('pauses once at xp 16 and applies only the chosen card on the next tick', () => {
  const state = createStateFixture()
  state.stats.xp = 15
  recordNormalKill(state); enterUpgradeIfEligible(state)
  expect(state.mode).toBe('awaiting-upgrade')
  const index = state.upgrade.offered.indexOf('power') as 0 | 1 | 2
  applyUpgradeChoice(state, index)
  expect(state.upgrade.applied).toBe(false)
  applyPendingUpgrade(state)
  expect(state.squads.scarlet.damageMultiplier).toBe(1.3)
  expect(state.squads.teal.damageMultiplier).toBe(1.3)
})
```

- [ ] **Step 2: progression tests RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-progression.test.ts`

Expected: FAIL with missing spawn/progression exports.

- [ ] **Step 3: exact spawn schedule와 cap 구현**

도입 `0..120/30 ×2`, 상승 `150..342/24 ×3`, 압박 `360..520/20 ×4`, 결전 `540..870/30 ×2`를 상수 배열로 만든다. 각 요청마다 spawn 각도를 한 번 소비하고 arena 밖 좌표는 재추첨 없이 clamp한다. tick 540은 일반 요청 angle 뒤 정예 angle을 소비한다.

- [ ] **Step 4: one-time upgrade state와 세 multiplier 구현**

XP 16을 해당 tick 종료 뒤 한 번만 `awaiting-upgrade`로 전환하고 `cards` stream으로 세 ID의 표시 순서만 shuffle한다. index 범위 오류는 상태 변경 전 `TypeError`다. `power ×1.30`, `march ×1.15`, `vigor max/current HP ×1.25`는 선택 다음 running tick 단계 4에서 정확히 한 번 적용한다.

- [ ] **Step 5: stream isolation과 progression GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-progression.test.ts tests/core/gameplay-determinism.test.ts`

Expected: 카드 선택을 바꿔도 spawn PRNG state/angle sequence가 같고 authority digest는 달라진다.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/gameplay prototype/tests/core/gameplay-progression.test.ts docs/codex-usage-log.md
git commit -m "feat: add waves and one-time upgrades"
```

### Task 7: 정예 예고, 범위 피해와 승패 우선순위

**Files:**
- Create: `prototype/src/core/gameplay/elite.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Modify: `prototype/src/core/gameplay/snapshot.ts`
- Test: `prototype/tests/core/gameplay-elite.test.ts`

**Interfaces:**
- Consumes: active squad center, tick 540 spawn stream order, friendly damage pipeline.
- Produces: `spawnElite`, `advanceElite`, `handleEliteDeath`, `resolveOutcome`, telegraph render effect/event history와 terminal outcome.

- [ ] **Step 1: spawn/telegraph/outcome RED tests 작성**

```ts
test('uses the exact warning and damage sequences through tick 880', () => {
  const game = createGameplaySimulation({ seed: 'elite-fixture', fixture: 'determinism' })
  game.enqueue({ applyTick: 0, sequence: 0, kind: 'start-battle' })
  let sequence = 1
  advanceToTick(game, 900, current => {
    const index = current.getState().upgrade.offered.indexOf('power') as 0 | 1 | 2
    current.enqueue({ applyTick: current.getState().combatTick, sequence: sequence++, kind: 'choose-upgrade', index })
  })
  expect(game.getState().elite.warningTicks).toEqual([570,610,650,690,730,770,810,850])
  expect(game.getState().elite.damageTicks).toEqual([600,640,680,720,760,800,840,880])
})

test('elite death cancels a live telegraph and wins before same-tick wipe', () => {
  const state = createStateFixture()
  state.combatTick = 600
  state.friendlies.forEach(unit => { unit.hp = 0; unit.life = 'downed' })
  state.elite.spawned = true
  state.elite.hp = 0
  state.elite.telegraphCenter = { x: 0, y: 0 }
  state.elite.telegraphRemaining = 10
  handleEliteDeath(state)
  resolveOutcome(state)
  expect(state).toMatchObject({ mode: 'won', failureReason: null })
  expect(state.elite).toMatchObject({ telegraphCenter: null, telegraphRemaining: 0, cycleIndex: 0 })
})
```

- [ ] **Step 2: elite tests RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-elite.test.ts`

Expected: FAIL with missing elite reducer and fixture behavior.

- [ ] **Step 3: elite movement와 fixed telegraph 구현**

tick 540에 active center 반경 5.0에서 spawn하고, `0.14`로 active center를 추적하되 overshoot를 clamp한다. tick 570부터 40 tick cycle의 30 tick warning, 1 tick damage, 9 tick recovery를 상태로 표현한다. warning 중심은 시작 순간 고정하고 반경 2.0 안의 모든 standing friendly에 0.35를 준다.

- [ ] **Step 4: death cleanup과 terminal ordering 구현**

정예 HP가 0이면 진행·향후 telegraph를 지우고 먼저 `won`; 다음으로 기립 0이면 `lost/all-units-lost`; `combatTick=900`이면 `lost/elite-survived`; terminal이면 upgrade entry를 건너뛴다. fixture는 단계 13 terminal만 억제하고 damage event와 나머지 상태 변화는 유지한다.

- [ ] **Step 5: formation-wide evasion matrices GREEN 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-elite.test.ts tests/core/gameplay-progression.test.ts`

Expected: base/march × healthy/exhausted × long/short axis의 전원 포함 결과, 범위 밖 no-event, death cancellation과 outcome precedence PASS.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/core/gameplay prototype/tests/core/gameplay-elite.test.ts docs/codex-usage-log.md
git commit -m "feat: add elite telegraph battle outcome"
```

### Task 8: 결정론 checkpoint와 8-seed 에이전시 정책

**Files:**
- Create: `prototype/src/scenarios/gameplay-policies.ts`
- Create: `prototype/tests/core/gameplay-policies.test.ts`
- Modify: `prototype/src/core/gameplay/simulation.ts`
- Modify: `prototype/src/core/gameplay/constants.ts` only if an approved tuning lever is required
- Modify: `docs/superpowers/specs/2026-08-14-squad-survivor-gameplay-design.md` only when a tuning value changes

**Interfaces:**
- Consumes: only public `GameplaySimulation.enqueue/getState/step/getDigest`.
- Produces: `runDeterminismFixture(seed): { checkpoints: readonly { tick: number; digest: string }[] }`, `runGameplayPolicy(seed, policy): PolicyRun`, checkpoint records and measured policy summary.

```ts
export type GameplayPolicy = 'tactical-no-input' | 'movement-only' | 'skilled'
export type PolicyRun = {
  readonly seed: string
  readonly policy: GameplayPolicy
  readonly mode: 'won' | 'lost'
  readonly failureReason: FailureReason
  readonly terminalTick: number
  readonly checkpoints: readonly { tick: number; digest: string }[]
  readonly firstAttackTick: number | null
  readonly firstDownedTick: number | null
  readonly upgradeTick: number | null
}
```

- [ ] **Step 1: fixture/checkpoint/policy RED tests 작성**

```ts
const seeds = ['11','29','47','71','101','131','173','211']

test('repeats every authoritative fixture checkpoint', () => {
  const first = runDeterminismFixture('47')
  const second = runDeterminismFixture('47')
  expect(first.checkpoints.map(point => point.tick)).toEqual([0,150,300,360,540,660,780,900])
  expect(second).toEqual(first)
})

test('meets the three agency result bands without seed branches', () => {
  const noInput = seeds.map(seed => runGameplayPolicy(seed, 'tactical-no-input'))
  const movement = seeds.map(seed => runGameplayPolicy(seed, 'movement-only'))
  const skilled = seeds.map(seed => runGameplayPolicy(seed, 'skilled'))
  expect(noInput.filter(run => run.mode === 'won')).toHaveLength(0)
  expect(movement.filter(run => run.mode === 'won').length).toBeLessThanOrEqual(2)
  expect(skilled.filter(run => run.mode === 'won').length).toBeGreaterThanOrEqual(6)
})
```

- [ ] **Step 2: policy tests RED 확인**

Run: `cd prototype && npm test -- tests/core/gameplay-policies.test.ts`

Expected: FAIL until policies and full simulation behavior exist.

- [ ] **Step 3: public-command-only policies 구현**

전술 무입력은 upgrade에서만 `power`; 이동 전용은 최근접 적 반대 방향 이동+`power`; 숙련은 피로 0.55 switch, 안전거리 3.0 rescue, elite circle 반대 이동+`power` event만 enqueue한다. seed별 분기와 직접 state mutation을 금지한다.

- [ ] **Step 4: 두 번 실행한 실제 policy digest 비교 구현**

각 seed/policy를 두 번 실행해 terminal tick/reason, terminal 이하 공통 checkpoint와 final digest가 같은지 먼저 검증한다. 종료 뒤 checkpoint는 생성하지 않는다. fixture는 기립 0 이후에도 enemy 정지, PRNG, timers와 telegraph를 tick 900까지 검사한다.

- [ ] **Step 5: agency와 tutorial timing GREEN 또는 제한된 tuning 수행**

Run: `cd prototype && npm test -- tests/core/gameplay-policies.test.ts`

Expected: `0/8`, `≤2/8`, `≥6/8`; seed 47 first attack `≤90`, first downed `350..600`, upgrade `200..450`. 실패하면 측정 결과와 원인 가설을 task report에 먼저 기록하고, Global Constraints의 네 tuning 범위 중 원인에 직접 대응하는 값 하나만 바꾼다. 변경 전후 8-seed 표, spawn/backlog/TTK 파생 산술, 전체 core 결과를 같은 report에 남기고 task reviewer가 acceptance 기준을 완화하지 않았음을 승인해야만 commit한다. 결과 비율·seed 목록·timing gate 자체는 수정하지 않는다.

- [ ] **Step 6: 전체 core GREEN 확인**

Run: `cd prototype && npm test -- tests/core`

Expected: gameplay와 legacy renderer core tests 모두 PASS.

- [ ] **Step 7: task commit**

```bash
git add prototype/src/scenarios/gameplay-policies.ts prototype/tests/core docs/superpowers/specs/2026-08-14-squad-survivor-gameplay-design.md prototype/src/core/gameplay docs/codex-usage-log.md
git commit -m "test: prove gameplay agency across seeds"
```

### Task 9: Gameplay controller와 실제 DOM 입력

**Files:**
- Create: `prototype/src/app/gameplay-controller.ts`
- Create: `prototype/src/app/gameplay-input.ts`
- Test: `prototype/tests/gameplay-controller.test.ts`
- Modify: `prototype/src/renderers/registry.ts`

**Interfaces:**
- Consumes: `createGameplaySimulation`, literal hybrid loader, existing `GameRenderer` lifecycle.
- Produces: `createGameplayInputAdapter(options): GameplayInputAdapter`, `createGameplayController(options): GameplayController`, state subscription and renderer snapshot loop.

- [ ] **Step 1: keyboard/pointer/pause/hidden RED tests 작성**

```ts
test('keeps Space held until keyup and never queues it while paused', async () => {
  const emitted: GameInputEvent[] = []
  let mode: BattleMode = 'running'
  const adapter = createGameplayInputAdapter({
    getTick: () => 12,
    getMode: () => mode,
    emit: event => emitted.push(event),
  })
  adapter.attach()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
  expect(emitted.at(-1)).toMatchObject({ kind: 'set-rescue', held: true })
  const beforePause = emitted.length
  mode = 'paused'
  adapter.clearPersistent()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }))
  expect(emitted).toHaveLength(beforePause)
  expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
})

test('uses keyboard axes over drag and clears drag on pointer end', async () => {
  const adapter = createGameplayInputAdapter({
    getTick: () => 12,
    getMode: () => 'running',
    emit: () => undefined,
  })
  adapter.attach()
  adapter.pointerDown({ x: -1, y: 0 })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }))
  expect(adapter.currentMovement()).toEqual({ x: 1, y: 0 })
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))
  adapter.pointerEnd()
  expect(adapter.currentMovement()).toEqual({ x: 0, y: 0 })
})
```

- [ ] **Step 2: controller tests RED 확인**

Run: `cd prototype && npm test -- tests/gameplay-controller.test.ts`

Expected: FAIL with missing gameplay controller.

- [ ] **Step 3: controller port와 30Hz loop 구현**

```ts
export interface GameplayInputAdapter {
  attach(): void
  clearPersistent(): void
  pointerDown(target: Vec2): void
  pointerMove(target: Vec2): void
  pointerEnd(): void
  currentMovement(): Vec2
  dispose(): void
}

export interface GameplayController {
  start(): Promise<void>
  beginBattle(): void
  subscribe(listener: (state: Readonly<GameState>) => void): () => void
  chooseUpgrade(index: 0 | 1 | 2): void
  togglePause(): void
  pointerDown(target: Vec2): void
  pointerMove(target: Vec2): void
  pointerEnd(): void
  restart(): void
  getState(): Readonly<GameState>
  dispose(): void
}
```

literal `import('../renderers/three-hybrid')`만 기본 loader로 사용한다. 기존 fixed-step 5 tick cap, stale async mount ownership, resize/render exception boundary와 idempotent dispose 패턴을 보존한다.

- [ ] **Step 4: DOM input state gate 구현**

WASD/arrow, Space hold, Q/Tab first keydown, 1/2/3, Escape와 pointer drag를 exact event로 변환한다. `event.repeat`, cooldown, mode별 금지 입력은 queue에 넣지 않는다. blur·hidden·pause·upgrade·terminal 진입은 지속 입력을 즉시 해제하며 hidden 복귀는 paused다.

- [ ] **Step 5: controller lifecycle GREEN 확인**

Run: `cd prototype && npm test -- tests/gameplay-controller.test.ts tests/renderer-contract.test.ts && npm run build`

Expected: input semantics and renderer ownership tests PASS; Three hybrid remains a literal dynamic chunk.

- [ ] **Step 6: task commit**

```bash
git add prototype/src/app/gameplay-controller.ts prototype/src/app/gameplay-input.ts prototype/src/renderers/registry.ts prototype/tests/gameplay-controller.test.ts docs/codex-usage-log.md
git commit -m "feat: connect gameplay input controller"
```

### Task 10: 시작·HUD·강화·pause·결과 UI와 기본 route

**Files:**
- Create: `prototype/src/app/gameplay-shell.ts`
- Create: `prototype/tests/gameplay-shell.test.ts`
- Create: `prototype/tests/helpers/gameplay-controller-stub.ts`
- Modify: `prototype/src/main.ts`
- Modify: `prototype/src/app/styles.css`
- Modify: `prototype/index.html`
- Test: `prototype/tests/gameplay-shell.spec.ts`
- Modify: `prototype/tests/app-shell.spec.ts`

**Interfaces:**
- Consumes: `GameplayController` port and authority state subscription.
- Produces: `mountApp(root, { createController? })`, accessible default gameplay UI; `?lab=renderers` lazy legacy route; unit test용 `createGameplayControllerStub()`.

- [ ] **Step 1: 실행 가능한 controller stub과 first-screen unit RED test 작성**

```ts
export function createGameplayControllerStub(): GameplayController & { publish(state: GameState): void } {
  let state = createInitialGameState('47')
  let listener: ((value: Readonly<GameState>) => void) | null = null
  return {
    start: async () => undefined,
    beginBattle: () => undefined,
    subscribe: next => { listener = next; next(state); return () => { listener = null } },
    chooseUpgrade: () => undefined,
    togglePause: () => undefined,
    pointerDown: () => undefined,
    pointerMove: () => undefined,
    pointerEnd: () => undefined,
    restart: () => { state = createInitialGameState('47'); listener?.(state) },
    getState: () => state,
    dispose: () => undefined,
    publish: next => { state = structuredClone(next); listener?.(state) },
  }
}

test('shows the complete objective and controls before start', () => {
  mountApp(root, { createController: () => createGameplayControllerStub() })
  expect(root.textContent).toContain('30초 안에 정예 지휘관을 쓰러뜨리십시오.')
  expect(root.textContent).toContain('WASD / 방향키 / 포인터 드래그')
  expect(root.textContent).toContain('Q 또는 Tab')
  expect(root.textContent).toContain('쓰러진 병사 곁에서 Space 유지')
})
```

- [ ] **Step 2: shell unit RED 확인**

Run: `cd prototype && npm test -- tests/gameplay-shell.test.ts`

Expected: FAIL because `gameplay-shell.ts` and its dependency port do not exist.

- [ ] **Step 3: default-route Playwright RED test 작성**

```ts
test('does not expose renderer or performance controls on the default route', async ({ page }) => {
  await page.goto('')
  await expect(page.getByText('Phaser 2D')).toHaveCount(0)
  await expect(page.getByText(/FPS|드로우콜|JSON 내보내기/)).toHaveCount(0)
})
```

- [ ] **Step 4: default-route browser RED 확인**

Run: `cd prototype && npm run test:e2e -- tests/gameplay-shell.spec.ts --workers=1`

Expected: FAIL because default route still mounts renderer selection.

- [ ] **Step 5: state-driven UI 구현**

ready 화면에 목표·조작·분대 역할과 시작 button을 viewport 안에 둔다. running HUD는 남은 시간, active squad, 양 분대 standing/fatigue, switch cooldown, XP, rescue target/progress, elite HP를 authority state에서 그린다. active squad standing이 0이면 정확히 `Q로 분대를 전환하세요`를 표시한다. `awaiting-upgrade`는 3 cards+1/2/3, paused는 opaque overlay, terminal은 정확한 원인·kills·rescues·survivors·choice·restart를 표시한다.

- [ ] **Step 6: default/lab dynamic route 구현**

```ts
const module = new URLSearchParams(location.search).get('lab') === 'renderers'
  ? await import('./app/app-shell')
  : await import('./app/gameplay-shell')
module.mountApp(root)
```

실제 export 이름이 충돌하지 않도록 gameplay도 `mountApp`을 export한다. `index.html` title/description을 30초 분대 생존 게임으로 바꾼다. legacy E2E는 `?lab=renderers`로 이동시킨다.

- [ ] **Step 7: shell unit/E2E와 production route GREEN 확인**

Run: `cd prototype && npm test -- tests/gameplay-shell.test.ts tests/app-shell.test.ts && npm run test:e2e -- tests/gameplay-shell.spec.ts tests/app-shell.spec.ts --workers=1 && npm run build`

Expected: default gameplay and isolated lab tests PASS; default entry chunk does not statically import Phaser/3D/lab shell.

- [ ] **Step 8: task commit**

```bash
git add prototype/src/main.ts prototype/src/app/gameplay-shell.ts prototype/src/app/styles.css prototype/index.html prototype/tests/gameplay-shell.test.ts prototype/tests/helpers/gameplay-controller-stub.ts prototype/tests/gameplay-shell.spec.ts prototype/tests/app-shell.spec.ts docs/codex-usage-log.md
git commit -m "feat: make squad survivor the default game"
```

### Task 11: Three.js 2.5D gameplay 표현과 실제 브라우저 완주

**Files:**
- Modify: `prototype/src/renderers/three-hybrid/hybrid-renderer.ts`
- Modify: `prototype/src/renderers/three-hybrid/index.ts`
- Modify: `prototype/src/renderers/contract.ts` only if Task 2's compatible type extension requires it
- Modify: `prototype/src/vite-env.d.ts`
- Test: `prototype/tests/gameplay-hybrid-renderer.spec.ts`
- Test: `prototype/tests/gameplay-play.spec.ts`
- Modify: `docs/assets-license.md`
- Modify: `docs/codex-usage-log.md`
- Create: `docs/reviews/2026-08-15-squad-survivor-playtest.md`

**Interfaces:**
- Consumes: gameplay `RenderSnapshot`, shell/controller public UI and seed 47 policy expectations.
- Produces: actual visual states, end-to-end keyboard/pointer/rescue/upgrade/outcome/restart evidence and human playtest sheet.

- [ ] **Step 1: renderer visual-state RED browser test 작성**

```ts
test('renders elite telegraph and downed/rescue states from a gameplay snapshot', async ({ page }) => {
  await page.goto('?seed=47')
  await page.getByRole('button', { name: '전투 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toHaveCount(1)
  await expect(page.getByText('정예 출현')).toBeVisible({ timeout: 20_000 })
  const scene = await page.evaluate(() => window.__SQUADING_TEST__?.rendererScene())
  expect(scene?.eliteTelegraph).toMatchObject({ visible: true, radius: 2 })
  expect(scene?.downedCards).toBeGreaterThan(0)
})
```

`__SQUADING_TEST__`는 `import.meta.env.DEV`에서만 설치하고 실제 Three scene object의 geometry radius·visible flag·downed card transform을 읽는다. production build에는 bridge가 없어야 한다는 build/E2E assertion을 추가한다. 일반 play E2E는 이 bridge를 사용하지 않으며 authority event와 결과를 UI에서만 검증한다.

- [ ] **Step 2: actual play RED E2E 작성**

`gameplay-play.spec.ts`는 실제 `keyboard.down/up`, pointer `down/move/up`, Space 44/45 tick 경계, Q cooldown, 카드 click, seed 47 숙련 승리와 전술 무입력 패배, 결과 통계, restart tick 0 UI를 각각 정확한 기대값으로 단언한다. `/승리|패배/` 대안 정규식과 `advanceForDiagnostics()`를 사용하지 않는다.

- [ ] **Step 3: gameplay browser tests RED 확인**

Run: `cd prototype && npm run test:e2e -- tests/gameplay-hybrid-renderer.spec.ts tests/gameplay-play.spec.ts --workers=1`

Expected: FAIL because elite telegraph/new states and full UI flow are not yet rendered.

- [ ] **Step 4: Three gameplay visuals 구현**

기존 cardboard unit 구조를 유지하고 `elite`를 1.25 scale card로, downed를 눕힌 card/marker로, rescuer와 target을 `rescue-signal`로, active squad를 marker로, `elite-telegraph`를 고정 원 mesh로 표현한다. root는 tabletop normal을 유지하고 card만 billboard한다. authority 좌표·판정·PRNG를 renderer에서 변경하지 않는다.

- [ ] **Step 5: actual browser GREEN과 전체 자동 검증 실행**

Run:

```bash
cd prototype
npm test
npm run build
npm run test:e2e -- --workers=1
git diff --check
```

Expected: all Vitest and Playwright tests PASS; build has default gameplay entry plus lazy hybrid and isolated lab chunks; diff check clean.

- [ ] **Step 6: clean production preview smoke 실행**

Run:

```bash
cd prototype
npm run build
PLAYWRIGHT_SERVER_COMMAND='npm run preview:pages' \
PLAYWRIGHT_SERVER_URL='http://127.0.0.1:4173/squading/' \
PLAYWRIGHT_BASE_URL='http://127.0.0.1:4173/squading/' \
npm run test:e2e -- tests/gameplay-shell.spec.ts tests/gameplay-play.spec.ts --workers=1
```

Expected: project Pages base 경로의 clean production artifact에서 start-to-result와 restart PASS.

- [ ] **Step 7: 자동 검증과 수동 출시 gate를 분리해 기록**

`docs/reviews/2026-08-15-squad-survivor-playtest.md`에 자동 결과, seed별 policy 표, 알려진 위험, 그리고 사람 3명의 `교대/구조/회피 이유` 답변란을 기록한다. 사람 3명 증거가 없으면 자동 구현 완료와 별개로 수직 슬라이스 출시 gate를 `PENDING`으로 둔다. `docs/codex-usage-log.md`에는 task별 subagent/TDD/review/Advisor 실패·산출물·검증을 기록한다.

- [ ] **Step 8: task commit**

```bash
git add prototype/src/renderers/three-hybrid prototype/src/renderers/contract.ts prototype/src/vite-env.d.ts prototype/tests/gameplay-hybrid-renderer.spec.ts prototype/tests/gameplay-play.spec.ts docs/assets-license.md docs/codex-usage-log.md docs/reviews/2026-08-15-squad-survivor-playtest.md
git commit -m "feat: complete squad survivor vertical slice"
```

## 최종 리뷰 게이트

Task 11 뒤 fresh whole-branch reviewer가 다음을 한 번에 검토한다.

- 기본 route가 gameplay 외 renderer/benchmark module을 eagerly import하지 않는가.
- 명세의 모든 14단계 tick 순서와 same-tick 우선순위를 테스트가 실제로 고정하는가.
- 8-seed 정책이 public command만 사용하고 seed별 분기가 없는가.
- browser test가 실제 DOM 입력과 정확한 결과를 검증하며 diagnostics 자기검증이 아닌가.
- legacy lab, renderer lifecycle/disposal, production Pages base가 회귀하지 않았는가.
- 코드·문서에 승인 범위 밖 기능이나 사용되지 않는 추상화가 추가되지 않았는가.

Critical/Important finding은 같은 task의 최대 5회 fix/re-review loop로 해소한다. plan text와 finding이 충돌하면 구현하지 않고 사용자에게 어느 쪽이 우선인지 묻는다. Minor는 SDD ledger에 기록해 final reviewer가 병합 전 처리 여부를 판정한다.
