import { describe, expect, it } from 'vitest'

import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/core/gameplay/constants'
import {
  PROP_KEEP_OUT,
  planTerrainProps,
  propMaxHeight,
  type TerrainPropKind,
} from '../src/renderers/three-hybrid/terrain-props'

// The terrain surround is decoration, so the properties worth pinning are the ones that
// keep it decoration: it never enters the play area, it never hides a unit standing on
// the board, and it is reproducible from its own cosmetic seed rather than from anything
// the authority owns.
const BOUNDS = { centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2, worldWidth: ARENA_WIDTH, worldHeight: ARENA_HEIGHT }
// The staged camera pitch is 30 degrees, so a prop hides cot(30) of board per unit of
// its own height. The renderer passes the same number.
const SIGHTLINE_SLOPE = 1.05 / Math.tan((30 * Math.PI) / 180)

describe('terrain prop placement', () => {
  it('places every prop outside the play area', () => {
    const placements = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE })

    expect(placements.length).toBeGreaterThan(80)
    for (const placement of placements) {
      const beyondEdge = Math.abs(placement.z - BOUNDS.centerY) - BOUNDS.worldHeight / 2
      expect(beyondEdge).toBeGreaterThanOrEqual(PROP_KEEP_OUT)
      expect(placement.clearance).toBeCloseTo(beyondEdge, 6)
      // A prop is never dropped onto a spot a unit can walk to.
      const insidePlayArea = placement.x >= 0 && placement.x <= ARENA_WIDTH && placement.z >= 0 && placement.z <= ARENA_HEIGHT
      expect(insidePlayArea).toBe(false)
    }
  })

  it('keeps props on the camera side short enough not to hide a unit on the board edge', () => {
    const placements = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE })
    const near = placements.filter((placement) => placement.side === 'near')

    expect(near.length).toBeGreaterThan(20)
    for (const placement of near) {
      expect(propMaxHeight(placement.kind, placement.scale) * SIGHTLINE_SLOPE).toBeLessThanOrEqual(placement.clearance)
    }
  })

  it('is reproducible from its cosmetic seed and independent of gameplay state', () => {
    const first = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE })
    const second = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE })
    expect(second).toEqual(first)

    const other = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE, seed: 0x1234567 })
    expect(other).not.toEqual(first)
    expect(other.length).toBeGreaterThan(80)
  })

  it('fields the whole prop set the concept sheet asks for', () => {
    const placements = planTerrainProps(BOUNDS, { sightlineSlope: SIGHTLINE_SLOPE })
    const kinds = new Set<TerrainPropKind>(placements.map((placement) => placement.kind))

    for (const kind of ['conifer', 'crates', 'barricade', 'banner', 'sandbags', 'debris'] as const) {
      expect(kinds).toContain(kind)
    }
    // Tall silhouettes belong to the far belt, which reads as background scenery.
    expect(placements.some((placement) => placement.kind === 'conifer' && placement.side === 'far')).toBe(true)
  })
})
