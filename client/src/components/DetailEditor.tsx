// Detail editor (extracted from App.tsx in batch S11): the big
// panel that opens under the selected node. The shell (anchoring,
// title row with name input / delete) plus the per-type editor
// bodies: the text node's content textarea, the generation panel
// for image/video/audio/config nodes, the tool panel for the four
// tool nodes, and the sticky-note panel. Placement (always below
// the node, narrow-screen bottom sheet) is computed by App and
// passed in as detailEditorStyle; visibility (selection, drag
// suppression) also stays with App — this component renders the
// panel for the node it is given.

import type { CSSProperties, RefObject } from "react";
import { StickyPanel } from "./StickyPanel";
import { GenerationPanel } from "./GenerationPanel";
import { ToolPanel } from "./ToolPanel";
import type { ToolRunOptions } from "./ToolNodeBody";
import type { NodeRunFeedback } from "./run-feedback";
import { IconTrash } from "../icons";
import { isToolNodeType } from "../node-utils";
import {
  NODE_TYPE_LABEL,
  STATUS_COLOR,
  type CanvasNode,
  type ConnectingState,
  type ReferenceInfo,
} from "../types";

export type DetailEditorProps = {
  detailEditorRef: RefObject<HTMLDivElement | null>;
  detailEditorStyle: CSSProperties | undefined;
  panelFlash: boolean;
  selectedNode: CanvasNode;
  selectedReferences: ReferenceInfo[];
  nodes: CanvasNode[];
  genBusyId: string | null;
  runFeedback: Record<string, NodeRunFeedback>;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  deleteNodes: (ids: Set<string>) => void;
  deleteEdge: (id: string) => void;
  addConnection: (conn: ConnectingState, targetNodeId: string) => void;
  runGeneration: (node: CanvasNode) => Promise<void>;
  runTool: (node: CanvasNode, options?: ToolRunOptions) => Promise<void>;
};

export function DetailEditor({
  detailEditorRef,
  detailEditorStyle,
  panelFlash,
  selectedNode,
  selectedReferences,
  nodes,
  genBusyId,
  runFeedback,
  updateNode,
  deleteNodes,
  deleteEdge,
  addConnection,
  runGeneration,
  runTool,
}: DetailEditorProps) {
  return (
    <div
      ref={detailEditorRef}
      data-ui
      data-canvas-no-zoom
      className={`detail-editor capsule-chrome absolute z-30 max-h-[min(560px,72vh)] w-[min(620px,94%)] overflow-y-auto rounded-[22px] p-5 ${
        panelFlash
          ? "ring-2 ring-[rgba(var(--accent-rgb),0.45)]"
          : ""
      }`}
      style={detailEditorStyle}
      aria-label="节点编辑"
    >
      {/* The editor's title row (name input + type label +
       * delete) is omitted for the four tool nodes and
       * the config node at the user's call — their panels stand
       * alone without it. Every other node type keeps the row
       * unchanged. */}
      {!isToolNodeType(selectedNode.type) &&
      selectedNode.type !== "config" ? (
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: STATUS_COLOR[selectedNode.status] }}
          aria-hidden="true"
        />
        <input
          value={selectedNode.title}
          onChange={(e) => updateNode(selectedNode.id, { title: e.target.value })}
          aria-label="节点标题"
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm font-medium outline-none focus:border-[var(--accent)]"
        />
        <span className="shrink-0 text-xs text-[var(--dim)]">
          {NODE_TYPE_LABEL[selectedNode.type]}
        </span>
        <button
          type="button"
          onClick={() => deleteNodes(new Set([selectedNode.id]))}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--danger)]"
          aria-label="删除此节点"
        >
          <IconTrash size={16} />
        </button>
      </div>
      ) : null}
      {selectedNode.type === "text" ? (
        <textarea
          value={selectedNode.content}
          onChange={(e) => updateNode(selectedNode.id, { content: e.target.value })}
          aria-label="节点内容"
          placeholder="节点内容…"
          rows={3}
          className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      ) : null}
      {selectedNode.type === "image" ||
      selectedNode.type === "video" ||
      selectedNode.type === "audio" ||
      selectedNode.type === "config" ? (
        <GenerationPanel
          key={selectedNode.id}
          node={selectedNode}
          references={selectedReferences}
          candidates={nodes}
          onPatch={(patch) => updateNode(selectedNode.id, patch)}
          onDisconnect={(edgeId) => deleteEdge(edgeId)}
          onConnectNode={(nodeId) =>
            addConnection(
              { nodeId, handleType: "source" },
              selectedNode.id,
            )
          }
          onGenerate={() => void runGeneration(selectedNode)}
          busy={genBusyId === selectedNode.id}
          feedback={runFeedback[selectedNode.id]}
        />
      ) : null}
      {isToolNodeType(selectedNode.type) ? (
        <ToolPanel
          key={selectedNode.id}
          node={selectedNode}
          references={selectedReferences}
          onDisconnect={(edgeId) => deleteEdge(edgeId)}
          onRun={(options) => void runTool(selectedNode, options)}
          busy={genBusyId === selectedNode.id}
          feedback={runFeedback[selectedNode.id]}
        />
      ) : null}
      {selectedNode.type === "sticky-note" ? (
        <StickyPanel
          node={selectedNode}
          onPatch={(patch) => updateNode(selectedNode.id, patch)}
        />
      ) : null}
    </div>
  );
}
