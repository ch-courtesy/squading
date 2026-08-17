// ARCHIVED — the two sight rules the cover design was measured with (§2 폐기 기록).
//
// Neither of these exists in the game. §1.6 removed cover: "시야는 항상 통한다", §1.8 has
// no sight filter, and `core/battle/` imports nothing from this directory. They live here
// because the stage-1 geometry sweep (`i9.ts`, `artifacts/i9-sweep.md`) is the evidence
// that binary blocking was measured and rejected — 0 of 504 cells — and evidence that
// cannot be re-run is not evidence.
//
// This file used to be `core/battle/sight.ts`. It moved rather than being deleted so the
// sweep still reproduces, and so the boundary test in `tests/battle/battle-boundaries.test.ts`
// can pin that the game path does not reach it.
//
//   `hasBattleSight`  — the rule §1.6 had grown by the time it was removed: a rectangle
//                       containing either endpoint does not block that segment. Under
//                       this rule the sweep measured a maximum mean blocking of 9.3%
//                       against a 15% gate, which is what killed cover.
//   `hasLineOfSight`  — the pre-exemption rule the FIRST stage-1 run used (in
//                       `gameplay/geometry.ts`); kept reachable through `i9.ts`'s
//                       `sightMode: 'legacy'` so that old artifact still reproduces.

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
    // A rectangle that contains an endpoint does not block that segment.
    if (containsPoint(rect, ax, ay)) continue
    if (containsPoint(rect, bx, by)) continue
    if (segmentIntersectsRect(ax, ay, bx, by, rect)) return false
  }
  return true
}
