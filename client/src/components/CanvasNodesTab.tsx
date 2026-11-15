// The side panel's 画布 tab: node list / grid, search, type filter,
// group tree, batch export, per-node visibility (eye) switch.
// NodeThumb renders a node's thumbnail — real media when the node
// carries it — and is shared with AssetsTab's node picker.

import { useMemo, useState } from "react";
import {
  IMAGE_PLACEHOLDER_BG,
  NODE_TYPE_LABEL,
  STATUS_COLOR,
  type CanvasNode,
  type NodeType,
} from "../types";
import {
  isMediaUrl,
  nodeListLabel,
  nodePreviewText,
} from "../node-utils";
import {
  NODE_TYPE_ICON,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconGrid,
  IconImage,
  IconList,
  IconPencil,
  IconPlay,
  IconSearch,
} from "../icons";
import type { SidePanelProps } from "./SidePanel";

// ---------------------------------------------------------------------------
// 画布 tab: node list / grid, search, type filter, group tree, batch export,
// per-node visibility (eye) switch.
// ---------------------------------------------------------------------------

// Only the six basic kinds are offered as filters (per the user's
// call: the group / tool / doc-type filter chips are not shown).
const TYPE_FILTERS: Array<{ value: NodeType | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "text", label: "文本" },
  { value: "audio", label: "音频" },
  { value: "config", label: "配置" },
];

export function NodeThumb({ node, size = 40 }: { node: CanvasNode; size?: number }) {
  const Icon = NODE_TYPE_ICON[node.type] ?? IconFileText;
  // Real media first: an image shows the image itself, a video shows
  // its poster (or its first frame via the media file) — never a
  // generic icon when the node actually carries media.
  const mediaSrc =
    node.mediaUrl ?? (isMediaUrl(node.content) ? node.content : null);
  if (node.type === "image" && mediaSrc) {
    return (
      <img
        src={mediaSrc}
        alt=""
        className="shrink-0 rounded-[7px] border border-[var(--border)] object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  if (node.type === "video" && node.posterUrl) {
    return (
      <span
        className="relative block shrink-0 overflow-hidden rounded-[7px] border border-[var(--border)]"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img src={node.posterUrl} alt="" className="h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center text-white/90">
          <IconPlay size={Math.round(size * 0.34)} />
        </span>
      </span>
    );
  }
  if (node.type === "video" && mediaSrc) {
    return (
      <span
        className="relative block shrink-0 overflow-hidden rounded-[7px] border border-[var(--border)] bg-black"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <video
          src={mediaSrc}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center text-white/90">
          <IconPlay size={Math.round(size * 0.34)} />
        </span>
      </span>
    );
  }
  if (node.type === "image") {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-[7px] text-white/85"
        style={{
          width: size,
          height: size,
          background: node.color ?? IMAGE_PLACEHOLDER_BG,
        }}
        aria-hidden="true"
      >
        <IconImage size={Math.round(size * 0.45)} />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center text-[var(--dim)]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}

export function CanvasNodesTab(props: SidePanelProps) {
  const { nodes, selectedNodeIds } = props;
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<NodeType | "all">("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const startRename = (node: CanvasNode) => {
    setEditingId(node.id);
    setEditTitle(node.title);
  };
  const commitRename = (node: CanvasNode) => {
    const title = editTitle.trim();
    setEditingId(null);
    if (title && title !== node.title) props.onRenameNode(node.id, title);
  };

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return nodes.filter(
      (node) =>
        (typeFilter === "all" || node.type === typeFilter) &&
        (!query ||
          [node.title, node.content, node.prompt]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
  }, [nodes, keyword, typeFilter]);

  const treeRows = useMemo(() => {
    const filteredIds = new Set(filtered.map((n) => n.id));
    const groupIds = new Set(
      nodes.filter((n) => n.type === "group").map((n) => n.id),
    );
    const children = new Map<string, CanvasNode[]>();
    filtered.forEach((node) => {
      if (node.groupId && groupIds.has(node.groupId)) {
        children.set(node.groupId, [...(children.get(node.groupId) ?? []), node]);
      }
    });
    return nodes.flatMap((node) => {
      if (node.groupId && groupIds.has(node.groupId)) return [];
      if (node.type !== "group") {
        return filteredIds.has(node.id)
          ? [{ node, depth: 0, hasChildren: false }]
          : [];
      }
      const groupChildren = children.get(node.id) ?? [];
      if (!filteredIds.has(node.id) && !groupChildren.length) return [];
      return [
        { node, depth: 0, hasChildren: groupChildren.length > 0 },
        ...(collapsedGroups.has(node.id)
          ? []
          : groupChildren.map((child) => ({
              node: child,
              depth: 1,
              hasChildren: false,
            }))),
      ];
    });
  }, [collapsedGroups, filtered, nodes]);

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked =
    filtered.length > 0 && filtered.every((n) => checked.has(n.id));
  const toggleAll = () =>
    setChecked(allChecked ? new Set() : new Set(filtered.map((n) => n.id)));
  const exitSelect = () => {
    setSelectMode(false);
    setChecked(new Set());
  };

  const handleExport = () => {
    const targets = nodes.filter((n) => checked.has(n.id));
    if (!targets.length) return;
    const payload = {
      app: "YoYo画布",
      kind: "node-export",
      exportedAt: new Date().toISOString(),
      note: "探针阶段导出仅包含所选节点的完整数据（标题/内容/位置/状态/显隐等），不打包媒体字节；媒体内容字段为占位色或引用文本。",
      nodes: targets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yoyo-canvas-nodes-${targets.length}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExportNote(`已导出 ${targets.length} 个节点的 JSON（不含媒体字节）`);
    exitSelect();
  };

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (
    node: CanvasNode,
    depth: number,
    hasChildren: boolean,
  ) => {
    const preview = nodePreviewText(node);
    const isSelected = selectedNodeIds.has(node.id);
    const isChecked = checked.has(node.id);
    return (
      <div
        key={node.id}
        role="button"
        tabIndex={0}
        aria-label={`节点 ${node.title}`}
        aria-pressed={isSelected}
        className="group flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover)]"
        style={{
          marginLeft: depth * 16,
          opacity: node.hidden ? 0.45 : 1,
          background: isSelected ? "var(--surface-2)" : undefined,
          borderColor: isSelected ? "var(--border)" : "transparent",
        }}
        onClick={() => {
          if (selectMode) toggleChecked(node.id);
          else props.onFocusNode(node.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (selectMode) toggleChecked(node.id);
            else props.onFocusNode(node.id);
          }
        }}
        onMouseEnter={() => props.onHoverNode(node.id)}
        onMouseLeave={() => props.onHoverNode(null)}
      >
        {selectMode ? (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
            style={{
              borderColor: isChecked ? "var(--accent)" : "var(--border)",
              background: isChecked ? "var(--accent)" : "transparent",
              color: "var(--accent-ink)",
            }}
            aria-hidden="true"
          >
            {isChecked ? <IconCheck size={12} /> : null}
          </span>
        ) : hasChildren ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--dim)]"
            aria-label={collapsedGroups.has(node.id) ? `展开分组 ${node.title}` : `折叠分组 ${node.title}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroup(node.id);
            }}
          >
            {collapsedGroups.has(node.id) ? (
              <IconChevronRight size={14} />
            ) : (
              <IconChevronDown size={14} />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <NodeThumb node={node} />
        <span className="min-w-0 flex-1">
          {editingId === node.id ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(node);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => commitRename(node)}
              autoFocus
              aria-label={`重命名节点 ${node.title}`}
              className="w-full rounded border border-[var(--accent)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px] font-medium outline-none"
            />
          ) : (
            <span
              className="block truncate text-[13px] font-medium leading-5"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startRename(node);
              }}
              title={`${node.title}（双击改名）`}
            >
              {nodeListLabel(node)}
            </span>
          )}
          {/* Second row: preview text takes the line, and the status
           * dot + the row's two icon buttons sit tight together at
           * its right end so the title row above stays fully free
           * for the name. */}
          <span className="flex items-center gap-0.5">
            <span className="min-w-0 flex-1 truncate text-xs leading-4 text-[var(--dim)]">
              {preview || NODE_TYPE_LABEL[node.type]}
            </span>
            <span
              className="mr-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: STATUS_COLOR[node.status],
                border: node.status === "idle" ? "1px solid var(--border)" : undefined,
              }}
              title={`状态：${node.status}`}
              aria-hidden="true"
            />
            {!selectMode && editingId !== node.id ? (
              <button
                type="button"
                className="hit-40 flex h-8 w-7 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--text)]"
                aria-label={`重命名 ${node.title}`}
                title="重命名"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(node);
                }}
              >
                <IconPencil size={14} />
              </button>
            ) : null}
            {!selectMode ? (
              <button
                type="button"
                className="hit-40 flex h-8 w-7 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--text)]"
                aria-label={`预览 ${node.title}`}
                title="预览"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onPreviewNode(node);
                }}
              >
                {node.hidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            ) : null}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-3 pb-2">
        <label className="relative block">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]">
            <IconSearch size={14} />
          </span>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索节点标题或内容"
            aria-label="搜索节点"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-8 pr-2 text-[13px] outline-none placeholder:text-[var(--dim)] focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="节点类型过滤">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={typeFilter === f.value}
              onClick={() => setTypeFilter(f.value)}
              className="rounded-full px-2 py-1 text-xs"
              style={{
                background:
                  typeFilter === f.value
                    ? "rgba(var(--accent-rgb),0.16)"
                    : "transparent",
                color:
                  typeFilter === f.value ? "var(--accent)" : "var(--dim)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
            aria-label="列表视图"
          >
            <IconList size={14} /> 列表
          </button>
          <button
            type="button"
            aria-pressed={viewMode === "grid"}
            onClick={() => setViewMode("grid")}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
            aria-label="网格视图"
          >
            <IconGrid size={14} /> 网格
          </button>
          <span className="flex-1" />
          {selectMode ? (
            <button
              type="button"
              onClick={exitSelect}
              className="rounded px-2 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
            >
              取消选择
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="rounded px-2 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
            >
              选择
            </button>
          )}
        </div>
        {selectMode ? (
          <div className="flex items-center gap-2 rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                aria-label="全选当前过滤结果"
                className="h-4 w-4 accent-(--accent)"
              />
              全选
            </label>
            <span className="text-[var(--dim)]">已选 {checked.size} 个</span>
            <span className="flex-1" />
            <button
              type="button"
              disabled={checked.size === 0}
              onClick={handleExport}
              className="flex items-center gap-1 rounded bg-[var(--accent)] px-2 py-1 font-medium text-[var(--accent-ink)] disabled:opacity-40"
              aria-label="导出所选节点"
            >
              <IconDownload size={13} /> 导出 JSON
            </button>
          </div>
        ) : null}
        {exportNote ? (
          <p className="text-xs text-[var(--accent)]" role="status">
            {exportNote}
          </p>
        ) : null}
        <p className="text-[11px] leading-4 text-[var(--dim)]">
          这里导出仅含节点数据，不打包媒体字节。
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {treeRows.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-[var(--dim)]">
            {nodes.length === 0
              ? "画布上还没有节点，用底部工具条新建一个。"
              : "没有匹配的节点。"}
          </p>
        ) : viewMode === "list" ? (
          treeRows.map((row) => renderRow(row.node, row.depth, row.hasChildren))
        ) : (
          <div className="grid grid-cols-2 gap-2 px-1 pt-1">
            {filtered.map((node) => (
              <button
                key={node.id}
                type="button"
                aria-label={`节点 ${node.title}`}
                className="overflow-hidden rounded-md border border-[var(--border)] text-left"
                style={{
                  opacity: node.hidden ? 0.45 : 1,
                  borderColor: selectedNodeIds.has(node.id)
                    ? "var(--accent)"
                    : undefined,
                }}
                onClick={() => {
                  if (selectMode) toggleChecked(node.id);
                  else props.onFocusNode(node.id);
                }}
                onMouseEnter={() => props.onHoverNode(node.id)}
                onMouseLeave={() => props.onHoverNode(null)}
              >
                <span className="flex h-16 items-center justify-center bg-[var(--surface-2)]">
                  <NodeThumb node={node} size={44} />
                </span>
                <span className="flex items-center gap-1.5 px-2 py-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: STATUS_COLOR[node.status] }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-medium">
                    {nodeListLabel(node)}
                  </span>
                  {selectMode && checked.has(node.id) ? (
                    <IconCheck size={13} className="ml-auto shrink-0 text-[var(--accent)]" />
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
