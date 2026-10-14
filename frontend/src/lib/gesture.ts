// THE HOUSE TAP SLOP — one definition for every gesture that has to tell a tap from a drag.

/** Movement that disqualifies a tap / commits a drag's axis, CSS px. R69 §4.1 [V] — AOSP `TOUCH_SLOP` =
 *  8 dp (iOS's 10 pt agrees to within a thumb); Telegram Web's zero slop is too strict for a thumb. Read
 *  by the mic gesture (`useMicGesture`) and the fling-proof tap (`usePointerTap`, ISS-71). */
export const SLOP_PX = 8;
