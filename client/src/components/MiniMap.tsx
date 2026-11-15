// Minimap, rebuilt to the old 无限画布 (wu-xian-hua-bu) minimap's spec
// at the user's direction: a 168x112 SVG on a dark surface panel. The
// mapped bounds are the union of the current viewport's world rect and
// every node's bounds, padded by 80 world units. Nodes draw as flat
// blocks — video teal, sticky notes amber, config blue, groups slate,
// everything else dim gray — and the viewport is an amber outline.
// Pointer down / drag re-centers the main viewport on the pointed
// world position.

import { useRef, useState } from "react";
import type { CanvasNode } from "../types";

export type ViewportLike = { x: number; y: number; zoom: number };

const MAP_W = 168;
const MAP_H = 112;
const BOUNDS_PAD = 80;

function blockColor(node: CanvasNode): string {
  switch (node.type) {
    case "video":
      return "var(--teal)";
    case "sticky-note":
      return "var(--accent)";
    case "config":
      return "#60a5fa";
    case "group":
      return "#94a3b8";
    default:
      return "var(--dim)";
  }
}

export function MiniMap({
  nodes,
  viewport,
  viewportSize,
  onViewportChange,
}: {
  nodes: CanvasNode[];
  viewport: ViewportLike;
  viewportSize: { width: number; height: number };
  onViewportChange: (viewport: ViewportLike) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);

  const viewWorld = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    w: viewportSize.width / viewport.zoom,
    h: viewportSize.height / viewport.zoom,
  };
  let minX = viewWorld.x;
  let minY = viewWorld.y;
  let maxX = viewWorld.x + viewWorld.w;
  let maxY = viewWorld.y + viewWorld.h;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  minX -= BOUNDS_PAD;
  minY -= BOUNDS_PAD;
  maxX += BOUNDS_PAD;
  maxY += BOUNDS_PAD;
  const scale = Math.min(MAP_W / (maxX - minX), MAP_H / (maxY - minY)) || 0;
  const toLocal = (wx: number, wy: number) => ({
    x: (wx - minX) * scale,
    y: (wy - minY) * scale,
  });
  const vp = toLocal(viewWorld.x, viewWorld.y);

  const navigateFromEvent = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || scale <= 0) return;
    const worldX = minX + (event.clientX - rect.left) / scale;
    const worldY = minY + (event.clientY - rect.top) / scale;
    onViewportChange({
      x: viewportSize.width / 2 - worldX * viewport.zoom,
      y: viewportSize.height / 2 - worldY * viewport.zoom,
      zoom: viewport.zoom,
    });
  };

  return (
    <div
      data-ui
      data-canvas-no-zoom
      className="safe-bottom-offset absolute right-3 z-40 overflow-hidden rounded-xl shadow-lg"
      style={{
        width: MAP_W,
        height: MAP_H,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
      role="img"
      aria-label="小地图"
    >
      <svg
        ref={svgRef}
        width={MAP_W}
        height={MAP_H}
        className="block cursor-pointer touch-none"
        role="img"
        aria-label="画布小地图，点击跳转视图"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          navigateFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (dragging) navigateFromEvent(event);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {nodes.map((n) => {
          const p = toLocal(n.x, n.y);
          return (
            <rect
              key={n.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, n.width * scale)}
              height={Math.max(2, n.height * scale)}
              rx={1.5}
              fill={blockColor(n)}
              opacity={0.75}
            />
          );
        })}
        <rect
          x={vp.x}
          y={vp.y}
          width={viewWorld.w * scale}
          height={viewWorld.h * scale}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
