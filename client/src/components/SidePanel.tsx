// CanvasSidePanel — port of the upstream infinite-canvas side panel
// (canvas-side-panel.tsx) onto this space's own server data.
//
// Upstream interface kept verbatim:
//   nodes, selectedNodeIds, onFocusNode, onPreviewNode, onHoverNode,
//   onInsertAsset
// plus width/onWidthChange for the drag-resize edge. Three tabs:
// 资产 / 画布 / 提示词库 (assets first). The row's eye button is the preview control
// (it opens the media preview dialog); hiding/showing a node lives in
// the canvas detail editor's eye toggle.

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  Asset,
  CanvasNode,
  InsertAssetPayload,
} from "../types";
import { AssetsTab } from "./AssetsTab";
import { CanvasNodesTab } from "./CanvasNodesTab";
import { PromptsTab } from "./PromptsTab";

type PanelTab = "canvas" | "assets" | "prompts";

export type SidePanelProps = {
  /** The project currently open on the canvas. The asset library is
   * scoped to it: assets are per-project and never shared. */
  projectId: string;
  nodes: CanvasNode[];
  selectedNodeIds: Set<string>;
  onFocusNode: (nodeId: string) => void;
  onPreviewNode: (node: CanvasNode) => void;
  /** Opens the shared media previewer for an asset row (same dialog
   * the canvas list's eye button opens). */
  onPreviewAsset: (asset: Asset) => void;
  onHoverNode: (nodeId: string | null) => void;
  /** Hovering a media asset row shows the SAME shared hover preview
   * the canvas list uses (rendered by App over the canvas). */
  onHoverAsset: (asset: Asset | null) => void;
  onInsertAsset: (payload: InsertAssetPayload) => void;
  /** Rename a canvas node from its panel row (persists via the
   * board's regular node update + save path). */
  onRenameNode: (nodeId: string, title: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
};

const PANEL_MIN = 240;
const PANEL_MAX = 520;

export function SidePanel(props: SidePanelProps) {
  const [tab, setTab] = useState<PanelTab>("canvas");
  const [resizing, setResizing] = useState(false);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.width;
    let nextWidth = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.min(
        PANEL_MAX,
        Math.max(PANEL_MIN, startWidth + moveEvent.clientX - startX),
      );
      props.onWidthChange(nextWidth);
    };
    const onUp = () => {
      localStorage.setItem("yoyohua-bu-panel-width", String(nextWidth));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
    };
    setResizing(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
      style={{ width: props.width }}
      aria-label="画布侧边面板"
    >
      {/* The panel rises to the full screen height, flush with the
       * left edge; its tab row sits at the very top of the panel in
       * the same 56px row as the floating top cluster — on desktop
       * the cluster shifts to the panel's right edge, so the tabs
       * need no clearance below it and the content starts right
       * under this row. */}
      <div className="flex h-14 shrink-0 items-center gap-5 px-4">
        <TabButton label="资产" active={tab === "assets"} onClick={() => setTab("assets")} />
        <TabButton label="画布" active={tab === "canvas"} onClick={() => setTab("canvas")} />
        <TabButton label="提示词库" active={tab === "prompts"} onClick={() => setTab("prompts")} />
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {tab === "canvas" ? (
          <CanvasNodesTab {...props} />
        ) : tab === "assets" ? (
          <AssetsTab
            projectId={props.projectId}
            nodes={props.nodes}
            onInsert={props.onInsertAsset}
            onPreviewAsset={props.onPreviewAsset}
            onHoverAsset={props.onHoverAsset}
          />
        ) : (
          <PromptsTab onInsert={props.onInsertAsset} />
        )}
      </div>
      <button
        type="button"
        className="absolute inset-y-0 right-0 z-40 hidden w-3 translate-x-1/2 cursor-col-resize md:block"
        style={{ touchAction: "none" }}
        onPointerDown={startResize}
        aria-label="调整面板宽度"
        data-resizing={resizing}
      />
    </aside>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="relative pb-1.5 text-sm font-semibold transition-opacity"
      style={{ opacity: active ? 1 : 0.45 }}
    >
      {label}
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />
      ) : null}
    </button>
  );
}
