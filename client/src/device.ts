/**
 * Touch-class device detection — the single implementation for the
 * whole client. A device counts as touch-class when its primary
 * pointer is coarse, OR when it has a multi-touch screen and no
 * hover capability: the coarse-pointer query alone is not reliable
 * on every tablet browser (an iPad reporting a fine primary
 * pointer, e.g. with a trackpad attached, fails it while still
 * raising a soft keyboard and offering touch-first flows).
 *
 * The CSS side of the same condition lives in theme.css as media
 * queries (the `@media (hover: none) and (pointer: coarse)` blocks
 * and the safe-area / hit-target rules) — CSS cannot import this
 * function, so that side is kept in sync by hand; this file is the
 * only JS/TS implementation of the test.
 */
/**
 * Narrow-layout breakpoint in CSS pixels: below this width the
 * canvas uses its phone layout (side panel closed by default and
 * overlaying, big panels as bottom sheets, fit-on-load). The CSS
 * mirror of this value is the `@media (min-width: 768px)` block in
 * theme.css (the .top-cluster-left rule) — CSS cannot import this
 * constant, so changing the breakpoint means changing both places.
 */
export const NARROW_BREAKPOINT_PX = 768;

export function isTouchClassDevice(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(pointer: coarse)").matches ||
      (navigator.maxTouchPoints > 0 &&
        window.matchMedia("(hover: none)").matches))
  );
}
