// Node operation handlers (extracted from App.tsx in batch S5 —
// a verbatim move, no behavior change): node construction and
// every discrete graph mutation the canvas UI performs —
// toolbar / double-click / context-menu / drag-out creation,
// asset insertion, rename + content updates through updateNode,
// delete, duplicate, group / ungroup, and the hover toolbar's
// generator-node factory. All graph writes go through the
// use-history apply* choke points (applyNodes / applyEdges /
// applyGraph) or the dedicated addNode action
// (persistAddedNode); no second save path lives here. The graph
// refs stay owned by App and are passed in, together with the
// history entries and the node serializer.

import {
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, type ApiRequest } from "../api";
import {
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelectedNodes,
  collectGroupMemberNodes,
  getGroupWrapRect,
} from "../canvas-geometry";
import type { ContextMenuState } from "./use-canvas-gestures";
import {
  STICKY_DEFAULT_COLOR,
  type CanvasEdge,
  type CanvasNode,
  type InsertAssetPayload,
  type NodeDraft,
  type NodeType,
} from "../types";

type Viewport = { x: number; y: number; zoom: number };

type SaveGraphRequest = ApiRequest<typeof api, "saveGraph">;
type NodeInput = SaveGraphRequest["nodes"][number];

/** UUID for new nodes/edges. crypto.randomUUID is missing in some
 * older in-app WebViews; without a fallback every add path would
 * throw inside buildNode and the click would silently do nothing. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const NODE_DEFAULTS: Record<NodeType, { w: number; h: number; title: string }> = {
  text: { w: 240, h: 150, title: "文本节点" },
  image: { w: 240, h: 190, title: "生图" },
  video: { w: 260, h: 180, title: "生视频" },
  audio: { w: 240, h: 120, title: "生音频" },
  config: { w: 300, h: 244, title: "生成配置" },
  group: { w: 380, h: 280, title: "分组" },
  "video-frames": { w: 280, h: 204, title: "视频抽帧" },
  "audio-extract": { w: 260, h: 150, title: "提取音频" },
  "video-compose": { w: 280, h: 196, title: "视频配乐" },
  "prompt-reverse": { w: 280, h: 180, title: "提示词逆推" },
  "sticky-note": { w: 240, h: 200, title: "便签" },
};

export function useNodeOps({
  projectIdRef,
  nodesRef,
  edgesRef,
  selectedIdsRef,
  selectedEdgeIdRef,
  canvasRef,
  viewportRef,
  setNodes,
  setFlashId,
  setContextMenu,
  applyNodes,
  applyEdges,
  applyGraph,
  adoptSeqs,
  flushSave,
  showToast,
  toInput,
  updateSelectedIds,
  updateSelectedEdgeId,
}: {
  projectIdRef: { current: string | null };
  nodesRef: { current: CanvasNode[] };
  edgesRef: { current: CanvasEdge[] };
  selectedIdsRef: { current: Set<string> };
  selectedEdgeIdRef: { current: string | null };
  canvasRef: { current: HTMLDivElement | null };
  viewportRef: { current: Viewport };
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setFlashId: Dispatch<SetStateAction<string | null>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  applyNodes: (next: CanvasNode[]) => void;
  applyEdges: (next: CanvasEdge[]) => void;
  applyGraph: (nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => void;
  adoptSeqs: (seqs: { id: string; seq: number | null }[]) => void;
  flushSave: () => Promise<void>;
  showToast: (message: string) => void;
  toInput: (n: CanvasNode) => NodeInput;
  updateSelectedIds: (next: Set<string>) => void;
  updateSelectedEdgeId: (next: string | null) => void;
}) {
// ------------------------------------------------------------ node ops
const buildNode = useCallback(
  (partial: NodeDraft): CanvasNode | null => {
    const pid = projectIdRef.current;
    if (!pid) {
      showToast("先新建一个项目，再添加节点");
      return null;
    }
    return {
      // Locally created nodes carry no number until the server
      // issues one on save (seq is server-owned).
      seq: null,
      genStatus: "idle",
      genError: null,
      genStartedAt: null,
      genSize: null,
      genKind: null,
      mediaBlobKey: null,
      mediaUrl: null,
      mimeType: null,
      filePath: null,
      posterBlobKey: null,
      posterUrl: null,
      proxyBlobKey: null,
      proxyUrl: null,
      ...partial,
      // New image / video generation nodes are born with 16:9
      // selected (Wei 2026-11-15); a draft carrying its own
      // ratio (or a node type without one) is untouched.
      genRatio:
        partial.genRatio ??
        (partial.type === "image" || partial.type === "video"
          ? "16:9"
          : null),
      genDuration: partial.genDuration ?? null,
      genMode: partial.genMode ?? null,
      freeResize: partial.freeResize ?? false,
      fontSize: partial.fontSize ?? null,
      color: partial.color ?? null,
      id: newId(),
      projectId: pid,
    };
  },
  [showToast],
);

/** Briefly ring-flash a node so a fresh add is impossible to miss. */
const flashNode = useCallback((id: string) => {
  setFlashId(id);
  window.setTimeout(
    () => setFlashId((cur) => (cur === id ? null : cur)),
    1100,
  );
}, []);

/** Persist a freshly created node through the dedicated single-row
 * addNode action, immediately — a discrete add must not depend on
 * the debounced whole-graph saveGraph landing (that save rewrites
 * every row of the project, so one bad legacy row in a real project
 * could silently veto a new node even though the add itself is
 * valid; the sandbox's clean test projects never showed this). If
 * the single-row insert fails — e.g. a flushSave upsert raced us
 * and the row already exists — fall back to the graph save, and
 * only surface a failure when neither path lands. */
const persistAddedNode = useCallback(
  (node: CanvasNode) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    void (async () => {
      try {
        const res = await api.addNode({
          projectId: pid,
          node: toInput(node),
        });
        // addNode returns the stored node: adopt the number the
        // server just issued so the badge shows immediately.
        adoptSeqs([{ id: res.node.id, seq: res.node.seq }]);
      } catch {
        try {
          await flushSave();
        } catch {
          showToast("新节点保存失败，请稍后重试");
        }
      }
    })();
  },
  [adoptSeqs, flushSave, showToast],
);

/** Create a node centered on a world point (upstream createCanvasNode). */
const createNodeAt = useCallback(
  (type: NodeType, centerX: number, centerY: number): CanvasNode | null => {
    const defaults = NODE_DEFAULTS[type];
    const node = buildNode({
      type,
      title: defaults.title,
      x: centerX - defaults.w / 2,
      y: centerY - defaults.h / 2,
      width: defaults.w,
      height: defaults.h,
      content: "",
      prompt: "",
      status: "idle",
      hidden: false,
      groupId: null,
      // Image placeholders default to no stored color: the card
      // renders the neutral 图3 surface tone (IMAGE_PLACEHOLDER_BG).
      color: type === "sticky-note" ? STICKY_DEFAULT_COLOR : null,
    });
    if (!node) return null;
    applyNodes([...nodesRef.current, node]);
    persistAddedNode(node);
    updateSelectedIds(new Set([node.id]));
    updateSelectedEdgeId(null);
    flashNode(node.id);
    return node;
  },
  [applyNodes, buildNode, flashNode, persistAddedNode, updateSelectedEdgeId, updateSelectedIds],
);

/** Add a node at the exact center of the current viewport — the
 * landing rule for every bottom-toolbar / panel add (no cascade
 * drift: the node appears dead-center, selected and flashed). */
const addNodeAt = useCallback(
  (partial: Omit<NodeDraft, "x" | "y">) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    const cx = rect ? (rect.width / 2 - vp.x) / vp.zoom : 240;
    const cy = rect ? (rect.height / 2 - vp.y) / vp.zoom : 200;
    const node = buildNode({
      ...partial,
      x: cx - partial.width / 2,
      y: cy - partial.height / 2,
    });
    if (!node) return null;
    applyNodes([...nodesRef.current, node]);
    persistAddedNode(node);
    updateSelectedIds(new Set([node.id]));
    flashNode(node.id);
    return node;
  },
  [applyNodes, buildNode, flashNode, persistAddedNode, updateSelectedIds],
);

const addNodeOfType = (type: NodeType) => {
  const defaults = NODE_DEFAULTS[type];
  addNodeAt({
    type,
    title: defaults.title,
    width: defaults.w,
    height: defaults.h,
    content: "",
    prompt: "",
    status: "idle",
    hidden: false,
    groupId: null,
    color: type === "sticky-note" ? STICKY_DEFAULT_COLOR : null,
  });
};

/** Insert an asset as a new node. Without a position the node
 * lands at the viewport center (the 插入 button); with one — the
 * canvas drop handler passes the drop point in world coordinates —
 * it lands where the asset row was dropped. */
const insertAsset = useCallback(
  (payload: InsertAssetPayload, at?: { x: number; y: number }) => {
    // Media assets go through the server so the inserted node
    // carries the asset's real media blob (with a copy of the file
    // landed in this project's directory); text and other assets
    // take the plain local node path.
    if (payload.assetId && payload.mediaBlobKey) {
      const pid = projectIdRef.current;
      if (!pid) {
        showToast("请先打开一个项目，再插入资产");
        return;
      }
      const assetId = payload.assetId;
      const rect = canvasRef.current?.getBoundingClientRect();
      const vp = viewportRef.current;
      const cx = at ? at.x : rect ? (rect.width / 2 - vp.x) / vp.zoom : 240;
      const cy = at ? at.y : rect ? (rect.height / 2 - vp.y) / vp.zoom : 200;
      void (async () => {
        try {
          const res = await api.insertAssetToCanvas({
            projectId: pid,
            assetId,
            x: Math.round(cx - 160),
            y: Math.round(cy - 120),
          });
          if (!nodesRef.current.some((n) => n.id === res.node.id)) {
            nodesRef.current = [...nodesRef.current, res.node];
            setNodes(nodesRef.current);
          }
          updateSelectedIds(new Set([res.node.id]));
          flashNode(res.node.id);
          showToast(`已插入「${payload.title}」到画布`);
        } catch {
          showToast("插入资产失败，请稍后重试");
        }
      })();
      return;
    }
    const defaults = NODE_DEFAULTS[payload.kind];
    if (at) {
      const node = buildNode({
        type: payload.kind,
        title: payload.title,
        width: defaults.w,
        height: defaults.h,
        content: payload.content,
        prompt: payload.prompt,
        status: "idle",
        hidden: false,
        groupId: null,
        color: payload.color,
        x: at.x - defaults.w / 2,
        y: at.y - defaults.h / 2,
      });
      if (node) {
        applyNodes([...nodesRef.current, node]);
        persistAddedNode(node);
        updateSelectedIds(new Set([node.id]));
        flashNode(node.id);
        showToast(`已插入「${payload.title}」到画布`);
      }
      return;
    }
    const node = addNodeAt({
      type: payload.kind,
      title: payload.title,
      width: defaults.w,
      height: defaults.h,
      content: payload.content,
      prompt: payload.prompt,
      status: "idle",
      hidden: false,
      groupId: null,
      color: payload.color,
    });
    if (node) showToast(`已插入「${payload.title}」到画布`);
  },
  [addNodeAt, applyNodes, buildNode, flashNode, persistAddedNode, showToast, updateSelectedIds],
);

const updateNode = useCallback(
  (id: string, patch: Partial<CanvasNode>) => {
    applyNodes(nodesRef.current.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  },
  [applyNodes],
);

/** Delete nodes, their edges, and release children of deleted groups. */
const deleteNodes = useCallback(
  (ids: Set<string>) => {
    if (!ids.size) return;
    const nextNodes = nodesRef.current
      .filter((n) => !ids.has(n.id))
      .map((n) =>
        n.groupId && ids.has(n.groupId) ? { ...n, groupId: null } : n,
      );
    const nextEdges = edgesRef.current.filter(
      (e) => !ids.has(e.fromNodeId) && !ids.has(e.toNodeId),
    );
    applyGraph(nextNodes, nextEdges);
    const nextSelected = new Set(selectedIdsRef.current);
    ids.forEach((id) => nextSelected.delete(id));
    updateSelectedIds(nextSelected);
    if (
      selectedEdgeIdRef.current &&
      !nextEdges.some((e) => e.id === selectedEdgeIdRef.current)
    ) {
      updateSelectedEdgeId(null);
    }
  },
  [applyGraph, updateSelectedEdgeId, updateSelectedIds],
);

const deleteEdge = useCallback(
  (id: string) => {
    applyEdges(edgesRef.current.filter((e) => e.id !== id));
    if (selectedEdgeIdRef.current === id) updateSelectedEdgeId(null);
  },
  [applyEdges, updateSelectedEdgeId],
);

/** Upstream duplicateNode: copy offset by (+36, +36), incoming edges re-pointed. */
const duplicateNode = useCallback(
  (nodeId: string) => {
    const source = nodesRef.current.find((n) => n.id === nodeId);
    if (!source) return;
    const id = newId();
    const copy: CanvasNode = {
      ...source,
      id,
      // A copy is a NEW node: it must not inherit the source's
      // number — the server issues it a fresh one on save.
      seq: null,
      title: `${source.title} 副本`,
      x: source.x + 36,
      y: source.y + 36,
    };
    const copiedEdges = edgesRef.current
      .filter((e) => e.toNodeId === nodeId)
      .map((e) => ({ ...e, id: newId(), toNodeId: id }));
    applyGraph(
      [...nodesRef.current, copy],
      [...edgesRef.current, ...copiedEdges],
    );
    updateSelectedIds(new Set([id]));
    updateSelectedEdgeId(null);
  },
  [applyGraph, updateSelectedEdgeId, updateSelectedIds],
);

const groupSelection = useCallback(() => {
  const selected = selectedIdsRef.current;
  const all = nodesRef.current;
  if (!canGroupSelectedNodes(selected, all)) return;
  const members = collectGroupMemberNodes(selected, all);
  const rect = getGroupWrapRect(members);
  const group = buildNode({
    type: "group",
    title: NODE_DEFAULTS.group.title,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    content: "",
    prompt: "",
    status: "idle",
    hidden: false,
    groupId: null,
    color: null,
  });
  if (!group) return;
  const result = applyGroupSelection(selected, all, group);
  if (!result) return;
  applyGraph(
    result.nodes,
    edgesRef.current.filter(
      (e) => !result.removedIds.has(e.fromNodeId) && !result.removedIds.has(e.toNodeId),
    ),
  );
  updateSelectedIds(new Set(result.selectedIds));
  updateSelectedEdgeId(null);
  setContextMenu(null);
}, [applyGraph, buildNode, updateSelectedEdgeId, updateSelectedIds]);

const ungroupSelection = useCallback(() => {
  const result = applyUngroupSelection(selectedIdsRef.current, nodesRef.current);
  if (!result) return;
  applyGraph(
    result.nodes,
    edgesRef.current.filter(
      (e) => !result.removedIds.has(e.fromNodeId) && !result.removedIds.has(e.toNodeId),
    ),
  );
  updateSelectedIds(new Set(result.selectedIds));
  updateSelectedEdgeId(null);
  setContextMenu(null);
}, [applyGraph, updateSelectedEdgeId, updateSelectedIds]);

/** Create a fresh image node beside `source`, wired source -> node,
 * holding `prompt`. The caller flushes + generates on it, so the run
 * goes through the exact existing reference-fed generation path. */
const createGeneratorNode = useCallback(
  (
    source: CanvasNode,
    prompt: string,
    title: string,
    extraSources: CanvasNode[] = [],
  ): CanvasNode | null => {
    const pid = projectIdRef.current;
    if (!pid) return null;
    const gen = buildNode({
      type: "image",
      title,
      x: source.x + source.width + 72,
      y: source.y,
      width: 320,
      height: 320,
      content: "",
      prompt,
      status: "idle",
      hidden: false,
      groupId: null,
      color: null,
      genRatio: source.genRatio ?? "16:9",
    });
    if (!gen) return null;
    const sources = [source, ...extraSources];
    const newEdges: CanvasEdge[] = sources.map((s) => ({
      id: newId(),
      projectId: pid,
      fromNodeId: s.id,
      toNodeId: gen.id,
    }));
    applyGraph([...nodesRef.current, gen], [...edgesRef.current, ...newEdges]);
    updateSelectedIds(new Set([gen.id]));
    return gen;
  },
  [applyGraph, buildNode, updateSelectedIds],
);

  return {
    buildNode,
    persistAddedNode,
    createNodeAt,
    addNodeOfType,
    insertAsset,
    updateNode,
    deleteNodes,
    deleteEdge,
    duplicateNode,
    groupSelection,
    ungroupSelection,
    createGeneratorNode,
  };
}
