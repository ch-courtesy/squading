// §1.15's 포인터 드래그, in the one coordinate system the battle accepts.
//
// `Battle.pointerDrag` takes the WORLD-SPACE offset from the command unit to the drag target,
// and the pointer arrives in screen pixels — so the diorama's staging has to be inverted. Two
// things bend the mapping and both are here:
//
//   * THE PITCH. The camera looks down at `DIORAMA_PITCH_RADIANS`, so a world offset along `y`
//     is foreshortened to `sin(pitch)` of its length on screen while an offset along `x` keeps
//     all of it. Ignoring this makes a 45-degree drag steer at 27 degrees, which reads as the
//     game refusing to go where the player pointed.
//   * THE ASPECT. The frustum's half-height is its half-width divided by the viewport aspect,
//     so the two normalized axes are not the same number of world units and the RATIO between
//     them — which is the whole direction — depends on it.
//
// Only the direction survives: `advanceCommandUnit` normalizes whatever it is given, so the
// magnitude carries no meaning (§1.15's `pointerDrag` says so). The one thing the magnitude
// still does is trip the queue's `ARRIVE_EPSILON` clamp, which is why a drag that ends on the
// centre of the stage stops the unit instead of jittering it.

import type { Vec2 } from '../../core/battle/types'
import { DIORAMA_PITCH_RADIANS } from '../../renderers/three-hybrid/staging'

/** Where the pointer is, relative to the stage that was clicked. */
export type PointerPoint = { readonly clientX: number; readonly clientY: number }

export type StageBounds = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function pointerWorldOffset(point: PointerPoint, bounds: StageBounds): Vec2 {
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  // Normalized to [-1, 1] with +y DOWN the screen, which is also §1.15's +y in the world.
  const screenX = ((point.clientX - bounds.left) / width) * 2 - 1
  const screenY = ((point.clientY - bounds.top) / height) * 2 - 1
  const aspect = width / height
  return { x: screenX, y: screenY / (aspect * Math.sin(DIORAMA_PITCH_RADIANS)) }
}
