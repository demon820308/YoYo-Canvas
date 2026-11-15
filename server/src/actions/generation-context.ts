// generation-context.ts — 生成输入收集（collectInputs）与生成
// 上下文组装（buildGenerationContext）：连入节点展开、@ 引用编号
// 与提示词拼装。拆分来源：批次 S1 自 server/src/actions.ts 整段
// 搬移，行为不变。

import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import type { Db, NodeRow } from "./contracts";

// ---------------------------------------------------------------------------
// Generation context (upstream buildNodeGenerationContext semantics):
// inputs are the nodes connected INTO the generation node, in edge
// order; a connected group expands to its member resource nodes;
// duplicates collapse. In composer mode (the prompt carries @[node:id]
// chips) only chip-referenced inputs are used and each chip is replaced
// by its reference label; otherwise every input is used and connected
// text is appended as labeled blocks.
// ---------------------------------------------------------------------------

export interface GenResource {
nodeId: string;
type: "text" | "image" | "video" | "audio";
title: string;
text: string;
filePath: string | null;
hasMedia: boolean;
}

export interface GenContext {
prompt: string;
refs: GenResource[];
imageRefs: GenResource[];
}

export async function collectInputs(db: Db, node: NodeRow): Promise<NodeRow[]> {
const inEdges = await db
.select({ fromNodeId: schema.canvasEdges.fromNodeId})
.from(schema.canvasEdges)
.where(
and(
eq(schema.canvasEdges.projectId, node.projectId),
eq(schema.canvasEdges.toNodeId, node.id),
),
)
.orderBy(asc(schema.canvasEdges.sortOrder), asc(schema.canvasEdges.createdAt));
if (inEdges.length === 0) return [];
const ids = [...new Set(inEdges.map((e) => e.fromNodeId))];
const rows = await db
.select()
.from(schema.canvasNodes)
.where(inArray(schema.canvasNodes.id, ids));
const byId = new Map(rows.map((r) => [r.id, r]));
const ordered = ids
.map((id) => byId.get(id))
.filter((r): r is NodeRow => Boolean(r) && r!.id!== node.id);
// Flatten groups into their member nodes (upstream group expansion).
const flattened: NodeRow[] = [];
for (const row of ordered) {
if (row.type === "group") {
const members = await db
.select()
.from(schema.canvasNodes)
.where(
and(
eq(schema.canvasNodes.projectId, node.projectId),
eq(schema.canvasNodes.groupId, row.id),
),
)
.orderBy(asc(schema.canvasNodes.sortOrder), asc(schema.canvasNodes.createdAt));
flattened.push(...members.filter((m) => m.type!== "group"));
} else {
flattened.push(row);
}
}
const seen = new Set<string>();
return flattened.filter((r) => {
if (seen.has(r.id)) return false;
seen.add(r.id);
return true;
});
}

export function toResource(row: NodeRow): GenResource | null {
if (row.type === "image" || row.type === "video" || row.type === "audio") {
if (!row.mediaBlobKey) return null;
return {
nodeId: row.id,
type: row.type,
title: row.title,
text: "",
filePath: row.filePath,
hasMedia: true,
};
}
if (
row.type === "text" ||
row.type === "config" ||
row.type === "sticky-note"
) {
// Text-ish nodes feed config context as text: text and config nodes
// give their content, sticky notes their note text.
const text = (row.content || row.prompt || "").trim();
return text
? {
nodeId: row.id,
type: "text" as const,
title: row.title,
text,
filePath: null,
hasMedia: false,
}
: null;
}
return null;
}

export const REF_LABEL_PREFIX: Record<GenResource["type"], string> = {
image: "图片",
video: "视频",
audio: "音频",
text: "文本",
};

export async function buildGenerationContext(
db: Db,
node: NodeRow,
rawPrompt: string,
): Promise<GenContext> {
const inputs = await collectInputs(db, node);
const resources = inputs
.map(toResource)
.filter((r): r is GenResource => r!== null);
const byId = new Map(resources.map((r) => [r.nodeId, r]));
const hasChips = /@\[node:[^\]]+\]/.test(rawPrompt);
if (!hasChips) {
const textBlocks: string[] = [];
let textIdx = 0;
for (const r of resources) {
if (r.type === "text") {
textIdx += 1;
textBlocks.push(`\n${r.text}`);
}
}
const prompt = textBlocks.length
? `${rawPrompt.trim()}\n\n${textBlocks.join("\n\n")}`.trim()
: rawPrompt.trim();
return {
prompt,
refs: resources,
imageRefs: resources.filter((r) => r.type === "image"),
};
}
// Composer mode: chips select and order the references.
const counts: Record<GenResource["type"], number> = {
image: 0,
video: 0,
audio: 0,
text: 0,
};
const labelByNodeId = new Map<string, string>();
const selected: GenResource[] = [];
const textBlocks: string[] = [];
const labelFor = (r: GenResource): string => {
const existing = labelByNodeId.get(r.nodeId);
if (existing) return existing;
counts[r.type] += 1;
const label = `${REF_LABEL_PREFIX[r.type]}${counts[r.type]}`;
labelByNodeId.set(r.nodeId, label);
if (r.type === "text") textBlocks.push(`\n${r.text}`);
else selected.push(r);
return label;
};
const expanded = rawPrompt.replace(/@\[node:([^\]]+)\]/g, (_m, id: string) => {
const r = byId.get(id);
if (!r) return "";
const label = labelFor(r);
return r.type === "text"? ``: label;
});
const prompt = textBlocks.length
? `${expanded.trim()}\n\n${textBlocks.join("\n\n")}`.trim()
: expanded.trim();
const refs = [...selected,...resources.filter((r) => r.type === "text" && labelByNodeId.has(r.nodeId))];
return { prompt, refs, imageRefs: selected.filter((r) => r.type === "image")};
}
