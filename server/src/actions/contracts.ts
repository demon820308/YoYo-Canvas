// contracts.ts — YoYo画布服务端契约层：zod 请求/响应 schema、行类型
// （Db / NodeRow / ProjectRow / EdgeRow）与行→线型的转换（toNode /
// toEdge / parseTags）。只放契约与纯转换，不放业务逻辑。
// 拆分来源：批次 S1 自 server/src/actions.ts 整段搬移，行为不变。

import { z, type Ctx, type SpaceDb } from "@hatch/space-sdk";
import * as schema from "../schema";

export type Db = SpaceDb<typeof schema>;
export type NodeRow = typeof schema.canvasNodes.$inferSelect;
export type ProjectRow = typeof schema.projects.$inferSelect;

export const nodeType = z.enum([
  "image",
  "video",
  "text",
  "audio",
  "config",
  "group",
  "video-frames",
  "audio-extract",
  "video-compose",
  "prompt-reverse",
  "sticky-note",
]);

/** The four tool node types (run via runToolNode, never via generation). */
export const TOOL_TYPES = new Set<string>([
  "video-frames",
  "audio-extract",
  "video-compose",
  "prompt-reverse",
]);

export const nodeStatus = z.enum(["idle", "loading", "success", "error"]);
export const genStatusEnum = z.enum(["idle", "queued", "working", "done", "failed"]);
export const genKindEnum = z.enum(["image", "video", "audio", "text", "tool"]);
export const genModeEnum = z.enum(["image", "text", "video", "audio"]);

export const nodeShape = z.object({
  id: z.string(),
  projectId: z.string(),
  // Per-project birth number (see schema): server-assigned, immutable,
  // null for pre-numbering legacy nodes.
  seq: z.number().nullable(),
  type: nodeType,
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  content: z.string(),
  prompt: z.string(),
  status: nodeStatus,
  hidden: z.boolean(),
  groupId: z.string().nullable(),
  color: z.string().nullable(),
  freeResize: z.boolean(),
  fontSize: z.number().nullable(),
  genStatus: genStatusEnum,
  genError: z.string().nullable(),
  genStartedAt: z.string().nullable(),
  genRatio: z.string().nullable(),
  genSize: z.string().nullable(),
  genDuration: z.number().nullable(),
  genKind: genKindEnum.nullable(),
  genMode: genModeEnum.nullable(),
  mediaBlobKey: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  filePath: z.string().nullable(),
  posterBlobKey: z.string().nullable(),
  posterUrl: z.string().nullable(),
  proxyBlobKey: z.string().nullable(),
  proxyUrl: z.string().nullable(),
});

// What the client may write through saveGraph/addNode: layout + text +
// the editable generation parameters. Every other gen/media column is
// server-owned and is never overwritten by a board save.
export const nodeInput = z.object({
  id: z.string(),
  type: nodeType,
  title: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  content: z.string(),
  prompt: z.string(),
  status: nodeStatus,
  hidden: z.boolean(),
  groupId: z.string().nullable(),
  color: z.string().nullable(),
  freeResize: z.boolean().default(false),
  fontSize: z.number().nullable().default(null),
  genRatio: z.string().nullable().default(null),
  genDuration: z.number().nullable().default(null),
  genMode: genModeEnum.nullable().default(null),
  // The seq the client last saw for this node. Advisory only: the
  // server never lets a payload change an existing row's number; for
  // a row that does not exist yet it is honoured solely as an
  // undo-restore claim (previously issued, currently unheld — see
  // saveGraph), otherwise a fresh number is issued.
  seq: z.number().int().positive().nullable().default(null),
});

export const edgeShape = z.object({
  id: z.string(),
  projectId: z.string(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
});

export const edgeInput = edgeShape.omit({ projectId: true });

export const okResponse = z.object({ ok: z.literal(true) });

// saveGraph additionally returns the authoritative number of every
// node in the saved payload, so the client can stamp freshly issued
// numbers onto its local nodes the moment the save lands — a new
// node's # badge must not wait for a full page reload to appear.
export const saveGraphResponse = z.object({
  ok: z.literal(true),
  seqs: z.array(z.object({ id: z.string(), seq: z.number().nullable() })),
});

export const genResult = z.object({
  status: z.enum(["done", "working", "failed"]),
  error: z.string().nullable(),
});

export const completeResult = z.object({
  status: z.enum(["done", "failed"]),
  resultNodeId: z.string().nullable(),
  error: z.string().nullable(),
});

export type EdgeRow = typeof schema.canvasEdges.$inferSelect;

export function toEdge(row: EdgeRow): z.infer<typeof edgeShape> {
  return {
    id: row.id,
    projectId: row.projectId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
  };
}

export async function blobUrl(ctx: Ctx, key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await ctx.blobs.getUrl(key);
  } catch {
    return null;
  }
}

export async function toNode(ctx: Ctx, row: NodeRow): Promise<z.infer<typeof nodeShape>> {
  const mediaUrl = await blobUrl(ctx, row.mediaBlobKey);
  const posterUrl = await blobUrl(ctx, row.posterBlobKey);
  const proxyUrl = await blobUrl(ctx, row.proxyBlobKey);
  return {
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    type: row.type,
    title: row.title,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    // Media nodes keep their bytes in blobs; when the text content is
    // empty, surface the media URL as content so list thumbnails and
    // asset snapshots keep working off the same field as before.
    content: row.content !== "" ? row.content : (mediaUrl ?? ""),
    prompt: row.prompt,
    status: row.status,
    hidden: row.hidden,
    groupId: row.groupId,
    color: row.color,
    freeResize: row.freeResize,
    fontSize: row.fontSize,
    genStatus: row.genStatus,
    genError: row.genError,
    genStartedAt: row.genStartedAt ? row.genStartedAt.toISOString() : null,
    genRatio: row.genRatio,
    genSize: row.genSize,
    genDuration: row.genDuration,
    genKind: row.genKind,
    genMode: row.genMode,
    mediaBlobKey: row.mediaBlobKey,
    mediaUrl,
    mimeType: row.mimeType,
    filePath: row.filePath,
    posterBlobKey: row.posterBlobKey,
    posterUrl,
    proxyBlobKey: row.proxyBlobKey,
    proxyUrl,
  };
}

export function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}
