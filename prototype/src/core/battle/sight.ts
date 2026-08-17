// §1.6's sight rule, as §1.8 and §1.9 need it.
//
// `gameplay/geometry.ts` gives the segment/rectangle primitive. What it does NOT give
// is §1.6's exemption:
//
//   "선분의 끝점이 어떤 사각형 내부에 있으면 그 사각형은 그 선분을 막지 않는다."
//
// Raw `hasLineOfSight` blocks a segment whose endpoint is strictly inside a rectangle,
// because the segment really does cross that interior. Low cover is *passable*, so a
// soldier standing in a sandbag line would be blind AND untargetable — §1.6 measured
// 65% of all "blocked" positions as that artifact and 20% of the arena as such a
// square, and it is the hole through which camping (I10) and I7 are both passed
// without terrain doing any work.
//
// So the battle's sight test is: a rectangle containing either endpoint is skipped;
// everything else blocks as usual. Batch A's seam note pointed §1.8 at
// `hasLineOfSight` directly, which would have shipped that hole — see the batch B
// report. `core/gameplay/` is the shipped v1 game and is not modified, so the rule
// lives here and every battle rule that asks about sight asks this function:
// §1.8 target selection, §1.9's shooter, and (later) §1.12's per-target re-check.

import { containsPoint, segmentIntersectsRect, type Rect } from '../gameplay/geometry'
import { sightBlockers } from './state'
import type { BattleState, Vec2 } from './types'

export function hasBattleSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blockers: readonly Rect[],
): boolean {
  for (let index = 0; index < blockers.length; index += 1) {
    const rect = blockers[index]
    // §1.6: a rectangle that contains an endpoint does not block that segment.
    if (containsPoint(rect, ax, ay)) continue
    if (containsPoint(rect, bx, by)) continue
    if (segmentIntersectsRect(ax, ay, bx, by, rect)) return false
  }
  return true
}

/**
 * Convenience for callers that have the state at hand and are not in a per-unit loop.
 *
 * The hot paths (steps 7, 9, 10 and enemy movement) hoist `sightBlockers(state)` out
 * of their loop instead — it concatenates the two terrain classes on every call.
 */
export function hasSightBetween(state: BattleState, from: Vec2, to: Vec2): boolean {
  return hasBattleSight(from.x, from.y, to.x, to.y, sightBlockers(state))
}
