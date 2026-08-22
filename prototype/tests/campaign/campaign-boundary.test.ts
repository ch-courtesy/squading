// The enforcement behind one sentence in `src/core/campaign/index.ts`:
//
//     "The dependency runs ONE WAY: this directory reads `core/battle/`, and nothing under
//      `core/battle/` may import anything from here."
//
// The sentence is what keeps "전투는 여전히 90초 한 판만 안다" (§3.2) true. A battle that could
// reach the campaign would start answering questions §1 never gives it — how many stages there
// are, which one is next, what the last one cost — and every one of those answers would end up
// inside the object §1.17's digest walks.
//
// It is checked rather than asserted because the same claim was prose for three batches in
// `core/battle/index.ts` and was false the whole time (see `battle-step-numbers.test.ts`).

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The directories that must not know a campaign exists. */
const BATTLE_ROOTS = ['src/core/battle', 'src/core/battle-view']

/** Every import specifier in a file, in the two spellings this project writes. */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g

function sourceFiles(root: string): string[] {
  const absolute = join(process.cwd(), root)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    found.push(join(entry.parentPath, entry.name))
  }
  return found
}

function specifiersOf(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((match) => match[1])
}

describe('§3.2 the campaign reads the battle, and never the other way round', () => {
  it('finds no import of `core/campaign` anywhere under the battle', () => {
    const offenders: string[] = []
    let read = 0

    for (const root of BATTLE_ROOTS) {
      const files = sourceFiles(root)
      expect(files.length).toBeGreaterThan(0)
      for (const file of files) {
        const specifiers = specifiersOf(readFileSync(file, 'utf8'))
        read += specifiers.length
        for (const specifier of specifiers) {
          if (specifier.includes('campaign')) offenders.push(`${file}: ${specifier}`)
        }
      }
    }

    expect(offenders).toEqual([])
    // A reader that matched nothing would report no offenders forever.
    expect(read).toBeGreaterThan(20)
  })

  it('reads the specifier forms this codebase actually writes', () => {
    expect(
      specifiersOf(
        [
          "import { createBattle } from './battle'",
          "import type { CardId } from '../battle/constants'",
          "const mod = await import('../campaign/state')",
          "export * from './digest'",
        ].join('\n'),
      ),
    ).toEqual(['./battle', '../battle/constants', '../campaign/state', './digest'])
  })

  it('confirms the campaign really does read the battle, so the direction is a direction', () => {
    const source = readFileSync(join(process.cwd(), 'src/core/campaign/transition.ts'), 'utf8')
    expect(specifiersOf(source).some((specifier) => specifier.includes('battle'))).toBe(true)
  })
})
