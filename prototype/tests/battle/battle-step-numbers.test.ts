// The enforcement behind one sentence in `src/core/battle/index.ts`:
//
//     "THE STEP NUMBERS LIVE HERE AND IN THE REDUCER, AND NOWHERE ELSE."
//
// That sentence was prose for three batches, and for three batches it was false. Measured with
// the regex below against commit 850c8f4, 31 comment lines under `src/core/battle/` named a
// step by number — `attacks.ts` 10, `movement.ts` 7, `targeting.ts` 6, `enemy.ts` 5,
// `rescue.ts` 2, `upgrades.ts` 1 (batch D's review found 26 of them, in five files) — plus 8
// more in the fixtures. The sentence's whole value is that the next §1.16 renumber costs ONE
// table edit, and prose cannot deliver that. This does.
//
// What counts as a step number here: the words `step`/`steps` followed by a digit, or Korean
// `N단계`. A bare `// 6` beside a call in a hand-rolled tick loop is NOT one — that IS a
// reducer, and §1.16's table explicitly allows the numbers there. The rule is about
// DOCUMENTATION that claims to know a step's position without owning it.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The one source file allowed to number the steps: it holds the table. */
const TABLE = join('src', 'core', 'battle', 'index.ts')

/**
 * And this file, which cannot state the rule without quoting what breaks it.
 *
 * Exactly two exemptions, both named: an exemption list that grows is how this guard would go
 * the way of the prose it replaces.
 */
const EXEMPT = [TABLE, join('tests', 'battle', 'battle-step-numbers.test.ts')]

// Batch F added `src/core/harness/policy` and `tests/harness`, and they are scanned for the
// same reason the two above are: a harness comment that names a position in §1.16's order is a
// second copy of the table, and the next renumber has to find it. The whole of
// `src/core/harness` is in scope rather than the policy directory alone — the archived stage-1
// sweep beside it names no step today, and there is no reason it should start.
//
// Campaign stage 1 added `src/core/campaign` and `tests/campaign`, and they are scanned for the
// same reason again: the campaign reads a FINISHED battle, so nothing in it has a position in
// §1.16's order to name, and the day one of its comments claims otherwise it is a second copy of
// the table living outside `core/battle` entirely.
const SCANNED_ROOTS = [
  'src/core/battle',
  'tests/battle',
  'src/core/harness',
  'tests/harness',
  'src/core/campaign',
  'tests/campaign',
]

const STEP_REFERENCE = /\b(?:steps?\s+\d+|\d+\s*단계)/gi

function sourceFiles(root: string): string[] {
  const absolute = join(process.cwd(), root)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    found.push(join(entry.parentPath, entry.name))
  }
  return found
}

/** Extracted so the test below can check the READER as well as the result. */
export function stepReferences(source: string): string[] {
  return [...source.matchAll(STEP_REFERENCE)].map((match) => match[0])
}

describe('§1.16 step numbers live in one table', () => {
  it('reads the forms the codebase actually used', () => {
    const sample = [
      '// the cooldown pass, at steps 6, 8 and 9:',
      ' * whole: both sides pick their target, at step 7.',
      '// Step 14 runs before the tick increment,',
      '// in "4단계" and called movement "5단계",',
      '// 6, 7',
      'const step = Math.min(distance, speed)',
      'export function stepMove(from: Vec2): Vec2 {',
    ].join('\n')

    // The first four lines are offenders; the last three must NOT be. `// 6, 7` is a reducer
    // annotation, and `step`/`stepMove` without a number is a displacement, not a tick phase.
    expect(stepReferences(sample)).toEqual(['steps 6', 'step 7', 'Step 14', '4단계', '5단계'])
  })

  it('finds no numbered step reference outside the two exempt files', () => {
    const offenders: string[] = []

    for (const root of SCANNED_ROOTS) {
      const files = sourceFiles(root)
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) {
        if (EXEMPT.some((exempt) => file.endsWith(exempt))) continue
        const source = readFileSync(file, 'utf8')
        for (const reference of stepReferences(source)) {
          offenders.push(`${file}: ${reference}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('still finds them in the table, so the reader is not simply blind', () => {
    // A guard that scans for nothing reports "no offenders" forever. The table numbers all 16
    // steps, so the reader has to see numbers there or it is not reading.
    const table = readFileSync(join(process.cwd(), TABLE), 'utf8')
    expect(stepReferences(table).length).toBeGreaterThan(0)
  })
})
