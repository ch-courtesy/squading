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

  // --- policies.ts: the decisions ------------------------------------------------------------
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
  {
    file: POLICIES,
    label: 'ignore the `allowsMove` filter',
    find: "  if (intent.kind === 'move' && rules.allowsMove(intent.reason)) {",
    replace: "  if (intent.kind === 'move') {",
  },
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
    find: 'const ELITE_DODGE_MARGIN = 0.75',
    replace: 'const ELITE_DODGE_MARGIN = -0.75',
  },
  {
    file: POLICIES,
    label: 'forget that succession zeroes the held vector',
    find: '  if (commandUnitId !== memory.commandUnitId) {',
    replace: '  if (false) {',
  },
  {
    file: POLICIES,
    label: 'revive cover with an import of the archived geometry',
    find: "import type { BattleCommand } from '../../battle/input'",
    replace:
      "import type { BattleCommand } from '../../battle/input'\nimport '../../gameplay/geometry'",
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
