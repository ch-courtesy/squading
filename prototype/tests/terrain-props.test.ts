import { describe, expect, it } from 'vitest'

import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/core/gameplay/constants'
import { DIORAMA_PITCH_RADIANS } from '../src/renderers/three-hybrid/staging'
import {
  PROP_KEEP_OUT,
  planTerrainProps,
  propMaxHeight,
  type TerrainPropKind,
} from '../src/renderers/three-hybrid/terrain-props'

// The terrain SURROUND — the belt of crates, conifers and banners outside the rail — is
// decoration, so the properties worth pinning are the ones that keep it decoration: it never
// enters the play area, it never hides a unit standing on the board, and it is reproducible from
// its own cosmetic seed rather than from anything the authority owns.
//
// The clutter that DOES lie inside the play area is a different planner with a different
// contract (§판 안 지형 소품) and is covered in `field-clutter.test.ts`. Splitting them is what
// keeps this file's guarantee — no surround prop on the board — literally true.
const BOUNDS = { centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2, worldWidth: ARENA_WIDTH, worldHeight: ARENA_HEIGHT }
// A prop hides cot(pitch) of board per unit of its own height, so this rides the staged pitch
// rather than a copy of it. The renderer passes the same number.
const SIGHTLINE_SLOPE = 1.05 / Math.tan(DIORAMA_PITCH_RADIANS)

describe('terrain prop placement', () => {
  it('places every surround prop outside the play area', () => {
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
