// queue-sweep.ts — 队列扫尾与自愈：媒体镜像落盘（mirrorNodeMedia /
// mirrorPendingMedia）、孤儿 working 回收（recoverStaleWorking）、
// 建聊超时回收（recoverStaleChats）、视频海报回填（ensurePoster /
// backfillPosters）、视频播放代理回填（ensureProxy / backfillProxies，
// V1 新增）。批次 S2 自 generation-dispatch.ts 整段搬移，行为不变。

import { type Ctx } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as schema from "../schema";
import { type Db, type NodeRow } from "./contracts";
import { amendGenerationRecordMedia } from "./generation-records";
import { getProjectRow, markFailed, repairNodeMediaPointers } from "./graph-helpers";
import { projectDirBase, expandHome, isInProjectDir, extForMime } from "./project-dirs";
import { frameFitsMeasuredSize, measuredCardSize } from "./ratios";

/** In-memory throttle for poster attempts: a video whose frame grab
 * keeps failing must not be retried by every sweep tick. */
const posterAttempts = new Map<string, number>();
const POSTER_RETRY_MS = 10 * 60 * 1000;

/** Grabs a video node's poster frame through the ffmpeg sidecar and
 * records its blob key. Deterministic per-node blob key, so a repeat
 * run overwrites instead of leaking. Best-effort: any failure leaves
 * the key null — playback always uses the original media. */
export async function ensurePoster(ctx: Ctx, db: Db, node: NodeRow): Promise<boolean> {
  if (node.type !== "video" || !node.filePath) return false;
  if (node.posterBlobKey) return false;
  const lastAttempt = posterAttempts.get(node.id);
  if (lastAttempt && Date.now() - lastAttempt < POSTER_RETRY_MS) return false;
  posterAttempts.set(node.id, Date.now());
  const project = await getProjectRow(db, node.projectId);
  if (!project || !isInProjectDir(project, node.filePath)) return false;
  const tag = node.id.slice(0, 8);
  const run = await ctx.executePrivileged(Contracts.makePoster, {
    input: node.filePath,
    outputDir: expandHome(project.workspaceDir),
    posterName: `poster-${tag}.jpg`,
  });
  if (!run.posterPath) return false;
  const posterFile = await ctx.executePrivileged(Contracts.readMediaFile, {
    path: run.posterPath,
  });
  const posterKey = `media/${node.projectId}/${node.id}-poster`;
  await ctx.blobs.put(posterKey, Buffer.from(posterFile.dataBase64, "base64"), {
    contentType: "image/jpeg",
  });
  await db
    .update(schema.canvasNodes)
    .set({ posterBlobKey: posterKey, updatedAt: new Date() })
    .where(eq(schema.canvasNodes.id, node.id));
  return true;
}

/** Poster sweep: backfills frames for the oldest video nodes that still
 * lack them — a couple per run, so the queue consumer drains the
 * backlog without long ffmpeg bursts. */
export async function backfillPosters(ctx: Ctx, db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.type, "video"))
    .orderBy(asc(schema.canvasNodes.updatedAt));
  let done = 0;
  for (const row of rows) {
    if (done >= 2) break;
    if (!row.filePath || row.posterBlobKey) continue;
    try {
      if (await ensurePoster(ctx, db, row)) done += 1;
    } catch {
      // Best-effort: the node keeps its placeholder stand-in.
    }
  }
  return done;
}

/** In-memory throttle for proxy attempts, same discipline as posters:
 * a video whose transcode keeps failing must not be retried by every
 * sweep tick. */
const proxyAttempts = new Map<string, number>();
const PROXY_RETRY_MS = 10 * 60 * 1000;

/** Produces a video node's playback proxy (V1) through the ffmpeg
 * sidecar and records its blob key. The proxy is a lightweight
 * H.264 MP4 twin used ONLY for playback; the node's original file
 * and blob are never touched. Deterministic per-node blob key, so a
 * repeat run overwrites instead of leaking. Best-effort by contract:
 * any failure leaves the key null and the caller carries on —
 * a missing proxy must never fail the generation it rode in on. */
export async function ensureProxy(ctx: Ctx, db: Db, node: NodeRow): Promise<boolean> {
  if (node.type !== "video" || !node.filePath) return false;
  if (node.proxyBlobKey) return false;
  const lastAttempt = proxyAttempts.get(node.id);
  if (lastAttempt && Date.now() - lastAttempt < PROXY_RETRY_MS) return false;
  proxyAttempts.set(node.id, Date.now());
  const project = await getProjectRow(db, node.projectId);
  if (!project || !isInProjectDir(project, node.filePath)) return false;
  const tag = node.id.slice(0, 8);
  const run = await ctx.executePrivileged(Contracts.makePlaybackProxy, {
    input: node.filePath,
    outputDir: expandHome(project.workspaceDir),
    fileName: `proxy-${tag}.mp4`,
  });
  const proxyFile = await ctx.executePrivileged(Contracts.readMediaFile, {
    path: run.path,
  });
  const proxyKey = `media/${node.projectId}/${node.id}-proxy`;
  await ctx.blobs.put(proxyKey, Buffer.from(proxyFile.dataBase64, "base64"), {
    contentType: "video/mp4",
  });
  await db
    .update(schema.canvasNodes)
    .set({ proxyBlobKey: proxyKey, updatedAt: new Date() })
    .where(eq(schema.canvasNodes.id, node.id));
  return true;
}

/** Proxy sweep: backfills playback proxies for the oldest video nodes
 * that still lack them — a couple per run, mirroring backfillPosters,
 * so the queue consumer drains the backlog without long ffmpeg bursts
 * and a failed transcode simply retries on a later run. */
export async function backfillProxies(ctx: Ctx, db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.type, "video"))
    .orderBy(asc(schema.canvasNodes.updatedAt));
  let done = 0;
  for (const row of rows) {
    if (done >= 2) break;
    if (!row.filePath || row.proxyBlobKey) continue;
    try {
      if (await ensureProxy(ctx, db, row)) done += 1;
    } catch {
      // Best-effort: playback keeps using the original file.
    }
  }
  return done;
}

/** Server-side mirror: copies a media node's blob bytes into its
 * project's working directory and records filePath + measured genSize.
 * Goes through the mirrorBlobToFile privileged contract (the BlobClient
 * has no byte-read; the contract reads this space's own blob-store
 * object file on the host). No-op when the node already has a filePath;
 * the recording update is guarded on filePath still being empty.
 * Returns true when this call landed the file. `attempts` bounds
 * retries of the copy itself (the direct image path passes
 * 3, so a blob object that becomes visible a beat after
 * generate_media returns is still landed in the same run; the queue
 * sweep passes 1 and lets the next run retry instead). */
export async function mirrorNodeMedia(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  attempts = 1,
): Promise<boolean> {
  if (!node.mediaBlobKey || node.filePath) return false;
  if (node.type !== "image" && node.type !== "video" && node.type !== "audio") {
    return false;
  }
  const project = await getProjectRow(db, node.projectId);
  if (!project) return false;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    try {
      const written = await ctx.executePrivileged(Contracts.mirrorBlobToFile, {
        spaceDir: ctx.spaceDir,
        blobKey: node.mediaBlobKey,
        dirName: projectDirBase(project),
        fileName: `${node.id}${extForMime(node.mimeType)}`,
      });
      let genSize: string | null = node.genSize;
      if (node.type === "image" || node.type === "video") {
        try {
          const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
            path: written.path,
          });
          if (probe.width && probe.height) {
            genSize = `${probe.width}x${probe.height}`;
          }
        } catch {
          // Keep whatever genSize was already recorded.
        }
      }
      // A node whose generation just landed (genStatus done — the
      // direct in-action path fills in place before its
      // probe exists) gets its frame re-shaped to the measured
      // aspect in the same write, so a 9:16 result ends up in a 9:16
      // frame. The test is whether the CURRENT frame fits the
      // measurement, not whether the genSize string changed: a
      // re-run that delivers the same measured size as last time
      // must still repair a frame the fill step shaped from the
      // requested ratio alone. Uploads and other idle media keep
      // the frame the user gave them.
      const frame =
        node.genStatus === "done" &&
        (node.type === "image" || node.type === "video") &&
        !frameFitsMeasuredSize(node.width, node.height, genSize)
          ? measuredCardSize(genSize, node.type)
          : null;
      const updated = await db
        .update(schema.canvasNodes)
        .set({
          filePath: written.path,
          genSize,
          ...(frame ? { width: frame.w, height: frame.h } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.canvasNodes.id, node.id),
            isNull(schema.canvasNodes.filePath),
          ),
        )
        .returning({ id: schema.canvasNodes.id });
      const landed = updated.length > 0;
      if (landed) {
        // The mirror just settled this file's measured size and
        // path: amend the run's history record (written at landing
        // time, before either existed) to match.
        await amendGenerationRecordMedia(db, node.mediaBlobKey, {
          genSize,
          filePath: written.path,
        });
      }
      return landed;
    } catch {
      // Fall through to the next attempt (or give up after the last).
    }
  }
  return false;
}

/** The queue consumer's mirror sweep: lands blob-only media nodes
 * (results of the direct path whose inline mirror failed,
 * uploads whose mirror failed) into their project directories, up to
 * `limit` per run. Returns how many were mirrored and how many still
 * wait. */
export async function mirrorPendingMedia(
  ctx: Ctx,
  db: Db,
  limit: number,
): Promise<{ mirrored: number; pending: number }> {
  const rows = await db.select().from(schema.canvasNodes);
  const candidates = rows.filter(
    (r) =>
      r.mediaBlobKey &&
      !r.filePath &&
      (r.type === "image" || r.type === "video" || r.type === "audio"),
  );
  let mirrored = 0;
  for (const row of candidates) {
    if (mirrored >= limit) break;
    if (await mirrorNodeMedia(ctx, db, row)) mirrored += 1;
  }
  return { mirrored, pending: candidates.length - mirrored };
}

/** Frame-repair sweep: a generation-landed node's frame must carry
 * its measured genSize's aspect (see frameFitsMeasuredSize), but the
 * frame is also client-writable through saveGraph — a page holding
 * the pre-landing placeholder frame (a second tab, a page that never
 * polled the landing) can stamp the old frame back over the server's
 * measured one, leaving the media cropped in a frame that
 * contradicts the node's own genSize (yoyo-02 #27: a 1152x2048 image
 * sitting in a 268x212 frame). This sweep is the reconciliation:
 * done image/video nodes whose frame no longer fits their
 * measurement are re-shaped to measuredCardSize. Deliberate user
 * geometry is out of reach by construction — freeResize nodes are
 * skipped, and an aspect-preserving resize stays within the fit
 * tolerance, so only frames that actually crop the media move.
 * Uploads and replaced media sit at genStatus idle and are never
 * touched. Bounded per run like the poster/proxy sweeps. */
export async function repairMeasuredFrames(
  db: Db,
  limit: number,
): Promise<number> {
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.genStatus, "done"))
    .orderBy(asc(schema.canvasNodes.updatedAt));
  let repaired = 0;
  for (const row of rows) {
    if (repaired >= limit) break;
    if (row.type !== "image" && row.type !== "video") continue;
    if (!row.mediaBlobKey || row.freeResize) continue;
    if (frameFitsMeasuredSize(row.width, row.height, row.genSize)) continue;
    const frame = measuredCardSize(row.genSize, row.type);
    if (!frame) continue;
    await db
      .update(schema.canvasNodes)
      .set({ width: frame.w, height: frame.h, updatedAt: new Date() })
      .where(eq(schema.canvasNodes.id, row.id));
    repaired += 1;
  }
  return repaired;
}

/** Media-pointer repair sweep: a media node whose server-owned
 * pointers (mediaBlobKey / filePath / mimeType / genSize) are null
 * while the asset library still holds the record filed for that
 * exact node is showing a placeholder for media that exists — the
 * scar of the whole-graph save race (a stale save deleted the
 * freshly landed row, a later save re-inserted it from a payload
 * that carries no media columns; yoyo-02 #38). saveGraph now
 * prevents the deletion and restores pointers at re-insert; this
 * sweep is the reconciliation net for rows damaged before that fix
 * or by any path that bypasses it, restoring each from its asset
 * record (repairNodeMediaPointers, guarded on the pointer still
 * being empty). Bounded per run like the other sweeps. */
export async function repairOrphanedMediaPointers(
  ctx: Ctx,
  db: Db,
  limit: number,
): Promise<number> {
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(isNull(schema.canvasNodes.mediaBlobKey))
    .orderBy(asc(schema.canvasNodes.updatedAt));
  let repaired = 0;
  for (const row of rows) {
    if (repaired >= limit) break;
    try {
      if (await repairNodeMediaPointers(ctx, db, row)) repaired += 1;
    } catch {
      // Best-effort: one unrepairable row never blocks the queue.
    }
  }
  return repaired;
}

const STALE_WORKING_MS = 10 * 60 * 1000;
const STALE_WORKING_MESSAGE = "上次运行被中断，点重新运行即可再试";

/** Fails orphaned "working" nodes so they become retryable. Nodes with
 * a background task in flight (genTaskId set) are exempt: media tasks
 * legitimately run for many minutes and deliver through the complete*
 * callbacks. Returns how many nodes were recovered. */
export async function recoverStaleWorking(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.genStatus, "working"));
  const now = Date.now();
  let recovered = 0;
  for (const row of rows) {
    if (row.genTaskId) continue;
    const startedAt = row.genStartedAt ?? row.updatedAt;
    if (now - startedAt.getTime() > STALE_WORKING_MS) {
      await markFailed(db, row.id, STALE_WORKING_MESSAGE);
      recovered += 1;
    }
  }
  return recovered;
}

const STALE_CHAT_MS = 10 * 60 * 1000;
const STALE_CHAT_MESSAGE = "建聊请求超时未被接手";

/** Fails chat-binding requests nobody picked up: a project sitting in
 * chatStatus=creating for over 10 minutes means the external sentinel
 * never handed the request to a live session. It becomes a retryable
 * failure and chatRequestedAt is cleared, so a later requestProjectChat
 * is never blocked by the stale marker. Returns how many were swept. */
export async function recoverStaleChats(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.chatStatus, "creating"));
  const now = Date.now();
  let recovered = 0;
  for (const row of rows) {
    if (!row.chatRequestedAt) continue;
    if (now - row.chatRequestedAt.getTime() > STALE_CHAT_MS) {
      await db
        .update(schema.projects)
        .set({
          chatStatus: "failed",
          chatError: STALE_CHAT_MESSAGE,
          chatRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, row.id));
      recovered += 1;
    }
  }
  return recovered;
}
