#!/usr/bin/env node
// A mutation harness for batch F's policy code, committed rather than described.
//
// Batch C's report claimed "mutation 20/20 caught" and left no script in the tree, so the claim
// could not be checked by anyone. This is the script. It edits one source file at a time,
// re-runs a fixed set of fixtures, and reports whether the fixtures noticed.
//
// WHAT IT PROVES AND WHAT IT DOES NOT. A caught mutation proves that at least one assertion
// depends on the line that was changed. It does not prove the assertion is the right one, and a
// MISSED mutation is not automatically a defect — some of the mutations below change a safety
// margin that nothing pins on purpose. Both outcomes are printed; the batch report is where a
// miss has to be argued for.
//
// ---------------------------------------------------------------------------
// WHERE THE LIST COMES FROM, AND WHY IT IS NOT READ OFF THE FIXTURES
// ---------------------------------------------------------------------------
// The first version of this table was assembled by reading the fixtures and asking what they
// would notice. The number that comes out of that is a tautology — it measures the tests against
// themselves — and the review of batch F demonstrated it rather than asserting it: it picked five
// mutations of its own and ALL FIVE passed the whole 569-test suite, three of them deleting the
// `commitTicks` mechanism the spec patch `ba2fa70` had just introduced.
//
// So this table is chosen from the RULES, with the fixtures unread. The two sources are:
//
//   * §4.1's table in `docs/superpowers/specs/2026-08-16-commander-battle-design.md` — the six
//     policies and the ONE difference each names against `skilled`.
//   * §3's two `skilled` player models, and in particular the amended second one: "둘째 변형을
//     v9가 실제로 가르는 축 — 어디에 멈출지(§1.6의 사거리 격차 안 어디)와 얼마나 자주 다시
//     고를지 — 으로 재정의한다."
//
// The mechanical rule those two produce: `PolicyRules` in `policies.ts` is the record of decision
// points that §4.1's "한 가지만 바꾼 변형" is built out of, so EVERY ONE OF ITS FIVE KEYS CARRIES
// AT LEAST ONE MUTATION — `intent`, `allowsMove`, `standoff`, `rescues`, `commitTicks`. The
// `policies.ts` section below is grouped by those five keys and every group names the rule it was
// derived from. A key with no mutation under it is a hole in THIS FILE, not a property of the
// code; that is exactly what `commitTicks` was before this round.
//
// `view.ts` and `run.ts` are not decision points. Their mutations come from the two lists in
// `view.ts`'s own header ("what is on the screen" against "what is not") and from the band
// arithmetic §4.1 counts policies by.
//
// Usage, from `prototype/`:  node scripts/mutate.mjs [--filter <substring>]
//
// It restores every file it touches, including on Ctrl-C. If it ever exits with a file still
// mutated, `git diff` says so immediately — which is the reason it edits the real tree instead
// of a copy: a copy would not run against the real test paths.

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/**
 * The fixtures a mutation is measured against.
 *
 * Not the whole suite: this batch's code is only reachable from these files, and running the
 * other 500 tests for each of the mutations below buys nothing but minutes. The two guards are
 * here because batch F widened both of them to cover the harness.
 */
const TARGET_TESTS = [
  'tests/harness',
  'tests/battle/battle-no-cover.test.ts',
  'tests/battle/battle-step-numbers.test.ts',
]

const VIEW = 'src/core/harness/policy/view.ts'
const POLICIES = 'src/core/harness/policy/policies.ts'
const RUN = 'src/core/harness/policy/run.ts'

/**
 * The mutation table. Hardcoded on purpose — a generated mutation set is a different tool, and
 * this one exists so a reader can see exactly which claims were tested.
 *
 * `find` must occur EXACTLY ONCE in the file. A zero or ambiguous anchor is reported as such
 * rather than silently skipped: an anchor that stopped matching after a refactor would otherwise
 * turn into a mutation that quietly stopped being run.
 */
const MUTATIONS = [
  // --- view.ts: the projection's two lists -------------------------------------------------
  {
    file: VIEW,
    label: 'show dead enemies too',
    find: "    if (enemy.life !== 'standing') continue",
    replace: '    if (false) continue',
  },
  {
    file: VIEW,
    label: 'downed countdown counts up',
    find: "unit.life === 'downed' ? DOWNED_TICKS - unit.downedTicks : 0",
    replace: "unit.life === 'downed' ? unit.downedTicks : 0",
  },
  {
    file: VIEW,
    label: 'hand out the position by reference',
    find: '  return { x: position.x, y: position.y }',
    replace: '  return position',
  },
  {
    file: VIEW,
    label: 'draw the telegraph during the cooldown instead',
    find: "    state.elite.attackPhase === 'telegraph' && telegraphCenter !== null",
    replace: "    state.elite.attackPhase === 'cooldown' && telegraphCenter !== null",
  },
  {
    file: VIEW,
    label: 'leak the enemy cooldown into the view',
    find: '    enemies.push({ id: enemy.id, kind: enemy.kind, position: copyPosition(enemy.position) })',
    replace:
      '    enemies.push({ id: enemy.id, kind: enemy.kind, position: copyPosition(enemy.position), attackCooldown: enemy.attackCooldown })',
  },
  {
    file: VIEW,
    label: 'forget the slot assignment',
    find: '    if (assignment.unitId === unitId) return assignment.slotIndex',
    replace: '    if (assignment.unitId === unitId) return null',
  },

  // --- policies.ts / `PolicyRules.standoff` --------------------------------------------------
  // §4.1: `ignores-range` is "정지 위치를 고를 때 사거리 우위를 참조하지 않음 — 적에게 붙어서
  // 멈춘다. 그 외 동일", so WHERE the policy stops is a decision the table names in its own row,
  // and §1.6's gap is what it stops against.
  {
    file: POLICIES,
    label: 'flip the sign of the standoff fraction',
    find: 'const SKILLED_STANDOFF_FRACTION = 0.4',
    replace: 'const SKILLED_STANDOFF_FRACTION = -0.4',
  },
  {
    file: POLICIES,
    label: 'walk toward the shooter when too close instead of away',
    find: "  if (distance < goal.band[0]) return { kind: 'move', direction: negate(toGoal), reason: 'standoff' }",
    replace: "  if (distance < goal.band[0]) return { kind: 'move', direction: toGoal, reason: 'standoff' }",
  },
  {
    file: POLICIES,
    label: 'relax the standoff lower bound to the upper one',
    find: '  if (distance < goal.band[0]) return',
    replace: '  if (distance < goal.band[1]) return',
  },

  // --- policies.ts / `PolicyRules.rescues` ----------------------------------------------------
  // §4.1: `abandons-downed` is "`set-rescue`를 절대 보내지 않음", and I13 counts the survivor
  // difference that switch is supposed to produce.
  {
    file: POLICIES,
    label: 'never rescue (early return)',
    find: 'function rescueIntent(view: PolicyView, command: FriendlyView): Intent | null {',
    replace:
      'function rescueIntent(view: PolicyView, command: FriendlyView): Intent | null {\n  if (view !== null) return null',
  },
  {
    file: POLICIES,
    label: 'ignore the `rescues` switch',
    find: '  if (rules.rescues) {',
    replace: '  if (true) {',
  },

  // --- policies.ts / `PolicyRules.allowsMove` ------------------------------------------------
  // §4.1: `camps-in-place` is "한 자리에 멈춰 정예 회피 외에는 움직이지 않음" — one filter on
  // which reasons are worth a step, and I10 is the band it is measured by.
  {
    file: POLICIES,
    label: 'ignore the `allowsMove` filter',
    find: "  if (intent.kind === 'move' && rules.allowsMove(intent.reason)) {",
    replace: "  if (intent.kind === 'move') {",
  },

  // --- policies.ts / `PolicyRules.intent` ----------------------------------------------------
  // §4.1's two whole-decision rows: `tactical-no-input` ("강화 선택 외 입력 없음") and
  // `flees-always` ("가장 가까운 적에서 계속 멀어지기만 함. 구조·정예 대응 없음"). §1.12's
  // telegraph, §1.11's countdown, §1.8's nearest-and-ties and §1.15's pointer vocabulary are the
  // rules `skilled`'s own intent is assembled out of.
  {
    file: POLICIES,
    label: 'never report a keydown',
    find: '    const keydown = !sameVector(move, ZERO) && sameVector(memory.sentMove, ZERO)',
    replace: '    const keydown = false',
  },
  {
    file: POLICIES,
    label: 'break the nearest tie toward the higher id',
    find: '    if (distance < bestDistance) {',
    replace: '    if (distance <= bestDistance) {',
  },
  {
    file: POLICIES,
    label: 'take the second card instead of the first',
    find: 'const FIRST_OFFERED_SLOT = 1',
    replace: 'const FIRST_OFFERED_SLOT = 2',
  },
  {
    file: POLICIES,
    label: 'flee toward the enemy',
    find: '  const away = offset(nearest.position, command.position)',
    replace: '  const away = offset(command.position, nearest.position)',
  },
  {
    file: POLICIES,
    label: 'drop the short-offset clamp',
    find: '    move = magnitude(intent.direction) < ARRIVE_EPSILON ? ZERO : intent.direction',
    replace: '    move = magnitude(intent.direction) < 0 ? ZERO : intent.direction',
  },
  {
    file: POLICIES,
    label: 'flip the sign of the elite dodge margin',
    find: 'const ELITE_DODGE_MARGIN_FRACTION = 0.3125',
    replace: 'const ELITE_DODGE_MARGIN_FRACTION = -0.3125',
  },
  {
    file: POLICIES,
    label: 'forget that succession zeroes the held vector',
    find: '  if (commandUnitId !== memory.commandUnitId) {',
    replace: '  if (false) {',
  },
  {
    // Review M3. §1.11 runs a countdown per body, so WHICH body the approach walks to is the
    // difference between one rescue and none — and it is the only choice `skilled` makes on the
    // rescue side. This takes the first reachable row in id order instead of the nearest.
    file: POLICIES,
    label: 'go for the first reachable body in id order, not the nearest',
    find: '    if (distance >= bestDistance) continue',
    replace: '    if (best !== null) continue',
  },
  {
    // Review M5. §1.11: "취소 시 진행도는 0으로 되돌린다", and the candidate test is re-run every
    // tick, so a lock can outlive the candidacy that started it. Dropping this branch releases
    // `Space` mid-lock and throws the progress away.
    file: POLICIES,
    label: 'release a lock the moment the body stops being a candidate',
    find: '  if (view.rescue !== null) return { kind: \'rescue\' }',
    replace: '  if (false) return { kind: \'rescue\' }',
  },
  {
    file: POLICIES,
    label: 'revive cover with an import of the archived geometry',
    find: "import type { BattleCommand } from '../../battle/input'",
    replace:
      "import type { BattleCommand } from '../../battle/input'\nimport '../../gameplay/geometry'",
  },

  // --- policies.ts / `PolicyRules.commitTicks` -----------------------------------------------
  // §3's amended second variant is defined ON THIS AXIS: "얼마나 자주 다시 고를지". A policy that
  // re-aims every tick at whichever body is nearest this frame is not a player, and two models
  // that re-aim on the same clock are not the two models §3 asks for. All three mutations here
  // are review findings (M1, M2, M4) and all three passed 569/569 before this round.
  {
    file: POLICIES,
    label: 'zero the commitment, so the heading is re-aimed every tick',
    find: 'const SKILLED_COMMIT_TICKS = 12',
    replace: 'const SKILLED_COMMIT_TICKS = 0',
  },
  {
    file: POLICIES,
    label: 'delete the commitment block entirely',
    find: "  if (intent.kind === 'move' && intent.reason === 'standoff') {",
    replace: '  if (false) {',
  },
  {
    file: POLICIES,
    label: "flatten both player models onto `skilled`'s re-aim clock",
    find:
      "  'skilled-conservative': { standoff: conservativeStandoff, commitTicks: 30 },\n" +
      "  'skilled-aggressive': { standoff: aggressiveStandoff, commitTicks: 4 },",
    replace:
      "  'skilled-conservative': { standoff: conservativeStandoff, commitTicks: 12 },\n" +
      "  'skilled-aggressive': { standoff: aggressiveStandoff, commitTicks: 12 },",
  },

  // --- run.ts: the aggregation ---------------------------------------------------------------
  {
    file: RUN,
    label: 'count the bodies that are NOT standing',
    find: "    if (unit.life === 'standing') standing += 1",
    replace: "    if (unit.life !== 'standing') standing += 1",
  },
  {
    file: RUN,
    label: 'invert the verdict',
    find: "    outcome: state.mode === 'won' ? 'won' : 'lost',",
    replace: "    outcome: state.mode === 'won' ? 'lost' : 'won',",
  },
  {
    file: RUN,
    label: 'count no wins',
    find: "    wins: results.filter((result) => result.outcome === 'won').length,",
    replace: '    wins: 0,',
  },
  {
    file: RUN,
    label: 'never start the battle',
    find: '  battle.start()',
    replace: '  // battle.start()',
  },
]

function occurrences(source, needle) {
  let count = 0
  let index = source.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = source.indexOf(needle, index + needle.length)
  }
  return count
}

function testsPass() {
  const result = spawnSync('npx', ['vitest', 'run', ...TARGET_TESTS], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return result.status === 0
}

const filterIndex = process.argv.indexOf('--filter')
const filter = filterIndex === -1 ? null : process.argv[filterIndex + 1]
const selected = filter ? MUTATIONS.filter((mutation) => mutation.label.includes(filter)) : MUTATIONS

/** Whatever is mutated right now, so a signal can put it back. */
let inFlight = null

function restore() {
  if (inFlight === null) return
  writeFileSync(inFlight.file, inFlight.original)
  inFlight = null
}

process.on('SIGINT', () => {
  restore()
  process.exit(130)
})

console.log(`[mutate] baseline: ${TARGET_TESTS.join(' ')}`)
if (!testsPass()) {
  console.error('[mutate] the fixtures do not pass BEFORE any mutation; nothing measured')
  process.exit(1)
}
console.log('[mutate] baseline green\n')

const rows = []

for (const mutation of selected) {
  const original = readFileSync(mutation.file, 'utf8')
  const found = occurrences(original, mutation.find)

  if (found !== 1) {
    rows.push({ ...mutation, verdict: found === 0 ? 'NO ANCHOR' : 'AMBIGUOUS' })
    console.log(`  ${found === 0 ? 'NO ANCHOR' : 'AMBIGUOUS'}  ${mutation.file}  ${mutation.label}`)
    continue
  }

  inFlight = { file: mutation.file, original }
  writeFileSync(mutation.file, original.replace(mutation.find, mutation.replace))

  let caught
  try {
    caught = !testsPass()
  } finally {
    restore()
  }

  rows.push({ ...mutation, verdict: caught ? 'caught' : 'MISSED' })
  console.log(`  ${caught ? 'caught  ' : 'MISSED  '}  ${mutation.file}  ${mutation.label}`)
}

const caught = rows.filter((row) => row.verdict === 'caught').length
const missed = rows.filter((row) => row.verdict === 'MISSED')
const broken = rows.filter((row) => row.verdict === 'NO ANCHOR' || row.verdict === 'AMBIGUOUS')

console.log(`\n[mutate] ${caught}/${rows.length} caught`)
for (const row of missed) console.log(`[mutate] MISSED    ${row.file}: ${row.label}`)
for (const row of broken) console.log(`[mutate] ${row.verdict} ${row.file}: ${row.label}`)

process.exit(missed.length + broken.length > 0 ? 1 : 0)
