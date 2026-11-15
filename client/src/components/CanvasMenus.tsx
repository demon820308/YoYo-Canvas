// Right-click menus, ported from the upstream canvas per source spec:
// - canvas-context-menu.tsx: node menu (duplicate / group / ungroup / delete;
//   the video-frame items only exist for video nodes with real media, which
//   this stage does not have, so they never render) and the connection menu
//   (delete only).
// - canvas-create-menus.tsx: NodeCreateMenu (blank-canvas create) and
//   ConnectionCreateMenu (create-and-connect after dropping a wire on empty
//   canvas). Menus close on any outside pointerdown and never let their own
//   pointer events reach the canvas.

import { useEffect, useRef, type ReactNode } from "react";
import {
NODE_TYPE_ICON,
IconCopy,
IconGroup,
IconLink,
IconTrash,
IconUngroup,
IconX,
} from "../icons";
import {
NODE_TYPE_LABEL,
type NodeType,
type ToolNodeType,
} from "../types";

function clampPosition(x: number, y: number, w: number, h: number) {
  const maxX = Math.max(8, window.innerWidth - w - 8);
  const maxY = Math.max(8, window.innerHeight - h - 8);
  return { left: Math.min(Math.max(8, x), maxX), top: Math.min(Math.max(8, y), maxY) };
}

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && ref.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [onClose]);
  return ref;
}

function MenuShell({
  x,
  y,
  estHeight,
  onClose,
  children,
  label,
  width = 240,
}: {
  x: number;
  y: number;
  estHeight: number;
  onClose: () => void;
  children: ReactNode;
  label: string;
  /** Menu width in px; create menus pass a narrower width. */
  width?: number;
}) {
  const ref = useOutsideClose(onClose);
  const pos = clampPosition(x, y, width + 8, estHeight);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-canvas-menu
      className="fixed z-[120] max-w-[86vw] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)] shadow-[var(--shadow)]"
      style={{ left: pos.left, top: pos.top, width }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="hit-40 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--hover)]"
      style={{ color: danger ? "#f87171" : "var(--text)" }}
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// --------------------------------------------------------------------------
// Node context menu (upstream CanvasNodeContextMenu)

export type NodeMenuState = { nodeId: string; x: number; y: number };

export function NodeContextMenu({
  menu,
  canGroup,
  canUngroup,
  onClose,
  onDuplicate,
  onGroup,
  onUngroup,
  onDelete,
  onTapConnect,
}: {
  menu: NodeMenuState;
  canGroup: boolean;
  canUngroup: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  /** Arm tap-to-connect from this node (the touch-friendly wire:
   * tap a target node next instead of dragging from a handle). */
  onTapConnect?: () => void;
}) {
  const items = 2 + (canGroup ? 1 : 0) + (canUngroup ? 1 : 0) + (onTapConnect ? 1 : 0);
  return (
    <MenuShell
      x={menu.x}
      y={menu.y}
      estHeight={items * 38 + 16}
      onClose={onClose}
      label="节点菜单"
    >
      {onTapConnect ? (
        <MenuItem icon={<IconLink size={15} />} label="点选连线" onClick={onTapConnect} />
      ) : null}
      {canGroup ? (
        <MenuItem icon={<IconGroup size={15} />} label="打组" onClick={onGroup} />
      ) : null}
      {canUngroup ? (
        <MenuItem icon={<IconUngroup size={15} />} label="解散组" onClick={onUngroup} />
      ) : null}
      <MenuItem icon={<IconCopy size={15} />} label="复制" onClick={onDuplicate} />
      <MenuItem icon={<IconTrash size={15} />} label="删除" danger onClick={onDelete} />
    </MenuShell>
  );
}

// --------------------------------------------------------------------------
// Connection context menu (upstream renders the same menu with only delete)

export type ConnectionMenuState = { edgeId: string; x: number; y: number };

export function ConnectionContextMenu({
  menu,
  onClose,
  onDelete,
}: {
  menu: ConnectionMenuState;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <MenuShell x={menu.x} y={menu.y} estHeight={54} onClose={onClose} label="连线菜单">
      <MenuItem icon={<IconTrash size={15} />} label="删除" danger onClick={onDelete} />
    </MenuShell>
  );
}

// --------------------------------------------------------------------------
// Create menus (upstream canvas-create-menus.tsx)

// Create rows carry ONLY a small icon (about text height, no tile
// background) and the node name — no description subtitles (user
// correction: the small explanatory text under each name goes away).
function CreateOption({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="hit-40 flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-[var(--hover)]"
    >
      <span className="grid shrink-0 place-items-center text-[var(--dim)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5">{title}</span>
    </button>
  );
}

function CreateMenuHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-1.5 flex items-center justify-between px-1">
      <span className="text-sm font-medium text-[var(--dim)]">{title}</span>
      <button
        type="button"
        className="grid h-7 w-7 place-items-center rounded-lg opacity-60 transition hover:bg-[var(--hover-strong)] hover:opacity-100"
        onClick={onClose}
        aria-label="关闭菜单"
      >
        <IconX size={15} />
      </button>
    </div>
  );
}

const CREATE_ORDER: NodeType[] = [
  "text",
  "image",
  "video",
  "audio",
  "config",
  "group",
];

/** The four tool nodes, offered as their own group in the create menu. */
const TOOL_CREATE_TYPES: ToolNodeType[] = [
  "video-frames",
  "audio-extract",
  "video-compose",
  "prompt-reverse",
];

export function NodeCreateMenu({
  x,
  y,
  onCreate,
  onClose,
}: {
  x: number;
  y: number;
  onCreate: (type: NodeType) => void;
  onClose: () => void;
}) {
  const StickyIcon = NODE_TYPE_ICON["sticky-note"] ?? IconGroup;
  return (
    <MenuShell x={x} y={y} estHeight={460} onClose={onClose} label="选择节点" width={192}>
      <CreateMenuHeader title="选择节点" onClose={onClose} />
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="grid gap-0.5">
          {CREATE_ORDER.map((type) => {
            const Icon = NODE_TYPE_ICON[type] ?? IconGroup;
            return (
              <CreateOption
                key={type}
                icon={<Icon size={15} />}
                title={NODE_TYPE_LABEL[type]}
                onClick={() => onCreate(type)}
              />
            );
          })}
        </div>
        <p className="px-2 pb-1 pt-3 text-xs font-medium text-[var(--dim)]">
          工具
        </p>
        <div className="grid gap-0.5">
          {TOOL_CREATE_TYPES.map((type) => {
            const Icon = NODE_TYPE_ICON[type] ?? IconGroup;
            return (
              <CreateOption
                key={type}
                icon={<Icon size={15} />}
                title={NODE_TYPE_LABEL[type]}
                onClick={() => onCreate(type)}
              />
            );
          })}
          {/* The sticky note sits below the tools, at the very end
           * of the menu (user-set order). */}
          <CreateOption
            icon={<StickyIcon size={15} />}
            title={NODE_TYPE_LABEL["sticky-note"]}
            onClick={() => onCreate("sticky-note")}
          />
        </div>
      </div>
    </MenuShell>
  );
}

/** Types offered after dropping a wire on empty canvas: the five
 * generation entries plus the four extension tool nodes. */
export type ConnectCreateType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "config"
  | ToolNodeType;

const CONNECT_OPTIONS: { type: ConnectCreateType; title: string }[] = [
  { type: "text", title: "文本生成" },
  { type: "image", title: "图片生成" },
  { type: "video", title: "视频生成" },
  { type: "audio", title: "音频参考" },
  { type: "config", title: "配置节点" },
];

export function ConnectionCreateMenu({
  x,
  y,
  onCreate,
  onClose,
}: {
  x: number;
  y: number;
  onCreate: (type: ConnectCreateType) => void;
  onClose: () => void;
}) {
  return (
    <MenuShell x={x} y={y} estHeight={420} onClose={onClose} label="引用该节点生成" width={192}>
      <CreateMenuHeader title="引用该节点生成" onClose={onClose} />
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="grid gap-0.5">
          {CONNECT_OPTIONS.map((opt) => {
            const Icon = NODE_TYPE_ICON[opt.type] ?? IconGroup;
            return (
              <CreateOption
                key={opt.type}
                icon={<Icon size={15} />}
                title={opt.title}
                onClick={() => onCreate(opt.type)}
              />
            );
          })}
        </div>
        <p className="px-2 pb-1 pt-3 text-xs font-medium text-[var(--dim)]">
          工具
        </p>
        <div className="grid gap-0.5">
          {TOOL_CREATE_TYPES.map((type) => {
            const Icon = NODE_TYPE_ICON[type] ?? IconGroup;
            return (
              <CreateOption
                key={type}
                icon={<Icon size={15} />}
                title={NODE_TYPE_LABEL[type]}
                onClick={() => onCreate(type)}
              />
            );
          })}
        </div>
      </div>
    </MenuShell>
  );
}
