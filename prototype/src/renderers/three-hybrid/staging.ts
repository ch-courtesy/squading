// The one number the diorama's camera staging shares with the outside world.
//
// It lives in its own module, free of `three`, because two very different things need it and
// only one of them may pay for a WebGL import: the renderer, which stages the camera with it,
// and the v2 shell, which has to invert that staging to turn a pointer drag on the screen back
// into a world-space direction (§1.15's 포인터 드래그). A second copy of the angle in the shell
// would be a second place for it to drift, and a drifted copy steers a drag off by the
// difference — silently, because the drag still moves *something*.

/**
 * The concept sheet is shot from a low oblique angle: the miniatures stand up against the
 * board, their bases read as ellipses rather than circles, and the key light rakes long shadows
 * across the sand. A near top-down view flattens all three away.
 *
 * WHY 23 AND NOT LOWER, AND WHY LOWERING IT DOES NOT COST FRAMING.
 *
 * The staged camera is orthographic, so the frustum the renderer has to guarantee is
 * `halfWidth = max(W, aspect * (D * sin(pitch) + headroom * cos(pitch)))`, where `W` and `D` are
 * §4.4's half-extents plus the edge margin. Dropping the pitch *shrinks* the second term over
 * this whole range (`d/dpitch` is positive up to `atan(D / headroom)`, far above any angle worth
 * shooting) because the board foreshortens faster than a standing figure grows. So the lower
 * angle needs LESS screen for the same world area, not more, and the miniatures come out larger
 * rather than smaller. The framing test in `battle-play.spec.ts` is what proves it, and it takes
 * its reading with the squad SCATTERED to `LEASH_RADIUS` — the clumped case is the easy one.
 *
 * WHAT IT DOES COST is occlusion. A figure of height `h` hides everything within `h / tan(pitch)`
 * of board behind it, so the hidden band is 36% longer at 23 degrees than at 30.
 * `HybridVisualState.framing.occlusion` measures the real thing — the fraction of each body's own
 * screen footprint that bodies nearer the camera cover — and this angle was chosen off that
 * measurement, taken on the same mid-fight frame of `seed-h` at tick 227, twenty-seven bodies on
 * the board and several of them locked in contact:
 *
 *   pitch   mean hidden   >half hidden   ~fully hidden   frustum half-width
 *      30       0.431         10/27           3/27            20.84
 *      27       0.449         10/27           4/27            19.73
 *      23       0.480         11/27           5/27            18.18
 *      20       0.505         13/27           6/27            16.96
 *
 * 23 buys a 13% tighter frustum — the miniatures come out that much larger — for two more bodies
 * substantially behind another. 20 was not taken: the step from 23 to 20 costs as much occlusion
 * again for half the framing gain, and the bodies it loses are the back rank of a melee, which is
 * where a player most needs to count what is in front of them.
 *
 * `diorama-presentation.spec.ts` holds a ceiling on the measurement so a later change cannot
 * quietly drift past it.
 */
export const DIORAMA_PITCH_RADIANS = (23 * Math.PI) / 180
