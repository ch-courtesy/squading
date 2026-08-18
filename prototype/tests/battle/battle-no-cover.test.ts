import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FORMATION_SLOTS as BATTLE_FORMATION_SLOTS } from '../../src/core/battle/formation'
import { FORMATION_SLOTS as ARCHIVED_FORMATION_SLOTS } from '../../src/core/gameplay/formation'

// §1.6 removed cover entirely. The terrain generator, the geometry primitives and the
// stage-1 I9 harness stay in the repository as the evidence for why — five review rounds
// and a 504-cell sweep that found no feasible point — but the game must never import
// them again. Without this guard, reviving cover is a one-line import that no other test
// would notice.
const ARCHIVED = [
  'core/gameplay/geometry',
  'core/gameplay/terrain',
  'core/harness/i9',
  'core/harness/sight',
]

// Scoped to the v2 battle core. `src/app` and `src/renderers` still belong to the
// shipped v1 game, which legitimately imports `core/gameplay/*`; batch G must add the new
// v2 shell and controller paths here when it wires them.
//
// BEFORE ADDING A PATH, read `moduleSpecifiers` below. The first version of this guard used
// `/^\s*(?:import|export)[^\n]*?from\s+'([^']+)'/gm`, and `[^\n]*?` cannot cross a newline —
// so it never saw a MULTI-LINE import, which is the style this codebase actually uses. It read
// 57 of the 62 specifiers under `src/core/battle`, and two of the five it missed were added by
// batch C. Reviving cover in the house style would have passed the one test that exists to
// prevent it. Widening the scope while the reader is blind widens the blind spot.
//
// `src/core/harness/policy` is here for batch F: the policies drive the v2 game and a cover
// import there would revive it just as effectively as one in the core. The root is the POLICY
// directory and not `src/core/harness`, because the archived stage-1 sweep (`harness/i9.ts`,
// `harness/sight.ts`) lives one level up and legitimately imports the geometry it was the
// evidence about — pointing the guard at the parent would fail on the archive itself.
const GAME_PATH_ROOTS = ['src/core/battle', 'src/core/harness/policy']

function sourceFiles(root: string): string[] {
  const absolute = join(process.cwd(), root)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    found.push(join(entry.parentPath, entry.name))
  }
  return found
}

/**
 * Every module specifier in a source file: `from '...'` and bare `import '...'`, no line anchor,
 * no single-line constraint.
 *
 * THE SIDE-EFFECT FORM IS HERE BECAUSE IT WAS MISSING. Batch F's mutation harness
 * (`scripts/mutate.mjs`) inserted `import '../../gameplay/geometry'` into a policy file and this
 * guard passed: a bare `import '...'` has no `from`, so the reader walked straight past the one
 * line it exists to fail on. It imports for side effects only, which is not how anybody revives
 * cover on purpose — and that is exactly why nothing else would have noticed.
 *
 * Matching bare `from '...'` also matches the phrase inside a comment or a string. That is
 * deliberate — the only false positive it can produce is text that names an archived module
 * the way an import does, and making that fail is exactly the point. Comments in this project
 * reference the archive by prose path (`gameplay/terrain.ts`), never as `from '...'`.
 *
 * Extracted as a named function so the test below can check the READER, not just the result:
 * a guard whose extraction is silently incomplete reports "no offenders" forever.
 */
export function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1])
}

function namesArchivedModule(specifier: string): boolean {
  return ARCHIVED.some((archived) => specifier.includes(archived.split('/').pop()!))
}

describe('§1.6 cover stays removed', () => {
  it('reads multi-line imports and side-effect imports, the two forms it has gone blind to', () => {
    const multiLine = [
      'import {',
      '  ARENA_WIDTH,',
      '  isInsideBlocker,',
      "} from '../gameplay/terrain'",
      '',
      "import './side-effect'",
      "import { clampToArena } from './movement'",
      'export {',
      '  segmentHitsRect,',
      "} from '../gameplay/geometry'",
    ].join('\n')

    expect(moduleSpecifiers(multiLine)).toEqual([
      '../gameplay/terrain',
      './side-effect',
      './movement',
      '../gameplay/geometry',
    ])
    expect(moduleSpecifiers(multiLine).filter(namesArchivedModule)).toEqual([
      '../gameplay/terrain',
      '../gameplay/geometry',
    ])
  })

  it('sees strictly more of the real tree than the line-anchored reader did', () => {
    // The regression test for the defect itself, measured against the actual battle core rather
    // than a fixture: this codebase writes multi-line imports, so a line-anchored reader finds
    // strictly fewer specifiers here than a newline-agnostic one. If `moduleSpecifiers` is ever
    // reverted to the anchored form, the two counts become equal and this fails.
    let total = 0
    let lineAnchored = 0

    for (const root of GAME_PATH_ROOTS) {
      const files = sourceFiles(root)
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        total += moduleSpecifiers(source).length
        lineAnchored += [
          ...source.matchAll(/^\s*(?:import|export)[^\n]*?from\s+'([^']+)'/gm),
        ].length
      }
    }

    expect(lineAnchored).toBeGreaterThan(0)
    expect(total).toBeGreaterThan(lineAnchored)
  })

  it('keeps the archived cover modules out of every game-path import', () => {
    const offenders: string[] = []

    for (const root of GAME_PATH_ROOTS) {
      for (const file of sourceFiles(root)) {
        for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
          if (namesArchivedModule(specifier)) offenders.push(`${file} -> ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps the copied slot table equal to the archived one', () => {
    // `core/battle/formation.ts` copies §1.4's 15 offsets instead of importing them, because
    // the archived module pulls slots out of terrain using `gameplay/geometry.ts` and importing
    // it would drag both archived modules back into the live game. The copy is the price of the
    // boundary; this is the pin that stops the two drifting apart, and `formation.ts`'s header
    // points at it by name.
    expect(BATTLE_FORMATION_SLOTS).toEqual(ARCHIVED_FORMATION_SLOTS)
  })

  it('leaves no terrain in the authoritative state or its streams', () => {
    const types = readFileSync(join(process.cwd(), 'src/core/battle/types.ts'), 'utf8')
    expect(types).not.toMatch(/^\s*(?:readonly\s+)?terrain\s*[?:]/m)
    expect(types).not.toMatch(/LOW_COVER/)
  })
})
