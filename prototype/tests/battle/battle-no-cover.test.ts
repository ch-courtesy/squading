import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
const GAME_PATH_ROOTS = ['src/core/battle']

function sourceFiles(root: string): string[] {
  const absolute = join(process.cwd(), root)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    found.push(join(entry.parentPath, entry.name))
  }
  return found
}

describe('§1.6 cover stays removed', () => {
  it('keeps the archived cover modules out of every game-path import', () => {
    const offenders: string[] = []

    for (const root of GAME_PATH_ROOTS) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, 'utf8')
        // Only real import/export statements count — the archive is named in comments on
        // purpose, so that a reader looking for the evidence can find it.
        for (const match of source.matchAll(/^\s*(?:import|export)[^\n]*?from\s+'([^']+)'/gm)) {
          const specifier = match[1]
          if (ARCHIVED.some((archived) => specifier.includes(archived.split('/').pop()!))) {
            offenders.push(`${file} -> ${specifier}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('leaves no terrain in the authoritative state or its streams', () => {
    const types = readFileSync(join(process.cwd(), 'src/core/battle/types.ts'), 'utf8')
    expect(types).not.toMatch(/^\s*(?:readonly\s+)?terrain\s*[?:]/m)
    expect(types).not.toMatch(/LOW_COVER/)
  })
})
