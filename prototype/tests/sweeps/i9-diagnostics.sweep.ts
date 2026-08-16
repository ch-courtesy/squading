// Side measurements that the main sweep table cannot carry: how much of I9 is the
// half-open-interior artefact of passable low cover, and what it does to the
// formation itself. Same runner as the sweep (`npm run sweep:i9`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, it } from 'vitest'

import { createPrng } from '../../src/core/prng'
import { containsAny } from '../../src/core/gameplay/geometry'
import { resolveFormation } from '../../src/core/gameplay/formation'
import { ARENA_HEIGHT, ARENA_WIDTH, generateTerrain, type SideRange } from '../../src/core/gameplay/terrain'
import { buildSeeds } from '../../src/core/harness/i9-sweep'

type Config = { label: string; lowSide: SideRange; lowCount: number }

const CONFIGS: Config[] = [
  { label: 'thin/many (spec ratio band)', lowSide: { min: 1.5, max: 2.0 }, lowCount: 40 },
  { label: 'medium', lowSide: { min: 2.0, max: 4.0 }, lowCount: 40 },
  { label: 'strict-feasible best', lowSide: { min: 3.0, max: 5.0 }, lowCount: 40 },
  { label: 'thick/few', lowSide: { min: 5.0, max: 6.0 }, lowCount: 40 },
]

describe('I9 diagnostics', () => {
  it('measures the passable-cover artefact', () => {
    const seeds = buildSeeds(48)
    const lines = [
      '## I9 diagnostics — the passable-low-cover artefact',
      '',
      'A unit standing strictly inside a low-cover rectangle is blind and invisible in',
      'every direction (§1.6: low cover blocks sight, low cover is passable, and any ray',
      'out of the interior crosses that interior). These are the consequences.',
      '',
      '| config | low placed | low area | free-space share inside low | bodies of 16 inside low | any body inside low |',
      '|---|---:|---:|---:|---:|---:|',
    ]

    for (const config of CONFIGS) {
      let area = 0
      let placed = 0
      let insideBodies = 0
      let totalBodies = 0
      let centresWithBlindBody = 0
      let centres = 0
      let insideArea = 0
      let areaSamples = 0

      for (const seed of seeds) {
        const layout = generateTerrain(seed, {
          highCount: 7,
          lowCount: config.lowCount,
          highSide: { min: 1.5, max: 6.0 },
          lowSide: config.lowSide,
        })
        placed += layout.stats.low.placed
        area += layout.low.reduce((sum, rect) => sum + rect.width * rect.height, 0)

        const prng = createPrng(`${seed}:diagnostics`)
        for (let sample = 0; sample < 400; sample += 1) {
          const x = prng.range(0, ARENA_WIDTH)
          const y = prng.range(0, ARENA_HEIGHT)
          if (containsAny(layout.movementBlockers, x, y)) continue
          areaSamples += 1
          if (containsAny(layout.low, x, y)) insideArea += 1
          if (areaSamples % 4 !== 0) continue
          centres += 1
          let blind = 0
          for (const body of resolveFormation(x, y, layout.movementBlockers)) {
            totalBodies += 1
            if (containsAny(layout.low, body.x, body.y)) blind += 1
          }
          insideBodies += blind
          if (blind > 0) centresWithBlindBody += 1
        }
      }

      lines.push(
        `| ${config.label} (${config.lowSide.min}-${config.lowSide.max}, req ${config.lowCount}) | ${(placed / seeds.length).toFixed(1)} | ${(area / seeds.length).toFixed(0)} | ${((insideArea / areaSamples) * 100).toFixed(1)}% | ${(insideBodies / centres).toFixed(2)} (${((insideBodies / totalBodies) * 100).toFixed(1)}%) | ${((centresWithBlindBody / centres) * 100).toFixed(1)}% |`,
      )
    }

    const report = lines.join('\n')
    console.log(report)
    const outputPath = process.env.I9_DIAG_OUT ?? 'artifacts/i9-diagnostics.md'
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${report}\n`, 'utf8')
  })
})
