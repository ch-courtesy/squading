// Two-class terrain generation for the v6 commander battle (§1.6).
//
// v5 had one terrain class carrying two jobs at once: keep a 5.0 corridor open so
// the 4.4-wide formation can move, and block enough sight lines to make cover
// mean something. Measurement showed the two jobs fight over the same parameter.
// v6 splits them:
//
//   high cover — blocks sight AND movement, minimum gap 5.0 (corridors)
//   low  cover — blocks sight only, minimum gap 1.0 (density)
//
// Everything here is deterministic: the `terrain` stream, four draws per attempt
// in the order `width, height, x, y`, per-rectangle rejection with a hard cap of
// 40 attempts. When a rectangle cannot be placed it is abandoned — the layout is
// never restarted, because a restart would make the draw count depend on the
// failure and destroy replay.

import type { Prng } from '../prng'
import { createPrng } from '../prng'
import { pointRectDistance, rectGap, rectsOverlap, type Rect } from './geometry'

export const ARENA_WIDTH = 56
export const ARENA_HEIGHT = 32

/** §1.1 initial commander position. */
export const COMMANDER_START = { x: 28, y: 16 } as const

/** §1.6 `x in [2.0, 56-2-width]`, `y in [2.0, 32-2-height]`. */
export const TERRAIN_MARGIN = 2.0
/** §1.6 nothing is placed within this radius of the initial commander position. */
export const TERRAIN_CLEAR_RADIUS = 6.0
export const HIGH_COVER_MIN_GAP = 5.0
export const LOW_COVER_MIN_GAP = 1.0
export const TERRAIN_MAX_ATTEMPTS = 40
/** §2 search range for a rectangle side. */
export const TERRAIN_SIDE_MIN = 1.5
export const TERRAIN_SIDE_MAX = 6.0

export type TerrainClass = 'high' | 'low'

export type TerrainRect = Rect & { kind: TerrainClass }

export type SideRange = {
  min: number
  max: number
}

export type TerrainOptions = {
  /** §2: high cover 4~10. */
  highCount: number
  /** §2: low cover 10~40. */
  lowCount: number
  /** §2: side 1.5~6.0. */
  highSide: SideRange
  lowSide: SideRange
}

export type TerrainClassStats = {
  requested: number
  placed: number
  abandoned: number
  attempts: number
  /** Mean of `(width + height) / 2` over the rectangles actually placed. */
  meanSide: number
}

export type TerrainLayout = {
  high: TerrainRect[]
  low: TerrainRect[]
  /** High first, then low — the order they were drawn in. */
  all: TerrainRect[]
  /** Movement blockers only (§1.6, §1.7): high cover. */
  movementBlockers: TerrainRect[]
  /** Sight blockers (§1.6, §1.8): both classes. */
  sightBlockers: TerrainRect[]
  stats: {
    high: TerrainClassStats
    low: TerrainClassStats
    /** 4 per attempt, both classes summed. */
    draws: number
  }
  prngState: number
}

export const DRAWS_PER_ATTEMPT = 4

function drawRect(prng: Prng, side: SideRange, kind: TerrainClass): TerrainRect {
  // §1.6: draw order is width, height, x, y. Exactly four draws, always, even on
  // an attempt that is about to be rejected.
  const width = prng.range(side.min, side.max)
  const height = prng.range(side.min, side.max)
  const x = prng.range(TERRAIN_MARGIN, ARENA_WIDTH - TERRAIN_MARGIN - width)
  const y = prng.range(TERRAIN_MARGIN, ARENA_HEIGHT - TERRAIN_MARGIN - height)
  return { kind, x, y, width, height }
}

function clearsCommanderStart(rect: Rect): boolean {
  return pointRectDistance(rect, COMMANDER_START.x, COMMANDER_START.y) >= TERRAIN_CLEAR_RADIUS
}

function placeClass(
  prng: Prng,
  kind: TerrainClass,
  count: number,
  side: SideRange,
  sameClass: TerrainRect[],
  minGap: number,
  mustNotOverlap: readonly TerrainRect[],
): TerrainClassStats {
  let attempts = 0
  let placed = 0

  for (let index = 0; index < count; index += 1) {
    // §1.6: exceeding 40 attempts gives up on THIS rectangle, not on the layout.
    // A layout restart would make the draw count depend on the failure.
    for (let attempt = 0; attempt < TERRAIN_MAX_ATTEMPTS; attempt += 1) {
      attempts += 1
      const rect = drawRect(prng, side, kind)

      if (!clearsCommanderStart(rect)) continue

      let ok = true
      for (let other = 0; other < sameClass.length; other += 1) {
        if (rectGap(rect, sameClass[other]) < minGap) {
          ok = false
          break
        }
      }
      if (ok) {
        for (let other = 0; other < mustNotOverlap.length; other += 1) {
          if (rectsOverlap(rect, mustNotOverlap[other])) {
            ok = false
            break
          }
        }
      }
      if (!ok) continue

      sameClass.push(rect)
      placed += 1
      break
    }
  }

  let sideSum = 0
  for (const rect of sameClass) sideSum += (rect.width + rect.height) / 2

  return {
    requested: count,
    placed,
    abandoned: count - placed,
    attempts,
    meanSide: sameClass.length === 0 ? 0 : sideSum / sameClass.length,
  }
}

/**
 * Generate a layout from an already-positioned `terrain` stream.
 *
 * High cover is placed first and in full, then low cover, which must additionally
 * avoid overlapping any high cover (touching is allowed — half-open rectangles
 * that share a face do not overlap).
 */
export function generateTerrainFrom(prng: Prng, options: TerrainOptions): TerrainLayout {
  const high: TerrainRect[] = []
  const low: TerrainRect[] = []

  const highStats = placeClass(prng, 'high', options.highCount, options.highSide, high, HIGH_COVER_MIN_GAP, [])
  const lowStats = placeClass(prng, 'low', options.lowCount, options.lowSide, low, LOW_COVER_MIN_GAP, high)

  const all = [...high, ...low]

  return {
    high,
    low,
    all,
    movementBlockers: high,
    sightBlockers: all,
    stats: {
      high: highStats,
      low: lowStats,
      draws: (highStats.attempts + lowStats.attempts) * DRAWS_PER_ATTEMPT,
    },
    prngState: prng.getState(),
  }
}

/** Named-stream convention matches `state.ts`: `${seed}:terrain`. */
export function createTerrainPrng(seed: string): Prng {
  return createPrng(`${seed}:terrain`)
}

export function generateTerrain(seed: string, options: TerrainOptions): TerrainLayout {
  return generateTerrainFrom(createTerrainPrng(seed), options)
}
