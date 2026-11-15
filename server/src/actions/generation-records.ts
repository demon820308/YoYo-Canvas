// generation-records.ts — 生成历史域：持久生成记录的唯一写入点
// （recordGenerationOutcome）与当前项目的记录查询
// （listGenerationRecords）。
//
// 写入纪律：一条运行只在到达终态时写一行，且只经这一个助手写——
// 共享终态路径负责调用它（deliver 落地 landMediaResult /
// attachResultNode、markFailed、stopGeneration），各派发/投递调用点
// 不许散写。幂等键为 (nodeId, startedAt)：同一轮运行重复到达终态
// 路径（例如跨类落地时 landMediaResult 与 attachResultNode 先后
// 经过）只落一行。记录是快照：节点之后被覆盖生成或删除，行不动。

import { defineAction, z } from "@hatch/space-sdk";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../schema";
import {
  blobUrl,
  genKindEnum,
  nodeType,
  type Db,
  type NodeRow,
} from "./contracts";

export type GenerationOutcomeStatus = "done" | "failed" | "stopped" | "cancelled";

export type GenerationOutcome = {
  status: GenerationOutcomeStatus;
  error?: string | null;
  /** Node that ended up carrying the result (done runs only). */
  resultNodeId?: string | null;
  mediaBlobKey?: string | null;
  mimeType?: string | null;
  filePath?: string | null;
  /** Measured size of the delivered file, when the landing knows it. */
  genSize?: string | null;
  /** The run's effective prompt, when the landing assembled one. */
  prompt?: string;
};

/** The run's start instant: genStartedAt once the run was claimed /
 * dispatched; a run cancelled while still queued was never claimed
 * (genStartedAt null), so its enqueue time — the node's updatedAt at
 * enqueue — stands in. Part of the idempotency key, so it must be
 * derived from the node row exactly the same way at every terminal
 * path. */
export function runStartedAt(node: NodeRow): Date {
  return node.genStartedAt ?? node.updatedAt;
}

/** Writes the single history row for a run that just settled. Must be
 * called with the node row as it was BEFORE the terminal update
 * clears genStartedAt. Best-effort by contract, like
 * recordMediaAsset: a history failure must never fail the generation
 * it rode in on. */
export async function recordGenerationOutcome(
  db: Db,
  node: NodeRow,
  outcome: GenerationOutcome,
): Promise<void> {
  try {
    const startedAt = runStartedAt(node);
    const existing = await db
      .select({ id: schema.generationRecords.id })
      .from(schema.generationRecords)
      .where(
        and(
          eq(schema.generationRecords.nodeId, node.id),
          eq(schema.generationRecords.startedAt, startedAt),
        ),
      )
      .limit(1);
    if (existing.length > 0) return;
    const now = new Date();
    await db.insert(schema.generationRecords).values({
      id: crypto.randomUUID(),
      projectId: node.projectId,
      nodeId: node.id,
      resultNodeId: outcome.resultNodeId ?? null,
      nodeSeq: node.seq,
      nodeTitle: node.title,
      nodeType: node.type,
      genKind: node.genKind,
      prompt: outcome.prompt ?? (node.prompt || node.content).trim(),
      genRatio: node.genRatio,
      genSize: outcome.genSize ?? node.genSize,
      genDuration: node.genDuration,
      mediaBlobKey: outcome.mediaBlobKey ?? null,
      mimeType: outcome.mimeType ?? null,
      filePath: outcome.filePath ?? null,
      status: outcome.status,
      error: outcome.error ?? null,
      startedAt,
      finishedAt: now,
      createdAt: now,
    });
  } catch {
    // History is a record of the run, never a gate on it.
  }
}

/** The direct image channel lands its result BEFORE the file is
 * mirrored into the project directory, so its done record is written
 * without the measured size / file path; the mirror step
 * (mirrorNodeMedia, the single place a node's filePath + measured
 * genSize are settled) amends the record afterwards. The join key is
 * the media blob key — unique per run — so the amendment touches
 * exactly the run whose file just landed, and only done records.
 * Best-effort, like the write itself. */
export async function amendGenerationRecordMedia(
  db: Db,
  mediaBlobKey: string,
  patch: { genSize: string | null; filePath: string },
): Promise<void> {
  try {
    const set: { filePath: string; genSize?: string } = {
      filePath: patch.filePath,
    };
    if (patch.genSize) set.genSize = patch.genSize;
    await db
      .update(schema.generationRecords)
      .set(set)
      .where(
        and(
          eq(schema.generationRecords.mediaBlobKey, mediaBlobKey),
          eq(schema.generationRecords.status, "done"),
        ),
      );
  } catch {
    // An unamended record still shows the run; only the measured
    // size / path stay blank.
  }
}

const recordShape = z.object({
  id: z.string(),
  nodeId: z.string(),
  resultNodeId: z.string().nullable(),
  // Whether the running node / the result node still exists on the
  // board — history outlives nodes, so the row says which locate
  // target (if any) is still live.
  nodeExists: z.boolean(),
  resultNodeExists: z.boolean(),
  seq: z.number().nullable(),
  title: z.string(),
  nodeType: nodeType,
  genKind: genKindEnum.nullable(),
  prompt: z.string(),
  genRatio: z.string().nullable(),
  genSize: z.string().nullable(),
  genDuration: z.number().nullable(),
  mediaUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  filePath: z.string().nullable(),
  status: z.enum(["done", "failed", "stopped", "cancelled"]),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string(),
});

export const GenerationRecordsActions = {
  listGenerationRecords: defineAction({
    description:
      "Lists the current project's persistent generation history, newest first, capped at 50: every settled run (done / failed / stopped / cancelled) with its snapshot — node number and title, prompt, ratio, measured size, media link, failure reason and start/finish times. Records survive node re-generation and deletion.",
    request: z.object({ projectId: z.string() }),
    response: z.object({ records: z.array(recordShape) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.generationRecords)
        .where(eq(schema.generationRecords.projectId, args.projectId))
        .orderBy(desc(schema.generationRecords.finishedAt))
        .limit(50);
      const nodeRows = await db
        .select({ id: schema.canvasNodes.id })
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId));
      const liveIds = new Set(nodeRows.map((n) => n.id));
      const records = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          nodeId: r.nodeId,
          resultNodeId: r.resultNodeId,
          nodeExists: liveIds.has(r.nodeId),
          resultNodeExists: r.resultNodeId ? liveIds.has(r.resultNodeId) : false,
          seq: r.nodeSeq,
          title: r.nodeTitle,
          nodeType: r.nodeType,
          genKind: r.genKind,
          prompt: r.prompt,
          genRatio: r.genRatio,
          genSize: r.genSize,
          genDuration: r.genDuration,
          mediaUrl: await blobUrl(ctx, r.mediaBlobKey),
          mimeType: r.mimeType,
          filePath: r.filePath,
          status: r.status,
          error: r.error,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt.toISOString(),
        })),
      );
      return { records };
    },
  }),
};
