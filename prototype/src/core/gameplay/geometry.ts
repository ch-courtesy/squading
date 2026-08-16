// Geometry primitives for the v6 commander battle (§1.6).
//
// Every rectangle in the design is axis-aligned and half-open: it owns
// `[x, x + width) x [y, y + height)`. Two consequences run through this file and
// they are the whole reason it exists as its own module:
//
//   1. A point sitting exactly on the `-x` or `-y` face is INSIDE; a point on the
//      `+x` or `+y` face is OUTSIDE. That asymmetry is what makes the ejection
//      rule (§1.6) necessary — moving a trapped unit onto a face does not free it.
//   2. A segment that merely touches a boundary does NOT intersect. Line of sight
//      is therefore an *open interior* test, not a closed-box test: grazing a wall
//      edge or clipping a corner leaves sight intact.
//
// The combat rules (target selection §1.8, sliding §1.7, elite re-check §1.12)
// all reduce to the four functions below, so they live here rather than inside
// the terrain generator.

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type Point = {
  x: number
  y: number
}

export type Axis = '-x' | '+x' | '-y' | '+y'

/** Half-open containment: `[x0,x1) x [y0,y1)`. */
export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

export function containsAny(rects: readonly Rect[], x: number, y: number): boolean {
  for (let index = 0; index < rects.length; index += 1) {
    if (containsPoint(rects[index], x, y)) return true
  }
  return false
}

/**
 * Does the segment `a -> b` pass through the open interior of `rect`?
 *
 * Slab clipping with strict comparisons. Tangency — running along a face, or
 * touching a single corner — produces a degenerate (zero-length) overlap, which
 * `tEnter < tExit` rejects. That is exactly §1.6's "boundary contact is not an
 * intersection", and it also makes the half-open `-x`/`-y` faces behave: a unit
 * standing on such a face is inside the rectangle but is not blocked by it.
 */
export function segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, rect: Rect): boolean {
  const x0 = rect.x
  const x1 = rect.x + rect.width
  const y0 = rect.y
  const y1 = rect.y + rect.height

  // Cheap reject on the segment's bounding box. Pure speed: the sweep runs this
  // function tens of millions of times.
  if ((ax <= x0 && bx <= x0) || (ax >= x1 && bx >= x1)) return false
  if ((ay <= y0 && by <= y0) || (ay >= y1 && by >= y1)) return false

  let enter = 0
  let exit = 1

  const dx = bx - ax
  if (dx === 0) {
    if (ax <= x0 || ax >= x1) return false
  } else {
    const inverse = 1 / dx
    let near = (x0 - ax) * inverse
    let far = (x1 - ax) * inverse
    if (near > far) {
      const swap = near
      near = far
      far = swap
    }
    if (near > enter) enter = near
    if (far < exit) exit = far
    if (enter >= exit) return false
  }

  const dy = by - ay
  if (dy === 0) {
    if (ay <= y0 || ay >= y1) return false
  } else {
    const inverse = 1 / dy
    let near = (y0 - ay) * inverse
    let far = (y1 - ay) * inverse
    if (near > far) {
      const swap = near
      near = far
      far = swap
    }
    if (near > enter) enter = near
    if (far < exit) exit = far
  }

  return enter < exit
}

/** §1.8: a candidate is only considered when the centre-to-centre segment is unblocked. */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blockers: readonly Rect[],
): boolean {
  for (let index = 0; index < blockers.length; index += 1) {
    if (segmentIntersectsRect(ax, ay, bx, by, blockers[index])) return false
  }
  return true
}

/** Euclidean distance from a point to the closed rectangle (0 when inside or on it). */
export function pointRectDistance(rect: Rect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width))
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height))
  return Math.hypot(dx, dy)
}

/**
 * Euclidean gap between two rectangles: 0 when they overlap or touch.
 *
 * §1.6's "minimum gap" is measured this way — the shortest distance between the
 * two point sets — so a 5.0 gap between high cover really is a 5.0-wide corridor
 * wherever the two rectangles face each other.
 */
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), 0)
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height), 0)
  return Math.hypot(dx, dy)
}

/** Half-open overlap: sharing only a face is not an overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

export type Ejection = {
  x: number
  y: number
  axis: Axis
}

/**
 * §1.6: push a unit caught inside movement-blocking terrain out through the
 * nearest face by `epsilon`. Ties break `-x, +x, -y, +y`.
 *
 * The epsilon is applied on all four faces, not just the half-open ones. On `-x`
 * and `-y` it is mandatory (the face itself is still inside); on `+x` and `+y` it
 * is cosmetic but keeps the rule one sentence long instead of two.
 */
export function ejectFromRect(rect: Rect, x: number, y: number, epsilon: number): Ejection {
  const toMinusX = x - rect.x
  const toPlusX = rect.x + rect.width - x
  const toMinusY = y - rect.y
  const toPlusY = rect.y + rect.height - y

  let axis: Axis = '-x'
  let best = toMinusX
  if (toPlusX < best) {
    axis = '+x'
    best = toPlusX
  }
  if (toMinusY < best) {
    axis = '-y'
    best = toMinusY
  }
  if (toPlusY < best) {
    axis = '+y'
    best = toPlusY
  }

  switch (axis) {
    case '-x':
      return { x: rect.x - epsilon, y, axis }
    case '+x':
      return { x: rect.x + rect.width + epsilon, y, axis }
    case '-y':
      return { x, y: rect.y - epsilon, axis }
    default:
      return { x, y: rect.y + rect.height + epsilon, axis }
  }
}

/**
 * Eject from the first blocking rectangle that contains the point. High cover
 * keeps a 5.0 gap from its own class, so at most one blocker can contain a point
 * and one pass is enough.
 */
export function ejectFromRects(
  rects: readonly Rect[],
  x: number,
  y: number,
  epsilon: number,
): Ejection | null {
  for (let index = 0; index < rects.length; index += 1) {
    if (containsPoint(rects[index], x, y)) {
      return ejectFromRect(rects[index], x, y, epsilon)
    }
  }
  return null
}
