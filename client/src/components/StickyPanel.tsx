// Detail-editor panel for the sticky-note node, shown under the
// selected node like the text node's editor. Editing writes through
// onPatch → updateNode → saveGraph, so everything persists
// server-side.

import {
  STICKY_COLORS,
  STICKY_DEFAULT_COLOR,
  type CanvasNode,
} from "../types";

export function StickyPanel({
  node,
  onPatch,
}: {
  node: CanvasNode;
  onPatch: (patch: Partial<CanvasNode>) => void;
}) {
  const color = node.color ?? STICKY_DEFAULT_COLOR;
  return (
    <div>
      <textarea
        value={node.content}
        onChange={(e) => onPatch({ content: e.target.value })}
        aria-label="便签文字"
        placeholder="写点什么…"
        rows={3}
        className="mt-2 w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm leading-6 outline-none"
        style={{ background: color, color: "#1c1917" }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="便签颜色">
        {STICKY_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPatch({ color: c })}
            aria-label={`便签颜色 ${c}`}
            aria-pressed={color === c}
            className="h-6 w-6 rounded-full border-2"
            style={{
              background: c,
              borderColor: color === c ? "var(--accent)" : "rgba(0,0,0,0.25)",
            }}
          />
        ))}
        <label className="flex items-center gap-1 text-xs text-[var(--dim)]">
          自定义
          <input
            type="color"
            value={color}
            onChange={(e) => onPatch({ color: e.target.value })}
            aria-label="自定义便签颜色"
            className="h-6 w-8 cursor-pointer rounded border border-[var(--border)] bg-transparent p-0"
          />
        </label>
      </div>
    </div>
  );
}
