// Long-press context menu (extracted from use-canvas-gestures.ts
// in batch S11 — a verbatim move, no behavior change): the armed
// touch long-press state. A lone touch that stays within a small
// radius for ~500ms fires the context menu (the dispatchers in
// use-canvas-gestures arm the timer and disarm it on move/up);
// firing cancels whatever gesture the press had started and opens
// the same menus a right-click opens. Thresholds are the ones the
// gesture layer has always used — arming ~500ms, disarm radius
// 10px (in the move handler), video-toggle suppression 800ms.

import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { suppressVideoToggleUntil } from "../components/NodeCard";
import type {
  ContextMenuState,
  CreateMenuState,
  GestureState,
} from "./use-canvas-gestures";
import type { ConnectingState, SelectionBoxState } from "../types";

export function useLongPress({
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
}: {
  gestureRef: { current: GestureState | null };
  setNodeDragging: Dispatch<SetStateAction<boolean>>;
  connectingRef: { current: ConnectingState | null };
  clearConnecting: () => void;
  selectionBoxRef: { current: SelectionBoxState | null };
  setSelectionBox: Dispatch<SetStateAction<SelectionBoxState | null>>;
  selectedIdsRef: { current: Set<string> };
  updateSelectedIds: (next: Set<string>) => void;
  updateSelectedEdgeId: (next: string | null) => void;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  setCreateMenu: Dispatch<SetStateAction<CreateMenuState | null>>;
  screenToWorld: (clientX: number, clientY: number) => { x: number; y: number };
}) {
// Armed long-press (touch only): fires the context menu after
// ~500ms if the pointer stays within a small radius.
const longPressRef = useRef<{
  timer: number;
  pointerId: number;
  x: number;
  y: number;
} | null>(null);

const cancelLongPress = useCallback(() => {
  if (longPressRef.current) {
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  }
}, []);

/** Long-press fired: cancel whatever gesture the press had
 * started and open the same menus a right-click opens (node menu
 * on a node, create menu on the background). The element under
 * the finger decides — the press position never moved, so it is
 * still the element the gesture began on. */
const fireLongPress = useCallback(
  (x: number, y: number) => {
    longPressRef.current = null;
    suppressVideoToggleUntil(Date.now() + 800);
    gestureRef.current = null;
    setNodeDragging(false);
    if (connectingRef.current) clearConnecting();
    selectionBoxRef.current = null;
    setSelectionBox(null);
    const el = document.elementFromPoint(x, y);
    const nodeEl = el?.closest?.("[data-node-id]") as HTMLElement | null;
    const nodeId = nodeEl?.dataset.nodeId;
    if (nodeId) {
      if (!selectedIdsRef.current.has(nodeId)) {
        updateSelectedIds(new Set([nodeId]));
      }
      updateSelectedEdgeId(null);
      setCreateMenu(null);
      setContextMenu({ type: "node", nodeId, x, y });
    } else {
      const world = screenToWorld(x, y);
      setContextMenu(null);
      setCreateMenu({ x, y, worldX: world.x, worldY: world.y });
    }
  },
  [clearConnecting, screenToWorld, updateSelectedEdgeId, updateSelectedIds],
);

  return { longPressRef, cancelLongPress, fireLongPress };
}
