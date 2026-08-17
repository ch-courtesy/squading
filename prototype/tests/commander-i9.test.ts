import { describe, expect, it } from 'vitest'

import { createPrng } from '../src/core/prng'
import { generateTerrain, type TerrainLayout, type TerrainRect } from '../src/core/gameplay/terrain'
import { createI9Prng, measureCenter, measureI9, measureI9ForSeed } from '../src/core/harness/i9'
import { correlation } from '../src/core/harness/i9-sweep'

function layoutOf(rects: TerrainRect[]): TerrainLayout {
  const high = rects.filter((rect) => rect.kind === 'high')
  const low = rects.filter((rect) => rect.kind === 'low')
  return {
    high,
    low,
    all: rects,
    movementBlockers: high,
    sightBlockers: rects,
    stats: {
      high: { requested: high.length, placed: high.length, abandoned: 0, attempts: high.length, meanSide: 0 },
      low: { requested: low.length, placed: low.length, abandoned: 0, attempts: low.length, meanSide: 0 },
      draws: 0,
    },
    prngState: 0,
  }
}

const OPTIONS = {
  highCount: 7,
  lowCount: 24,
  highSide: { min: 1.5, max: 6.0 },
  lowSide: { min: 1.5, max: 4.0 },
}

describe('I9 measurement (§3)', () => {
  it('is deterministic for a given layout and sampling seed', () => {
    const layout = generateTerrain('seed-47', OPTIONS)
    const first = measureI9ForSeed(layout, 'seed-47', { shooterRange: 4.0, commanderSamples: 8, shooterSamples: 64 })
    const second = measureI9ForSeed(layout, 'seed-47', { shooterRange: 4.0, commanderSamples: 8, shooterSamples: 64 })
    expect(second.meanBlocked).toBe(first.meanBlocked)
    expect(second.bestBlocked).toBe(first.bestBlocked)
    expect(second.perCenter).toEqual(first.perCenter)
  })

  it('uses a sampling stream separate from the terrain stream', () => {
    // Changing the sample budget must not be able to change the layout under test.
    expect(createI9Prng('seed-47').getState()).toBe(createPrng('seed-47:i9').getState())
    expect(createI9Prng('seed-47').getState()).not.toBe(createPrng('seed-47:terrain').getState())
  })

  it('reports zero blocking on an empty arena', () => {
    const result = measureI9(layoutOf([]), { shooterRange: 4.0, commanderSamples: 8, shooterSamples: 128 }, createPrng('empty'))
    expect(result.meanBlocked).toBe(0)
    expect(result.bestBlocked).toBe(0)
    expect(result.totalOpportunities).toBeGreaterThan(0)
    expect(result.passed).toBe(false)
  })

  it('counts a shooter as blocked only when nobody in range is visible', () => {
    // A hand-built wall (§4.2 forbids deriving fixtures from the seed): a long low
    // wall between the formation and everything to its left.
    const wall: TerrainRect = { kind: 'low', x: 20, y: 4, width: 1, height: 24 }
    const layout = layoutOf([wall])
    const result = measureCenter(layout, 24, 16, 4.0, 4000, createPrng('wall'))
    // Shooters west of the wall (x < 20) are in range of the formation but blind.
    expect(result.ratio).toBeGreaterThan(0.05)
    expect(result.ratio).toBeLessThan(0.5)
    // Removing the wall removes every blocked position.
    expect(measureCenter(layoutOf([]), 24, 16, 4.0, 4000, createPrng('wall')).ratio).toBe(0)
  })

  it('measures the sight the game plays, endpoint exemption included', () => {
    // §1.6: a rectangle containing an endpoint does not block that segment. A shooter
    // standing inside a low slab therefore sees out of it, so it is NOT blocked — the
    // opposite of the legacy rule, where any ray out of the interior crossed that
    // interior and the position was blind in every direction.
    const slab: TerrainRect = { kind: 'low', x: 22, y: 12, width: 4, height: 4 }
    const layout = layoutOf([slab])

    const battle = measureCenter(layout, 28, 16, 4.0, 6000, createPrng('slab'))
    const legacy = measureCenter(layout, 28, 16, 4.0, 6000, createPrng('slab'), 'legacy')

    // Same samples (the sampling stream does not depend on the sight rule), so the
    // opportunity counts match exactly and only the blocked counts move.
    expect(battle.opportunities).toBe(legacy.opportunities)
    expect(battle.strictOpportunities).toBe(legacy.strictOpportunities)
    expect(battle.blocked).toBeLessThan(legacy.blocked)

    // Under the legacy rule the in-cover positions inflated the literal ratio above the
    // strict one; under the game's rule they no longer count as blocked, so the literal
    // ratio now sits BELOW the strict one (same numerator, larger denominator).
    expect(legacy.ratio).toBeGreaterThan(legacy.strictRatio)
    expect(battle.ratio).toBeLessThan(battle.strictRatio)
    expect(battle.strictOpportunities).toBeLessThan(battle.opportunities)
  })

  it('defaults to the battle sight mode and records which one it used', () => {
    const layout = generateTerrain('seed-47', OPTIONS)
    const options = { shooterRange: 4.0, commanderSamples: 6, shooterSamples: 64 }
    const battle = measureI9ForSeed(layout, 'seed-47', options)
    const legacy = measureI9ForSeed(layout, 'seed-47', { ...options, sightMode: 'legacy' as const })

    expect(battle.sightMode).toBe('battle')
    expect(legacy.sightMode).toBe('legacy')
    // The legacy rule counts strictly more positions as blocked, never fewer.
    expect(legacy.meanBlocked).toBeGreaterThanOrEqual(battle.meanBlocked)
    expect(battle.totalOpportunities).toBe(legacy.totalOpportunities)
  })

  it('never lets a shooter stand inside high cover', () => {
    const block: TerrainRect = { kind: 'high', x: 22, y: 12, width: 4, height: 4 }
    const layout = layoutOf([block])
    const result = measureCenter(layout, 28, 16, 4.0, 2000, createPrng('block'))
    expect(result.opportunities).toBe(result.strictOpportunities)
    expect(result.ratio).toBeGreaterThan(0)
  })

  it('reports the best-of-40 as at least the mean', () => {
    const layout = generateTerrain('seed-12', OPTIONS)
    const result = measureI9ForSeed(layout, 'seed-12', { shooterRange: 4.0, commanderSamples: 40, shooterSamples: 128, refineShooterSamples: 512 })
    expect(result.bestBlocked).toBeGreaterThanOrEqual(result.meanBlocked)
    expect(result.perCenter.length).toBe(40)
  })
})

describe('sweep helpers', () => {
  it('computes Pearson correlation', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 9)
    expect(correlation([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 9)
    expect(correlation([1, 1, 1], [1, 2, 3])).toBe(0)
  })
})
