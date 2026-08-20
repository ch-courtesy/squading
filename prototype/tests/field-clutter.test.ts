import { describe, expect, it } from 'vitest'

import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/core/battle/constants'
import {
  CLUTTER_FLAT_HEIGHT,
  CLUTTER_POLE_RADIUS,
  PROP_KEEP_OUT,
  clutterExtent,
  clutterFootprintRadius,
  clutterShape,
  planFieldClutter,
  planTerrainProps,
  type FieldClutterKind,
} from '../src/renderers/three-hybrid/terrain-props'

/**
 * §판 안 지형 소품, held to the one rule that makes it safe to put anything on the board at all.
 *
 * §1.6 removed cover from the game after five review rounds, and `tests/battle/battle-no-cover.
 * test.ts` guards that decision in the simulation. This file guards the OTHER half of it: the
 * simulation not modelling cover is only half the promise, and a crate wall standing on the mat
 * breaks the other half without touching a line of `core/`. A player reads shelter off shape.
 *
 * So every piece of board clutter is either FLAT — low enough that a miniature is drawn standing
 * over it — or a POLE thin enough to see straight past. The assertions below take the numbers off
 * the BUILT geometry rather than off the planner's declared table, because the declaration is
 * what a re-sculpt forgets to update.
 */
const BOUNDS = { centerX: ARENA_WIDTH / 2, centerY: ARENA_HEIGHT / 2, worldWidth: ARENA_WIDTH, worldHeight: ARENA_HEIGHT }
const KINDS: readonly FieldClutterKind[] = ['pebbles', 'plank', 'tuft', 'brass', 'stake']

describe('field clutter inside the play area', () => {
  it('puts every piece on the board, footprint and all', () => {
    const placements = planFieldClutter(BOUNDS)

    expect(placements.length).toBeGreaterThan(120)
    for (const placement of placements) {
      const radius = clutterFootprintRadius(placement)
      expect(Math.abs(placement.x - BOUNDS.centerX) + radius).toBeLessThanOrEqual(BOUNDS.worldWidth / 2)
      expect(Math.abs(placement.z - BOUNDS.centerY) + radius).toBeLessThanOrEqual(BOUNDS.worldHeight / 2)
    }
  })

  it('never builds a piece that could shelter a miniature', () => {
    // Every placement the planner actually produced, measured as built.
    for (const placement of planFieldClutter(BOUNDS)) {
      const extent = clutterExtent(placement)
      if (clutterShape(placement.kind) === 'pole') expect(extent.radius).toBeLessThanOrEqual(CLUTTER_POLE_RADIUS)
      else expect(extent.height).toBeLessThanOrEqual(CLUTTER_FLAT_HEIGHT)
    }
  })

  it('holds the rule at the extremes of every kind, not only where the seed happened to land', () => {
    // The planner samples `scale` and `variant` continuously, so a kind can be within the rule
    // for one seed and over it for another. This walks the corners of both ranges for all five.
    for (const kind of KINDS) {
      for (const scale of [0.8, 1.05, 1.35]) {
        for (const variant of [0, 0.35, 0.7, 0.999]) {
          const extent = clutterExtent({ kind, x: 0, z: 0, rotation: 0, scale, variant })
          if (clutterShape(kind) === 'pole') {
            expect.soft(extent.radius, `${kind} scale=${scale} variant=${variant}`).toBeLessThanOrEqual(CLUTTER_POLE_RADIUS)
          } else {
            expect.soft(extent.height, `${kind} scale=${scale} variant=${variant}`).toBeLessThanOrEqual(CLUTTER_FLAT_HEIGHT)
          }
        }
      }
    }
  })

  it('never grows past the footprint the planner spaced it by', () => {
    // The spacing rule and the "is a unit standing on this" test both use the declared radius.
    // If a builder reached past it, two pieces could touch and the walk-through counter would be
    // reporting a circle that is not the piece.
    for (const kind of KINDS) {
      for (const variant of [0, 0.35, 0.7, 0.999]) {
        const placement = { kind, x: 0, z: 0, rotation: 0, scale: 1, variant }
        expect.soft(clutterExtent(placement).radius, `${kind} variant=${variant}`)
          .toBeLessThanOrEqual(clutterFootprintRadius(placement))
      }
    }
  })

  it('fields every kind the board dressing is made of', () => {
    const kinds = new Set(planFieldClutter(BOUNDS).map((placement) => placement.kind))
    for (const kind of KINDS) expect(kinds).toContain(kind)
  })

  it('is reproducible from its cosmetic seed and independent of gameplay state', () => {
    expect(planFieldClutter(BOUNDS)).toEqual(planFieldClutter(BOUNDS))
    const other = planFieldClutter(BOUNDS, { seed: 0x777333 })
    expect(other).not.toEqual(planFieldClutter(BOUNDS))
    expect(other.length).toBeGreaterThan(120)
  })

  it('is a different set from the surround, which stays off the board', () => {
    // The two planners are separate on purpose: `terrain-props.test.ts` asserts that NOTHING the
    // surround places lands inside the play area, and that guarantee has to survive the board
    // being dressed. A shared planner would have made that assertion quietly weaker.
    const surround = planTerrainProps(BOUNDS)
    for (const prop of surround) {
      const beyondEdge = Math.abs(prop.z - BOUNDS.centerY) - BOUNDS.worldHeight / 2
      expect(beyondEdge).toBeGreaterThanOrEqual(PROP_KEEP_OUT)
    }
    for (const placement of planFieldClutter(BOUNDS)) {
      expect(Math.abs(placement.z - BOUNDS.centerY)).toBeLessThan(BOUNDS.worldHeight / 2)
    }
  })

  it('leaves room to walk: no two pieces are allowed to pile into one silhouette', () => {
    const placements = planFieldClutter(BOUNDS)
    for (let index = 0; index < placements.length; index += 1) {
      for (let other = index + 1; other < placements.length; other += 1) {
        const a = placements[index]!
        const b = placements[other]!
        const separation = clutterFootprintRadius(a) + clutterFootprintRadius(b)
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(separation)
      }
    }
  })
})
