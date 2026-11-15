import {
IconGroup,
IconUngroup,
} from "../icons";
import { ToolbarAction } from "./HoverToolbar";

// ---------------------------------------------------------------------------
// Multi-selection toolbar (upstream canvas-selection-toolbar.tsx)

export function SelectionToolbar({
  bounds,
  viewport,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
}: {
  bounds: { left: number; top: number; right: number; bottom: number };
  viewport: { x: number; y: number; zoom: number };
  canGroup: boolean;
  canUngroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
}) {
  if (!canGroup && !canUngroup) return null;
  const pad = 14;
  const left = viewport.x + bounds.left * viewport.zoom - pad;
  const top = viewport.y + bounds.top * viewport.zoom - pad;
  const width = (bounds.right - bounds.left) * viewport.zoom + pad * 2;
  return (
    <div
      data-ui
      className="capsule-chrome absolute z-[70] flex h-11 -translate-x-1/2 -translate-y-full items-center rounded-full px-1.5 text-[var(--text)]"
      style={{ left: left + width / 2, top: top - 8 }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label="多选工具条"
    >
      {canGroup ? (
        <ToolbarAction
          id="group"
          title="把所选节点打成一组"
          label="打组"
          icon={<IconGroup size={16} />}
          onClick={onGroup}
          showLabel
        />
      ) : null}
      {canUngroup ? (
        <ToolbarAction
          id="ungroup"
          title="解散所选分组"
          label="解散组"
          icon={<IconUngroup size={16} />}
          onClick={onUngroup}
          showLabel
        />
      ) : null}
    </div>
  );
}
