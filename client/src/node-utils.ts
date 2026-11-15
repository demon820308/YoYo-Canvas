// Runtime helpers over canvas nodes, moved out of types.ts (which
// keeps only type definitions and pure constant tables): node-kind
// guards, chip-token cleanup, and the canvas list's label / preview
// text.

import {
  SEQ_TYPE_LABEL,
  type CanvasNode,
  type NodeType,
  type ToolNodeType,
} from "./types";

/** Node types whose content counts as text when gathered as an input
 * (config context on the server mirrors this list). */
export function isTextSourceType(type: NodeType): boolean {
  return type === "text" || type === "config" || type === "sticky-note";
}
export function isToolNodeType(type: NodeType): type is ToolNodeType {
  return (
    type === "video-frames" ||
    type === "audio-extract" ||
    type === "video-compose" ||
    type === "prompt-reverse"
  );
}
/** Replace @[node:id] chip tokens with a readable @引用 marker. */
export function stripChipTokens(text: string): string {
  return text.replace(/@\[node:[^\]]+\]/g, "@引用");
}
/** The canvas list's row heading for a node. A numbered node reads
 * "#NN - 类型 - 名字" for the media generation kinds (image / video /
 * audio) and "#NN - 类型" for everything else (text, tools, config,
 * sticky notes) — those rows never show the node's own name. A legacy
 * node with no number (seq null, pre-numbering stock) keeps the
 * plain title it has always shown. */
export function nodeListLabel(node: CanvasNode): string {
  if (node.seq == null) return node.title;
  const num = `#${String(node.seq).padStart(2, "0")}`;
  const label = SEQ_TYPE_LABEL[node.type];
  if (node.type === "image" || node.type === "video" || node.type === "audio") {
    return `${num} - ${label} - ${node.title}`;
  }
  return `${num} - ${label}`;
}
export function nodePreviewText(node: CanvasNode): string {
  if (node.type === "config") return node.prompt || node.content || "";
  return node.content || node.prompt || "";
}
export function isMediaUrl(content: string): boolean {
  return (
    content.startsWith("data:image/") ||
    content.startsWith("http://") ||
    content.startsWith("https://")
  );
}
