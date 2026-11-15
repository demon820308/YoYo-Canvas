// Generation core handlers (extracted from App.tsx in batch
// S5 — a verbatim move, no behavior change): the run dispatch
// for the generation modes (config hub / video / audio / image
// call their server actions, which own the direct-vs-background
// split), the config node's stop, the tool-node run entry, the
// run-feedback state machine wiring (begin / settle / clear and
// the genStatus settle watcher), the client-side fallback
// mirror that merges the server graph back in
// (refreshGraphFromServer), the queue query + consumer kick,
// the drawer's records query and queue-row stop mutation,
// and media-file upload onto the board. The graph refs stay
// owned by App and are passed in; persistence goes through
// use-history's flushSave, never a second save path.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fileToBase64 } from "@hatch/space-sdk/client";
import { api, type ApiRequest } from "../api";
import { frameMatchesGenSizeAspect } from "../canvas-geometry";
import { type NodeRunFeedback } from "../components/run-feedback";
import {
  VIDEO_SECONDS_DEFAULT,
  type CanvasEdge,
  type CanvasNode,
} from "../types";
import { NODE_DEFAULTS } from "./use-node-ops";

type Viewport = { x: number; y: number; zoom: number };

export function useGeneration({
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
}: {
  projectId: string | null;
  projectIdRef: { current: string | null };
  loadedProjectRef: { current: string | null };
  knownNodeIdsRef: { current: Set<string> };
  nodesRef: { current: CanvasNode[] };
  edgesRef: { current: CanvasEdge[] };
  nodes: CanvasNode[];
  queueOpen: boolean;
  canvasRef: { current: HTMLDivElement | null };
  viewportRef: { current: Viewport };
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<CanvasEdge[]>>;
  setFlashId: Dispatch<SetStateAction<string | null>>;
  setUploading: Dispatch<SetStateAction<boolean>>;
  flushSave: () => Promise<void>;
  showToast: (message: string) => void;
  updateSelectedIds: (next: Set<string>) => void;
}) {
const queryClient = useQueryClient();
const [genBusyId, setGenBusyId] = useState<string | null>(null);
// Node whose generation request is in flight from THIS page (the
// server's genStatus only becomes visible after the action call
// returns). The node card shows its 生成中…… overlay for this id
// as well, so the wait is visible from the moment 生成 is clicked;
// once the call returns, the genStatus watcher tracks the
// background run to completion.
const [directGenId, setDirectGenId] = useState<string | null>(null);
// ---- 点选即运行按钮的统一反馈状态机 (run-feedback.tsx) ----
// One record per node: activeKey/startedAt are set locally the
// instant a run button is clicked (before any server round-trip,
// closing the dead zone where a click looked like nothing
// happened); flash records how the run settled and is cleared
// ~1.4s later. The ref mirror + in-flight set are the hard
// anti-double-submit guard inside the run functions themselves.
const [runFeedback, setRunFeedback] = useState<
  Record<string, NodeRunFeedback>
>({});
const runFeedbackRef = useRef<Record<string, NodeRunFeedback>>({});
const inFlightRunsRef = useRef<Set<string>>(new Set());
const runFlashTimersRef = useRef<Map<string, number>>(new Map());
const beginRunFeedback = useCallback((nodeId: string, key: string) => {
  setRunFeedback((cur) => {
    if (cur[nodeId]?.activeKey) return cur;
    const next = {
      ...cur,
      [nodeId]: { activeKey: key, startedAt: Date.now(), flash: null },
    };
    runFeedbackRef.current = next;
    return next;
  });
}, []);
const settleRunFeedback = useCallback(
  (nodeId: string, kind: "done" | "failed") => {
    setRunFeedback((cur) => {
      const entry = cur[nodeId];
      if (!entry) return cur;
      const next = {
        ...cur,
        [nodeId]: {
          activeKey: null,
          startedAt: null,
          flash: { kind, key: entry.activeKey, at: Date.now() },
        },
      };
      runFeedbackRef.current = next;
      return next;
    });
    const old = runFlashTimersRef.current.get(nodeId);
    if (old != null) window.clearTimeout(old);
    runFlashTimersRef.current.set(
      nodeId,
      window.setTimeout(() => {
        setRunFeedback((cur) => {
          if (!cur[nodeId]?.flash) return cur;
          const next = {
            ...cur,
            [nodeId]: { activeKey: null, startedAt: null, flash: null },
          };
          runFeedbackRef.current = next;
          return next;
        });
      }, 1400),
    );
  },
  [],
);
const clearRunFeedback = useCallback((nodeId: string) => {
  const old = runFlashTimersRef.current.get(nodeId);
  if (old != null) window.clearTimeout(old);
  runFlashTimersRef.current.delete(nodeId);
  setRunFeedback((cur) => {
    if (!cur[nodeId]) return cur;
    const next = { ...cur };
    delete next[nodeId];
    runFeedbackRef.current = next;
    return next;
  });
}, []);
const kickGuardRef = useRef<string>("");
// --------------------------------------------------- generation core

/** Merge the server's graph back in: adopt server-owned generation /
 * media state and brand-new result nodes, keep in-flight local layout
 * and text edits untouched. */
const refreshGraphFromServer = useCallback(async () => {
  const pid = projectIdRef.current;
  if (!pid || loadedProjectRef.current !== pid) return;
  try {
    const data = await api.getProject({ id: pid });
    if (!data.project || projectIdRef.current !== pid) return;
    // This merge adopts the server's nodes into the page, so their
    // ids join the page's adopted set (use-history's deletion
    // boundary): from now on this page may delete them on purpose,
    // and nodes landed after this merge stay protected until the
    // next one.
    for (const sn of data.nodes) knownNodeIdsRef.current.add(sn.id);
    const localById = new Map(nodesRef.current.map((n) => [n.id, n]));
    const merged: CanvasNode[] = data.nodes.map((sn) => {
      const local = localById.get(sn.id);
      if (!local) return sn;
      // When a generation lands in this node (new media blob) or a
      // fresh measurement arrives for a finished run, the server has
      // re-shaped the frame to the finished file's real aspect
      // ratio — adopt the server frame instead of keeping the
      // placeholder's local one, or a 9:16 result stays cropped in
      // the old frame. Pure layout edits (no new media, no new
      // measurement) keep the local frame as before. The third
      // clause covers the divergence the first two cannot see: this
      // page's local frame was stamped over the server's measured
      // frame by an earlier save (or the server's frame-repair sweep
      // has since re-shaped it) — blob and genSize agree on both
      // sides, yet the local frame's aspect contradicts the measured
      // size it displays. A deliberate local geometry survives:
      // aspect-preserving resizes stay within the fit tolerance,
      // and freeResize is a local field this merge always keeps.
      const adoptServerFrame =
        (sn.mediaBlobKey !== null && sn.mediaBlobKey !== local.mediaBlobKey) ||
        (sn.genStatus === "done" &&
          sn.genSize !== null &&
          sn.genSize !== local.genSize) ||
        (sn.genStatus === "done" &&
          sn.genSize !== null &&
          (sn.width !== local.width || sn.height !== local.height) &&
          !frameMatchesGenSizeAspect(local.width, local.height, sn.genSize));
      return {
        ...sn,
        x: local.x,
        y: local.y,
        width: adoptServerFrame ? sn.width : local.width,
        height: adoptServerFrame ? sn.height : local.height,
        title: local.title,
        content: local.content,
        prompt: local.prompt,
        status: local.status,
        hidden: local.hidden,
        groupId: local.groupId,
        color: local.color,
        freeResize: local.freeResize,
        fontSize: local.fontSize,
        genRatio: local.genRatio,
        genDuration: local.genDuration,
        genMode: local.genMode,
      };
    });
    for (const local of nodesRef.current) {
      if (!merged.some((n) => n.id === local.id)) merged.push(local);
    }
    nodesRef.current = merged;
    setNodes(merged);
    // A result node landing from one of this page's runs gets one
    // highlight beat (the same ring flash as a fresh add): flash
    // each node that just appeared from the server while a run is
    // in flight or has just settled.
    const freshNodes = data.nodes.filter((sn) => !localById.has(sn.id));
    if (
      freshNodes.length > 0 &&
      Object.values(runFeedbackRef.current).some((e) => e.activeKey || e.flash)
    ) {
      for (const sn of freshNodes) {
        setFlashId(sn.id);
        window.setTimeout(
          () => setFlashId((cur) => (cur === sn.id ? null : cur)),
          1100,
        );
      }
    }
    const edgeById = new Map(edgesRef.current.map((e) => [e.id, e]));
    for (const e of data.edges) edgeById.set(e.id, e);
    const mergedEdges = [...edgeById.values()];
    edgesRef.current = mergedEdges;
    setEdges(mergedEdges);
  } catch {
    // Keep local state; the next poll retries.
  }
}, []);

const runGeneration = useCallback(
  async (node: CanvasNode) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Anti-double-submit: a run already in flight for this node
    // (local click state) swallows repeat clicks entirely.
    if (inFlightRunsRef.current.has(node.id)) return;
    inFlightRunsRef.current.add(node.id);
    beginRunFeedback(node.id, "generate");
    setGenBusyId(node.id);
    setDirectGenId(node.id);
    try {
      await flushSave();
      const res =
        node.type === "config"
          ? await api.runConfigNode({ projectId: pid, nodeId: node.id })
          : node.type === "video"
            ? await api.generateVideo({
                projectId: pid,
                nodeId: node.id,
                duration: node.genDuration ?? VIDEO_SECONDS_DEFAULT,
              })
            : node.type === "audio"
              ? await api.generateAudio({ projectId: pid, nodeId: node.id })
              : await api.generateImage({ projectId: pid, nodeId: node.id });
      if (res.status === "done") {
        showToast("生成完成");
        settleRunFeedback(node.id, "done");
      } else if (res.status === "working") {
        // Background run: the feedback entry stays active and the
        // genStatus watcher settles it when the result lands.
        showToast("已开始后台生成，完成后结果会自动上板");
      } else {
        showToast(`生成失败：${res.error ?? "未知原因"}`);
        settleRunFeedback(node.id, "failed");
      }
    } catch {
      showToast("生成请求失败，请稍后重试");
      settleRunFeedback(node.id, "failed");
    } finally {
      // Background runs keep their in-flight guard until the
      // watcher settles them; synchronous settles release it here.
      if (!runFeedbackRef.current[node.id]?.activeKey) {
        inFlightRunsRef.current.delete(node.id);
      }
      setGenBusyId(null);
      setDirectGenId(null);
      void refreshGraphFromServer();
    }
  },
  [beginRunFeedback, flushSave, refreshGraphFromServer, settleRunFeedback, showToast],
);

const runTool = useCallback(
  async (
    node: CanvasNode,
    options?: NonNullable<ApiRequest<typeof api, "runToolNode">["options"]>,
  ) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Anti-double-submit, same guard as runGeneration.
    if (inFlightRunsRef.current.has(node.id)) return;
    inFlightRunsRef.current.add(node.id);
    // Which button started this run, for the per-button feedback:
    // frames picks its action, reverse its mode, compose/extract
    // are single-button tools.
    const runKey =
      node.type === "video-frames"
        ? `frames:${options?.framesAction ?? "all"}`
        : node.type === "prompt-reverse"
          ? `reverse:${options?.reverseMode ?? "concise"}`
          : node.type === "video-compose"
            ? "compose"
            : "extract";
    beginRunFeedback(node.id, runKey);
    setGenBusyId(node.id);
    try {
      await flushSave();
      const res = await api.runToolNode({
        projectId: pid,
        nodeId: node.id,
        options,
      });
      if (res.status === "done") {
        showToast("工具运行完成，结果节点已上板");
        settleRunFeedback(node.id, "done");
      } else {
        showToast(`工具运行失败：${res.error ?? "未知原因"}`);
        settleRunFeedback(node.id, "failed");
      }
    } catch {
      showToast("工具运行请求失败，请稍后重试");
      settleRunFeedback(node.id, "failed");
    } finally {
      inFlightRunsRef.current.delete(node.id);
      setGenBusyId(null);
      void refreshGraphFromServer();
    }
  },
  [beginRunFeedback, flushSave, refreshGraphFromServer, settleRunFeedback, showToast],
);

/** The config card's 停止 button: dequeues / un-claims the run
 * server-side; a background task that still finishes afterwards is
 * refused by the delivery guard, so nothing lands after a stop. */
const stopGeneration = useCallback(
  async (node: CanvasNode) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    try {
      await api.stopGeneration({ projectId: pid, nodeId: node.id });
      showToast("已停止生成");
    } catch {
      showToast("停止失败，请稍后重试");
    } finally {
      // A stopped run gets no settle flash — its feedback record
      // and in-flight guard simply clear.
      inFlightRunsRef.current.delete(node.id);
      clearRunFeedback(node.id);
      void refreshGraphFromServer();
    }
  },
  [clearRunFeedback, refreshGraphFromServer, showToast],
);

const queueQ = useQuery({
  queryKey: ["generation-requests"],
  queryFn: () => api.listGenerationRequests({}),
  refetchInterval: queueOpen ? 4000 : 15000,
});
// The drawer's 记录 tab: the current project's persistent generation
// history. Only fetched while the drawer is open — the queue query
// above already keeps the board itself fresh.
const recordsQ = useQuery({
  queryKey: ["generation-records", projectId],
  queryFn: () => api.listGenerationRecords({ projectId: projectId ?? "" }),
  enabled: queueOpen && !!projectId,
  refetchInterval: queueOpen ? 5000 : false,
});
// The queue/record rows' 停止 (working) / 取消 (queued) buttons: the
// same server stopGeneration the config card's 停止 uses — queued
// runs leave the queue, working runs are un-claimed and any late
// delivery is refused server-side. The settle lands in the history
// as a stopped / cancelled record, which the records query picks up.
const stopRequestMut = useMutation({
  mutationFn: (args: { projectId: string; nodeId: string }) =>
    api.stopGeneration(args),
  onSuccess: (_res, args) => {
    showToast("已停止生成");
    queryClient.invalidateQueries({ queryKey: ["generation-requests"] });
    queryClient.invalidateQueries({ queryKey: ["generation-records"] });
    if (args.projectId === projectIdRef.current) void refreshGraphFromServer();
  },
  onError: () => showToast("停止失败，请稍后重试"),
});
const processQueueMut = useMutation({
  mutationFn: () => api.processQueue({}),
  onSuccess: (res) => {
    showToast(
      `队列处理完成：推进 ${res.processed} 个，回收孤儿 ${res.recovered} 个，服务端落盘 ${res.mirrored} 个，待落盘 ${res.pendingMirrors} 个，剩余排队 ${res.remaining} 个${res.framesRepaired > 0 ? `，校正落框 ${res.framesRepaired} 个` : ""}${res.chatRecovered > 0 ? `，回收建聊超时 ${res.chatRecovered} 个` : ""}`,
    );
    queryClient.invalidateQueries({ queryKey: ["generation-requests"] });
    void refreshGraphFromServer();
  },
  onError: () => showToast("队列处理失败，请稍后重试"),
});

const handleUploadFiles = useCallback(
  async (files: FileList | null) => {
    const pid = projectIdRef.current;
    if (!pid || !files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : null;
        if (!kind) {
          showToast(`不支持的文件类型：${file.name}`);
          continue;
        }
        const { dataBase64, mimeType } = await fileToBase64(file);
        const rect = canvasRef.current?.getBoundingClientRect();
        const vp = viewportRef.current;
        const cx = rect ? (rect.width / 2 - vp.x) / vp.zoom : 240;
        const cy = rect ? (rect.height / 2 - vp.y) / vp.zoom : 200;
        const defaults = NODE_DEFAULTS[kind];
        const res = await api.uploadMedia({
          projectId: pid,
          kind,
          fileName: file.name,
          mimeType,
          dataBase64,
          x: cx - defaults.w / 2,
          y: cy - defaults.h / 2,
          width: defaults.w,
          height: defaults.h,
        });
        if (!nodesRef.current.some((n) => n.id === res.node.id)) {
          nodesRef.current = [...nodesRef.current, res.node];
          setNodes(nodesRef.current);
        }
        updateSelectedIds(new Set([res.node.id]));
        showToast(
          res.filePath
            ? `已上传「${file.name}」并落盘到项目目录`
            : `已上传「${file.name}」（落盘未成功，稍后会再试）`,
        );
      }
    } catch {
      showToast("上传失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  },
  [showToast, updateSelectedIds],
);

// Poll the server graph while anything is queued/working (background
// tasks deliver asynchronously) or the queue drawer is open.
const anyGenerating = nodes.some(
  (n) => n.genStatus === "queued" || n.genStatus === "working",
);
useEffect(() => {
  if (!anyGenerating && !queueOpen) return;
  const t = window.setInterval(() => {
    void refreshGraphFromServer();
  }, 4000);
  return () => window.clearInterval(t);
}, [anyGenerating, queueOpen, refreshGraphFromServer]);

// Background settle watcher for the run-feedback state machine: a
// run this page started whose call already returned "working"
// settles here, when the polled graph shows the node leaving
// queued/working for done/failed. Synchronous runs settle through
// their own call result instead; the status-change guard keeps a
// stale "done" from a previous run from flashing a fresh click.
const prevGenStatusRef = useRef<Map<string, string>>(new Map());
useEffect(() => {
  const prev = prevGenStatusRef.current;
  for (const n of nodes) {
    const before = prev.get(n.id);
    prev.set(n.id, n.genStatus);
    if (before === n.genStatus) continue;
    if (n.genStatus !== "done" && n.genStatus !== "failed") continue;
    if (!runFeedbackRef.current[n.id]?.activeKey) continue;
    inFlightRunsRef.current.delete(n.id);
    settleRunFeedback(n.id, n.genStatus === "done" ? "done" : "failed");
  }
}, [nodes, settleRunFeedback]);

// Kick the queue consumer whenever the queued set changes (the
// per-minute external schedule is the backstop, not the only driver).
const queuedKey = nodes
  .filter((n) => n.genStatus === "queued")
  .map((n) => n.id)
  .join(",");
useEffect(() => {
  if (!queuedKey) return;
  if (kickGuardRef.current === queuedKey) return;
  kickGuardRef.current = queuedKey;
  void api
    .processQueue({})
    .then(() => refreshGraphFromServer())
    .catch(() => undefined);
}, [queuedKey, refreshGraphFromServer]);

  return {
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
  };
}
