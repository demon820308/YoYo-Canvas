// YoYo画布 — the upstream canvas body + both right-click menu sets, ported
// per source spec (infinite-canvas.tsx, canvas-connections.tsx,
// canvas-create-menus.tsx, canvas-context-menu.tsx, canvas-zoom-controls.tsx,
// canvas-mini-map.tsx, pages/canvas/project.tsx wiring), hosted next to the
// v1 side panel. Viewport model {x, y, zoom}; wheel zoom uses the upstream
// anchor formula; nodes and edges persist server-side via saveGraph.

import {
useCallback,
useEffect,
useRef,
useState,
type CSSProperties,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { NARROW_BREAKPOINT_PX } from "./device";
import { releasePlaybackBlobs } from "./playback-blob";
import { useAppearance } from "./hooks/use-appearance";
import { useHistory } from "./hooks/use-history";
import { usePackageIo } from "./hooks/use-package-io";
import { usePanelChrome } from "./hooks/use-panel-chrome";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  useCanvasGestures,
  type ContextMenuState,
  type CreateMenuState,
} from "./hooks/use-canvas-gestures";
import { useGeneration } from "./hooks/use-generation";
import { NODE_DEFAULTS, newId, useNodeOps } from "./hooks/use-node-ops";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { SidePanel } from "./components/SidePanel";
import {
  QueueDrawer,
  type GenerationRecord,
} from "./components/QueueDrawer";
import { DetailEditor } from "./components/DetailEditor";
import { ConfigComposerDialog } from "./components/ConfigComposerDialog";
import {
ConnectionContextMenu,
ConnectionCreateMenu,
NodeContextMenu,
NodeCreateMenu,
} from "./components/CanvasMenus";
import { ZoomControls } from "./components/ZoomControls";
import { MiniMap } from "./components/MiniMap";
import {
CanvasToolbar,
type CanvasTool,
} from "./components/CanvasToolbar";
import { HoverToolbar, type ToolbarHandlers } from "./components/HoverToolbar";
import { NodeInfoModal } from "./components/NodeInfoModal";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { AngleDialog, type AngleParams } from "./components/AngleDialog";
import { CropDialog, type CropRect } from "./components/CropDialog";
import { MaskDialog, type MaskPayload } from "./components/MaskDialog";
import { SplitDialog, type SplitParams } from "./components/SplitDialog";
import {
  UpscaleDialog,
  type UpscaleParams,
} from "./components/UpscaleDialog";
import {
MediaPreviewDialog,
type PreviewTarget,
} from "./components/MediaPreviewDialog";
import {
HoverMediaPreview,
type HoverPreviewData,
} from "./components/HoverMediaPreview";
import { downloadMediaFile } from "./components/download-media";
import logoUrl from "./assets/logo.png";
import { ChatStatusBadge, ProjectMenuItem } from "./components/ProjectChrome";
import { EdgePath } from "./components/EdgePath";
import { NodeCard } from "./components/NodeCard";
import {
ASSET_DRAG_MIME,
NODE_TYPE_LABEL,
type Asset,
type CanvasEdge,
type CanvasNode,
type InsertAssetPayload,
type ToolNodeType,
type ReferenceInfo,
} from "./types";
import {
isMediaUrl,
isToolNodeType,
} from "./node-utils";
import {
activeEdgePathD,
canGroupSelectedNodes,
canUngroupSelectedNodes,
nodeBounds,
} from "./canvas-geometry";
import {
IconCheck,
IconChevronDown,
IconDownload,
IconFileText,
IconMenu,
IconPanelLeft,
IconPlus,
IconQueue,
IconTrash,
IconUpload,
IconX,
} from "./icons";

type Viewport = { x: number; y: number; zoom: number };

const NO_INPUTS: CanvasNode[] = [];

/** The extension popup entries in the bottom toolbar: the four
 * tool nodes plus the sticky note, in menu order with their labels. */
const EXTENSION_ENTRIES: {
  type: ToolNodeType | "sticky-note";
  label: string;
}[] = [
  { type: "video-frames", label: "视频抽帧" },
  { type: "video-compose", label: "视频配乐" },
  { type: "prompt-reverse", label: "逆推提示词" },
  { type: "audio-extract", label: "音频提取" },
  { type: "sticky-note", label: "便签" },
];

function toInput(n: CanvasNode) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    content: n.content,
    prompt: n.prompt,
    status: n.status,
    hidden: n.hidden,
    groupId: n.groupId,
    color: n.color,
    freeResize: n.freeResize,
    fontSize: n.fontSize,
    genRatio: n.genRatio,
    genDuration: n.genDuration,
    genMode: n.genMode,
    // Advisory only (see nodeInput on the server): lets an
    // undo-restored node claim its old number back; the server
    // decides and never lets this change an existing row's number.
    seq: n.seq,
  };
}

function toEdgeInput(e: CanvasEdge) {
  return { id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId };
}

export function App() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Asset row hovered in the side panel — feeds the SAME shared
  // hover preview as canvas rows (see hoverData below).
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  // Config node whose 组装提示词 composer dialog is open.
  const [composerNodeId, setComposerNodeId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // One shared previewer for canvas-list rows, asset rows and the
  // node hover toolbar — all build a PreviewTarget and open the same
  // MediaPreviewDialog (original size, zoom, fullscreen, download).
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const openNodePreview = useCallback((node: CanvasNode) => {
    setPreviewTarget({
      title: node.title,
      type: node.type,
      mediaUrl: node.mediaUrl ?? (isMediaUrl(node.content) ? node.content : null),
      proxyUrl: node.proxyUrl,
      posterUrl: node.posterUrl,
      color: node.color,
      text: node.content || node.prompt || "",
      meta: `${NODE_TYPE_LABEL[node.type]} · ${Math.round(node.width)}×${Math.round(node.height)} · 状态 ${node.status}${node.genSize ? ` · 成品实测 ${node.genSize}` : ""}`,
      filePath: node.filePath,
    });
  }, []);
  const openAssetPreview = useCallback((asset: Asset) => {
    setPreviewTarget({
      title: asset.title,
      type: asset.kind,
      mediaUrl: asset.mediaUrl ?? (isMediaUrl(asset.content) ? asset.content : null),
      posterUrl: asset.posterUrl,
      color: asset.color,
      text: asset.content || asset.prompt || "",
      meta: `资产 · ${NODE_TYPE_LABEL[asset.kind]}${asset.tags.length ? ` · ${asset.tags.join(" · ")}` : ""}`,
      filePath: asset.filePath,
    });
  }, []);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [createMenu, setCreateMenu] = useState<CreateMenuState | null>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(
    () => typeof window === "undefined" || window.innerWidth >= NARROW_BREAKPOINT_PX,
  );
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("yoyo-canvas-panel-width"));
      return saved >= 240 && saved <= 520 ? saved : 300;
    } catch {
      return 300;
    }
  });
  const [queueOpen, setQueueOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!projectMenuOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && projectMenuRef.current?.contains(target)) return;
      setProjectMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenuOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [projectMenuOpen]);
  // Custom project switcher (replaces the native <select>: its OS
  // popup can't follow the theme). Same open/close discipline as the
  // project menu above — outside pointer-down or Escape closes it.
  const [projectSwitchOpen, setProjectSwitchOpen] = useState(false);
  const projectSwitchRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!projectSwitchOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && projectSwitchRef.current?.contains(target)) return;
      setProjectSwitchOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectSwitchOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [projectSwitchOpen]);
  const [infoNode, setInfoNode] = useState<CanvasNode | null>(null);
  const [editorDialog, setEditorDialog] = useState<
    | { kind: "crop" | "split" | "upscale" | "super" | "angle" | "mask"; node: CanvasNode }
    | null
  >(null);
  const [panelFlash, setPanelFlash] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "rename"; id: string; name: string }
    | { mode: "delete"; id: string; name: string }
    | null
  >(null);
  const [dialogName, setDialogName] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  // ---- canvas toolbar state (upstream canvas-toolbar / infinite-canvas) --
  // Base tool for background drags; Ctrl / Space temporarily inverts it.
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("pan");
  // Multi-select mode (toolbar toggle): taps toggle node selection,
  // dragging a selected node moves the whole selection, background
  // taps keep the selection. Desktop Ctrl-click / box select are
  // independent and keep working with the mode off.
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const { kbInset, keyboardUp, recomputePanelTextFocus } =
    usePanelChrome();
  const {
    backgroundMode,
    setBackgroundMode,
    themeMode,
    setThemeMode,
    showMediaInfo,
    setShowMediaInfo,
  } = useAppearance();
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const selectedEdgeIdRef = useRef<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const toolbarUploadRef = useRef<HTMLInputElement | null>(null);
  const toolbarUploadTargetRef = useRef<string | null>(null);
  const detailEditorRef = useRef<HTMLDivElement | null>(null);

  projectIdRef.current = projectId;

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
    // Light poll so a project's chat binding (creating -> bound, filled
    // in by an external session) becomes visible without a manual
    // refresh. The list payload is small; the graph itself is untouched.
    refetchInterval: 5000,
  });
  const projectQ = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject({ id: projectId ?? "" }),
    enabled: projectId !== null,
    refetchOnWindowFocus: false,
  });

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // Adopt the first project once the list loads.
  useEffect(() => {
    if (projectId === null && projectsQ.data?.projects[0]) {
      setProjectId(projectsQ.data.projects[0].id);
    }
  }, [projectsQ.data, projectId]);

  // Track the canvas element's pixel size (minimap viewport math and
  // the side-panel hover preview's fit bounds).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setCanvasSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Adopt a freshly loaded project's graph (once per project switch).
  useEffect(() => {
    const data = projectQ.data;
    if (!data?.project || data.project.id !== projectId) return;
    if (loadedProjectRef.current === projectId) return;
    loadedProjectRef.current = projectId;
    intentionalEmptyRef.current = data.nodes.length === 0;
    // This adoption is the page's deletion boundary for later
    // whole-graph saves: exactly these server nodes are this page's
    // to delete; anything the server adds afterwards is preserved
    // by saveGraph until a merge adopts it (see use-history).
    knownNodeIdsRef.current = new Set(data.nodes.map((n) => n.id));
    nodesRef.current = data.nodes;
    setNodes(data.nodes);
    edgesRef.current = data.edges;
    setEdges(data.edges);
    viewportRef.current = data.project.viewport;
    setViewport(data.project.viewport);
    selectedIdsRef.current = new Set();
    setSelectedIds(new Set());
    selectedEdgeIdRef.current = null;
    setSelectedEdgeId(null);
    setHoveredId(null);
    // On phone-width screens, fit the visible graph into the canvas so no
    // node starts off-canvas (desktop keeps the saved viewport as-is). The
    // fitted viewport is local-only until the next regular save.
    const visible = data.nodes.filter((n) => !n.hidden);
    if (window.innerWidth < NARROW_BREAKPOINT_PX && visible.length > 0) {
      requestAnimationFrame(() => {
        const el = canvasRef.current;
        if (!el || loadedProjectRef.current !== projectId) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const minX = Math.min(...visible.map((n) => n.x));
        const minY = Math.min(...visible.map((n) => n.y));
        const maxX = Math.max(...visible.map((n) => n.x + n.width));
        const maxY = Math.max(...visible.map((n) => n.y + n.height));
        const pad = 16;
        const zoom = Math.min(
          1,
          (rect.width - pad * 2) / Math.max(1, maxX - minX),
          (rect.height - pad * 2) / Math.max(1, maxY - minY),
        );
        const fitted: Viewport = {
          zoom,
          x: pad - minX * zoom + (rect.width - pad * 2 - (maxX - minX) * zoom) / 2,
          y: pad - minY * zoom + (rect.height - pad * 2 - (maxY - minY) * zoom) / 2,
        };
        viewportRef.current = fitted;
        setViewport(fitted);
      });
    }
  }, [projectQ.data, projectId]);

  // ------------------------------------------- persistence + history
  // (hooks/use-history.ts: autosave scheduling, undo/redo, apply*)
  const {
    canUndo,
    canRedo,
    loadedProjectRef,
    knownNodeIdsRef,
    intentionalEmptyRef,
    adoptSeqs,
    scheduleSave,
    flushSave,
    recordHistory,
    applyNodes,
    applyEdges,
    applyGraph,
    applyViewport,
    undoGraph,
    redoGraph,
    cancelPendingSave,
    resetHistory,
  } = useHistory({
    projectIdRef,
    nodesRef,
    edgesRef,
    viewportRef,
    selectedIdsRef,
    selectedEdgeIdRef,
    setNodes,
    setEdges,
    setViewport,
    setSelectedIds,
    setSelectedEdgeId,
    showToast,
    toInput,
    toEdgeInput,
  });

  const updateSelectedIds = useCallback((next: Set<string>) => {
    selectedIdsRef.current = next;
    setSelectedIds(next);
  }, []);

  const updateSelectedEdgeId = useCallback((next: string | null) => {
    selectedEdgeIdRef.current = next;
    setSelectedEdgeId(next);
  }, []);

  // ------------------------------------------------------- node ops
  // (hooks/use-node-ops.ts: node creation / mutation handlers)
  const {
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
  } = useNodeOps({
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
  });

  // ---------------------------------------------------- generation
  // (hooks/use-generation.ts: run dispatch, run feedback, queue)
  const {
    genBusyId,
    setGenBusyId,
    directGenId,
    setDirectGenId,
    runFeedback,
    beginRunFeedback,
    settleRunFeedback,
    inFlightRunsRef,
    refreshGraphFromServer,
    runGeneration,
    runTool,
    stopGeneration,
    queueQ,
    recordsQ,
    stopRequestMut,
    processQueueMut,
    handleUploadFiles,
  } = useGeneration({
    projectId,
    projectIdRef,
    loadedProjectRef,
    knownNodeIdsRef,
    nodesRef,
    edgesRef,
    nodes,
    queueOpen,
    canvasRef,
    viewportRef,
    setNodes,
    setEdges,
    setFlashId,
    setUploading,
    flushSave,
    showToast,
    updateSelectedIds,
  });

  // ------------------------------------------------------ gestures
  // (hooks/use-canvas-gestures.ts: pointer / pinch / connect layer)
  const {
    nodeDragging,
    setNodeDragging,
    suppressedEditorId,
    suppressedEditorRef,
    setEditorSuppressed,
    connecting,
    setConnecting,
    pendingConnect,
    setPendingConnect,
    connectTargetId,
    mouseWorld,
    selectionBox,
    spaceDown,
    tapConnect,
    setTapConnect,
    connectingRef,
    pendingConnectRef,
    tapConnectRef,
    pinchRef,
    activePointersRef,
    pinchStaleRef,
    longPressRef,
    screenToWorld,
    addConnection,
    createConnectedNode,
    cancelPendingConnect,
    clearTapConnect,
    openTapConnectCreateMenu,
    onCanvasPointerDown,
    onCanvasContextMenu,
    onCanvasDoubleClick,
  } = useCanvasGestures({
    projectIdRef,
    nodesRef,
    edgesRef,
    viewportRef,
    selectedIdsRef,
    selectedEdgeIdRef,
    canvasRef,
    canvasTool,
    multiSelectMode,
    setNodes,
    setContextMenu,
    setCreateMenu,
    applyViewport,
    applyEdges,
    applyGraph,
    recordHistory,
    scheduleSave,
    showToast,
    updateSelectedIds,
    updateSelectedEdgeId,
    buildNode,
    persistAddedNode,
    deleteNodes,
    deleteEdge,
    undoGraph,
    redoGraph,
  });

  const switchProject = useCallback(
    (id: string | null) => {
      // Re-selecting the project that is already open is a no-op:
      // clearing the local graph here and letting a later stray save
      // persist that empty graph is exactly how a project's nodes
      // were once wiped by re-clicking it in the switcher.
      if (id !== null && id === projectIdRef.current) return;
      // The old project's cards unmount with the switch: release the
      // V2 playback blob cache so its object URLs don't linger.
      releasePlaybackBlobs();
      loadedProjectRef.current = null;
      intentionalEmptyRef.current = false;
      knownNodeIdsRef.current = new Set();
      cancelPendingSave();
      resetHistory();
      setProjectId(id);
      setNodes([]);
      nodesRef.current = [];
      setEdges([]);
      edgesRef.current = [];
      updateSelectedIds(new Set());
      updateSelectedEdgeId(null);
      setEditorSuppressed(null);
      setNodeDragging(false);
      setContextMenu(null);
      setCreateMenu(null);
      connectingRef.current = null;
      setConnecting(null);
      pendingConnectRef.current = null;
      setPendingConnect(null);
      tapConnectRef.current = null;
      setTapConnect(null);
      pinchRef.current = null;
      activePointersRef.current.clear();
      pinchStaleRef.current.clear();
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current = null;
      }
    },
    [setEditorSuppressed, updateSelectedIds, updateSelectedEdgeId],
  );

  // ------------------------------------------------------------- mutations
  const createProject = useMutation({
    mutationFn: (name: string) => api.createProject({ name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialog(null);
      switchProject(res.id);
      showToast("项目已创建");
    },
  });
  const renameProject = useMutation({
    mutationFn: (args: { id: string; name: string }) => api.renameProject(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      loadedProjectRef.current = projectId;
      setDialog(null);
      showToast("已重命名");
    },
  });
  const deleteProject = useMutation({
    mutationFn: (id: string) => api.deleteProject({ id }),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialog(null);
      if (id === projectId) switchProject(null);
      showToast("项目已删除");
    },
  });
  const requestChat = useMutation({
    mutationFn: (id: string) => api.requestProjectChat({ projectId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      showToast("已发出建聊请求，专属窗口创建中");
    },
    onError: () => showToast("建聊请求失败，请稍后重试"),
  });
  // ------------------------------------------------- project package I/O
  // (hooks/use-package-io.ts: export download, import + report)
  const {
    exporting,
    importing,
    importReport,
    setImportReport,
    importInputRef,
    handleExportPackage,
    handleImportPackageFile,
  } = usePackageIo({ projectId, showToast, switchProject });

  const saveAsAsset = useMutation({
    mutationFn: (node: CanvasNode) =>
      api.addAsset({
        projectId: node.projectId,
        kind: node.type,
        title: node.title,
        content: node.content,
        prompt: node.prompt,
        color: node.color,
        tags: [],
        sourceNodeId: node.id,
        // Media nodes keep their real bytes in the asset (blob ref +
        // project file + poster), so re-inserting restores the media.
        mediaBlobKey: node.mediaBlobKey,
        mimeType: node.mimeType,
        filePath: node.filePath,
        posterBlobKey: node.posterBlobKey,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      showToast("已存为资产（见左侧面板「资产」页签）");
    },
  });

  // --------------------------------------------------- hover toolbar

  const toolbarHandlers: ToolbarHandlers = {
    onInfo: (node) => setInfoNode(node),
    onDelete: (node) => deleteNodes(new Set([node.id])),
    onRetry: (node) => {
      if (isToolNodeType(node.type)) void runTool(node);
      else void runGeneration(node);
    },
    onSaveAsset: (node) => saveAsAsset.mutate(node),
    onDownload: (node) => {
      void (async () => {
        const url = node.mediaUrl;
        if (!url) {
          showToast("这个节点还没有可下载的媒体");
          return;
        }
        // Same in-page save as the preview dialog (see
        // download-media.ts): bytes are fetched and saved without
        // ever navigating the page — the old raw-URL anchor
        // fallback could unload the whole space in embedded
        // browsers.
        const result = await downloadMediaFile(url, node.title || "media");
        if (result === "downloaded") showToast("已开始下载");
        else if (result === "shared") showToast("已打开系统分享，可保存到文件");
        else showToast("下载失败，请稍后重试");
      })();
    },
    onUngroup: () => ungroupSelection(),
    onToggleDialog: (node) => {
      updateSelectedIds(new Set([node.id]));
      setPanelFlash(true);
      window.setTimeout(() => setPanelFlash(false), 900);
      requestAnimationFrame(() => {
        detailEditorRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      });
    },
    onGenerateImage: (node) => {
      const text = (node.content || node.prompt).trim();
      if (!text) {
        showToast("文本节点还是空的，先写点内容再生成图片");
        return;
      }
      const gen = createGeneratorNode(
        node,
        text,
        `${node.title || "文本"} · 生成图`,
      );
      if (!gen) return;
      void (async () => {
        await flushSave();
        setGenBusyId(gen.id);
        setDirectGenId(gen.id);
        try {
          const res = await api.generateImage({
            projectId: gen.projectId,
            nodeId: gen.id,
          });
          if (res.status === "done") showToast("生成完成");
          else if (res.status === "working")
            showToast("已开始后台生成，完成后结果会自动上板");
          else showToast(`生成失败：${res.error ?? "未知原因"}`);
        } catch {
          showToast("生成请求失败，请稍后重试");
        } finally {
          setGenBusyId(null);
          setDirectGenId(null);
          void refreshGraphFromServer();
        }
      })();
    },
    onDecreaseFont: (node) =>
      updateNode(node.id, {
        fontSize: Math.max(10, Math.round((node.fontSize ?? 12) - 2)),
      }),
    onIncreaseFont: (node) =>
      updateNode(node.id, {
        fontSize: Math.min(40, Math.round((node.fontSize ?? 12) + 2)),
      }),
    onUpload: (node) => {
      toolbarUploadTargetRef.current = node.id;
      if (toolbarUploadRef.current) {
        toolbarUploadRef.current.accept =
          node.type === "video"
            ? "video/*"
            : node.type === "audio"
              ? "audio/*"
              : "image/*";
        toolbarUploadRef.current.click();
      }
    },
    onCopyPrompt: (node) => {
      const prompt = (node.prompt || "").trim();
      if (!prompt) {
        showToast("这个节点没有提示词");
        return;
      }
      void (async () => {
        try {
          await navigator.clipboard.writeText(prompt);
          showToast("已复制提示词");
        } catch {
          const ta = document.createElement("textarea");
          ta.value = prompt;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            showToast("已复制提示词");
          } catch {
            showToast("复制失败，请长按提示词手动复制");
          }
          ta.remove();
        }
      })();
    },
    onReversePrompt: (node) => {
      // Reuse the tool-node machinery wholesale: build a prompt-reverse
      // node, wire the image into it, and run it — no second reverse
      // implementation.
      const tool = buildNode({
        type: "prompt-reverse",
        title: NODE_DEFAULTS["prompt-reverse"].title,
        x: node.x + node.width + 72,
        y: node.y,
        width: NODE_DEFAULTS["prompt-reverse"].w,
        height: NODE_DEFAULTS["prompt-reverse"].h,
        content: "",
        prompt: "",
        status: "idle",
        hidden: false,
        groupId: null,
        color: null,
      });
      if (!tool) return;
      const pid = projectIdRef.current;
      if (!pid) return;
      applyGraph(
        [...nodesRef.current, tool],
        [
          ...edgesRef.current,
          {
            id: newId(),
            projectId: pid,
            fromNodeId: node.id,
            toNodeId: tool.id,
          },
        ],
      );
      updateSelectedIds(new Set([tool.id]));
      showToast("已创建逆推工具节点，正在运行");
      void (async () => {
        await flushSave();
        inFlightRunsRef.current.add(tool.id);
        beginRunFeedback(tool.id, "reverse:concise");
        setGenBusyId(tool.id);
        try {
          const res = await api.runToolNode({
            projectId: pid,
            nodeId: tool.id,
            options: { reverseMode: "concise" },
          });
          if (res.status === "done") {
            showToast("逆推完成，文本节点已上板（在面板里可换其它逆推方式再跑）");
            settleRunFeedback(tool.id, "done");
          } else {
            showToast(`逆推失败：${res.error ?? "未知原因"}`);
            settleRunFeedback(tool.id, "failed");
          }
        } catch {
          showToast("逆推运行请求失败，请稍后重试");
          settleRunFeedback(tool.id, "failed");
        } finally {
          inFlightRunsRef.current.delete(tool.id);
          setGenBusyId(null);
          void refreshGraphFromServer();
        }
      })();
    },
    onToggleFreeResize: (node) => {
      updateNode(node.id, { freeResize: !node.freeResize });
      showToast(
        node.freeResize
          ? "已关闭自由尺寸：拖动缩放时保持比例"
          : "已开启自由尺寸：节点可非等比拉伸",
      );
    },
    onMaskEdit: (node) => setEditorDialog({ kind: "mask", node }),
    onCrop: (node) => setEditorDialog({ kind: "crop", node }),
    onSplit: (node) => setEditorDialog({ kind: "split", node }),
    onUpscale: (node) => setEditorDialog({ kind: "upscale", node }),
    onSuperResolve: (node) => setEditorDialog({ kind: "super", node }),
    onAngle: (node) => setEditorDialog({ kind: "angle", node }),
    onViewImage: (node) => openNodePreview(node),
  };

  const handleToolbarUpload = useCallback(
    async (files: FileList | null) => {
      const targetId = toolbarUploadTargetRef.current;
      toolbarUploadTargetRef.current = null;
      const file = files?.[0];
      if (!targetId || !file) return;
      const node = nodesRef.current.find((n) => n.id === targetId);
      if (!node) return;
      if (!file.type.startsWith(`${node.type}/`)) {
        showToast(`请选择${NODE_TYPE_LABEL[node.type]}文件`);
        return;
      }
      setGenBusyId(node.id);
      try {
        const { dataBase64, mimeType } = await fileToBase64(file);
        const res = await api.replaceNodeMedia({
          nodeId: node.id,
          fileName: file.name,
          mimeType,
          dataBase64,
        });
        const next = nodesRef.current.map((n) =>
          n.id === node.id ? { ...n, ...res.node } : n,
        );
        nodesRef.current = next;
        setNodes(next);
        showToast(
          res.filePath
            ? `已替换「${node.title}」并落盘到项目目录`
            : `已替换「${node.title}」（落盘未成功，稍后会再试）`,
        );
        void refreshGraphFromServer();
      } catch {
        showToast("替换失败，请稍后重试");
      } finally {
        setGenBusyId(null);
      }
    },
    [refreshGraphFromServer, showToast],
  );

  const handleCropConfirm = useCallback(
    async (node: CanvasNode, rect: CropRect) => {
      setEditorDialog(null);
      setGenBusyId(node.id);
      try {
        const res = await api.cropNodeImage({ nodeId: node.id, rect });
        if (res.status === "done") showToast("裁剪完成，新节点已上板");
        else showToast(`裁剪失败：${res.error ?? "未知原因"}`);
      } catch {
        showToast("裁剪请求失败，请稍后重试");
      } finally {
        setGenBusyId(null);
        void refreshGraphFromServer();
      }
    },
    [refreshGraphFromServer, showToast],
  );

  const handleSplitConfirm = useCallback(
    async (node: CanvasNode, params: SplitParams) => {
      setEditorDialog(null);
      setGenBusyId(node.id);
      try {
        const res = await api.splitNodeImage({ nodeId: node.id, ...params });
        if (res.status === "done")
          showToast(`切分完成，${res.resultNodeIds.length} 个节点已排布在原图下方`);
        else showToast(`切分失败：${res.error ?? "未知原因"}`);
      } catch {
        showToast("切分请求失败，请稍后重试");
      } finally {
        setGenBusyId(null);
        void refreshGraphFromServer();
      }
    },
    [refreshGraphFromServer, showToast],
  );

  const handleUpscaleConfirm = useCallback(
    async (node: CanvasNode, params: UpscaleParams) => {
      setEditorDialog(null);
      setGenBusyId(node.id);
      try {
        const res = await api.upscaleNodeImage({ nodeId: node.id, ...params });
        if (res.status === "done") showToast("放大完成，新节点已上板");
        else showToast(`放大失败：${res.error ?? "未知原因"}`);
      } catch {
        showToast("放大请求失败，请稍后重试");
      } finally {
        setGenBusyId(null);
        void refreshGraphFromServer();
      }
    },
    [refreshGraphFromServer, showToast],
  );

  const handleAngleConfirm = useCallback(
    async (node: CanvasNode, params: AngleParams) => {
      setEditorDialog(null);
      const prompt = `换一个视角：方位角 ${params.horizontalAngle}°、俯仰角 ${params.pitchAngle}°、距离 ${params.cameraDistance}，保持主体与风格不变`;
      const gen = createGeneratorNode(node, prompt, `${node.title || "图片"} · 换角度`);
      if (!gen) return;
      await flushSave();
      setGenBusyId(gen.id);
      try {
        const res = await api.generateImage({
          projectId: gen.projectId,
          nodeId: gen.id,
        });
        if (res.status === "working")
          showToast("换角度已开始后台生成，完成后结果会自动上板");
        else if (res.status === "done") showToast("生成完成，结果节点已上板");
        else showToast(`换角度失败：${res.error ?? "未知原因"}`);
      } catch {
        showToast("换角度请求失败，请稍后重试");
      } finally {
        setGenBusyId(null);
        void refreshGraphFromServer();
      }
    },
    [createGeneratorNode, flushSave, refreshGraphFromServer, showToast],
  );

  const handleMaskConfirm = useCallback(
    async (node: CanvasNode, payload: MaskPayload) => {
      setEditorDialog(null);
      const pid = projectIdRef.current;
      if (!pid) return;
      setGenBusyId(node.id);
      try {
        // Land the mask as its own image node in the project directory
        // (uploadMedia writes the real file), then generate with BOTH
        // the original and the mask wired in as references. Note: the
        // generation channel does not do true masked inpainting — this
        // is an approximate redraw guided by the two references.
        const maskBase64 = payload.maskDataUrl.replace(
          /^data:image\/png;base64,/,
          "",
        );
        const uploaded = await api.uploadMedia({
          projectId: pid,
          kind: "image",
          fileName: `${node.title || "图片"} · 蒙版.png`,
          mimeType: "image/png",
          dataBase64: maskBase64,
          x: node.x,
          y: node.y + node.height + 40,
          width: node.width,
          height: node.height,
        });
        if (!nodesRef.current.some((n) => n.id === uploaded.node.id)) {
          nodesRef.current = [...nodesRef.current, uploaded.node];
          setNodes(nodesRef.current);
        }
        const maskNode =
          nodesRef.current.find((n) => n.id === uploaded.node.id) ??
          uploaded.node;
        const gen = createGeneratorNode(
          node,
          payload.prompt,
          `${node.title || "图片"} · 蒙版重绘`,
          [maskNode],
        );
        if (!gen) return;
        await flushSave();
        const res = await api.generateImage({
          projectId: pid,
          nodeId: gen.id,
        });
        if (res.status === "working")
          showToast("蒙版重绘已开始后台生成（原图＋蒙版双参考近似重绘）");
        else if (res.status === "done") showToast("生成完成，结果节点已上板");
        else showToast(`蒙版重绘失败：${res.error ?? "未知原因"}`);
      } catch {
        showToast("蒙版重绘请求失败，请稍后重试");
      } finally {
        setGenBusyId(null);
        void refreshGraphFromServer();
      }
    },
    [createGeneratorNode, flushSave, refreshGraphFromServer, showToast],
  );

  /** Live node resize from the card's corner handle (no save until commit). */
  const handleLiveResize = useCallback((id: string, width: number, height: number) => {
    const next = nodesRef.current.map((n) =>
      n.id === id ? { ...n, width, height } : n,
    );
    nodesRef.current = next;
    setNodes(next);
  }, []);

  const focusNode = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((n) => n.id === id);
      const el = canvasRef.current;
      if (!node || !el) return;
      // Focusing from the side panel is an explicit open: any
      // drag-suppression for this node no longer applies.
      if (suppressedEditorRef.current === id) setEditorSuppressed(null);
      updateSelectedIds(new Set([id]));
      const rect = el.getBoundingClientRect();
      const zoom = viewportRef.current.zoom;
      applyViewport({
        x: rect.width / 2 - (node.x + node.width / 2) * zoom,
        y: rect.height / 2 - (node.y + node.height / 2) * zoom,
        zoom,
      });
      setFlashId(id);
      window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1000);
      if (window.innerWidth < NARROW_BREAKPOINT_PX) setPanelOpen(false);
    },
    [applyViewport, setEditorSuppressed, updateSelectedIds],
  );

  // Queue drawer / records locate: only meaningful for the project
  // currently on the board (queue rows span projects; records are
  // already current-project scoped). A target that is gone from the
  // board gets a plain-language note instead of a silent no-op.
  const locateQueueNode = useCallback(
    (pid: string, nodeId: string) => {
      if (pid !== projectIdRef.current) {
        showToast("该节点在其它项目里，先切换到那个项目再定位");
        return;
      }
      if (!nodesRef.current.some((n) => n.id === nodeId)) {
        showToast("节点已不存在，无法定位");
        return;
      }
      focusNode(nodeId);
    },
    [focusNode, showToast],
  );

  // A history record opens in the same shared previewer as nodes
  // and assets; the record's snapshot supplies title / media / meta.
  const openRecordPreview = useCallback((record: GenerationRecord) => {
    setPreviewTarget({
      title: record.title,
      type: record.nodeType,
      mediaUrl: record.mediaUrl,
      posterUrl: null,
      color: null,
      text: record.prompt,
      meta: `生成记录 · ${NODE_TYPE_LABEL[record.nodeType]}${record.genSize ? ` · 成品实测 ${record.genSize}` : ""}`,
      filePath: record.filePath,
    });
  }, []);

  /** Toolbar 定位： center the viewport on the selection's bounds. */
  const focusSelection = useCallback(() => {
    const selected = nodesRef.current.filter((n) =>
      selectedIdsRef.current.has(n.id),
    );
    const el = canvasRef.current;
    if (!selected.length || !el) return;
    const bounds = nodeBounds(selected);
    const rect = el.getBoundingClientRect();
    const zoom = viewportRef.current.zoom;
    applyViewport({
      x: rect.width / 2 - ((bounds.left + bounds.right) / 2) * zoom,
      y: rect.height / 2 - ((bounds.top + bounds.bottom) / 2) * zoom,
      zoom,
    });
  }, [applyViewport]);

  /** Toolbar 清空画布 (after confirm): one history step, so the
   * toolbar's undo brings everything back. */
  const clearCanvas = useCallback(() => {
    applyGraph([], []);
    updateSelectedIds(new Set());
    updateSelectedEdgeId(null);
    setClearConfirmOpen(false);
    showToast("画布已清空（点工具条的撤销可恢复）");
  }, [applyGraph, showToast, updateSelectedEdgeId, updateSelectedIds]);

  // ------------------------------------------------------- view controls
  const zoomTo = useCallback(
    (nextZoom: number) => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vp = viewportRef.current;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const wx = (mx - vp.x) / vp.zoom;
      const wy = (my - vp.y) / vp.zoom;
      applyViewport({ zoom, x: mx - wx * zoom, y: my - wy * zoom });
    },
    [applyViewport],
  );

  const fitView = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const visible = nodesRef.current.filter((n) => !n.hidden);
    if (!visible.length) {
      applyViewport({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const minX = Math.min(...visible.map((n) => n.x));
    const minY = Math.min(...visible.map((n) => n.y));
    const maxX = Math.max(...visible.map((n) => n.x + n.width));
    const maxY = Math.max(...visible.map((n) => n.y + n.height));
    const pad = 48;
    const zoom = Math.min(
      1.5,
      Math.max(
        MIN_ZOOM,
        Math.min(
          (rect.width - pad * 2) / Math.max(1, maxX - minX),
          (rect.height - pad * 2) / Math.max(1, maxY - minY),
        ),
      ),
    );
    applyViewport({
      zoom,
      x: pad - minX * zoom + (rect.width - pad * 2 - (maxX - minX) * zoom) / 2,
      y: pad - minY * zoom + (rect.height - pad * 2 - (maxY - minY) * zoom) / 2,
    });
  }, [applyViewport]);

  // ------------------------------------------------------------- rendering
  const projects = projectsQ.data?.projects ?? [];
  const currentProject = projects.find((p) => p.id === projectId) ?? null;
  const visibleNodes = nodes.filter((n) => !n.hidden);
  const renderNodes = [...visibleNodes].sort(
    (a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1),
  );
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  // Incoming source nodes per node (edge order, groups flattened),
  // mirroring selectedReferences' expansion.
  const inputsByNodeId = new Map<string, CanvasNode[]>();
  for (const e of edges) {
    const src = nodeById.get(e.fromNodeId);
    if (!src) continue;
    const list = inputsByNodeId.get(e.toNodeId) ?? [];
    if (src.type === "group") {
      for (const m of nodes.filter(
        (n) => n.groupId === src.id && n.type !== "group",
      )) {
        if (!list.some((n) => n.id === m.id)) list.push(m);
      }
    } else if (!list.some((n) => n.id === src.id)) {
      list.push(src);
    }
    inputsByNodeId.set(e.toNodeId, list);
  }
  const renderEdges = edges.filter((e) => {
    const from = nodeById.get(e.fromNodeId);
    const to = nodeById.get(e.toNodeId);
    return Boolean(from && to && !from.hidden && !to.hidden);
  });
  const selectedNode =
    selectedIds.size === 1 ? (nodes.find((n) => selectedIds.has(n.id)) ?? null) : null;
  // The detail editor (图1) shows for a plain selection, never while
  // a node is being dragged, and not after a drag that started this
  // selection (until the next plain click on the node).
  const showDetailEditor =
    selectedNode !== null &&
    !nodeDragging &&
    suppressedEditorId !== selectedNode.id;
  // The detail editor anchors under the selected node (the upstream
  // composer position): horizontally centered on the node and
  // clamped to the canvas. It ALWAYS opens below the node — never
  // above it (user's standing rule). When the room underneath runs
  // short, the panel's height cap shrinks to what is left below
  // (with a usable floor) and its own overflow scroll takes over.
  const detailEditorStyle = (() => {
    if (!selectedNode || canvasSize.width === 0) return undefined;
    const cw = canvasSize.width;
    const ch = canvasSize.height;
    if (cw < NARROW_BREAKPOINT_PX) {
      // Narrow screens: the editor becomes a bottom sheet — full
      // width, capped height (its own overflow scrolls), lifted
      // above the on-screen keyboard by the visualViewport inset.
      return {
        left: 8,
        width: cw - 16,
        bottom: `calc(${8 + kbInset}px + env(safe-area-inset-bottom, 0px))`,
        maxHeight: "min(62dvh, 560px)",
      } as CSSProperties;
    }
    const w = Math.min(620, cw * 0.94);
    const cx =
      viewport.x + (selectedNode.x + selectedNode.width / 2) * viewport.zoom;
    const left = Math.max(8, Math.min(cx - w / 2, cw - w - 8));
    const nodeBottom =
      viewport.y + (selectedNode.y + selectedNode.height) * viewport.zoom;
    const roomBelow = ch - (nodeBottom + 10) - 8;
    return {
      left,
      width: w,
      top: nodeBottom + 10,
      maxHeight: `min(560px, 72vh, ${Math.max(200, roomBelow)}px)`,
    };
  })();
  const selectedReferences: ReferenceInfo[] = (() => {
    if (!selectedNode) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: ReferenceInfo[] = [];
    const seen = new Set<string>();
    for (const e of edges.filter((edge) => edge.toNodeId === selectedNode.id)) {
      const src = byId.get(e.fromNodeId);
      if (!src) continue;
      if (src.type === "group") {
        for (const m of nodes.filter(
          (n) => n.groupId === src.id && n.type !== "group",
        )) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            out.push({ node: m, edgeId: e.id });
          }
        }
      } else if (!seen.has(src.id)) {
        seen.add(src.id);
        out.push({ node: src, edgeId: e.id });
      }
    }
    return out;
  })();
  // The config node whose 组装提示词 composer is open, with its
  // references expanded exactly like the selected node's.
  const composerNode = composerNodeId
    ? (nodes.find((n) => n.id === composerNodeId) ?? null)
    : null;
  const composerReferences: ReferenceInfo[] = (() => {
    if (!composerNode) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: ReferenceInfo[] = [];
    const seen = new Set<string>();
    for (const e of edges.filter((edge) => edge.toNodeId === composerNode.id)) {
      const src = byId.get(e.fromNodeId);
      if (!src) continue;
      if (src.type === "group") {
        for (const m of nodes.filter(
          (n) => n.groupId === src.id && n.type !== "group",
        )) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            out.push({ node: m, edgeId: e.id });
          }
        }
      } else if (!seen.has(src.id)) {
        seen.add(src.id);
        out.push({ node: src, edgeId: e.id });
      }
    }
    return out;
  })();
  // The 组装提示词 composer anchors under its config node, with the
  // detail editor's placement math — expressed in fixed (viewport)
  // coordinates because the dialog renders at the app root. Like
  // the detail editor it ALWAYS opens below the node; when the room
  // underneath runs short its height cap shrinks to what is left
  // below and its own overflow scroll takes over.
  const composerStyle = ((): CSSProperties | undefined => {
    if (!composerNode || canvasSize.width === 0) return undefined;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    const cw = canvasSize.width;
    const ch = canvasSize.height;
    if (cw < NARROW_BREAKPOINT_PX) {
      // Same bottom-sheet treatment as the detail editor.
      return {
        position: "fixed",
        left: rect.left + 8,
        width: cw - 16,
        bottom: `calc(${8 + kbInset}px + env(safe-area-inset-bottom, 0px))`,
        maxHeight: "min(70dvh, 640px)",
      };
    }
    const w = Math.min(512, cw * 0.94);
    const cx =
      viewport.x + (composerNode.x + composerNode.width / 2) * viewport.zoom;
    const left =
      rect.left + Math.max(8, Math.min(cx - w / 2, cw - w - 8));
    const nodeBottom =
      viewport.y + (composerNode.y + composerNode.height) * viewport.zoom;
    const roomBelow = ch - (nodeBottom + 10) - 8;
    return {
      position: "fixed",
      left,
      width: w,
      top: rect.top + nodeBottom + 10,
      maxHeight: `min(560px, 80vh, ${Math.max(200, roomBelow)}px)`,
    };
  })();
  // A panel opening or closing changes what "inside an open big
  // panel" means for the active element (a field that unmounts with
  // its panel leaves focus on <body>, an exit WebKit often delivers
  // without any focusout), so panel state changes funnel into the
  // same single recompute as every other focus-relevant event.
  const anyPanelOpen = showDetailEditor || composerNode !== null;
  useEffect(() => {
    recomputePanelTextFocus();
  }, [anyPanelOpen, recomputePanelTextFocus]);
  const connectingOrigin = connecting ? nodeById.get(connecting.nodeId) : undefined;
  const connectTargetNode = connectTargetId ? nodeById.get(connectTargetId) : undefined;
  const menuCanGroup =
    contextMenu?.type === "node" ? canGroupSelectedNodes(selectedIds, nodes) : false;
  const menuCanUngroup =
    contextMenu?.type === "node" ? canUngroupSelectedNodes(selectedIds, nodes) : false;

  const gridSize = 48 * viewport.zoom;
  const dotSize = viewport.zoom < 0.12 ? 0.8 : 1.15;
  // Canvas background per the appearance panel: dot grid (default),
  // line grid, or blank — all positioned by the live viewport.
  const canvasBackgroundStyle =
    backgroundMode === "blank"
      ? { backgroundImage: "none" as const }
      : backgroundMode === "lines"
        ? {
            backgroundImage:
              "linear-gradient(var(--dot) 1px, transparent 1px), linear-gradient(90deg, var(--dot) 1px, transparent 1px)",
            backgroundSize: `${gridSize}px ${gridSize}px`,
            backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px`,
          }
        : {
            backgroundImage: `radial-gradient(circle, var(--dot) ${dotSize}px, transparent ${dotSize + 0.2}px)`,
            backgroundSize: `${gridSize}px ${gridSize}px`,
            backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px`,
          };

  const boxRect = selectionBox
    ? {
        x: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
        y: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
        w: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
        h: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
      }
    : null;

  // Multi-selection (>=2): dashed bounds + floating toolbar (upstream
  // canvas-selection-toolbar.tsx).
  const multiSelectedNodes =
    selectedIds.size >= 2
      ? nodes.filter((n) => selectedIds.has(n.id) && !n.hidden)
      : [];
  const multiBounds =
    multiSelectedNodes.length >= 2 ? nodeBounds(multiSelectedNodes) : null;
  const multiCanGroup = canGroupSelectedNodes(selectedIds, nodes);
  const multiCanUngroup = canUngroupSelectedNodes(selectedIds, nodes);
  const selectionPadWorld = 14 / viewport.zoom;

  const openDialog = (d: NonNullable<typeof dialog>) => {
    setDialog(d);
    setDialogName(d.mode === "rename" ? d.name : "");
  };

  // ---- side-panel hover preview (upstream onHoverNode): hovering a
  // node row OR an asset row in the left panel floats a large preview
  // of its media over the canvas. Both lists feed the one shared
  // HoverMediaPreview component (same look, one implementation);
  // videos preview as their poster still, never the video itself.
  const hoverData: HoverPreviewData | null = (() => {
    if (canvasSize.width === 0) return null;
    if (hoveredAsset) {
      const a = hoveredAsset;
      if (a.kind === "image") {
        const src = a.mediaUrl ?? (isMediaUrl(a.content) ? a.content : null);
        if (!src) return null;
        return { title: a.title, kind: "image", src, poster: null };
      }
      if (a.kind === "video") {
        const poster = a.posterUrl ?? null;
        if (!poster && !a.mediaUrl) return null;
        return { title: a.title, kind: "video", src: null, poster };
      }
      return null;
    }
    const n = hoveredId ? nodeById.get(hoveredId) : null;
    if (!n) return null;
    if (n.type === "image") {
      const src = n.mediaUrl ?? (isMediaUrl(n.content) ? n.content : null);
      if (!src) return null;
      const measured = n.genSize?.match(/^(\d+)x(\d+)$/);
      return {
        title: n.title,
        kind: "image",
        src,
        poster: null,
        natW: measured ? Number(measured[1]) : n.width,
        natH: measured ? Number(measured[2]) : n.height,
      };
    }
    if (n.type === "video") {
      const poster = n.posterUrl;
      if (!poster && !n.mediaUrl) return null;
      const measured = n.genSize?.match(/^(\d+)x(\d+)$/);
      return {
        title: n.title,
        kind: "video",
        src: null,
        poster,
        natW: measured ? Number(measured[1]) : n.width,
        natH: measured ? Number(measured[2]) : n.height,
      };
    }
    return null;
  })();

  return (
    <div className="app-root relative flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* --------------------- top floating cluster (upstream
          canvas-top-bar pattern, per the user's call: NO bar of its
          own — the canvas fills the whole screen and the controls
          float over it in two transparent clusters, left: panel
          toggle, logo, project menu button, project switcher, chat
          status; right: the queue icon. Fully transparent, no capsule
          background: nodes sliding under the cluster overlap it,
          exactly like the upstream original. The header itself is
          pointer-events-none so the canvas stays draggable through
          the gaps; each interactive child re-enables its own events.
          Every project action lives in the 项目菜单 dropdown. The
          left cluster rides with the side panel on desktop widths:
          panel open, it starts just right of the panel's edge (the
          panel's tabs own the top-left row); panel closed, it returns
          to the screen's left edge. On narrow widths the panel is an
          overlay above this header, so the cluster stays put. The
          right queue button never moves.) */}
      <header className="safe-top-offset pointer-events-none absolute inset-x-0 z-40 flex h-14 items-center gap-1 px-3">
        <div
          className="top-cluster-left pointer-events-none flex min-w-0 items-center gap-1"
          data-panel-open={panelOpen}
          style={{ "--panel-width": `${panelWidth}px` } as CSSProperties}
        >
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="hit-40 pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          aria-label={panelOpen ? "关闭左侧面板" : "打开左侧面板"}
          aria-pressed={panelOpen}
        >
          <IconPanelLeft size={16} />
        </button>
        <img
          src={logoUrl}
          alt="YoYo画布 logo"
          className="h-7 w-7 shrink-0 rounded-md"
          width={28}
          height={28}
        />
        <div className="pointer-events-auto relative shrink-0" ref={projectMenuRef}>
          <button
            type="button"
            onClick={() => setProjectMenuOpen((v) => !v)}
            className="hit-40 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label="项目菜单"
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen}
          >
            <IconMenu size={16} />
          </button>
          {projectMenuOpen ? (
            <div
              role="menu"
              aria-label="项目菜单"
              className="absolute left-0 top-[calc(100%+6px)] z-50 w-52 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]"
            >
              <ProjectMenuItem
                icon={<IconPlus size={15} />}
                label="新建项目"
                onClick={() => {
                  setProjectMenuOpen(false);
                  openDialog({ mode: "create" });
                }}
              />
              <ProjectMenuItem
                icon={<IconUpload size={15} />}
                label={importing ? "导入中…" : "导入项目包"}
                disabled={importing}
                onClick={() => {
                  setProjectMenuOpen(false);
                  importInputRef.current?.click();
                }}
              />
              {currentProject ? (
                <>
                  <div className="mx-2 my-1 h-px bg-[var(--border)]" />
                  <ProjectMenuItem
                    icon={<IconFileText size={15} />}
                    label="重命名"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      openDialog({ mode: "rename", id: currentProject.id, name: currentProject.name });
                    }}
                  />
                  <ProjectMenuItem
                    icon={<IconDownload size={15} />}
                    label={exporting ? "导出中…" : "导出项目包"}
                    disabled={exporting}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      void handleExportPackage();
                    }}
                  />
                  <div className="mx-2 my-1 h-px bg-[var(--border)]" />
                  <ProjectMenuItem
                    icon={<IconTrash size={15} />}
                    label="删除项目"
                    danger
                    onClick={() => {
                      setProjectMenuOpen(false);
                      openDialog({ mode: "delete", id: currentProject.id, name: currentProject.name });
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label="选择要导入的项目包文件"
          onChange={(e) => {
            void handleImportPackageFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <div className="pointer-events-auto relative min-w-0 max-w-[180px] shrink" ref={projectSwitchRef}>
          <button
            type="button"
            onClick={() => setProjectSwitchOpen((v) => !v)}
            disabled={projects.length === 0}
            className="flex w-full min-w-0 items-center gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-left text-sm font-semibold outline-none hover:border-[var(--border)] focus:border-[var(--accent)] disabled:opacity-60"
            aria-label="切换项目"
            aria-haspopup="listbox"
            aria-expanded={projectSwitchOpen}
          >
            <span className="min-w-0 truncate">
              {currentProject
                ? `${currentProject.name}（${currentProject.nodeCount}）`
                : projects.length
                  ? "选择项目"
                  : "暂无项目"}
            </span>
            <span className="shrink-0 text-[var(--dim)]">
              <IconChevronDown size={14} />
            </span>
          </button>
          {projectSwitchOpen ? (
            <div
              role="listbox"
              aria-label="选择项目"
              className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-64 w-52 overflow-y-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow)]"
            >
              {projects.map((p) => {
                const active = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setProjectSwitchOpen(false);
                      switchProject(p.id);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors hover:bg-[var(--hover)]"
                    style={
                      active
                        ? { background: "var(--accent-soft)", color: "var(--accent)" }
                        : { color: "var(--text)" }
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}（{p.nodeCount}）
                    </span>
                    {active ? (
                      <span className="shrink-0">
                        <IconCheck size={14} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {currentProject ? (
          <span className="pointer-events-auto flex min-w-0">
            <ChatStatusBadge
              project={currentProject}
              requesting={requestChat.isPending}
              onRequest={() => requestChat.mutate(currentProject.id)}
            />
          </span>
        ) : null}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setQueueOpen(true)}
          className="hit-40 pointer-events-auto relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--dim)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          aria-label="打开生成队列"
        >
          <IconQueue size={16} />
          {(queueQ.data?.requests.length ?? 0) > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-0.5 text-[10px] font-semibold leading-none text-[var(--accent-ink)]">
              {queueQ.data?.requests.length}
            </span>
          ) : null}
        </button>
      </header>

      {importReport ? (
        <div
          className="capsule-chrome absolute inset-x-3 top-16 z-40 flex flex-wrap items-start gap-2 rounded-xl px-3 py-2 text-[13px]"
          role="status"
          aria-label="导入结果报告"
        >
          <span className="font-medium">导入完成：「{importReport.name}」</span>
          <span className="text-[var(--dim)]">
            共 {importReport.nodeCount} 个节点，{importReport.mediaImported} 个媒体文件已恢复
            {importReport.mediaMissing.length
              ? `；${importReport.mediaMissing.length} 个媒体缺失：${importReport.mediaMissing
                  .map((m) => `「${m.title}」${m.reason}`)
                  .join("；")}（对应节点已标为缺失态）`
              : ""}
          </span>
          <button
            type="button"
            onClick={() => setImportReport(null)}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
            aria-label="关闭导入报告"
          >
            <IconX size={14} />
          </button>
        </div>
      ) : null}

      {/* ------------------------------------------------ main row:
          full-bleed — the canvas fills the whole screen under the
          floating top cluster; the side panel rises to full screen
          height flush with the left edge, its tab row at the very
          top in the same row as the floating cluster (which shifts
          to the panel's right edge on desktop while it is open) */}
      <div className="relative flex min-h-0 flex-1">
        {panelOpen ? (
          <div className="fixed inset-0 z-50 flex md:static md:z-auto">
            <div className="panel-in flex max-w-[88vw]">
              <SidePanel
                projectId={projectId ?? ""}
                nodes={nodes}
                selectedNodeIds={selectedIds}
                onFocusNode={focusNode}
                onPreviewNode={openNodePreview}
                onPreviewAsset={openAssetPreview}
                onHoverNode={(id) => {
                  setHoveredId(id);
                  if (id) setHoveredAsset(null);
                }}
                onHoverAsset={(asset) => {
                  setHoveredAsset(asset);
                  if (asset) setHoveredId(null);
                }}
                onInsertAsset={insertAsset}
                onRenameNode={(nodeId, title) => updateNode(nodeId, { title })}
                width={panelWidth}
                onWidthChange={setPanelWidth}
              />
            </div>
            <button
              type="button"
              aria-label="关闭面板"
              className="flex-1 bg-black/50 md:hidden"
              onClick={() => setPanelOpen(false)}
            />
          </div>
        ) : null}

        {/* ------------------------------------------------ canvas */}
        <div
          ref={canvasRef}
          data-canvas-root
          className="relative min-w-0 flex-1 touch-none overscroll-none overflow-hidden bg-[var(--board)]"
          style={{
            ...canvasBackgroundStyle,
            cursor: spaceDown || canvasTool === "pan" ? "grab" : undefined,
          }}
          onPointerDown={onCanvasPointerDown}
          onContextMenu={onCanvasContextMenu}
          onDoubleClick={onCanvasDoubleClick}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(ASSET_DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(ASSET_DRAG_MIME);
            if (!raw) return;
            e.preventDefault();
            try {
              const payload = JSON.parse(raw) as InsertAssetPayload;
              insertAsset(payload, screenToWorld(e.clientX, e.clientY));
            } catch {
              showToast("插入资产失败，请稍后重试");
            }
          }}
          role="application"
          aria-label="画布区域"
        >
          {!projectId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <img src={logoUrl} alt="" className="h-20 w-20 rounded-3xl opacity-90" />
              <p className="text-sm text-[var(--dim)]">
                {projectsQ.isPending
                  ? "加载中…"
                  : "还没有项目。新建一个项目，开始在画布上连线与编组。"}
              </p>
              <button
                type="button"
                onClick={() => openDialog({ mode: "create" })}
                className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]"
              >
                <IconPlus size={15} /> 新建项目
              </button>
            </div>
          ) : projectQ.isPending && loadedProjectRef.current !== projectId ? (
            <p className="flex h-full items-center justify-center text-sm text-[var(--dim)]">
              加载项目中…
            </p>
          ) : (
            <>
              <div
                className="absolute left-0 top-0 h-full w-full"
                style={{
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                <svg
                  className="absolute left-0 top-0"
                  width={10000}
                  height={10000}
                  style={{ overflow: "visible", pointerEvents: "none", zIndex: 0 }}
                  aria-hidden="true"
                >
                  {renderEdges.map((edge) => {
                    const from = nodeById.get(edge.fromNodeId);
                    const to = nodeById.get(edge.toNodeId);
                    if (!from || !to) return null;
                    const active =
                      selectedEdgeId === edge.id ||
                      selectedIds.has(edge.fromNodeId) ||
                      selectedIds.has(edge.toNodeId);
                    return (
                      <EdgePath
                        key={edge.id}
                        edge={edge}
                        from={from}
                        to={to}
                        active={active}
                        onSelect={() => {
                          updateSelectedEdgeId(edge.id);
                          updateSelectedIds(new Set());
                        }}
                        onContextMenu={(clientX, clientY) => {
                          updateSelectedEdgeId(edge.id);
                          updateSelectedIds(new Set());
                          setCreateMenu(null);
                          setContextMenu({
                            type: "connection",
                            edgeId: edge.id,
                            x: clientX,
                            y: clientY,
                          });
                        }}
                      />
                    );
                  })}
                  {connecting && connectingOrigin ? (
                    <path
                      d={activeEdgePathD(
                        connectingOrigin,
                        connecting.handleType,
                        mouseWorld,
                        connectTargetNode,
                      )}
                      fill="none"
                      style={{
                        stroke: "var(--accent)",
                        strokeWidth: 2,
                        strokeDasharray: "5,5",
                        pointerEvents: "none",
                      }}
                    />
                  ) : null}
                  {boxRect ? (
                    <rect
                      x={boxRect.x}
                      y={boxRect.y}
                      width={boxRect.w}
                      height={boxRect.h}
                      style={{
                        fill: "rgba(var(--accent-rgb),0.08)",
                        stroke: "var(--accent)",
                        strokeOpacity: 0.55,
                        strokeWidth: 1 / viewport.zoom,
                        strokeDasharray: `${6 / viewport.zoom} ${4 / viewport.zoom}`,
                      }}
                    />
                  ) : null}
                </svg>
                {renderNodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    inputs={inputsByNodeId.get(node.id) ?? NO_INPUTS}
                    selected={selectedIds.has(node.id)}
                    hovered={hoveredId === node.id}
                    flashing={flashId === node.id}
                    connectTarget={
                      connectTargetId === node.id || tapConnect?.nodeId === node.id
                    }
                    showHandles={Boolean(connecting)}
                    generating={directGenId === node.id}
                    feedback={runFeedback[node.id]}
                    showMediaInfo={showMediaInfo}
                    onLiveResize={handleLiveResize}
                    onResizeCommit={scheduleSave}
                    onPreview={openNodePreview}
                    onPatchNode={updateNode}
                    onGenerateNode={(n) => void runGeneration(n)}
                    onStopNode={(n) => void stopGeneration(n)}
                    onRunToolNode={(n, options) => void runTool(n, options)}
                    onOpenComposer={(n) => setComposerNodeId(n.id)}
                  />
                ))}
                {multiBounds ? (
                  <div
                    className="pointer-events-none absolute z-[5] rounded-2xl"
                    style={{
                      left: multiBounds.left - selectionPadWorld,
                      top: multiBounds.top - selectionPadWorld,
                      width:
                        multiBounds.right - multiBounds.left + selectionPadWorld * 2,
                      height:
                        multiBounds.bottom - multiBounds.top + selectionPadWorld * 2,
                      border: `${1.5 / viewport.zoom}px dashed rgba(var(--accent-rgb),0.55)`,
                      background: "rgba(var(--accent-rgb),0.05)",
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              {selectedNode && !nodeDragging && !keyboardUp ? (
                <HoverToolbar
                  node={selectedNode}
                  viewport={viewport}
                  handlers={toolbarHandlers}
                />
              ) : null}
              {multiBounds && !keyboardUp ? (
                <SelectionToolbar
                  bounds={multiBounds}
                  viewport={viewport}
                  canGroup={multiCanGroup}
                  canUngroup={multiCanUngroup}
                  onGroup={groupSelection}
                  onUngroup={ungroupSelection}
                />
              ) : null}
              {nodes.length === 0 ? (
                <p className="pointer-events-none absolute inset-x-0 top-16 px-4 text-center text-sm text-[var(--dim)]">
                  画布是空的——在画布上右键新建节点，或用底部工具条添加，也可以从左侧面板插入资产 / 提示词。
                </p>
              ) : null}
      {/* ------------------------- side-panel hover preview */}
      <HoverMediaPreview
        data={hoverData}
        canvasWidth={canvasSize.width}
        canvasHeight={canvasSize.height}
      />

      {/* ------------------------------------------ bottom toolbar */}
      {/* Hidden while typing in a node's big panel on touch devices
          (see keyboardUp above); restored when focus leaves the
          panel's text fields. */}
      {!keyboardUp ? (
      <CanvasToolbar
        tool={canvasTool}
        multiSelect={multiSelectMode}
        onToggleMultiSelect={() => setMultiSelectMode((v) => !v)}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={selectedIds.size > 0 || Boolean(selectedEdgeId)}
        disabled={!projectId || uploading}
        extensionTypes={EXTENSION_ENTRIES}
        themeMode={themeMode}
        backgroundMode={backgroundMode}
        showMediaInfo={showMediaInfo}
        onToolChange={setCanvasTool}
        onUndo={undoGraph}
        onRedo={redoGraph}
        onFocusSelected={focusSelection}
        onAddNode={addNodeOfType}
        onUpload={() => uploadInputRef.current?.click()}
        onDeleteSelected={() => {
          if (selectedIds.size > 0) deleteNodes(new Set(selectedIds));
          else if (selectedEdgeId) deleteEdge(selectedEdgeId);
        }}
        onClear={() => setClearConfirmOpen(true)}
        onThemeModeChange={setThemeMode}
        onBackgroundModeChange={setBackgroundMode}
        onShowMediaInfoChange={setShowMediaInfo}
      />
      ) : null}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        aria-label="选择要上传的媒体文件"
        onChange={(e) => {
          void handleUploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={toolbarUploadRef}
        type="file"
        className="hidden"
        aria-label="选择替换节点的媒体文件"
        onChange={(e) => {
          void handleToolbarUpload(e.target.files);
          e.target.value = "";
        }}
      />

              {!keyboardUp ? (
                <>
                  <ZoomControls
                    scale={viewport.zoom}
                    onScaleChange={zoomTo}
                    onFit={fitView}
                  />
                  <div className="hidden sm:contents">
                    <MiniMap
                      nodes={visibleNodes}
                      viewport={viewport}
                      viewportSize={canvasSize}
                      onViewportChange={(next) => applyViewport(next)}
                    />
                  </div>
                </>
              ) : null}
              {tapConnect ? (
                <div
                  data-ui
                  className="capsule-chrome absolute left-1/2 top-16 z-40 flex max-w-[94vw] -translate-x-1/2 items-center gap-1.5 rounded-full py-1.5 pl-4 pr-1.5"
                  role="status"
                  aria-label="连线进行中"
                >
                  <span className="whitespace-nowrap text-xs">
                    连线中：点选目标节点完成连线，点空白取消
                  </span>
                  <button
                    type="button"
                    className="hit-40 whitespace-nowrap rounded-full bg-[var(--surface-3)] px-3 py-1.5 text-xs hover:text-[var(--accent)]"
                    onClick={openTapConnectCreateMenu}
                    aria-label="新建节点并连线"
                  >
                    新建并连线
                  </button>
                  <button
                    type="button"
                    className="hit-40 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
                    onClick={clearTapConnect}
                    aria-label="取消连线"
                  >
                    取消
                  </button>
                </div>
              ) : null}
              {multiSelectMode ? (
                <div
                  data-ui
                  className="capsule-chrome absolute bottom-24 left-1/2 z-40 flex max-w-[94vw] -translate-x-1/2 items-center gap-1.5 rounded-full py-1.5 pl-4 pr-1.5"
                  role="status"
                  aria-label="多选模式"
                >
                  <span className="whitespace-nowrap text-xs">
                    多选模式 · 已选 {selectedIds.size} 个
                  </span>
                  <button
                    type="button"
                    disabled={selectedIds.size === 0}
                    className="hit-40 whitespace-nowrap rounded-full bg-[var(--surface-3)] px-3 py-1.5 text-xs text-[var(--danger)] disabled:opacity-40"
                    onClick={() => deleteNodes(new Set(selectedIds))}
                    aria-label="删除所选节点"
                  >
                    删除所选
                  </button>
                  <button
                    type="button"
                    className="hit-40 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
                    onClick={() => setMultiSelectMode(false)}
                    aria-label="退出多选模式"
                  >
                    退出
                  </button>
                </div>
              ) : null}
            </>
          )}

          {/* ------------------------------------------ detail editor */}
          {showDetailEditor && selectedNode ? (
            <DetailEditor
              detailEditorRef={detailEditorRef}
              detailEditorStyle={detailEditorStyle}
              panelFlash={panelFlash}
              selectedNode={selectedNode}
              selectedReferences={selectedReferences}
              nodes={nodes}
              genBusyId={genBusyId}
              runFeedback={runFeedback}
              updateNode={updateNode}
              deleteNodes={deleteNodes}
              deleteEdge={deleteEdge}
              addConnection={addConnection}
              runGeneration={runGeneration}
              runTool={runTool}
            />
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------ right-click menus */}
      {contextMenu?.type === "node" ? (
        <NodeContextMenu
          menu={contextMenu}
          canGroup={menuCanGroup}
          canUngroup={menuCanUngroup}
          onClose={() => setContextMenu(null)}
          onDuplicate={() => {
            duplicateNode(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          onDelete={() => {
            deleteNodes(new Set([contextMenu.nodeId]));
            setContextMenu(null);
          }}
          onTapConnect={() => {
            setTapConnect({ nodeId: contextMenu.nodeId, handleType: "source" });
            tapConnectRef.current = {
              nodeId: contextMenu.nodeId,
              handleType: "source",
            };
            setContextMenu(null);
          }}
        />
      ) : null}
      {contextMenu?.type === "connection" ? (
        <ConnectionContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            deleteEdge(contextMenu.edgeId);
            setContextMenu(null);
          }}
        />
      ) : null}
      {createMenu ? (
        <NodeCreateMenu
          x={createMenu.x}
          y={createMenu.y}
          onClose={() => setCreateMenu(null)}
          onCreate={(type) => {
            createNodeAt(type, createMenu.worldX, createMenu.worldY);
            setCreateMenu(null);
          }}
        />
      ) : null}
      {pendingConnect ? (
        <ConnectionCreateMenu
          x={pendingConnect.x}
          y={pendingConnect.y}
          onClose={cancelPendingConnect}
          onCreate={createConnectedNode}
        />
      ) : null}

      {/* ------------------------------------------------ queue drawer */}
      {queueOpen ? (
        <QueueDrawer
          currentProjectId={projectId}
          requests={queueQ.data?.requests ?? []}
          queueLoading={queueQ.isPending}
          records={recordsQ.data?.records ?? []}
          recordsLoading={recordsQ.isPending}
          onClose={() => setQueueOpen(false)}
          onProcessQueue={() => processQueueMut.mutate()}
          processingQueue={processQueueMut.isPending}
          onLocateNode={locateQueueNode}
          onStopRequest={(pid, nodeId) =>
            stopRequestMut.mutate({ projectId: pid, nodeId })
          }
          stoppingNodeId={
            stopRequestMut.isPending
              ? (stopRequestMut.variables?.nodeId ?? null)
              : null
          }
          onPreviewRecord={openRecordPreview}
          showToast={showToast}
        />
      ) : null}

      {/* ------------------------------------------------ project dialog */}
      {clearConfirmOpen ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="清空画布"
          onClick={() => setClearConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">清空画布？</h3>
            <p className="mt-2 text-sm text-[var(--dim)]">
              当前项目的全部节点与连线会被删除。清空后可以点工具条的「撤销」恢复。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={clearCanvas}
                className="rounded bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white"
              >
                清空
              </button>
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={
            dialog.mode === "create"
              ? "新建项目"
              : dialog.mode === "rename"
                ? "重命名项目"
                : "删除项目"
          }
          onClick={() => setDialog(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {dialog.mode === "delete" ? (
              <>
                <h3 className="text-base font-semibold">删除项目「{dialog.name}」？</h3>
                <p className="mt-2 text-sm text-[var(--dim)]">
                  项目里的全部节点与连线会一起删除，资产库与提示词库不受影响。此操作不可撤销。
                </p>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => deleteProject.mutate(dialog.id)}
                    disabled={deleteProject.isPending}
                    className="rounded bg-[var(--danger)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="rounded border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">
                  {dialog.mode === "create" ? "新建项目" : "重命名项目"}
                </h3>
                <input
                  value={dialogName}
                  onChange={(e) => setDialogName(e.target.value)}
                  placeholder="项目名称"
                  aria-label="项目名称"
                  autoFocus
                  className="mt-3 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && dialogName.trim()) {
                      if (dialog.mode === "create") createProject.mutate(dialogName.trim());
                      else renameProject.mutate({ id: dialog.id, name: dialogName.trim() });
                    }
                  }}
                />
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    disabled={!dialogName.trim() || createProject.isPending || renameProject.isPending}
                    onClick={() => {
                      if (dialog.mode === "create") createProject.mutate(dialogName.trim());
                      else renameProject.mutate({ id: dialog.id, name: dialogName.trim() });
                    }}
                    className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40"
                  >
                    {dialog.mode === "create" ? "创建" : "保存"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialog(null)}
                    className="rounded border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ preview dialog */}
      {previewTarget ? (
        <MediaPreviewDialog
          target={previewTarget}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}

      {/* --------------------------------------- 组装提示词 composer dialog */}
      {composerNode && composerNode.type === "config" ? (
        <ConfigComposerDialog
          node={composerNode}
          references={composerReferences}
          style={composerStyle}
          feedback={runFeedback[composerNode.id]}
          onPatch={(patch) => updateNode(composerNode.id, patch)}
          onClose={() => setComposerNodeId(null)}
          onGenerate={() => {
            setComposerNodeId(null);
            void runGeneration(composerNode);
          }}
        />
      ) : null}

      {/* ------------------------------------------------ toolbar dialogs */}
      {infoNode ? (
        <NodeInfoModal node={infoNode} onClose={() => setInfoNode(null)} />
      ) : null}
      {editorDialog?.kind === "crop" && editorDialog.node.mediaUrl ? (
        <CropDialog
          src={editorDialog.node.mediaUrl}
          title={editorDialog.node.title}
          onClose={() => setEditorDialog(null)}
          onConfirm={(rect) => void handleCropConfirm(editorDialog.node, rect)}
        />
      ) : null}
      {editorDialog?.kind === "split" && editorDialog.node.mediaUrl ? (
        <SplitDialog
          src={editorDialog.node.mediaUrl}
          title={editorDialog.node.title}
          onClose={() => setEditorDialog(null)}
          onConfirm={(params) =>
            void handleSplitConfirm(editorDialog.node, params)
          }
        />
      ) : null}
      {(editorDialog?.kind === "upscale" || editorDialog?.kind === "super") &&
      editorDialog.node.mediaUrl ? (
        <UpscaleDialog
          src={editorDialog.node.mediaUrl}
          title={editorDialog.node.title}
          superResolve={editorDialog.kind === "super"}
          onClose={() => setEditorDialog(null)}
          onConfirm={(params) =>
            void handleUpscaleConfirm(editorDialog.node, params)
          }
        />
      ) : null}
      {editorDialog?.kind === "angle" && editorDialog.node.mediaUrl ? (
        <AngleDialog
          src={editorDialog.node.mediaUrl}
          title={editorDialog.node.title}
          onClose={() => setEditorDialog(null)}
          onConfirm={(params) =>
            void handleAngleConfirm(editorDialog.node, params)
          }
        />
      ) : null}
      {editorDialog?.kind === "mask" && editorDialog.node.mediaUrl ? (
        <MaskDialog
          src={editorDialog.node.mediaUrl}
          title={editorDialog.node.title}
          onClose={() => setEditorDialog(null)}
          onConfirm={(payload) =>
            void handleMaskConfirm(editorDialog.node, payload)
          }
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-[95] -translate-x-1/2 rounded-full bg-[var(--surface-3)] px-4 py-2 text-sm shadow-xl"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
