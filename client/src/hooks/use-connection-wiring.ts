// Connection wiring (extracted from use-canvas-gestures.ts in
// batch S11 — a verbatim move, no behavior change): the wire-drag
// state machine the canvas gesture layer dispatches through. Owns
// the connecting / pendingConnect / tapConnect state and refs, the
// screen-to-world geometry and the drop-target computation
// (handle radius 40, node padding 32 — upstream semantics), and
// every connection mutation: addConnection, createConnectedNode,
// clear/cancel helpers and the tap-connect create menu. The
// gesture dispatchers in use-canvas-gestures keep reading and
// writing these refs exactly as they did when the state lived
// inline; only the ownership moved.

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  connectionTargetAnchor,
  resolveConnection,
} from "../canvas-geometry";
import type { ConnectCreateType } from "../components/CanvasMenus";
import { NODE_DEFAULTS, newId } from "./use-node-ops";
import type { ContextMenuState, Viewport } from "./use-canvas-gestures";
import type {
  CanvasEdge,
  CanvasNode,
  ConnectingState,
  NodeDraft,
} from "../types";

export type PendingConnectState = {
  connection: ConnectingState;
  worldX: number;
  worldY: number;
  x: number;
  y: number;
};

export function useConnectionWiring({
  projectIdRef,
  nodesRef,
  edgesRef,
  viewportRef,
  canvasRef,
  setContextMenu,
  applyEdges,
  applyGraph,
  showToast,
  buildNode,
  persistAddedNode,
  updateSelectedIds,
  updateSelectedEdgeId,
}: {
  projectIdRef: { current: string | null };
  nodesRef: { current: CanvasNode[] };
  edgesRef: { current: CanvasEdge[] };
  viewportRef: { current: Viewport };
  canvasRef: { current: HTMLDivElement | null };
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  applyEdges: (next: CanvasEdge[]) => void;
  applyGraph: (nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => void;
  showToast: (message: string) => void;
  buildNode: (partial: NodeDraft) => CanvasNode | null;
  persistAddedNode: (node: CanvasNode) => void;
  updateSelectedIds: (next: Set<string>) => void;
  updateSelectedEdgeId: (next: string | null) => void;
}) {
const [connecting, setConnecting] = useState<ConnectingState | null>(null);
const [pendingConnect, setPendingConnect] = useState<PendingConnectState | null>(null);
const [connectTargetId, setConnectTargetId] = useState<string | null>(null);
const [mouseWorld, setMouseWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
// Tap-to-connect: a connect source armed by tapping a handle (or
// the node menu's 点选连线) — the next node tapped becomes the
// target. The touch-friendly alternative to dragging a wire.
const [tapConnect, setTapConnect] = useState<ConnectingState | null>(null);
const connectingRef = useRef<ConnectingState | null>(null);
const pendingConnectRef = useRef<PendingConnectState | null>(null);
const tapConnectRef = useRef<ConnectingState | null>(null);

// ------------------------------------------------------------ geometry
const screenToWorld = useCallback((clientX: number, clientY: number) => {
  const rect = canvasRef.current?.getBoundingClientRect();
  const vp = viewportRef.current;
  const sx = rect ? clientX - rect.left : clientX;
  const sy = rect ? clientY - rect.top : clientY;
  return { x: (sx - vp.x) / vp.zoom, y: (sy - vp.y) / vp.zoom };
}, []);

/** Upstream getConnectionDropTarget: handle radius 40, node padding 32 (screen px). */
const computeDropTarget = useCallback(
  (clientX: number, clientY: number, conn: ConnectingState) => {
    const world = screenToWorld(clientX, clientY);
    const scale = Math.max(viewportRef.current.zoom, 0.05);
    const padding = 32 / scale;
    const handleRadius = 40 / scale;
    let isNearNode = false;
    let bestNodeId: string | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    [...nodesRef.current].reverse().forEach((node) => {
      if (node.hidden) return;
      const anchor = connectionTargetAnchor(node, conn.handleType);
      const dx = world.x - anchor.x;
      const dy = world.y - anchor.y;
      const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
      const hitsInside =
        world.x >= node.x &&
        world.x <= node.x + node.width &&
        world.y >= node.y &&
        world.y <= node.y + node.height;
      const hitsExpanded =
        world.x >= node.x - padding &&
        world.x <= node.x + node.width + padding &&
        world.y >= node.y - padding &&
        world.y <= node.y + node.height + padding;
      if (!hitsHandle && !hitsInside && !hitsExpanded) return;
      isNearNode = true;
      if (
        node.id === conn.nodeId ||
        !resolveConnection(conn.nodeId, conn.handleType, node.id, nodesRef.current)
      ) {
        return;
      }
      const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
      if (priority < bestPriority) {
        bestNodeId = node.id;
        bestPriority = priority;
      }
    });
    return { nodeId: bestNodeId, isNearNode };
  },
  [screenToWorld],
);

const clearConnecting = useCallback(() => {
  connectingRef.current = null;
  setConnecting(null);
  setConnectTargetId(null);
}, []);

const cancelPendingConnect = useCallback(() => {
  pendingConnectRef.current = null;
  setPendingConnect(null);
  connectingRef.current = null;
  setConnecting(null);
  setConnectTargetId(null);
}, []);

const addConnection = useCallback(
  (conn: ConnectingState, targetNodeId: string) => {
    const resolved = resolveConnection(
      conn.nodeId,
      conn.handleType,
      targetNodeId,
      nodesRef.current,
    );
    if (!resolved) {
      showToast("配置节点之间不能连接");
      return;
    }
    const exists = edgesRef.current.some(
      (e) => e.fromNodeId === resolved.fromNodeId && e.toNodeId === resolved.toNodeId,
    );
    if (!exists) {
      const pid = projectIdRef.current;
      if (!pid) return;
      applyEdges([
        ...edgesRef.current,
        { id: newId(), projectId: pid, ...resolved },
      ]);
    }
    setContextMenu(null);
  },
  [applyEdges, showToast],
);

const createConnectedNode = useCallback(
  (type: ConnectCreateType) => {
    const pending = pendingConnectRef.current;
    if (!pending) return;
    const defaults = NODE_DEFAULTS[type];
    const node = buildNode({
      type,
      title: defaults.title,
      x: pending.worldX - defaults.w / 2,
      y: pending.worldY - defaults.h / 2,
      width: defaults.w,
      height: defaults.h,
      content: "",
      prompt: "",
      status: "idle",
      hidden: false,
      groupId: null,
      color: null,
    });
    if (!node) {
      cancelPendingConnect();
      return;
    }
    const resolved = resolveConnection(
      pending.connection.nodeId,
      pending.connection.handleType,
      node.id,
      [...nodesRef.current, node],
    );
    if (!resolved) {
      showToast("配置节点之间不能连接");
      cancelPendingConnect();
      return;
    }
    applyGraph(
      [...nodesRef.current, node],
      [...edgesRef.current, { id: newId(), projectId: node.projectId, ...resolved }],
    );
    persistAddedNode(node);
    updateSelectedIds(new Set([node.id]));
    updateSelectedEdgeId(null);
    cancelPendingConnect();
  },
  [applyGraph, buildNode, cancelPendingConnect, persistAddedNode, showToast, updateSelectedEdgeId, updateSelectedIds],
);

const clearTapConnect = useCallback(() => {
  tapConnectRef.current = null;
  setTapConnect(null);
}, []);

/** The tap-connect pill's 新建并连线: open the create-and-connect
 * menu just right of the source node (the existing pendingConnect
 * flow places the new node there and wires it up). */
const openTapConnectCreateMenu = useCallback(() => {
  const tc = tapConnectRef.current;
  if (!tc) return;
  const src = nodesRef.current.find((n) => n.id === tc.nodeId);
  const rect = canvasRef.current?.getBoundingClientRect();
  if (!src || !rect) return;
  const vp = viewportRef.current;
  const pending: PendingConnectState = {
    connection: tc,
    worldX: src.x + src.width + 72,
    worldY: src.y,
    x: rect.left + vp.x + (src.x + src.width) * vp.zoom + 14,
    y: rect.top + vp.y + (src.y + src.height / 2) * vp.zoom,
  };
  pendingConnectRef.current = pending;
  setPendingConnect(pending);
  clearTapConnect();
}, [clearTapConnect]);

  return {
    connecting,
    setConnecting,
    pendingConnect,
    setPendingConnect,
    connectTargetId,
    setConnectTargetId,
    mouseWorld,
    setMouseWorld,
    tapConnect,
    setTapConnect,
    connectingRef,
    pendingConnectRef,
    tapConnectRef,
    screenToWorld,
    computeDropTarget,
    clearConnecting,
    cancelPendingConnect,
    addConnection,
    createConnectedNode,
    clearTapConnect,
    openTapConnectCreateMenu,
  };
}
