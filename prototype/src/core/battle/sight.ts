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

// This module deliberately imports NOTHING but the geometry primitives: it is the one
// sight rule shared by the battle core and the I9 harness (`core/harness/i9.ts`), and
// §4.3's replay contract needs the harness to measure the sight the game plays. Pulling
// `BattleState` in here would make the geometry sweep load the whole battle module graph
// for a function that only wants four numbers and a rectangle list. The state-aware
// convenience lives in `targeting.ts` instead.

import { containsPoint, segmentIntersectsRect, type Rect } from '../gameplay/geometry'

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
