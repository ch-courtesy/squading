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
 * 30 degrees is as low as the staging can go before the front rank starts hiding the rank
 * behind it, and it matches the base-ring ellipse of the concept art.
 */
export const DIORAMA_PITCH_RADIANS = (30 * Math.PI) / 180
