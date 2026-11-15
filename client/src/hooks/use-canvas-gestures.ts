// Canvas gesture layer (extracted from App.tsx in batch S5 —
// a verbatim move, no behavior change): the canvas pointer
// handlers (pan / node drag / box select), pinch zoom over the
// live pointer map, the window pointer / keyboard listeners and
// the native wheel zoom. Every threshold and anchor formula is
// the one App() used to hold inline (12px touch / 6px mouse tap
// radius in the card's own handler, two-finger center anchor).
// Two sub-domains were split out in batch S11, again as verbatim
// moves composed as sub-hooks below: the connection wiring
// (wire dragging with its drop-target geometry, tap-to-connect)
// lives in use-connection-wiring.ts, and the ~500ms long-press
// context menu in use-long-press.ts. Graph writes go through
// use-history's apply* entries and node creation through
// use-node-ops' buildNode / persistAddedNode, both passed in;
// the graph refs stay owned by App. The gesture-owned state and
// refs live here and are returned for the render tree and for
// switchProject's reset, which writes them exactly as before.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import type { CanvasTool } from "../components/CanvasToolbar";
import {
  useConnectionWiring,
  type PendingConnectState,
} from "./use-connection-wiring";
import { useLongPress } from "./use-long-press";
import type {
  CanvasEdge,
  CanvasNode,
  ConnectingState,
  NodeDraft,
  SelectionBoxState,
} from "../types";

export type Viewport = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 5;

export type ContextMenuState =
  | { type: "node"; nodeId: string; x: number; y: number }
  | { type: "connection"; edgeId: string; x: number; y: number };

export type CreateMenuState = { x: number; y: number; worldX: number; worldY: number };


export type GestureState =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      viewport: Viewport;
      moved: boolean;
      startedOnBackground: boolean;
    }
  | {
      kind: "node";
      startX: number;
      startY: number;
      origins: Map<string, { x: number; y: number }>;
      moved: boolean;
      /** The node the pointer went down on, and whether the detail
       * editor was open for it before this gesture — a drag that
       * STARTS a selection must not summon the editor (图1), while a
       * drag of an already-open node keeps its editor afterwards. */
      primaryId: string;
      editorWasOpen: boolean;
      /** Multi-select mode only: this node was already selected when
       * the press began, so a press that ends as a plain tap (no
       * drag) toggles it back OUT of the selection on pointer-up. */
      tapToggleId?: string;
    }
  | { kind: "box" }
  /** A press the canvas deliberately does not turn into a drag:
   * a multi-select tap that only changes the selection, or a touch
   * press inside a text node's scrollable content (the browser's
   * native scroll owns that gesture). */
  | { kind: "none" };

function isFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function useCanvasGestures({
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
}: {
  projectIdRef: { current: string | null };
  nodesRef: { current: CanvasNode[] };
  edgesRef: { current: CanvasEdge[] };
  viewportRef: { current: Viewport };
  selectedIdsRef: { current: Set<string> };
  selectedEdgeIdRef: { current: string | null };
  canvasRef: { current: HTMLDivElement | null };
  canvasTool: CanvasTool;
  multiSelectMode: boolean;
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  setCreateMenu: Dispatch<SetStateAction<CreateMenuState | null>>;
  applyViewport: (next: Viewport, save?: boolean) => void;
  applyEdges: (next: CanvasEdge[]) => void;
  applyGraph: (nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => void;
  recordHistory: () => void;
  scheduleSave: () => void;
  showToast: (message: string) => void;
  updateSelectedIds: (next: Set<string>) => void;
  updateSelectedEdgeId: (next: string | null) => void;
  buildNode: (partial: NodeDraft) => CanvasNode | null;
  persistAddedNode: (node: CanvasNode) => void;
  deleteNodes: (ids: Set<string>) => void;
  deleteEdge: (id: string) => void;
  undoGraph: () => void;
  redoGraph: () => void;
}) {
// Detail-editor (图1) summon rule: dragging a node must not pop the
// editor. While a node drag is moving, the editor is hidden; when a
// drag STARTS a fresh selection, the editor stays suppressed for
// that node until the next plain click on it.
const [nodeDragging, setNodeDragging] = useState(false);
const [suppressedEditorId, setSuppressedEditorId] = useState<string | null>(null);
const suppressedEditorRef = useRef<string | null>(null);
const setEditorSuppressed = useCallback((id: string | null) => {
  suppressedEditorRef.current = id;
  setSuppressedEditorId(id);
}, []);
const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
const [spaceDown, setSpaceDown] = useState(false);
const selectionBoxRef = useRef<SelectionBoxState | null>(null);
const gestureRef = useRef<GestureState | null>(null);
const multiSelectRef = useRef(false);
multiSelectRef.current = multiSelectMode;
// ---- multi-touch / press tracking for the gesture layer ----
// Every live non-mouse pointer on the canvas, by id; a second one
// converts the running gesture into a pinch (see pinchRef).
const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
const pinchRef = useRef<{
  startDist: number;
  startCx: number;
  startCy: number;
  viewport: Viewport;
} | null>(null);
// Pointers that were part of a finished pinch and are still down:
// their moves/ups are ignored until they lift, so the leftover
// finger cannot resume the drag the pinch cancelled.
const pinchStaleRef = useRef(new Set<number>());
// Where the current wire drag started if it began on a connect
// handle — a press that ends as a tap (barely moved) becomes
// tap-to-connect instead of a dropped wire.
const handlePressRef = useRef<{
  pointerId: number;
  x: number;
  y: number;
} | null>(null);
const spaceRef = useRef(false);

// ------------------------------------------------------------ wiring (S11)
// Connection wiring sub-domain (use-connection-wiring.ts): the
// wire-drag / tap-connect state machine and its geometry. The
// dispatchers below read and write its refs exactly as before.
const {
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
} = useConnectionWiring({
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
});

// Long-press sub-domain (use-long-press.ts): the armed ~500ms
// touch long-press that fires the context menu; the dispatchers
// arm its timer on pointer-down and disarm it on move/up.
const { longPressRef, cancelLongPress, fireLongPress } = useLongPress({
  gestureRef,
  setNodeDragging,
  connectingRef,
  clearConnecting,
  selectionBoxRef,
  setSelectionBox,
  selectedIdsRef,
  updateSelectedIds,
  updateSelectedEdgeId,
  setContextMenu,
  setCreateMenu,
  screenToWorld,
});


// ------------------------------------------------------- canvas gestures
const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
  if (e.button === 2) return; // right button never starts a gesture
  const target = e.target as HTMLElement;
  if (target.closest("[data-ui]")) return;
  if (target.closest("[data-canvas-menu]")) return;
  if (target.closest("[data-node-media]")) {
    // Media regions keep their own clicks — with one scoped
    // exception: a surface marked data-node-drag-surface (the
    // video picture) starts node drags like the rest of the card,
    // so the node no longer drags only by its title bar. Two
    // carve-outs stay with the media: real controls inside the
    // surface (e.g. the zoom button) and the video's bottom
    // native-controls strip. The card's own pointerup handler
    // still decides click-vs-drag for play/pause (a small tap
    // radius toggles — wider for touch than for the mouse — a
    // real drag never does).
    const surface = target.closest(
      "[data-node-drag-surface]",
    ) as HTMLElement | null;
    if (!surface) return;
    if (target.closest("button, input, select, textarea, a")) return;
    if (e.clientY > surface.getBoundingClientRect().bottom - 44) return;
    // fall through: selection + node-drag gesture below
  }
  if (e.button !== 0 && e.button !== 1) return;

  // ---- multi-touch: a second finger converts the running
  // gesture into a pinch (zoom about the two-finger center, pan
  // with its movement). The interrupted single-pointer gesture is
  // cancelled outright — neither finger resumes it afterwards.
  if (e.pointerType !== "mouse") {
    activePointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });
    if (pinchRef.current) return;
    if (activePointersRef.current.size === 2) {
      const pts = [...activePointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      const rect = canvasRef.current?.getBoundingClientRect();
      if (a && b && rect) {
        cancelLongPress();
        gestureRef.current = null;
        setNodeDragging(false);
        selectionBoxRef.current = null;
        setSelectionBox(null);
        if (connectingRef.current) clearConnecting();
        pinchRef.current = {
          startDist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
          startCx: (a.x + b.x) / 2 - rect.left,
          startCy: (a.y + b.y) / 2 - rect.top,
          viewport: viewportRef.current,
        };
      }
      return;
    }
    // Arm the long-press context menu for a lone touch that
    // stays put (~500ms, small radius — the move/up handlers
    // disarm it the moment the press turns into a drag).
    if (e.pointerType === "touch" && activePointersRef.current.size === 1) {
      cancelLongPress();
      const pressX = e.clientX;
      const pressY = e.clientY;
      const timer = window.setTimeout(
        () => fireLongPress(pressX, pressY),
        500,
      );
      longPressRef.current = {
        timer,
        pointerId: e.pointerId,
        x: pressX,
        y: pressY,
      };
    }
  }

  // ---- tap-to-connect interception: with a source armed, a tap
  // on another node completes the wire; a tap anywhere else
  // (background, source itself, a handle) disarms it and falls
  // through to the normal gesture.
  const tc = tapConnectRef.current;
  if (tc) {
    const tcNodeEl = target.closest("[data-node-id]") as HTMLElement | null;
    const tcTargetId = tcNodeEl?.dataset.nodeId;
    clearTapConnect();
    if (tcTargetId && tcTargetId !== tc.nodeId) {
      addConnection(tc, tcTargetId);
      return;
    }
  }

  const handleEl = target.closest("[data-connect-node]") as HTMLElement | null;
  if (handleEl && e.button === 0) {
    const nodeId = handleEl.dataset.connectNode;
    const handleType = handleEl.dataset.connectType as "source" | "target" | undefined;
    if (nodeId && handleType) {
      handlePressRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      };
      const conn: ConnectingState = { nodeId, handleType };
      connectingRef.current = conn;
      setConnecting(conn);
      setConnectTargetId(null);
      updateSelectedEdgeId(null);
      setMouseWorld(screenToWorld(e.clientX, e.clientY));
    }
    return;
  }

  if (target.closest("[data-connection-id]")) return; // edge clicks select via onClick

  const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
  if (nodeEl) {
    const nodeId = nodeEl.dataset.nodeId;
    if (!nodeId) return;
    // A touch press inside a text node's scrollable content
    // belongs to the content: the browser scrolls it natively
    // (the content opts into pan-y), and the canvas must not
    // turn the swipe into a node drag. The press still selects.
    if (e.pointerType === "touch" && target.closest("[data-text-scroll]")) {
      if (!selectedIdsRef.current.has(nodeId)) {
        updateSelectedIds(new Set([nodeId]));
      }
      updateSelectedEdgeId(null);
      setContextMenu(null);
      gestureRef.current = { kind: "none" };
      return;
    }
    // Multi-select mode: tapping an unselected node only adds it
    // to the selection (no drag starts on this press); dragging
    // works from the next press, when it is already selected.
    if (multiSelectRef.current && !selectedIdsRef.current.has(nodeId)) {
      const next = new Set(selectedIdsRef.current);
      next.add(nodeId);
      updateSelectedIds(next);
      updateSelectedEdgeId(null);
      setContextMenu(null);
      gestureRef.current = { kind: "none" };
      return;
    }
    if (e.button === 1 || spaceRef.current) {
      gestureRef.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        viewport: viewportRef.current,
        moved: false,
        startedOnBackground: false,
      };
      return;
    }
    // Upstream selectNodeByEvent: toggle with shift/meta/ctrl, else solo.
    const prev = selectedIdsRef.current;
    let nextSelected: Set<string>;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      nextSelected = new Set(prev);
      if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
      else nextSelected.add(nodeId);
    } else if (prev.has(nodeId)) {
      nextSelected = prev;
    } else {
      nextSelected = new Set([nodeId]);
    }
    // Was the detail editor open for THIS node before the gesture?
    // (single selection of it, not drag-suppressed). A drag that
    // starts a fresh selection must not summon the editor; a drag
    // of an already-open node may keep it after the drop.
    const editorWasOpen =
      prev.size === 1 && prev.has(nodeId) && suppressedEditorRef.current !== nodeId;
    updateSelectedIds(nextSelected);
    updateSelectedEdgeId(null);
    setContextMenu(null);
    // Drag origins: the whole selection plus children of selected groups.
    const origins = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      if (nextSelected.has(n.id)) origins.set(n.id, { x: n.x, y: n.y });
    }
    for (const n of nodesRef.current) {
      if (n.groupId && nextSelected.has(n.groupId)) {
        origins.set(n.id, { x: n.x, y: n.y });
      }
    }
    // One undo step per drag: node moves bypass applyNodes while
    // dragging (they write the refs directly), so record up front.
    recordHistory();
    gestureRef.current = {
      kind: "node",
      startX: e.clientX,
      startY: e.clientY,
      origins,
      moved: false,
      primaryId: nodeId,
      editorWasOpen,
      tapToggleId:
        multiSelectRef.current && prev.has(nodeId) ? nodeId : undefined,
    };
    return;
  }

  // Background. Upstream infinite-canvas semantics: the base tool
  // (toolbar toggle, default pan) decides what a plain drag does,
  // and Ctrl / Meta / Space temporarily INVERTS it — so with the
  // default pan tool a plain drag pans the canvas and Ctrl+drag
  // draws the selection box. The middle button always pans.
  const temporaryTool = e.ctrlKey || e.metaKey || spaceRef.current;
  const activeTool = temporaryTool
    ? canvasTool === "pan"
      ? "select"
      : "pan"
    : canvasTool;
  if (e.button === 1 || activeTool === "pan") {
    gestureRef.current = {
      kind: "pan",
      startX: e.clientX,
      startY: e.clientY,
      viewport: viewportRef.current,
      moved: false,
      startedOnBackground: true,
    };
    return;
  }
  const world = screenToWorld(e.clientX, e.clientY);
  const box: SelectionBoxState = {
    startWorldX: world.x,
    startWorldY: world.y,
    currentWorldX: world.x,
    currentWorldY: world.y,
    additive: e.shiftKey,
    initialSelectedNodeIds: e.shiftKey ? [...selectedIdsRef.current] : [],
  };
  selectionBoxRef.current = box;
  setSelectionBox(box);
  if (!e.shiftKey) updateSelectedIds(new Set());
  updateSelectedEdgeId(null);
  setContextMenu(null);
  gestureRef.current = { kind: "box" };
};

const handleWindowPointerMove = useCallback(
  (e: PointerEvent) => {
    // Pinch in progress: zoom is anchored so the world point
    // under the fingers' starting center stays under their
    // current center — the same math gives two-finger pan.
    const pinch = pinchRef.current;
    if (pinch) {
      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
      }
      const pts = [...activePointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      const rect = canvasRef.current?.getBoundingClientRect();
      if (a && b && rect) {
        const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        const cx = (a.x + b.x) / 2 - rect.left;
        const cy = (a.y + b.y) / 2 - rect.top;
        const zoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, pinch.viewport.zoom * (dist / pinch.startDist)),
        );
        const wx = (pinch.startCx - pinch.viewport.x) / pinch.viewport.zoom;
        const wy = (pinch.startCy - pinch.viewport.y) / pinch.viewport.zoom;
        applyViewport({ zoom, x: cx - wx * zoom, y: cy - wy * zoom }, false);
      }
      return;
    }
    if (pinchStaleRef.current.has(e.pointerId)) return;
    // A press that wanders is a drag, not a long-press.
    const lp = longPressRef.current;
    if (
      lp &&
      lp.pointerId === e.pointerId &&
      Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10
    ) {
      cancelLongPress();
    }
    const conn = connectingRef.current;
    if (conn && !pendingConnectRef.current) {
      setMouseWorld(screenToWorld(e.clientX, e.clientY));
      setConnectTargetId(computeDropTarget(e.clientX, e.clientY, conn).nodeId);
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind === "none") return;
    if (gesture.kind === "pan") {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      applyViewport(
        { ...gesture.viewport, x: gesture.viewport.x + dx, y: gesture.viewport.y + dy },
        false,
      );
      return;
    }
    if (gesture.kind === "node") {
      const dx = e.clientX - gesture.startX;
      const dy = e.clientY - gesture.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        if (!gesture.moved) setNodeDragging(true);
        gesture.moved = true;
      }
      if (!gesture.moved) return;
      const zoom = viewportRef.current.zoom;
      const next = nodesRef.current.map((n) => {
        const origin = gesture.origins.get(n.id);
        return origin
          ? { ...n, x: origin.x + dx / zoom, y: origin.y + dy / zoom }
          : n;
      });
      nodesRef.current = next;
      setNodes(next);
      return;
    }
    // Box selection: live-update the rect and the selection (upstream).
    const box = selectionBoxRef.current;
    if (!box) return;
    if (e.buttons === 0) {
      selectionBoxRef.current = null;
      setSelectionBox(null);
      gestureRef.current = null;
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    const rectX = Math.min(box.startWorldX, world.x);
    const rectY = Math.min(box.startWorldY, world.y);
    const rectW = Math.abs(world.x - box.startWorldX);
    const rectH = Math.abs(world.y - box.startWorldY);
    const nextSelected = new Set<string>(
      box.additive ? box.initialSelectedNodeIds : [],
    );
    for (const node of nodesRef.current) {
      if (node.hidden) continue;
      const intersects =
        rectX < node.x + node.width &&
        rectX + rectW > node.x &&
        rectY < node.y + node.height &&
        rectY + rectH > node.y;
      if (intersects) nextSelected.add(node.id);
    }
    const nextBox = { ...box, currentWorldX: world.x, currentWorldY: world.y };
    selectionBoxRef.current = nextBox;
    setSelectionBox(nextBox);
    updateSelectedIds(nextSelected);
  },
  [applyViewport, cancelLongPress, computeDropTarget, screenToWorld, updateSelectedIds],
);

const handleWindowPointerUp = useCallback(
  (e: PointerEvent) => {
    // ---- multi-touch bookkeeping first: a pinch ends when one
    // of its fingers lifts; the finger still down goes stale so
    // it cannot resume the gesture the pinch cancelled.
    activePointersRef.current.delete(e.pointerId);
    if (longPressRef.current?.pointerId === e.pointerId) cancelLongPress();
    if (pinchRef.current) {
      pinchRef.current = null;
      handlePressRef.current = null;
      for (const id of activePointersRef.current.keys()) {
        pinchStaleRef.current.add(id);
      }
      scheduleSave();
      return;
    }
    if (pinchStaleRef.current.has(e.pointerId)) {
      pinchStaleRef.current.delete(e.pointerId);
      return;
    }
    const conn = connectingRef.current;
    if (conn && !pendingConnectRef.current) {
      const drop = computeDropTarget(e.clientX, e.clientY, conn);
      const hp = handlePressRef.current;
      handlePressRef.current = null;
      const handleTap =
        hp !== null &&
        hp.pointerId === e.pointerId &&
        Math.hypot(e.clientX - hp.x, e.clientY - hp.y) < 8;
      if (drop.nodeId) {
        addConnection(conn, drop.nodeId);
        clearConnecting();
      } else if (handleTap && drop.isNearNode) {
        // A plain tap on a connect handle (the natural touch
        // gesture, where dragging a wire is fiddly): arm
        // tap-to-connect instead of dropping the wire — the next
        // node tapped becomes the target.
        tapConnectRef.current = conn;
        setTapConnect(conn);
        connectingRef.current = null;
        setConnecting(null);
        setConnectTargetId(null);
      } else if (drop.isNearNode) {
        clearConnecting();
      } else {
        const world = screenToWorld(e.clientX, e.clientY);
        const pending: PendingConnectState = {
          connection: conn,
          worldX: world.x,
          worldY: world.y,
          x: e.clientX,
          y: e.clientY,
        };
        pendingConnectRef.current = pending;
        setPendingConnect(pending);
        setConnectTargetId(null);
      }
    }
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    if (gesture.kind === "pan") {
      // Multi-select mode keeps the selection across background
      // taps (the mode's own pill / toolbar toggle exits it).
      // A release that lands on UI chrome (e.g. a portaled menu
      // rooted in <body>) is not a background tap either — it
      // must never clear the selection out from under an open
      // panel.
      const upTarget = e.target as HTMLElement | null;
      const releasedOnUi =
        !!upTarget &&
        typeof upTarget.closest === "function" &&
        upTarget.closest("[data-ui],[data-canvas-menu]") !== null;
      if (
        !gesture.moved &&
        gesture.startedOnBackground &&
        !multiSelectRef.current &&
        !releasedOnUi
      ) {
        updateSelectedIds(new Set());
        updateSelectedEdgeId(null);
      }
      scheduleSave();
    } else if (gesture.kind === "node") {
      setNodeDragging(false);
      if (gesture.moved) {
        scheduleSave();
        // A drag must not summon the detail editor: if this drag
        // started the selection, keep the editor suppressed for the
        // dragged node until a later plain click; if the editor was
        // already open for it, it simply reappears.
        if (!gesture.editorWasOpen) setEditorSuppressed(gesture.primaryId);
        else if (suppressedEditorRef.current === gesture.primaryId) {
          setEditorSuppressed(null);
        }
      } else if (suppressedEditorRef.current === gesture.primaryId) {
        // Plain click on the dragged-suppressed node: open the editor.
        setEditorSuppressed(null);
      }
      // Multi-select mode: a tap on an already-selected node
      // toggles it back out (a drag never toggles).
      if (gesture.tapToggleId && !gesture.moved) {
        const next = new Set(selectedIdsRef.current);
        next.delete(gesture.tapToggleId);
        updateSelectedIds(next);
      }
    } else if (gesture.kind === "box") {
      selectionBoxRef.current = null;
      setSelectionBox(null);
    }
  },
  [addConnection, cancelLongPress, clearConnecting, computeDropTarget, scheduleSave, screenToWorld, setEditorSuppressed, updateSelectedEdgeId, updateSelectedIds],
);

const handleKeyDown = useCallback(
  (e: KeyboardEvent) => {
    if (e.code === "Space" && !isFormTarget(e.target)) {
      e.preventDefault();
      spaceRef.current = true;
      setSpaceDown(true);
    }
    if (isFormTarget(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redoGraph();
      else undoGraph();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoGraph();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedEdgeIdRef.current) {
        e.preventDefault();
        deleteEdge(selectedEdgeIdRef.current);
      } else if (selectedIdsRef.current.size) {
        e.preventDefault();
        deleteNodes(new Set(selectedIdsRef.current));
      }
    } else if (e.key === "Escape") {
      if (tapConnectRef.current) clearTapConnect();
      else if (pendingConnectRef.current) cancelPendingConnect();
      else if (connectingRef.current) clearConnecting();
      else {
        setContextMenu(null);
        setCreateMenu(null);
        updateSelectedIds(new Set());
        updateSelectedEdgeId(null);
      }
    }
  },
  [cancelPendingConnect, clearConnecting, clearTapConnect, deleteEdge, deleteNodes, redoGraph, undoGraph, updateSelectedEdgeId, updateSelectedIds],
);

useEffect(() => {
  const up = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      spaceRef.current = false;
      setSpaceDown(false);
    }
  };
  const blur = () => {
    spaceRef.current = false;
    setSpaceDown(false);
    gestureRef.current = null;
    setNodeDragging(false);
    pinchRef.current = null;
    activePointersRef.current.clear();
    pinchStaleRef.current.clear();
    cancelLongPress();
  };
  window.addEventListener("pointermove", handleWindowPointerMove);
  window.addEventListener("pointerup", handleWindowPointerUp);
  window.addEventListener("pointercancel", handleWindowPointerUp);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("pointermove", handleWindowPointerMove);
    window.removeEventListener("pointerup", handleWindowPointerUp);
    window.removeEventListener("pointercancel", handleWindowPointerUp);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}, [handleKeyDown, handleWindowPointerMove, handleWindowPointerUp]);

// Wheel zoom, bound natively (non-passive) as soon as the canvas element
// mounts — the first wheel event after a cold start must already zoom.
// Upstream handleWheel: factor = 1.1^(-deltaY/100), k clamped to
// [0.05, 5], anchored so the world point under the cursor stays put.
const applyViewportRef = useRef(applyViewport);
applyViewportRef.current = applyViewport;
useEffect(() => {
  const el = canvasRef.current;
  if (!el) return;
  const onWheelNative = (event: WheelEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-canvas-no-zoom]")) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const vp = viewportRef.current;
    const factor = Math.pow(1.1, -event.deltaY / 100);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor));
    const wx = (mx - vp.x) / vp.zoom;
    const wy = (my - vp.y) / vp.zoom;
    applyViewportRef.current({ zoom, x: mx - wx * zoom, y: my - wy * zoom });
  };
  el.addEventListener("wheel", onWheelNative, { passive: false });
  return () => el.removeEventListener("wheel", onWheelNative);
}, []);

// ------------------------------------------------------------- context menus
const onCanvasContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
  e.preventDefault();
  const target = e.target as HTMLElement;
  if (target.closest("[data-ui]") || target.closest("[data-canvas-menu]")) return;
  const nodeEl = target.closest("[data-node-id]") as HTMLElement | null;
  if (nodeEl) {
    const nodeId = nodeEl.dataset.nodeId;
    if (!nodeId) return;
    if (!selectedIdsRef.current.has(nodeId)) {
      updateSelectedIds(new Set([nodeId]));
    }
    updateSelectedEdgeId(null);
    setCreateMenu(null);
    setContextMenu({ type: "node", nodeId, x: e.clientX, y: e.clientY });
    return;
  }
  if (target.closest("[data-connection-id]")) return; // the path opens its own menu
  const world = screenToWorld(e.clientX, e.clientY);
  setContextMenu(null);
  setCreateMenu({ x: e.clientX, y: e.clientY, worldX: world.x, worldY: world.y });
};

const onCanvasDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
  const target = e.target as HTMLElement;
  if (target.closest("[data-ui],[data-canvas-menu],[data-node-id],[data-connection-id]")) return;
  const world = screenToWorld(e.clientX, e.clientY);
  setContextMenu(null);
  setCreateMenu({ x: e.clientX, y: e.clientY, worldX: world.x, worldY: world.y });
};

  return {
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
  };
}
