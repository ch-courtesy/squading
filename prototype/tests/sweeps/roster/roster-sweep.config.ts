// The roster sweep's own vitest config — `src/` IS NOT EDITED, it is TRANSFORMED IN MEMORY.
//
//   SWEEP_ROSTER_SIZE=32 npx vitest run --config tests/sweeps/roster/roster-sweep.config.ts \
//     tests/sweeps/roster/roster-campaign-band.sweep.ts
//
// ---------------------------------------------------------------------------
// WHY A TRANSFORM AND NOT AN EDIT
// ---------------------------------------------------------------------------
// The brief requires `src/` to end unmodified and the tree clean. A sweep that patched
// `constants.ts`, ran, and patched back would leave the tree dirty for the whole run and
// permanently dirty on any crash — and would make the harness unreproducible from the committed
// files alone. So the three source lines the sweep needs to move are rewritten by a Vite plugin at
// import time. The files on disk never change; `git status` is clean while the sweep is running.
//
// A `vi.mock` was the other candidate and was rejected: `constants.ts` runs its structural
// assertions at module load and imports `FORMATION_SLOTS` to do it, so a partial mock would have
// to reason about whether `importActual`'s own dependency graph is mocked too. The transform has
// no such question — the module that loads IS the module the sweep means, and every importer of
// `./formation` inside `src/core/battle/` sees the same one.
//
// EVERY REPLACEMENT IS CHECKED. If a source line the transform expects has moved, the plugin
// throws at import time rather than silently measuring the shipped 16.
//
// ---------------------------------------------------------------------------
// THE THREE REWRITES
// ---------------------------------------------------------------------------
//   constants.ts  `ROSTER_SIZE = 16` -> the swept size.
//   formation.ts  the fifteen-slot table -> `generateSlots(size - 1, scheme)`. See
//                 `formation-scheme.ts` for what the widening is and what it is not.
//   names.ts      §1.14's pool is exactly 24 and `assignNameIndices` throws above it. The rewrite
//                 makes the assignment CYCLE the shuffled pool instead of throwing. It does NOT
//                 grow the pool, and that is the point: the Fisher-Yates pass stays at exactly 23
//                 draws, so the `names` stream ends where it ended at sixteen bodies and the
//                 `spawn` and `cards` streams are untouched. Two rosters of different size on the
//                 same seed therefore face the SAME spawn angles. A grown pool would have shifted
//                 every draw and confounded the roster axis with a reseed.
//                 Duplicate names above 24 bodies are cosmetic — `nameIndex` feeds §1.14's result
//                 screen and nothing mechanical reads it.

import { defineConfig, type Plugin } from 'vite'

import { generateSlots, slotsLiteral, type FormationScheme } from './formation-scheme'

const ROSTER_SIZE = Number(process.env.SWEEP_ROSTER_SIZE ?? 16)
const SCHEME = (process.env.SWEEP_FORMATION_SCHEME ?? 'wide') as FormationScheme

if (!Number.isInteger(ROSTER_SIZE) || ROSTER_SIZE < 2) {
  throw new Error(`roster sweep: SWEEP_ROSTER_SIZE must be an integer >= 2, got ${ROSTER_SIZE}`)
}
if (SCHEME !== 'wide' && SCHEME !== 'dense') {
  throw new Error(`roster sweep: SWEEP_FORMATION_SCHEME must be 'wide' or 'dense', got ${SCHEME}`)
}

const SLOTS = generateSlots(ROSTER_SIZE - 1, SCHEME)

function replaceOnce(code: string, id: string, find: RegExp, replacement: string): string {
  const matches = code.match(find)
  if (matches === null) {
    throw new Error(`roster sweep: the transform for ${id} matched nothing — the source moved`)
  }
  return code.replace(find, replacement)
}

function rosterPlugin(): Plugin {
  return {
    name: 'roster-sweep-transform',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0]
      if (path.endsWith('src/core/battle/constants.ts')) {
        return replaceOnce(
          code,
          path,
          /export const ROSTER_SIZE = 16\b/,
          `export const ROSTER_SIZE = ${ROSTER_SIZE}`,
        )
      }
      if (path.endsWith('src/core/battle/formation.ts')) {
        return replaceOnce(
          code,
          path,
          /export const FORMATION_SLOTS: readonly FormationSlot\[\] = \[[\s\S]*?\n\]/,
          slotsLiteral(SLOTS),
        )
      }
      if (path.endsWith('src/core/battle/names.ts')) {
        return replaceOnce(
          code,
          path,
          /if \(count > NAME_POOL_SIZE\) \{[\s\S]*?\n  \}\n  return shuffleNamePool\(prng\)\.slice\(0, count\)/,
          '  const order = shuffleNamePool(prng)\n' +
            '  return Array.from({ length: count }, (_, index) => order[index % NAME_POOL_SIZE])',
        )
      }
      return null
    },
  }
}

export default defineConfig({
  root: new URL('../../..', import.meta.url).pathname,
  plugins: [rosterPlugin()],
  test: {
    environment: 'node',
    include: ['tests/sweeps/roster/**/*.sweep.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
  },
})
