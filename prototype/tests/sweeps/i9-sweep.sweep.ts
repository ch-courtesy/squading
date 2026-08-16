// Runner for the §5 stage-1 geometry sweep.
//
//   npm run sweep:i9
//   I9_SEEDS=4 I9_SHOOTER_SAMPLES=128 I9_GRID=pilot npm run sweep:i9
//
// It is a Vitest file only because Vitest is the TypeScript runner this repo
// already has; it asserts nothing about the outcome. Asserting a pass here would
// be exactly the failure mode §3 warns about — tuning until the gate goes green.
// The table lands in `artifacts/i9-sweep.md` (override with `I9_OUT`).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { describe, it } from 'vitest'

import {
  DEFAULT_HIGH_SIDE,
  LOW_SIDE_RANGES,
  buildSeeds,
  correlation,
  formatSweepTable,
  runSweep,
  type SweepCell,
  type SweepCellResult,
} from '../../src/core/harness/i9-sweep'
import { I9_BEST_THRESHOLD, I9_MEAN_THRESHOLD } from '../../src/core/harness/i9'

const SHOOTER_RANGES = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 4.9]
const LOW_COUNTS = [10, 20, 30, 40]
const HIGH_COUNTS = [4, 7, 10]
const PILOT_RANGES = [2.0, 3.5, 4.9]
const PILOT_LOW_SIDES = [LOW_SIDE_RANGES[0], LOW_SIDE_RANGES[4]]
const PILOT_LOW_COUNTS = [10, 40]

const seedCount = Number(process.env.I9_SEEDS ?? 24)
const shooterSamples = Number(process.env.I9_SHOOTER_SAMPLES ?? 512)
const refineShooterSamples = Number(process.env.I9_REFINE_SAMPLES ?? 8192)
const grid = process.env.I9_GRID ?? 'full'
const mainHighCount = Number(process.env.I9_HIGH_COUNT ?? 7)

const pilot = grid === 'pilot'
const ranges = pilot ? PILOT_RANGES : SHOOTER_RANGES
const sides = pilot ? PILOT_LOW_SIDES : LOW_SIDE_RANGES
const counts = pilot ? PILOT_LOW_COUNTS : LOW_COUNTS

function buildCells(highCount: number): SweepCell[] {
  const cells: SweepCell[] = []
  for (const shooterRange of ranges) {
    for (const lowSide of sides) {
      for (const lowCount of counts) {
        cells.push({ shooterRange, lowSide, lowCount, highCount, highSide: DEFAULT_HIGH_SIDE })
      }
    }
  }
  return cells
}

function describeCell(result: SweepCellResult): string {
  const cell = result.cell
  return `range ${cell.shooterRange}, low side ${cell.lowSide.min}-${cell.lowSide.max}, low ${cell.lowCount} (placed ${result.placedLow.toFixed(1)}), high ${cell.highCount}`
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function summarise(results: SweepCellResult[], label: string): string {
  const passing = results.filter((result) => result.passed)
  const strictPassing = results.filter(
    (result) => result.meanBlockedStrict >= I9_MEAN_THRESHOLD && result.bestBlockedStrict >= I9_BEST_THRESHOLD,
  )
  const byMean = [...results].sort((a, b) => b.meanBlocked - a.meanBlocked)
  const byStrict = [...results].sort((a, b) => b.meanBlockedStrict - a.meanBlockedStrict)
  return [
    ``,
    `### ${label}`,
    ``,
    `cells ${results.length} | seeds/cell ${seedCount} | shooter samples/centre ${shooterSamples} | refine ${refineShooterSamples}`,
    `I9 thresholds: mean >= ${percent(I9_MEAN_THRESHOLD)}, best-of-40 >= ${percent(I9_BEST_THRESHOLD)}`,
    `cells satisfying I9 (literal): ${passing.length}/${results.length}`,
    `cells satisfying I9 (strict, shooters inside low cover excluded): ${strictPassing.length}/${results.length}`,
    `max mean (literal): ${percent(byMean[0].meanBlocked)} at ${describeCell(byMean[0])} — ratio ${byMean[0].ratio.toFixed(2)}`,
    `max mean (strict):  ${percent(byStrict[0].meanBlockedStrict)} at ${describeCell(byStrict[0])} — ratio ${byStrict[0].ratio.toFixed(2)}`,
  ].join('\n')
}

/**
 * §2 claims the blocking rate follows `SHOOTER_RANGE / low mean side` and that the
 * useful band is `>= 2.0`. If the ratio really is a sufficient statistic, cells
 * with the same ratio must land on the same blocking rate no matter how the
 * ratio was reached. This groups by ratio bucket and prints the spread.
 */
function isoRatioTable(results: SweepCellResult[]): string {
  const buckets = new Map<string, SweepCellResult[]>()
  for (const result of results) {
    const bucket = (Math.round(result.ratio * 4) / 4).toFixed(2)
    const list = buckets.get(bucket) ?? []
    list.push(result)
    buckets.set(bucket, list)
  }
  const lines = [
    '',
    '### Iso-ratio spread (is `range / side` a sufficient statistic?)',
    '',
    '| ratio bucket | cells | min mean% | max mean% | spread pp |',
    '|---:|---:|---:|---:|---:|',
  ]
  for (const [bucket, list] of [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (list.length < 2) continue
    const values = list.map((result) => result.meanBlocked)
    const min = Math.min(...values)
    const max = Math.max(...values)
    lines.push(
      `| ${bucket} | ${list.length} | ${(min * 100).toFixed(1)} | ${(max * 100).toFixed(1)} | ${((max - min) * 100).toFixed(1)} |`,
    )
  }
  return lines.join('\n')
}

function sensitivity(results: SweepCellResult[]): string {
  const meanBlocked = results.map((result) => result.meanBlocked)
  const rows: Array<[string, number[]]> = [
    ['SHOOTER_RANGE', results.map((result) => result.cell.shooterRange)],
    ['low mean side (placed)', results.map((result) => result.lowMeanSide)],
    ['SHOOTER_RANGE / side (§2 axis)', results.map((result) => result.ratio)],
    ['low cover count (placed)', results.map((result) => result.placedLow)],
    ['low cover total area', results.map((result) => result.lowArea)],
    ['high cover count', results.map((result) => result.cell.highCount)],
  ]
  const lines = [
    '',
    '### Sensitivity (Pearson r against literal mean blocking, all cells pooled)',
    '',
    '| parameter | r |',
    '|---|---:|',
  ]
  for (const [label, values] of rows) {
    lines.push(`| ${label} | ${correlation(values, meanBlocked).toFixed(3)} |`)
  }
  return lines.join('\n')
}

describe('I9 geometry sweep', () => {
  it('measures the blocking surface over the spec ranges', () => {
    const started = performance.now()
    const options = {
      seeds: buildSeeds(seedCount),
      measurement: { shooterSamples, refineShooterSamples, refineTop: 3 },
    }

    const main = runSweep(buildCells(mainHighCount), options)
    const secondary = HIGH_COUNTS.filter((count) => count !== mainHighCount).flatMap((count) =>
      runSweep(buildCells(count), options),
    )
    const all = [...main, ...secondary]
    const elapsed = (performance.now() - started) / 1000

    const report = [
      `## I9 geometry sweep`,
      ``,
      `Main grid: high cover = ${mainHighCount}. Secondary grids: high cover = ${HIGH_COUNTS.filter((count) => count !== mainHighCount).join(', ')}.`,
      `\`side*\` is the realised mean side of the rectangles actually placed; \`ratio\` = SHOOTER_RANGE / side*.`,
      `\`strict\` columns drop shooter positions standing inside low cover; \`in-low%\` is the share of blocked positions that were.`,
      ``,
      `### Main grid (high cover = ${mainHighCount})`,
      ``,
      formatSweepTable(main),
      summarise(main, `Main grid (high cover = ${mainHighCount})`),
      ``,
      `### High-cover sensitivity grids`,
      ``,
      formatSweepTable(secondary),
      summarise(all, 'All grids pooled'),
      isoRatioTable(all),
      sensitivity(all),
      ``,
      `elapsed: ${elapsed.toFixed(1)}s`,
    ].join('\n')

    console.log(report)

    const outputPath = process.env.I9_OUT ?? 'artifacts/i9-sweep.md'
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${report}\n`, 'utf8')
  })
})
