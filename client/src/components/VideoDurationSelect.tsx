import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { VIDEO_SECONDS_MAX, VIDEO_SECONDS_MIN } from "../types";

/**
 * The one video-duration control used everywhere a video length is
 * chosen (generation panel inline row, config-node card, config params
 * popover): a single seconds number input with a 「秒」 unit — no
 * preset dropdown. The input echoes the node's stored seconds
 * (including legacy values like the retired 4s, which stay untouched
 * until the user types a new one). Committing accepts any integer
 * from 1 to 30 — values above 30 clamp to 30; invalid input (empty,
 * non-numeric, below 1) changes nothing and the input reverts to the
 * stored value.
 */
export function VideoDurationSelect({
  value,
  onChange,
  inputClassName,
  stopPointerDown = false,
}: {
  value: number;
  onChange: (seconds: number) => void;
  inputClassName?: string;
  stopPointerDown?: boolean;
}) {
  // null = not editing, input shows the stored value; a string is the
  // in-flight draft so typing is never clobbered by re-renders.
  const [draft, setDraft] = useState<string | null>(null);
  const stopProps = stopPointerDown
    ? {
        onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
      }
    : {};
  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (!Number.isFinite(parsed) || parsed < VIDEO_SECONDS_MIN) return;
    onChange(Math.min(VIDEO_SECONDS_MAX, parsed));
  };
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={VIDEO_SECONDS_MIN}
        max={VIDEO_SECONDS_MAX}
        step={1}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          }
        }}
        aria-label="视频时长（秒）"
        title={`可输入 ${VIDEO_SECONDS_MIN}–${VIDEO_SECONDS_MAX} 的整数秒，超出按 ${VIDEO_SECONDS_MAX} 秒算`}
        className={inputClassName}
        {...stopProps}
      />
      <span aria-hidden="true">秒</span>
    </span>
  );
}
