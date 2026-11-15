// Undo/redo history + graph persistence scheduling (extracted
// from App.tsx in batch S4 — a verbatim move, no behavior change):
// history snapshots with burst coalescing, the apply* mutation
// choke points, the debounced autosave with its not-yet-loaded
// guard, the seq-adoption merge, and the flush that generation
// runs first. The graph refs themselves (nodesRef / edgesRef /
// viewportRef / selection refs) stay owned by App and are passed
// in, together with the state setters and the node/edge
// serializers; this hook owns the history stacks, the canUndo /
// canRedo flags, the loaded / intentionalEmpty guards and the
// save timer. applyViewport moved along with applyNodes /
// applyEdges / applyGraph: it is the fourth choke point writing
// through scheduleSave, so the persistence boundary is cleanest
// with all four on this side.

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, type ApiRequest } from "../api";
import type { CanvasEdge, CanvasNode } from "../types";

type Viewport = { x: number; y: number; zoom: number };

type SaveGraphRequest = ApiRequest<typeof api, "saveGraph">;
type NodeInput = SaveGraphRequest["nodes"][number];
type EdgeInput = NonNullable<SaveGraphRequest["edges"]>[number];

export function useHistory({
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
}: {
  projectIdRef: { current: string | null };
  nodesRef: { current: CanvasNode[] };
  edgesRef: { current: CanvasEdge[] };
  viewportRef: { current: Viewport };
  selectedIdsRef: { current: Set<string> };
  selectedEdgeIdRef: { current: string | null };
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<CanvasEdge[]>>;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  showToast: (message: string) => void;
  toInput: (n: CanvasNode) => NodeInput;
  toEdgeInput: (e: CanvasEdge) => EdgeInput;
}) {
const [canUndo, setCanUndo] = useState(false);
const [canRedo, setCanRedo] = useState(false);
const loadedProjectRef = useRef<string | null>(null);
// The deletion boundary for whole-graph saves: ids of nodes this
// page has adopted from the server (project-load adoption and every
// post-run merge) plus every id this page has itself sent in a
// save. saveGraph may only delete a missing node whose id is in
// this set — a node born server-side after this page's snapshot
// (a tool/generation result landing) is in neither the payload nor
// this set, so a stale save from this page can never delete a row
// it never saw; the merge adopts it later and it becomes deletable
// only then. Reset wholesale on project adoption, unioned on merge
// and on every save send.
const knownNodeIdsRef = useRef<Set<string>>(new Set());
// True only when the graph became empty through a deliberate in-page
// graph mutation (清空画布, deleting the last node, undo/redo landing
// on an empty snapshot) — as opposed to a not-yet-loaded or
// switch-cleared board. saveGraph refuses an empty payload that
// would delete existing server nodes unless this flag rides along,
// so a stray viewport-only save can never wipe a project.
const intentionalEmptyRef = useRef(false);
const saveTimer = useRef<number | null>(null);
// ---- undo/redo history: snapshots of the graph taken BEFORE each
// discrete mutation (applyNodes/applyEdges/applyGraph are the choke
// points; node drags record once at gesture start). Rapid bursts
// (typing in a node editor) coalesce into one step. Server-driven
// merges write the refs directly and never record.
const historyRef = useRef<{
  past: { nodes: CanvasNode[]; edges: CanvasEdge[] }[];
  future: { nodes: CanvasNode[]; edges: CanvasEdge[] }[];
}>({ past: [], future: [] });
const historyMutedRef = useRef(false);
const lastHistoryAtRef = useRef(0);

// ---------------------------------------------------------- persistence
/** Stamp server-issued node numbers onto the local graph. seq is
 * server-owned and immutable once issued, so this merge touches
 * that one field and nothing else: no history snapshot, no
 * follow-up save. It is what makes a freshly created node's #
 * badge (card top-right + side-panel label) appear the moment its
 * first save lands instead of only after a full page reload. A
 * null server value never erases a number the client already has. */
const adoptSeqs = useCallback(
  (seqs: { id: string; seq: number | null }[]) => {
    if (seqs.length === 0) return;
    const byId = new Map(seqs.map((s) => [s.id, s.seq]));
    let changed = false;
    const next = nodesRef.current.map((n) => {
      const s = byId.get(n.id);
      if (s == null || s === n.seq) return n;
      changed = true;
      return { ...n, seq: s };
    });
    if (!changed) return;
    nodesRef.current = next;
    setNodes(next);
  },
  [],
);

const scheduleSave = useCallback(() => {
  const pid = projectIdRef.current;
  if (!pid) return;
  // Never persist a graph that has not been adopted from the server
  // yet: between a project switch and the adopt effect, the local
  // graph is an empty placeholder, and saving it would delete the
  // project's real nodes server-side.
  if (loadedProjectRef.current !== pid) return;
  if (saveTimer.current) window.clearTimeout(saveTimer.current);
  saveTimer.current = window.setTimeout(() => {
    const sentNodes = nodesRef.current;
    // Every id this page sends becomes part of its adopted set:
    // from here on this page is responsible for those rows, so a
    // later payload that drops one is a deliberate deletion.
    for (const n of sentNodes) knownNodeIdsRef.current.add(n.id);
    api
      .saveGraph({
        projectId: pid,
        viewport: viewportRef.current,
        nodes: sentNodes.map(toInput),
        edges: edgesRef.current.map(toEdgeInput),
        explicitClear: intentionalEmptyRef.current,
        knownNodeIds: [...knownNodeIdsRef.current],
      })
      .then((res) => adoptSeqs(res.seqs))
      .catch(() => {
        showToast("保存失败，请稍后重试");
      });
  }, 450);
}, [adoptSeqs, showToast]);

// ------------------------------------------------------------- history
const syncHistoryFlags = useCallback(() => {
  setCanUndo(historyRef.current.past.length > 0);
  setCanRedo(historyRef.current.future.length > 0);
}, []);

/** Snapshot the current graph as one undo step (burst-coalesced). */
const recordHistory = useCallback(() => {
  if (historyMutedRef.current) return;
  const top = historyRef.current.past[historyRef.current.past.length - 1];
  if (top && top.nodes === nodesRef.current && top.edges === edgesRef.current) {
    return; // nothing changed since the last snapshot (e.g. plain clicks)
  }
  const now = Date.now();
  if (now - lastHistoryAtRef.current < 600 && historyRef.current.past.length) {
    lastHistoryAtRef.current = now;
    return;
  }
  lastHistoryAtRef.current = now;
  historyRef.current.past.push({
    nodes: nodesRef.current,
    edges: edgesRef.current,
  });
  if (historyRef.current.past.length > 60) historyRef.current.past.shift();
  historyRef.current.future = [];
  syncHistoryFlags();
}, [syncHistoryFlags]);

const applyNodes = useCallback(
  (next: CanvasNode[]) => {
    recordHistory();
    intentionalEmptyRef.current = next.length === 0;
    nodesRef.current = next;
    setNodes(next);
    scheduleSave();
  },
  [recordHistory, scheduleSave],
);

const applyEdges = useCallback(
  (next: CanvasEdge[]) => {
    recordHistory();
    edgesRef.current = next;
    setEdges(next);
    scheduleSave();
  },
  [recordHistory, scheduleSave],
);

const applyGraph = useCallback(
  (nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => {
    recordHistory();
    intentionalEmptyRef.current = nextNodes.length === 0;
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
    scheduleSave();
  },
  [recordHistory, scheduleSave],
);

const applySnapshot = useCallback(
  (snap: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
    historyMutedRef.current = true;
    applyGraph(snap.nodes, snap.edges);
    historyMutedRef.current = false;
    const alive = new Set(snap.nodes.map((n) => n.id));
    const kept = new Set(
      [...selectedIdsRef.current].filter((id) => alive.has(id)),
    );
    selectedIdsRef.current = kept;
    setSelectedIds(kept);
    if (
      selectedEdgeIdRef.current &&
      !snap.edges.some((e) => e.id === selectedEdgeIdRef.current)
    ) {
      selectedEdgeIdRef.current = null;
      setSelectedEdgeId(null);
    }
    syncHistoryFlags();
  },
  [applyGraph, syncHistoryFlags],
);

const undoGraph = useCallback(() => {
  const prev = historyRef.current.past.pop();
  if (!prev) return;
  historyRef.current.future.push({
    nodes: nodesRef.current,
    edges: edgesRef.current,
  });
  applySnapshot(prev);
}, [applySnapshot]);

const redoGraph = useCallback(() => {
  const next = historyRef.current.future.pop();
  if (!next) return;
  historyRef.current.past.push({
    nodes: nodesRef.current,
    edges: edgesRef.current,
  });
  applySnapshot(next);
}, [applySnapshot]);

const applyViewport = useCallback(
  (next: Viewport, save = true) => {
    viewportRef.current = next;
    setViewport(next);
    if (save) scheduleSave();
  },
  [scheduleSave],
);

/** Flush the debounced board save so generation reads fresh prompts. */
const flushSave = useCallback(async () => {
  const pid = projectIdRef.current;
  if (!pid) return;
  // Same not-yet-loaded guard as scheduleSave: flushing an
  // un-adopted (empty placeholder) graph would wipe the project.
  if (loadedProjectRef.current !== pid) return;
  if (saveTimer.current) {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }
  const sentNodes = nodesRef.current;
  for (const n of sentNodes) knownNodeIdsRef.current.add(n.id);
  const res = await api.saveGraph({
    projectId: pid,
    viewport: viewportRef.current,
    nodes: sentNodes.map(toInput),
    edges: edgesRef.current.map(toEdgeInput),
    explicitClear: intentionalEmptyRef.current,
    knownNodeIds: [...knownNodeIdsRef.current],
  });
  adoptSeqs(res.seqs);
}, [adoptSeqs]);

  // Project-switch cleanup for the two pieces switchProject used
  // to reset inline (it keeps the loadedProjectRef /
  // intentionalEmptyRef resets itself — the adopt effect writes
  // those refs too): drop any pending autosave, and clear the
  // history stacks together with their flags.
  const cancelPendingSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);
  const resetHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return {
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
  };
}
