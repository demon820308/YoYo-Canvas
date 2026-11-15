// Bottom-center canvas toolbar, ported from the upstream
// canvas-toolbar.tsx: tool toggle (select/pan), undo/redo, focus
// selected, the six basic node adds, the extensions puzzle popup
// (the four tool nodes), upload, the appearance popup (theme mode,
// background style, media-info badge), a delete button that only
// exists while something is selected, and clear-canvas. Styling uses
// this artifact's capsule tokens instead of the upstream theme.

import {
useEffect,
useRef,
useState,
type MouseEvent as ReactMouseEvent,
type ReactNode,
} from "react";
import {
NODE_TYPE_ICON,
IconConfig,
IconEraser,
IconGroup,
IconHand,
IconImage,
IconListChecks,
IconLocate,
IconMoon,
IconMusic,
IconPalette,
IconPointer,
IconPuzzle,
IconRedo,
IconSun,
IconTrash,
IconType,
IconUndo,
IconUpload,
IconVideo,
} from "../icons";
import type { NodeType, ToolNodeType } from "../types";

export type CanvasTool = "pan" | "select";
export type ThemeMode = "system" | "light" | "dark";
export type BackgroundMode = "dots" | "lines" | "blank";

/** Popup entries: the four tool nodes plus the sticky note. */
export type ExtensionEntry = {
  type: ToolNodeType | "sticky-note";
  label: string;
};

function clampPanelX(x: number, rootWidth: number, panelWidth: number) {
  const half = panelWidth / 2 + 4;
  return Math.min(Math.max(x, half), Math.max(half, rootWidth - half));
}

export function CanvasToolbar({
  tool,
  multiSelect,
  canUndo,
  canRedo,
  hasSelection,
  disabled,
  extensionTypes,
  themeMode,
  backgroundMode,
  showMediaInfo,
  onToolChange,
  onToggleMultiSelect,
  onUndo,
  onRedo,
  onFocusSelected,
  onAddNode,
  onUpload,
  onDeleteSelected,
  onClear,
  onThemeModeChange,
  onBackgroundModeChange,
  onShowMediaInfoChange,
}: {
  tool: CanvasTool;
  /** Touch-friendly multi-select mode: taps toggle node selection,
   * a selected node drags the whole selection. Desktop Ctrl-click
   * and box selection exist independently of this mode. */
  multiSelect: boolean;
  onToggleMultiSelect: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  disabled: boolean;
  extensionTypes: ExtensionEntry[];
  themeMode: ThemeMode;
  backgroundMode: BackgroundMode;
  showMediaInfo: boolean;
  onToolChange: (tool: CanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFocusSelected: () => void;
  onAddNode: (type: NodeType) => void;
  onUpload: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  onBackgroundModeChange: (mode: BackgroundMode) => void;
  onShowMediaInfoChange: (show: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tipX, setTipX] = useState(0);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extPanelX, setExtPanelX] = useState(0);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appPanelX, setAppPanelX] = useState(0);

  // Close the popups on any pointerdown outside the toolbar root.
  useEffect(() => {
    if (!extensionsOpen && !appearanceOpen) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setExtensionsOpen(false);
      setAppearanceOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [extensionsOpen, appearanceOpen]);

  const anchorX = (event: ReactMouseEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (!root) return 0;
    const rootBox = root.getBoundingClientRect();
    const box = event.currentTarget.getBoundingClientRect();
    return box.left - rootBox.left + box.width / 2;
  };

  const tipFor = (id: string | null): string => {
    switch (id) {
      case "tool-mode":
        return tool === "pan" ? "拖拽工具" : "选择工具";
      case "multi-select":
        return "多选模式";
      case "undo":
        return "撤销";
      case "redo":
        return "重做";
      case "focus":
        return "定位到选中节点";
      case "text":
        return "文本";
      case "image":
        return "图片";
      case "video":
        return "视频";
      case "audio":
        return "音频";
      case "config":
        return "配置";
      case "group":
        return "分组";
      case "extensions":
        return "扩展节点";
      case "upload":
        return "上传媒体";
      case "appearance":
        return "画布外观";
      case "delete":
        return "删除所选";
      case "clear":
        return "清空画布";
      default:
        return "";
    }
  };

  const btn = (
    id: string,
    opts: {
      label: string;
      onClick: (e: ReactMouseEvent<HTMLElement>) => void;
      active?: boolean;
      danger?: boolean;
      isDisabled?: boolean;
      children: ReactNode;
    },
  ) => (
    <button
      key={id}
      type="button"
      aria-label={opts.label}
      title={opts.label}
      disabled={opts.isDisabled}
      onClick={opts.onClick}
      onMouseEnter={(e) => {
        setHovered(id);
        setTipX(anchorX(e));
      }}
      onMouseLeave={() => setHovered(null)}
      className="hit-40 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-35"
      style={{
        color: opts.danger ? "var(--danger)" : "var(--text)",
        background:
          opts.active || hovered === id ? "var(--hover-strong)" : "transparent",
      }}
    >
      {opts.children}
    </button>
  );

  const divider = (key: string) => (
    <span key={key} className="mx-1 h-6 w-px shrink-0 bg-[var(--border)]" />
  );

  const addBtn = (type: NodeType, label: string, icon: ReactNode) =>
    btn(type, {
      label: `添加${label}节点`,
      isDisabled: disabled,
      onClick: () => onAddNode(type),
      children: icon,
    });

  return (
    <div
      ref={rootRef}
      data-ui
      data-canvas-no-zoom
      className="safe-bottom-offset absolute left-1/2 z-40 -translate-x-1/2"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative">
        {hovered && tipFor(hovered) ? (
          <span
            className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text)] px-2 py-1 text-xs text-[var(--bg)] shadow-lg"
            style={{ left: tipX }}
            aria-hidden="true"
          >
            {tipFor(hovered)}
          </span>
        ) : null}
        <div
          className="capsule-chrome flex max-w-[calc(100vw-16px)] flex-nowrap items-center gap-0.5 overflow-x-auto rounded-2xl px-2 py-2"
          role="toolbar"
          aria-label="画布工具条"
        >
          {btn("tool-mode", {
            label: tool === "pan" ? "拖拽工具（点击切换为选择工具）" : "选择工具（点击切换为拖拽工具）",
            active: true,
            onClick: () => onToolChange(tool === "pan" ? "select" : "pan"),
            children: tool === "pan" ? <IconHand size={17} /> : <IconPointer size={17} />,
          })}
          {btn("multi-select", {
            label: multiSelect ? "多选模式（已开启，点击退出）" : "多选模式",
            active: multiSelect,
            onClick: onToggleMultiSelect,
            children: <IconListChecks size={17} />,
          })}
          {btn("undo", {
            label: "撤销",
            isDisabled: !canUndo,
            onClick: onUndo,
            children: <IconUndo size={17} />,
          })}
          {btn("redo", {
            label: "重做",
            isDisabled: !canRedo,
            onClick: onRedo,
            children: <IconRedo size={17} />,
          })}
          {btn("focus", {
            label: "定位到选中节点",
            isDisabled: !hasSelection,
            onClick: onFocusSelected,
            children: <IconLocate size={17} />,
          })}
          {divider("d1")}
          {addBtn("text", "文本", <IconType size={17} />)}
          {addBtn("image", "图片", <IconImage size={17} />)}
          {addBtn("video", "视频", <IconVideo size={17} />)}
          {addBtn("audio", "音频", <IconMusic size={17} />)}
          {addBtn("config", "配置", <IconConfig size={17} />)}
          {addBtn("group", "分组", <IconGroup size={17} />)}
          {extensionTypes.length
            ? btn("extensions", {
                label: "扩展节点",
                active: extensionsOpen,
                isDisabled: disabled,
                onClick: (e) => {
                  setExtPanelX(clampPanelX(anchorX(e), rootRef.current?.offsetWidth ?? 0, 240));
                  setAppearanceOpen(false);
                  setExtensionsOpen((v) => !v);
                },
                children: <IconPuzzle size={17} />,
              })
            : null}
          {btn("upload", {
            label: "上传媒体文件到画布",
            isDisabled: disabled,
            onClick: onUpload,
            children: <IconUpload size={17} />,
          })}
          {divider("d2")}
          {btn("appearance", {
            label: "画布外观",
            active: appearanceOpen,
            onClick: (e) => {
              setAppPanelX(clampPanelX(anchorX(e), rootRef.current?.offsetWidth ?? 0, 248));
              setExtensionsOpen(false);
              setAppearanceOpen((v) => !v);
            },
            children: <IconPalette size={17} />,
          })}
          {hasSelection ? (
            <>
              {divider("d3")}
              {btn("delete", {
                label: "删除所选",
                danger: true,
                onClick: onDeleteSelected,
                children: <IconTrash size={17} />,
              })}
            </>
          ) : null}
          {divider("d4")}
          {btn("clear", {
            label: "清空画布",
            danger: true,
            isDisabled: disabled,
            onClick: onClear,
            children: <IconEraser size={17} />,
          })}
        </div>

        {extensionsOpen && extensionTypes.length ? (
          <div
            className="capsule-chrome absolute bottom-[calc(100%+10px)] z-30 w-60 -translate-x-1/2 rounded-xl p-2"
            style={{ left: extPanelX }}
            role="menu"
            aria-label="扩展节点"
          >
            <p className="px-1.5 pb-1.5 text-[11px] font-medium text-[var(--dim)]">
              扩展节点
            </p>
            <div className="grid gap-0.5">
              {extensionTypes.map((entry) => {
                const Icon = NODE_TYPE_ICON[entry.type] ?? IconPuzzle;
                return (
                  <button
                    key={entry.type}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-[var(--text)] transition-colors hover:bg-[var(--hover)]"
                    onClick={() => {
                      onAddNode(entry.type);
                      setExtensionsOpen(false);
                    }}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--surface-3)] text-[var(--dim)]">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {appearanceOpen ? (
          <div
            className="capsule-chrome absolute bottom-[calc(100%+10px)] z-30 w-[248px] -translate-x-1/2 rounded-xl p-2.5"
            style={{ left: appPanelX }}
            role="dialog"
            aria-label="画布外观"
          >
            <p className="px-1 pb-2 text-sm font-medium">画布外观</p>
            <p className="px-1 pb-1.5 text-[11px] font-medium text-[var(--dim)]">
              主题模式
            </p>
            <div
              className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--surface-3)] p-1"
              role="group"
              aria-label="主题模式"
            >
              {(
                [
                  { mode: "system" as ThemeMode, label: "跟随系统" },
                  { mode: "light" as ThemeMode, label: "浅色", icon: <IconSun size={14} /> },
                  { mode: "dark" as ThemeMode, label: "深色", icon: <IconMoon size={14} /> },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  aria-pressed={themeMode === opt.mode}
                  onClick={() => onThemeModeChange(opt.mode)}
                  className="flex h-8 items-center justify-center gap-1 rounded-md text-xs transition-colors"
                  style={
                    themeMode === opt.mode
                      ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-node)" }
                      : { color: "var(--dim)" }
                  }
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="px-1 pb-1.5 pt-3 text-[11px] font-medium text-[var(--dim)]">
              背景样式
            </p>
            <div
              className="grid grid-cols-3 gap-1 rounded-lg bg-[var(--surface-3)] p-1"
              role="group"
              aria-label="背景样式"
            >
              {(
                [
                  { mode: "dots" as BackgroundMode, label: "点阵" },
                  { mode: "lines" as BackgroundMode, label: "网格" },
                  { mode: "blank" as BackgroundMode, label: "空白" },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  aria-pressed={backgroundMode === opt.mode}
                  onClick={() => onBackgroundModeChange(opt.mode)}
                  className="flex h-8 items-center justify-center rounded-md text-xs transition-colors"
                  style={
                    backgroundMode === opt.mode
                      ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-node)" }
                      : { color: "var(--dim)" }
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 px-1.5 py-2 pt-3">
              <span className="text-xs text-[var(--text)]">媒体尺寸徽标</span>
              <button
                type="button"
                role="switch"
                aria-checked={showMediaInfo}
                aria-label="媒体尺寸徽标"
                onClick={() => onShowMediaInfoChange(!showMediaInfo)}
                className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                style={{
                  background: showMediaInfo ? "var(--accent)" : "var(--surface-3)",
                }}
              >
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                  style={{ left: showMediaInfo ? 18 : 2 }}
                />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
