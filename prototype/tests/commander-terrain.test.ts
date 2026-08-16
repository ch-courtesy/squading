import { describe, expect, it } from 'vitest'

import { createPrng, type Prng } from '../src/core/prng'
import { containsPoint, pointRectDistance, rectGap, rectsOverlap } from '../src/core/gameplay/geometry'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  COMMANDER_START,
  DRAWS_PER_ATTEMPT,
  HIGH_COVER_MIN_GAP,
  LOW_COVER_MIN_GAP,
  TERRAIN_CLEAR_RADIUS,
  TERRAIN_MARGIN,
  TERRAIN_MAX_ATTEMPTS,
  createTerrainPrng,
  generateTerrain,
  generateTerrainFrom,
  type TerrainOptions,
} from '../src/core/gameplay/terrain'
import {
  FORMATION_MAX_SLOT_RADIUS,
  FORMATION_SIZE,
  FORMATION_SLOTS,
  resolveFormation,
  resolveSlotPosition,
} from '../src/core/gameplay/formation'

const OPTIONS: TerrainOptions = {
  highCount: 7,
  lowCount: 24,
  highSide: { min: 1.5, max: 6.0 },
  lowSide: { min: 1.5, max: 4.0 },
}

// Placement is rejection sampling on floats, so gaps land on the constraint to
// within rounding rather than exactly on it.
const TOLERANCE = 1e-9

function countingPrng(seed: string): { prng: Prng; draws: () => number } {
  const inner = createPrng(seed)
  let draws = 0
  return {
    prng: {
      getState: () => inner.getState(),
      nextUint32: () => {
        draws += 1
        return inner.nextUint32()
      },
      nextFloat: () => {
        draws += 1
        return inner.nextFloat()
      },
      range: (min, max) => {
        draws += 1
        return inner.range(min, max)
      },
    },
    draws: () => draws,
  }
}

describe('terrain determinism (§1.17)', () => {
  it('produces an identical layout for the same seed', () => {
    const first = generateTerrain('seed-47', OPTIONS)
    const second = generateTerrain('seed-47', OPTIONS)
    expect(second.all).toEqual(first.all)
    expect(second.stats).toEqual(first.stats)
    expect(second.prngState).toBe(first.prngState)
  })

  it('produces a different layout for a different seed', () => {
    const first = generateTerrain('seed-47', OPTIONS)
    const other = generateTerrain('seed-48', OPTIONS)
    expect(other.all).not.toEqual(first.all)
  })

  it('draws from the `terrain` stream, matching the named-stream convention', () => {
    const direct = generateTerrainFrom(createPrng('seed-47:terrain'), OPTIONS)
    expect(generateTerrain('seed-47', OPTIONS).all).toEqual(direct.all)
    expect(createTerrainPrng('seed-47').getState()).toBe(createPrng('seed-47:terrain').getState())
  })

  it('consumes exactly four draws per attempt', () => {
    const counted = countingPrng('seed-47:terrain')
    const layout = generateTerrainFrom(counted.prng, OPTIONS)
    const attempts = layout.stats.high.attempts + layout.stats.low.attempts
    expect(attempts).toBeGreaterThanOrEqual(OPTIONS.highCount + OPTIONS.lowCount)
    expect(counted.draws()).toBe(attempts * DRAWS_PER_ATTEMPT)
    expect(layout.stats.draws).toBe(attempts * DRAWS_PER_ATTEMPT)
  })
})

describe('terrain placement constraints (§1.6)', () => {
  const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

  it('keeps every rectangle inside the 2.0 margin', () => {
    for (const seed of seeds) {
      for (const rect of generateTerrain(seed, OPTIONS).all) {
        expect(rect.x).toBeGreaterThanOrEqual(TERRAIN_MARGIN - TOLERANCE)
        expect(rect.y).toBeGreaterThanOrEqual(TERRAIN_MARGIN - TOLERANCE)
        expect(rect.x + rect.width).toBeLessThanOrEqual(ARENA_WIDTH - TERRAIN_MARGIN + TOLERANCE)
        expect(rect.y + rect.height).toBeLessThanOrEqual(ARENA_HEIGHT - TERRAIN_MARGIN + TOLERANCE)
      }
    }
  })

  it('keeps every rectangle clear of the initial commander position', () => {
    for (const seed of seeds) {
      const layout = generateTerrain(seed, OPTIONS)
      expect(layout.all.length).toBeGreaterThan(0)
      for (const rect of layout.all) {
        expect(pointRectDistance(rect, COMMANDER_START.x, COMMANDER_START.y)).toBeGreaterThanOrEqual(
          TERRAIN_CLEAR_RADIUS - TOLERANCE,
        )
        expect(containsPoint(rect, COMMANDER_START.x, COMMANDER_START.y)).toBe(false)
      }
    }
  })

  it('holds a 5.0 gap between high cover so the 4.4-wide formation can pass', () => {
    for (const seed of seeds) {
      const { high } = generateTerrain(seed, OPTIONS)
      for (let a = 0; a < high.length; a += 1) {
        for (let b = a + 1; b < high.length; b += 1) {
          expect(rectGap(high[a], high[b])).toBeGreaterThanOrEqual(HIGH_COVER_MIN_GAP - TOLERANCE)
        }
      }
    }
  })

  it('holds a 1.0 gap between low cover and never overlaps high cover', () => {
    for (const seed of seeds) {
      const { low, high } = generateTerrain(seed, OPTIONS)
      for (let a = 0; a < low.length; a += 1) {
        for (let b = a + 1; b < low.length; b += 1) {
          expect(rectGap(low[a], low[b])).toBeGreaterThanOrEqual(LOW_COVER_MIN_GAP - TOLERANCE)
        }
        for (const blocker of high) {
          expect(rectsOverlap(low[a], blocker)).toBe(false)
        }
      }
    }
  })

  it('places high cover before low cover', () => {
    const layout = generateTerrain('seed-47', OPTIONS)
    const kinds = layout.all.map((rect) => rect.kind)
    expect(kinds.indexOf('low')).toBe(layout.high.length)
    expect(kinds.lastIndexOf('high')).toBe(layout.high.length - 1)
    expect(layout.movementBlockers).toEqual(layout.high)
    expect(layout.sightBlockers.length).toBe(layout.high.length + layout.low.length)
  })

  it('reports placed counts, not requested counts', () => {
    // 40 high rectangles at a 5.0 gap do not fit in a 52x28 usable arena, so most
    // are abandoned. §1.6 requires the layout to survive and the gate to be read
    // off what was actually placed.
    const crowded = generateTerrain('seed-47', { ...OPTIONS, highCount: 40 })
    expect(crowded.stats.high.requested).toBe(40)
    expect(crowded.stats.high.placed).toBeLessThan(40)
    expect(crowded.stats.high.placed).toBe(crowded.high.length)
    expect(crowded.stats.high.abandoned).toBe(40 - crowded.high.length)
    // Every abandoned rectangle burned the full attempt budget and no more.
    expect(crowded.stats.high.attempts).toBeLessThanOrEqual(40 * TERRAIN_MAX_ATTEMPTS)
    expect(crowded.stats.high.attempts).toBeGreaterThanOrEqual(crowded.stats.high.abandoned * TERRAIN_MAX_ATTEMPTS)
    for (let a = 0; a < crowded.high.length; a += 1) {
      for (let b = a + 1; b < crowded.high.length; b += 1) {
        expect(rectGap(crowded.high[a], crowded.high[b])).toBeGreaterThanOrEqual(HIGH_COVER_MIN_GAP - TOLERANCE)
      }
    }
  })

  it('abandons a single rectangle without restarting the layout', () => {
    // Giving up on the layout would make the draw count depend on the failure.
    const crowded = generateTerrain('seed-47', { ...OPTIONS, highCount: 40 })
    expect(crowded.stats.draws).toBe(
      (crowded.stats.high.attempts + crowded.stats.low.attempts) * DRAWS_PER_ATTEMPT,
    )
    expect(crowded.stats.low.placed).toBeGreaterThan(0)
  })

  it('reports the mean side of the rectangles it actually placed', () => {
    const layout = generateTerrain('seed-47', OPTIONS)
    const expected =
      layout.low.reduce((sum, rect) => sum + (rect.width + rect.height) / 2, 0) / layout.low.length
    expect(layout.stats.low.meanSide).toBeCloseTo(expected, 9)
  })
})

describe('formation geometry (§1.4)', () => {
  it('has 15 world-axis-fixed slots with a 2.460 maximum radius', () => {
    expect(FORMATION_SLOTS.length).toBe(15)
    expect(FORMATION_SIZE).toBe(16)
    expect(FORMATION_MAX_SLOT_RADIUS).toBeCloseTo(2.46, 3)
    const xs = FORMATION_SLOTS.map((slot) => slot.x)
    const ys = FORMATION_SLOTS.map((slot) => slot.y)
    expect(Math.min(...xs)).toBeCloseTo(-2.2, 9)
    expect(Math.max(...xs)).toBeCloseTo(2.2, 9)
    expect(Math.min(...ys)).toBeCloseTo(-1.1, 9)
    expect(Math.max(...ys)).toBeCloseTo(2.2, 9)
  })

  it('does not rotate with the command unit — slots are pure world offsets', () => {
    const positions = resolveFormation(20, 20, [])
    expect(positions[0]).toEqual({ x: 20, y: 20 })
    for (let index = 0; index < FORMATION_SLOTS.length; index += 1) {
      expect(positions[index + 1].x).toBeCloseTo(20 + FORMATION_SLOTS[index].x, 9)
      expect(positions[index + 1].y).toBeCloseTo(20 + FORMATION_SLOTS[index].y, 9)
    }
  })

  it('pulls a blocked slot toward the command unit until it is free', () => {
    const blocker = { x: 21, y: 19, width: 4, height: 4 }
    const slot = { x: 2.2, y: 0 }
    const resolved = resolveSlotPosition(20, 20, slot, [blocker])
    expect(containsPoint(blocker, resolved.x, resolved.y)).toBe(false)
    expect(resolved.x).toBeLessThan(22.2)
    expect(resolved.x).toBeGreaterThanOrEqual(20)
    expect(resolved.y).toBeCloseTo(20, 9)
  })

  it('falls back to the command unit position when the pull never clears', () => {
    const blocker = { x: 0, y: 0, width: 56, height: 32 }
    const resolved = resolveSlotPosition(20, 20, { x: 2.2, y: 1.1 }, [blocker])
    expect(resolved).toEqual({ x: 20, y: 20 })
  })

  it('keeps every body out of movement-blocking terrain', () => {
    const layout = generateTerrain('seed-47', OPTIONS)
    for (let x = 4; x < ARENA_WIDTH - 4; x += 3.1) {
      for (let y = 4; y < ARENA_HEIGHT - 4; y += 3.1) {
        if (layout.movementBlockers.some((rect) => containsPoint(rect, x, y))) continue
        for (const body of resolveFormation(x, y, layout.movementBlockers)) {
          expect(layout.movementBlockers.some((rect) => containsPoint(rect, body.x, body.y))).toBe(false)
        }
      }
    }
  })
})
