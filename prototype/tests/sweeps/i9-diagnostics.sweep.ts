// Side measurements that the main sweep table cannot carry: how often a body ends up
// standing inside passable low cover, and what that does to the formation. Same runner
// as the sweep (`npm run sweep:i9`).
//
// What the numbers MEAN changed after §1.6 grew its endpoint exemption ("선분의 끝점이
// 어떤 사각형 내부에 있으면 그 사각형은 그 선분을 막지 않는다"). The measurement is
// unchanged — it counts containment, never sight — but a body inside low cover is no
// longer blind and invisible; it is a body that shoots over its own sandbags and can be
// shot back. So this table now reads as "how much of the roster gets the exemption",
// which is what turns the exemption from a footnote into a balance input.

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
      '## I9 diagnostics — units standing inside passable low cover',
      '',
      'Low cover blocks sight and is passable (§1.6), so bodies end up standing inside it.',
      "§1.6's endpoint exemption means such a body is NOT blind: the rectangle it stands in",
      'does not block its own segments, so it shoots over its sandbags and is visible in',
      'return. This table counts how often that happens — i.e. how much of the roster gets',
      'the exemption. (Before the exemption was added to the spec, these same positions',
      'were blind and untargetable, which is the artefact the stage-1 report measured at',
      '65% of blocked samples.)',
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
