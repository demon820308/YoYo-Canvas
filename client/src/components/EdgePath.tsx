// One canvas connection: an invisible fat hit path (click select /
// right-click menu) under the visible stroke. Path geometry is
// canvas-geometry's edgePathD; this file only renders it.

import { edgePathD } from "../canvas-geometry";
import type { CanvasEdge, CanvasNode } from "../types";

export function EdgePath({
  edge,
  from,
  to,
  active,
  onSelect,
  onContextMenu,
}: {
  edge: CanvasEdge;
  from: CanvasNode;
  to: CanvasNode;
  active: boolean;
  onSelect: () => void;
  onContextMenu: (clientX: number, clientY: number) => void;
}) {
  const d = edgePathD(from, to);
  return (
    <g>
      <path
        data-connection-id={edge.id}
        d={d}
        fill="none"
        style={{
          stroke: "transparent",
          strokeWidth: 16,
          cursor: "pointer",
          pointerEvents: "stroke",
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenu(event.clientX, event.clientY);
        }}
      />
      <path
        d={d}
        fill="none"
        style={{
          stroke: active ? "var(--accent)" : "var(--dim)",
          strokeWidth: active ? 3 : 2,
          strokeOpacity: active ? 1 : 0.82,
          pointerEvents: "none",
          filter: active ? "drop-shadow(0 0 8px rgba(var(--accent-rgb),0.4))" : undefined,
        }}
      />
    </g>
  );
}
