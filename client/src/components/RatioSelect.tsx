import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown } from "../icons";
import { IMAGE_RATIOS } from "../types";

/**
 * The one aspect-ratio picker used everywhere a generation ratio is
 * chosen (image / video generation panels, the config node's card
 * and its detail panel): a custom dark dropdown in the canvas's own
 * style — never the native <select> system popup (Wei 2026-11-15
 * 定版， replacing the short-lived inline segmented buttons). Closed
 * it shows just the current ratio (「16:9 ▾」); opening lists the
 * eight real ratios — 16:9 / 9:16 / 1:1 / 3:2 / 2:3 / 4:3 / 3:4 /
 * 21:9 — and picking one
 * writes it straight back through onChange, exactly like the old
 * segmented buttons wrote gen_ratio.
 *
 * The menu is portaled to <body> with fixed positioning measured
 * from the trigger: the config card's content area is
 * overflow-hidden and the canvas world is transformed, so an
 * in-flow absolute menu would be clipped or misplaced. It flips
 * above the trigger when there is not enough room below, and
 * closes on any outside pointer-down, on Escape, and on window
 * resize (its measured position would go stale). It deliberately
 * does NOT close on scroll: the detail panel scrolls itself
 * (opening scroll-into-view, internal overflow), and a scroll
 * closing would eat the user's click on an option; canvas pan /
 * zoom gestures start with a pointer-down, which already closes
 * the menu as an outside press.
 *
 * Portal safety (fix for 「选项点了选不中」): the menu lives in
 * <body>, outside every [data-ui] subtree, so the canvas root's
 * pointer-down handler — which React delivers portal events to
 * through the React tree — must never mistake a menu press for a
 * canvas-background press (that started a pan gesture whose
 * pointer-up cleared the selection and unmounted the panel before
 * the option's click could land). Two independent guards: the
 * menu root carries data-ui (the canvas exempts presses by DOM
 * ancestry) and it always stops pointer-down propagation, not
 * only in the config-card usage that passes stopPointerDown.
 */
export function RatioSelect({
  value,
  onChange,
  showSize = false,
  compact = false,
  stopPointerDown = false,
}: {
  value: string;
  onChange: (ratio: string) => void;
  /** Image mode: each option also names its measured pixel size. */
  showSize?: boolean;
  /** Smaller metrics for the config node's on-card row. */
  compact?: boolean;
  /** Config-card usage: keep pointer-downs from starting a node drag. */
  stopPointerDown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number | undefined;
    bottom: number | undefined;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const itemH = compact ? 28 : 32;
  const menuH = IMAGE_RATIOS.length * itemH + 8;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
    };
  }, [open ]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.max(rect.width, compact ? 148 : 176);
    const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
    const flipUp =
      rect.bottom + 4 + menuH > window.innerHeight - 8 &&
      rect.top - 4 - menuH > 8;
    setMenuPos({
      left,
      top: flipUp ? undefined : rect.bottom + 4,
      bottom: flipUp ? window.innerHeight - rect.top + 4 : undefined,
      width,
    });
    setOpen(true);
  };

  const stopProps = stopPointerDown
    ? {
        onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
      }
    : {};

  return (
    <span ref={rootRef} className="relative inline-flex" {...stopProps}>
      <button
        type="button"
        onClick={toggle}
        className={`flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] font-medium text-[var(--text)] hover:border-[var(--accent)] ${
          compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1.5 text-xs"
        }`}
        aria-label={`画面比例，当前 ${value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value}
        <IconChevronDown size={compact ? 11 : 12} className="text-[var(--dim)]" />
      </button>
      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              data-ui
              role="listbox"
              aria-label="画面比例"
              className="fixed z-[200] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-[var(--shadow)]"
              style={{
                left: menuPos.left,
                top: menuPos.top,
                bottom: menuPos.bottom,
                width: menuPos.width,
              }}
              onPointerDown={(e: ReactPointerEvent) => e.stopPropagation()}
            >
              {IMAGE_RATIOS.map((r) => {
                const active = r.ratio === value;
                return (
                  <button
                    key={r.ratio}
                    type="button"
                    role="option"
                    aria-selected={active}
                    aria-label={`比例 ${r.ratio}${showSize ? `，${r.size} 像素` : ""}`}
                    onClick={() => {
                      onChange(r.ratio);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 text-left ${
                      compact ? "py-1 text-[11px]" : "py-1.5 text-xs"
                    } ${
                      active
                        ? "bg-[var(--accent-soft)] font-medium text-[var(--text)]"
                        : "text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="shrink-0">{r.ratio}</span>
                    {showSize ? (
                      <span className="min-w-0 flex-1 truncate text-right opacity-75">
                        {r.size}
                      </span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {active ? (
                      <IconCheck size={13} className="shrink-0 text-[var(--accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
