// Bottom-left zoom capsule, per Wei's final 2026-11-15 spec
// (corrected 03:09): exactly five items — fit button, − button,
// a short slider, the live percentage, and the ＋ button —
// identical on desktop and touch widths (no per-breakpoint
// variants). Only the old trailing 100% reset button was removed.
// Anchor: the main toolbar is horizontally centered and ~620px
// wide, so below xl its left end reaches into the capsule's
// corner band (at 820px wide it would start near x≈100, under
// the capsule) — the capsule therefore rides one row above the
// toolbar until xl, where the toolbar's left end clears the
// capsule's right edge (~271px) with room to spare. Same capsule,
// same five items at every width; only the row changes.
// The minimap itself lives at the canvas's bottom-right
// (MiniMap.tsx), always on, as in the reference canvas.

import { IconFocus, IconMinus, IconPlus } from "../icons";

export function ZoomControls({
  scale,
  onScaleChange,
  onFit,
}: {
  scale: number;
  onScaleChange: (scale: number) => void;
  onFit: () => void;
}) {
  const percent = Math.round(scale * 100);
  return (
    <div
      data-ui
      data-canvas-no-zoom
      className="absolute bottom-[4.5rem] left-3 z-40 xl:bottom-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="capsule-chrome flex h-11 items-center gap-1 rounded-full px-2.5">
        <button
          type="button"
          className="hit-40 grid h-8 w-8 place-items-center rounded-full text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={onFit}
          aria-label="适配全图"
        >
          <IconFocus size={16} />
        </button>
        <button
          type="button"
          className="hit-40 grid h-8 w-8 place-items-center rounded-full text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={() => onScaleChange(scale / 1.2)}
          aria-label="缩小画布"
        >
          <IconMinus size={15} />
        </button>
        <label className="sr-only" htmlFor="canvas-zoom-slider">
          放大/缩小画布
        </label>
        <input
          id="canvas-zoom-slider"
          type="range"
          min="5"
          max="500"
          step="1"
          value={percent}
          className="w-14 sm:w-20"
          onChange={(event) => onScaleChange(Number(event.target.value) / 100)}
          aria-label="放大/缩小画布"
        />
        <span
          className="w-11 text-center text-xs tabular-nums text-[var(--dim)]"
          aria-live="polite"
        >
          {percent}%
        </span>
        <button
          type="button"
          className="hit-40 grid h-8 w-8 place-items-center rounded-full text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={() => onScaleChange(scale * 1.2)}
          aria-label="放大画布"
        >
          <IconPlus size={15} />
        </button>
      </div>
    </div>
  );
}
