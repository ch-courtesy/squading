import { describe, expect, it } from 'vitest'

import {
  containsPoint,
  ejectFromRect,
  ejectFromRects,
  hasLineOfSight,
  pointRectDistance,
  rectGap,
  rectsOverlap,
  segmentIntersectsRect,
  type Rect,
} from '../src/core/gameplay/geometry'

// The rectangle used almost everywhere below: [10,20) x [10,20).
const BOX: Rect = { x: 10, y: 10, width: 10, height: 10 }

describe('half-open containment (§1.6)', () => {
  it('owns the -x and -y faces and disowns the +x and +y faces', () => {
    expect(containsPoint(BOX, 10, 10)).toBe(true)
    expect(containsPoint(BOX, 10, 15)).toBe(true)
    expect(containsPoint(BOX, 15, 10)).toBe(true)
    // The far faces belong to the outside, which is exactly why ejection needs an
    // epsilon on the near faces: `x = 10` is still inside.
    expect(containsPoint(BOX, 20, 15)).toBe(false)
    expect(containsPoint(BOX, 15, 20)).toBe(false)
    expect(containsPoint(BOX, 20, 20)).toBe(false)
  })

  it('excludes points outside on every side', () => {
    expect(containsPoint(BOX, 9.999, 15)).toBe(false)
    expect(containsPoint(BOX, 15, 9.999)).toBe(false)
  })
})

describe('segment / rectangle intersection (§1.6: touching is not intersecting)', () => {
  it('reports a segment that crosses the interior', () => {
    expect(segmentIntersectsRect(0, 15, 30, 15, BOX)).toBe(true)
    expect(segmentIntersectsRect(0, 0, 30, 30, BOX)).toBe(true)
  })

  it('does not report a segment running along a face', () => {
    // Along the -x face (which is "inside" for containment) and the +x face.
    expect(segmentIntersectsRect(10, 0, 10, 30, BOX)).toBe(false)
    expect(segmentIntersectsRect(20, 0, 20, 30, BOX)).toBe(false)
    expect(segmentIntersectsRect(0, 10, 30, 10, BOX)).toBe(false)
    expect(segmentIntersectsRect(0, 20, 30, 20, BOX)).toBe(false)
  })

  it('does not report a segment that only clips a corner', () => {
    // Passes exactly through (10,10) and (20,20) respectively.
    expect(segmentIntersectsRect(0, 20, 20, 0, BOX)).toBe(false)
    expect(segmentIntersectsRect(20, 30, 30, 20, BOX)).toBe(false)
  })

  it('does not report a segment that stops on the boundary', () => {
    expect(segmentIntersectsRect(0, 15, 10, 15, BOX)).toBe(false)
    expect(segmentIntersectsRect(30, 15, 20, 15, BOX)).toBe(false)
  })

  it('reports a segment that starts on the -x face and enters', () => {
    // The start point is inside by containment, and the segment has real interior
    // overlap, so sight is blocked.
    expect(segmentIntersectsRect(10, 15, 30, 15, BOX)).toBe(true)
  })

  it('misses a rectangle entirely outside the segment span', () => {
    expect(segmentIntersectsRect(0, 0, 5, 5, BOX)).toBe(false)
    expect(segmentIntersectsRect(25, 25, 30, 30, BOX)).toBe(false)
  })

  it('is symmetric in the endpoints', () => {
    for (const [ax, ay, bx, by] of [
      [0, 15, 30, 15],
      [0, 20, 20, 0],
      [10, 0, 10, 30],
      [0, 12, 12, 30],
    ]) {
      expect(segmentIntersectsRect(ax, ay, bx, by, BOX)).toBe(segmentIntersectsRect(bx, by, ax, ay, BOX))
    }
  })
})

describe('line of sight (§1.8)', () => {
  it('is denied by any one blocker and granted when every blocker is missed', () => {
    const blockers: Rect[] = [BOX, { x: 30, y: 10, width: 4, height: 4 }]
    expect(hasLineOfSight(0, 15, 40, 15, blockers)).toBe(false)
    expect(hasLineOfSight(0, 25, 40, 25, blockers)).toBe(true)
    expect(hasLineOfSight(0, 25, 40, 25, [])).toBe(true)
  })
})

describe('rectangle metrics used by placement (§1.6)', () => {
  it('measures the gap as the shortest distance between the two rectangles', () => {
    const other: Rect = { x: 25, y: 10, width: 5, height: 10 }
    expect(rectGap(BOX, other)).toBeCloseTo(5, 9)
    expect(rectGap(BOX, { x: 20, y: 10, width: 5, height: 5 })).toBe(0)
    expect(rectGap(BOX, { x: 5, y: 5, width: 10, height: 10 })).toBe(0)
    // Diagonally offset: the gap is the corner-to-corner distance.
    expect(rectGap(BOX, { x: 23, y: 24, width: 2, height: 2 })).toBeCloseTo(Math.hypot(3, 4), 9)
  })

  it('does not call a shared face an overlap', () => {
    expect(rectsOverlap(BOX, { x: 20, y: 10, width: 5, height: 10 })).toBe(false)
    expect(rectsOverlap(BOX, { x: 19.9, y: 10, width: 5, height: 10 })).toBe(true)
  })

  it('measures point distance to the rectangle, zero when inside', () => {
    expect(pointRectDistance(BOX, 15, 15)).toBe(0)
    expect(pointRectDistance(BOX, 5, 15)).toBeCloseTo(5, 9)
    expect(pointRectDistance(BOX, 7, 6)).toBeCloseTo(5, 9)
  })
})

describe('ejection from movement-blocking terrain (§1.6)', () => {
  const EPSILON = 0.005

  it('leaves through the nearest face and lands outside', () => {
    for (const [x, y, axis] of [
      [11, 15, '-x'],
      [19, 15, '+x'],
      [15, 11, '-y'],
      [15, 19, '+y'],
    ] as const) {
      const ejected = ejectFromRect(BOX, x, y, EPSILON)
      expect(ejected.axis).toBe(axis)
      expect(containsPoint(BOX, ejected.x, ejected.y)).toBe(false)
      expect(pointRectDistance(BOX, ejected.x, ejected.y)).toBeCloseTo(EPSILON, 9)
    }
  })

  it('clears the half-open -x and -y faces by epsilon rather than landing on them', () => {
    const ejected = ejectFromRect(BOX, 10, 15, EPSILON)
    expect(ejected.axis).toBe('-x')
    expect(ejected.x).toBeCloseTo(10 - EPSILON, 9)
    expect(containsPoint(BOX, ejected.x, ejected.y)).toBe(false)
    // Landing exactly on the face would leave the unit inside.
    expect(containsPoint(BOX, 10, 15)).toBe(true)
  })

  it('breaks ties in the order -x, +x, -y, +y', () => {
    // Dead centre: all four faces are 5 away.
    expect(ejectFromRect(BOX, 15, 15, EPSILON).axis).toBe('-x')
    // -x ties +x, both nearer than y.
    expect(ejectFromRect({ x: 0, y: 0, width: 10, height: 40 }, 5, 20, EPSILON).axis).toBe('-x')
    // +x ties -y, and both beat -x and +y.
    expect(ejectFromRect({ x: 0, y: 0, width: 10, height: 10 }, 8, 2, EPSILON).axis).toBe('+x')
    // -y ties +y and beats both x faces.
    expect(ejectFromRect({ x: 0, y: 0, width: 40, height: 10 }, 20, 5, EPSILON).axis).toBe('-y')
    // +y alone is nearest.
    expect(ejectFromRect({ x: 0, y: 0, width: 40, height: 10 }, 20, 9, EPSILON).axis).toBe('+y')
  })

  it('ejects from the rectangle that contains the point and returns null when free', () => {
    const rects: Rect[] = [BOX, { x: 30, y: 30, width: 4, height: 4 }]
    const ejected = ejectFromRects(rects, 31, 32, EPSILON)
    expect(ejected).not.toBeNull()
    expect(ejected?.axis).toBe('-x')
    expect(ejectFromRects(rects, 0, 0, EPSILON)).toBeNull()
  })
})
