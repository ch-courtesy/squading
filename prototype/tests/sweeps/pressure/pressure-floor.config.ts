// §1.10.1's floor, swept without editing `src/` — the same device `roster-sweep.config.ts` uses.
//
//   PRESSURE_FLOOR=0.65 CAMPAIGN2_STAGE_OUT=artifacts/x.json \
//     npx vitest run --config tests/sweeps/pressure/pressure-floor.config.ts \
//     tests/sweeps/campaign2-stage-band.sweep.ts
//
// WHY IT EXISTS. `MIN_PRESSURE_FRACTION` is a §2 value with a declared search range (`0.3~0.8`),
// and "what does the floor do" is a question about that range and not about one point in it. A
// batch that reported only the shipped value would be reporting a placeholder and calling it a
// reason. This config runs any of the existing sweep files at a floor of its own choosing so the
// range can be measured; it CHOOSES nothing and it is not part of `npm test`.
//
// `src/` IS NOT EDITED. The one line the sweep needs to move is rewritten by a Vite plugin at
// import time, so `git status` stays clean while the sweep runs and the harness is reproducible
// from the committed files alone. The replacement is checked: if the source line moves, the plugin
// throws at import time rather than silently measuring the shipped 0.5.
//
// THE §2 BOX IS STILL ENFORCED. `constants.ts` asserts `[0.3, 0.8]` at module load and the
// rewrite happens before that assert runs, so a floor outside the box fails here exactly as it
// would fail in the game. That is deliberate — a sweep that could reach values the rule forbids
// would be measuring a different rule.

import { defineConfig, type Plugin } from 'vite'

const FLOOR = Number(process.env.PRESSURE_FLOOR ?? 0.65)

if (!Number.isFinite(FLOOR)) {
  throw new Error(`pressure sweep: PRESSURE_FLOOR must be a number, got ${process.env.PRESSURE_FLOOR}`)
}

function pressurePlugin(): Plugin {
  return {
    name: 'pressure-floor-transform',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0]
      if (!path.endsWith('src/core/battle/constants.ts')) return null
      const find = /export const MIN_PRESSURE_FRACTION = 0\.65\b/
      if (code.match(find) === null) {
        throw new Error('pressure sweep: the MIN_PRESSURE_FRACTION transform matched nothing')
      }
      return code.replace(find, `export const MIN_PRESSURE_FRACTION = ${FLOOR}`)
    },
  }
}

export default defineConfig({
  root: new URL('../../..', import.meta.url).pathname,
  plugins: [pressurePlugin()],
  test: {
    environment: 'node',
    include: ['tests/sweeps/**/*.sweep.ts'],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 60 * 1000,
  },
})
