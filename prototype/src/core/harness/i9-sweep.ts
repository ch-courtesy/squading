// Stage 1 of §5: the geometry-only sweep. No simulation, no player model.
//
// §2's first sweep axis is `SHOOTER_RANGE / low-cover mean side length`, with
// low-cover count as the secondary axis. The claim under test is that the ratio,
// not absolute thickness, governs the blocking rate, with a target of `>= 2.0`.
//
// A cell is (shooter range x low-cover side range x low-cover count), evaluated
// over N seeds. Every number reported is measured from the layout that was
// actually PLACED (§1.6 insists on this): the realised mean side length and the
// realised count both come back from the generator, because rejection sampling
// against the 1.0 gap and the 6.0 clear radius routinely abandons rectangles.

import {
  generateTerrain,
  TERRAIN_SIDE_MAX,
  TERRAIN_SIDE_MIN,
  type SideRange,
  type TerrainOptions,
} from '../gameplay/terrain'
import { measureI9ForSeed, type I9Options } from './i9'

export type SweepCell = {
  shooterRange: number
  lowSide: SideRange
  lowCount: number
  highCount: number
  highSide: SideRange
}

export type SweepCellResult = {
  cell: SweepCell
  /** Requested vs placed, averaged over seeds. */
  placedLow: number
  placedHigh: number
  /** Mean of `(width+height)/2` over placed low cover, averaged over seeds. */
  lowMeanSide: number
  /** `shooterRange / lowMeanSide` — §2's first axis, computed from placed rects. */
  ratio: number
  /** Total placed low-cover area, averaged over seeds. The rival explanation. */
  lowArea: number
  meanBlocked: number
  meanBlockedSe: number
  bestBlocked: number
  meanBlockedStrict: number
  bestBlockedStrict: number
  insideLowShare: number
  /** Seeds whose best-of-40 cleared 35%. */
  bestPassSeeds: number
  /** Seeds whose mean cleared 15%. */
  meanPassSeeds: number
  seeds: number
  passed: boolean
}

export type SweepOptions = {
  seeds: string[]
  measurement: Omit<I9Options, 'shooterRange'>
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

function standardError(values: number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  let sum = 0
  for (const value of values) sum += (value - average) ** 2
  return Math.sqrt(sum / (values.length - 1) / values.length)
}

export function runSweepCell(cell: SweepCell, options: SweepOptions): SweepCellResult {
  const terrainOptions: TerrainOptions = {
    highCount: cell.highCount,
    lowCount: cell.lowCount,
    highSide: cell.highSide,
    lowSide: cell.lowSide,
  }

  const meanBlocked: number[] = []
  const bestBlocked: number[] = []
  const meanStrict: number[] = []
  const bestStrict: number[] = []
  const insideLow: number[] = []
  const placedLow: number[] = []
  const placedHigh: number[] = []
  const lowMeanSide: number[] = []
  const lowArea: number[] = []
  let bestPassSeeds = 0
  let meanPassSeeds = 0

  for (const seed of options.seeds) {
    const layout = generateTerrain(seed, terrainOptions)
    const result = measureI9ForSeed(layout, seed, { ...options.measurement, shooterRange: cell.shooterRange })
    meanBlocked.push(result.meanBlocked)
    bestBlocked.push(result.bestBlocked)
    meanStrict.push(result.meanBlockedStrict)
    bestStrict.push(result.bestBlockedStrict)
    insideLow.push(result.insideLowShare)
    placedLow.push(layout.stats.low.placed)
    placedHigh.push(layout.stats.high.placed)
    lowMeanSide.push(layout.stats.low.meanSide)
    lowArea.push(layout.low.reduce((sum, rect) => sum + rect.width * rect.height, 0))
    if (result.bestPassed) bestPassSeeds += 1
    if (result.meanPassed) meanPassSeeds += 1
  }

  const realisedSide = mean(lowMeanSide)
  const aggregateMean = mean(meanBlocked)
  const aggregateBest = mean(bestBlocked)

  return {
    cell,
    placedLow: mean(placedLow),
    placedHigh: mean(placedHigh),
    lowMeanSide: realisedSide,
    ratio: realisedSide === 0 ? Infinity : cell.shooterRange / realisedSide,
    lowArea: mean(lowArea),
    meanBlocked: aggregateMean,
    meanBlockedSe: standardError(meanBlocked),
    bestBlocked: aggregateBest,
    meanBlockedStrict: mean(meanStrict),
    bestBlockedStrict: mean(bestStrict),
    insideLowShare: mean(insideLow),
    bestPassSeeds,
    meanPassSeeds,
    seeds: options.seeds.length,
    passed: aggregateMean >= 0.15 && aggregateBest >= 0.35,
  }
}

export function runSweep(cells: SweepCell[], options: SweepOptions): SweepCellResult[] {
  return cells.map((cell) => runSweepCell(cell, options))
}

export function buildSeeds(count: number, prefix = 'i9'): string[] {
  const seeds: string[] = []
  for (let index = 0; index < count; index += 1) seeds.push(`${prefix}-${index + 1}`)
  return seeds
}

/** §2 side search range is 1.5~6.0 for both classes; these are slices of it. */
export const LOW_SIDE_RANGES: SideRange[] = [
  { min: 1.5, max: 2.0 },
  { min: 1.5, max: 3.0 },
  { min: 2.0, max: 4.0 },
  { min: 3.0, max: 5.0 },
  { min: 4.0, max: 6.0 },
  { min: 5.0, max: 6.0 },
]

export const DEFAULT_HIGH_SIDE: SideRange = { min: TERRAIN_SIDE_MIN, max: TERRAIN_SIDE_MAX }

function percent(value: number): string {
  return (value * 100).toFixed(1)
}

export function formatSweepTable(results: SweepCellResult[]): string {
  const header = [
    '| range | low side draw | side* | ratio | low req | low placed | low area | high | mean% | ±SE | best% | strict mean% | strict best% | in-low% | mean pass | best pass | I9 |',
    '|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|',
  ]
  const rows = results.map((result) => {
    const cell = result.cell
    return [
      '',
      cell.shooterRange.toFixed(1),
      `${cell.lowSide.min.toFixed(1)}-${cell.lowSide.max.toFixed(1)}`,
      result.lowMeanSide.toFixed(2),
      result.ratio.toFixed(2),
      String(cell.lowCount),
      result.placedLow.toFixed(1),
      result.lowArea.toFixed(0),
      String(cell.highCount),
      percent(result.meanBlocked),
      percent(result.meanBlockedSe),
      percent(result.bestBlocked),
      percent(result.meanBlockedStrict),
      percent(result.bestBlockedStrict),
      percent(result.insideLowShare),
      `${result.meanPassSeeds}/${result.seeds}`,
      `${result.bestPassSeeds}/${result.seeds}`,
      result.passed ? 'PASS' : '-',
      '',
    ].join(' | ')
  })
  return [...header, ...rows].join('\n')
}

/** Pearson correlation, used only to rank which knob the surface actually follows. */
export function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const meanX = mean(xs.slice(0, n))
  const meanY = mean(ys.slice(0, n))
  let covariance = 0
  let varianceX = 0
  let varianceY = 0
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - meanX
    const dy = ys[index] - meanY
    covariance += dx * dy
    varianceX += dx * dx
    varianceY += dy * dy
  }
  if (varianceX === 0 || varianceY === 0) return 0
  return covariance / Math.sqrt(varianceX * varianceY)
}
