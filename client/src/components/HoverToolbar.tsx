// Node hover toolbar, ported from the upstream
// canvas-node-hover-toolbar.tsx + canvas-image-toolbar-tools.tsx
// onto this artifact's theme and actions.
//
// - HoverToolbar: floats above the single selected node, follows
//   the viewport (position computed from world coords x zoom),
//   stops its own pointer events so it never starts a canvas drag.
// - For image nodes WITH media, the visible tools are filtered by
//   the user's quick-tool config (localStorage page preference,
//   upstream semantics — see quick-tools.ts) and a 「更多」
//   settings modal edits that config, including whether text
//   labels show.
// - ToolbarAction is the shared pill button, also used by the
//   multi-selection toolbar (SelectionToolbar.tsx).
import { useEffect, useState, type ReactNode } from "react";
import {
IconBrush,
IconCamera,
IconCopy,
IconDownload,
IconEllipsis,
IconFileText,
IconFolderPlus,
IconGrid,
IconImage,
IconInfo,
IconLock,
IconLockOpen,
IconMaximize,
IconMessage,
IconMinus,
IconMusic,
IconPlus,
IconRefresh,
IconScissors,
IconConfig,
IconSpark,
IconTrash,
IconUngroup,
IconUpload,
IconVideo,
IconX,
IconZoomIn,
} from "../icons";
import type { CanvasNode } from "../types";
import { isTextSourceType } from "../node-utils";
import {
ALL_QUICK_IDS,
IMAGE_TOOL_DEFS,
readQuickToolsConfig,
writeQuickToolsConfig,
type ImageToolId,
type QuickToolId,
type QuickToolsConfig,
} from "./quick-tools";

export type ToolbarHandlers = {
  onInfo: (node: CanvasNode) => void;
  onDelete: (node: CanvasNode) => void;
  onRetry: (node: CanvasNode) => void;
  onSaveAsset: (node: CanvasNode) => void;
  onDownload: (node: CanvasNode) => void;
  onUngroup: (node: CanvasNode) => void;
  onToggleDialog: (node: CanvasNode) => void;
  onGenerateImage: (node: CanvasNode) => void;
  onDecreaseFont: (node: CanvasNode) => void;
  onIncreaseFont: (node: CanvasNode) => void;
  onUpload: (node: CanvasNode) => void;
  onCopyPrompt: (node: CanvasNode) => void;
  onReversePrompt: (node: CanvasNode) => void;
  onToggleFreeResize: (node: CanvasNode) => void;
  onMaskEdit: (node: CanvasNode) => void;
  onCrop: (node: CanvasNode) => void;
  onSplit: (node: CanvasNode) => void;
  onUpscale: (node: CanvasNode) => void;
  onSuperResolve: (node: CanvasNode) => void;
  onAngle: (node: CanvasNode) => void;
  onViewImage: (node: CanvasNode) => void;
};

type Tool = {
  id: string;
  title: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
};

function imageToolIcon(id: ImageToolId, node: CanvasNode): ReactNode {
  switch (id) {
    case "copyPrompt":
      return <IconCopy size={16} />;
    case "reversePrompt":
      return <IconFileText size={16} />;
    case "replace":
      return <IconUpload size={16} />;
    case "resize":
      return node.freeResize ? <IconLockOpen size={16} /> : <IconLock size={16} />;
    case "maskEdit":
      return <IconBrush size={16} />;
    case "crop":
      return <IconScissors size={16} />;
    case "split":
      return <IconGrid size={16} />;
    case "upscale":
      return <IconZoomIn size={16} />;
    case "superResolve":
      return <IconSpark size={16} />;
    case "angle":
      return <IconCamera size={16} />;
    case "view":
      return <IconMaximize size={16} />;
  }
}

function imageToolLabel(id: ImageToolId, node: CanvasNode): string {
  if (id === "resize") return node.freeResize ? "自由尺寸·开" : "自由尺寸";
  return IMAGE_TOOL_DEFS.find((t) => t.id === id)?.label ?? id;
}

function imageToolRun(
  id: ImageToolId,
  node: CanvasNode,
  h: ToolbarHandlers,
): () => void {
  switch (id) {
    case "copyPrompt":
      return () => h.onCopyPrompt(node);
    case "reversePrompt":
      return () => h.onReversePrompt(node);
    case "replace":
      return () => h.onUpload(node);
    case "resize":
      return () => h.onToggleFreeResize(node);
    case "maskEdit":
      return () => h.onMaskEdit(node);
    case "crop":
      return () => h.onCrop(node);
    case "split":
      return () => h.onSplit(node);
    case "upscale":
      return () => h.onUpscale(node);
    case "superResolve":
      return () => h.onSuperResolve(node);
    case "angle":
      return () => h.onAngle(node);
    case "view":
      return () => h.onViewImage(node);
  }
}

export function HoverToolbar({
  node,
  viewport,
  handlers,
}: {
  node: CanvasNode;
  viewport: { x: number; y: number; zoom: number };
  handlers: ToolbarHandlers;
}) {
  const [config, setConfig] = useState<QuickToolsConfig>(() =>
    readQuickToolsConfig(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<QuickToolId[]>(config.ids);
  const [draftLabels, setDraftLabels] = useState(config.showLabels);

  useEffect(() => {
    setSettingsOpen(false);
  }, [node.id]);

  const isImage = node.type === "image";
  const isVideo = node.type === "video";
  const isAudio = node.type === "audio";
  const isText = node.type === "text";
  const isConfig = node.type === "config";
  const isGroup = node.type === "group";
  const hasMedia = Boolean(node.mediaBlobKey);
  const hasImage = isImage && hasMedia;
  const promptText = (node.prompt || "").trim();
  const canRetry = node.genStatus === "failed" || node.status === "error";

  const imageTools: Tool[] = IMAGE_TOOL_DEFS.map((def) => ({
    id: def.id,
    title: imageToolLabel(def.id, node),
    label: imageToolLabel(def.id, node),
    icon: imageToolIcon(def.id, node),
    active: def.id === "resize" ? node.freeResize : undefined,
    onClick: imageToolRun(def.id, node, handlers),
  }));

  const baseTools: Tool[] = [
    ...(promptText
      ? [
          {
            id: "copyPromptBase",
            title: "复制提示词",
            label: "复制提示词",
            icon: <IconCopy size={16} />,
            onClick: () => handlers.onCopyPrompt(node),
          },
        ]
      : []),
    {
      id: "info",
      title: "查看节点详情",
      label: "详情",
      icon: <IconInfo size={16} />,
      onClick: () => handlers.onInfo(node),
    },
    ...(isGroup
      ? [
          {
            id: "ungroup",
            title: "解散这个分组",
            label: "解散组",
            icon: <IconUngroup size={16} />,
            onClick: () => handlers.onUngroup(node),
          },
        ]
      : []),
    {
      id: "delete",
      title: "删除节点",
      label: "删除",
      icon: <IconTrash size={16} />,
      danger: true,
      onClick: () => handlers.onDelete(node),
    },
  ];

  const nodeTools: Tool[] = [
    ...(canRetry
      ? [
          {
            id: "retry",
            title: "重试上次运行",
            label: "重试",
            icon: <IconRefresh size={16} />,
            onClick: () => handlers.onRetry(node),
          },
        ]
      : []),
    ...(hasMedia || isText || (isTextSourceType(node.type) && node.type !== "config")
      ? [
          {
            id: "saveAsset",
            title: "存入资产库",
            label: "存资产",
            icon: <IconFolderPlus size={16} />,
            onClick: () => handlers.onSaveAsset(node),
          },
        ]
      : []),
    ...(hasMedia
      ? [
          {
            id: "download",
            title: isAudio ? "下载音频" : isVideo ? "下载视频" : "下载图片",
            label: "下载",
            icon: <IconDownload size={16} />,
            onClick: () => handlers.onDownload(node),
          },
        ]
      : []),
    ...(isVideo && hasMedia
      ? [
          {
            id: "view",
            title: "放大查看视频（弹窗里可播放）",
            label: "查看大图",
            icon: <IconMaximize size={16} />,
            onClick: () => handlers.onViewImage(node),
          },
        ]
      : []),
    ...(isVideo
      ? [
          {
            id: "edit",
            title: "打开视频节点的生成面板",
            label: "编辑",
            icon: <IconMessage size={16} />,
            onClick: () => handlers.onToggleDialog(node),
          },
        ]
      : []),
    ...(isText
      ? [
          {
            id: "generateImage",
            title: "用这段文本生成图片",
            label: "生成图片",
            icon: <IconImage size={16} />,
            onClick: () => handlers.onGenerateImage(node),
          },
        ]
      : []),
    ...(isConfig
      ? [
          {
            id: "config",
            title: "打开配置面板",
            label: "配置",
            icon: <IconConfig size={16} />,
            onClick: () => handlers.onToggleDialog(node),
          },
        ]
      : []),
    ...(isText
      ? [
          {
            id: "decreaseFont",
            title: "减小字号",
            label: "字号-",
            icon: <IconMinus size={16} />,
            onClick: () => handlers.onDecreaseFont(node),
          },
          {
            id: "increaseFont",
            title: "增大字号",
            label: "字号+",
            icon: <IconPlus size={16} />,
            onClick: () => handlers.onIncreaseFont(node),
          },
        ]
      : []),
    ...(isImage && !hasMedia
      ? [
          {
            id: "uploadImage",
            title: "上传图片",
            label: "上传",
            icon: <IconUpload size={16} />,
            onClick: () => handlers.onUpload(node),
          },
        ]
      : []),
    ...(isVideo
      ? [
          {
            id: "uploadVideo",
            title: hasMedia ? "替换视频" : "上传视频",
            label: hasMedia ? "替换" : "上传",
            icon: <IconVideo size={16} />,
            onClick: () => handlers.onUpload(node),
          },
        ]
      : []),
    ...(isAudio
      ? [
          {
            id: "uploadAudio",
            title: hasMedia ? "替换音频" : "上传音频",
            label: hasMedia ? "替换" : "上传",
            icon: <IconMusic size={16} />,
            onClick: () => handlers.onUpload(node),
          },
        ]
      : []),
    ...(hasImage ? imageTools : []),
  ];

  // Upstream: for image nodes with media, base + node tools are
  // filtered by the quick-tool config (copyPromptBase maps to the
  // copyPrompt quick id); every other node type shows all its tools,
  // plus image quick tools never leak into it.
  const quickSet = new Set<string>(config.ids);
  const tools: Tool[] = hasImage
    ? [...baseTools, ...nodeTools].filter((tool) =>
        quickSet.has(tool.id === "copyPromptBase" ? "copyPrompt" : tool.id),
      )
    : [...baseTools, ...nodeTools];
  const selectableTools: Tool[] = [...baseTools, ...nodeTools].filter(
    (tool) => tool.id !== "retry" && tool.id !== "copyPromptBase",
  );

  const left = viewport.x + (node.x + node.width / 2) * viewport.zoom;
  const top = viewport.y + node.y * viewport.zoom - 14;

  const openSettings = () => {
    setDraftIds(config.ids);
    setDraftLabels(config.showLabels);
    setSettingsOpen(true);
  };
  const saveSettings = () => {
    const next = { ids: draftIds, showLabels: draftLabels };
    setConfig(next);
    writeQuickToolsConfig(next);
    setSettingsOpen(false);
  };
  const toggleDraft = (id: string, visible: boolean) => {
    setDraftIds((current) => {
      const selected = new Set<string>(current);
      if (visible) selected.add(id);
      else selected.delete(id);
      return ALL_QUICK_IDS.filter((qid) => selected.has(qid));
    });
  };

  return (
    <>
      <div
        data-ui
        data-node-toolbar={node.id}
        className="capsule-chrome absolute z-[70] flex h-11 max-w-[94vw] -translate-x-1/2 -translate-y-full items-center overflow-x-auto rounded-full px-1.5 text-[var(--text)]"
        style={{ left, top }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="toolbar"
        aria-label={`节点工具条 ${node.title}`}
      >
        {tools.map((tool) => (
          <ToolbarAction
            key={tool.id}
            {...tool}
            showLabel={hasImage ? config.showLabels : true}
          />
        ))}
        {hasImage ? (
          <ToolbarAction
            id="more"
            title="配置图片工具条"
            label="更多"
            icon={<IconEllipsis size={16} />}
            active={settingsOpen}
            onClick={openSettings}
            showLabel={config.showLabels}
          />
        ) : null}
      </div>
      {settingsOpen ? (
        <div
          data-ui
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="配置图片工具条"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <h3 className="flex-1 text-base font-semibold">配置图片工具条</h3>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
                aria-label="关闭工具条配置"
              >
                <IconX size={16} />
              </button>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--dim)]">
              勾选要常驻在图片节点工具条上的工具；配置只存在本页面偏好里。
            </p>
            <div className="mt-3 flex flex-col gap-1">
              {selectableTools.map((tool) => {
                const checked = draftIds.includes(tool.id as QuickToolId);
                return (
                  <label
                    key={tool.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleDraft(tool.id, e.target.checked)}
                      className="h-4 w-4 accent-(--accent)"
                      aria-label={`工具条显示 ${tool.label}`}
                    />
                    <span className="text-[var(--dim)]">{tool.icon}</span>
                    {tool.label}
                  </label>
                );
              })}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--hover)]">
              <input
                type="checkbox"
                checked={draftLabels}
                onChange={(e) => setDraftLabels(e.target.checked)}
                className="h-4 w-4 accent-(--accent)"
                aria-label="工具条显示文字标签"
              />
              显示文字标签（关掉时只显示图标）
            </label>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={saveSettings}
                className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ToolbarAction({
  title,
  label,
  icon,
  onClick,
  showLabel,
  active = false,
  danger = false,
}: Tool & { showLabel: boolean }) {
  const hasText = showLabel && Boolean(label);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`hit-40 group relative flex h-10 shrink-0 items-center whitespace-nowrap px-0.5 ${
        danger ? "text-[var(--danger)]" : ""
      }`}
    >
      <span
        className={`flex h-8 items-center ${
          hasText ? "gap-1.5 px-2" : "justify-center px-1.5"
        } rounded-full transition group-hover:bg-[var(--hover)] ${active ? "bg-[var(--hover-strong)]" : ""}`}
      >
        {icon}
        {hasText ? <span className="text-xs">{label}</span> : null}
      </span>
    </button>
  );
}
