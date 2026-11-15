// Actions for YoYo画布. All data lives in this space's own tables
// (projects / canvas_nodes / canvas_edges / assets / prompts) — nothing is
// read from or written to the old canvas space, and project working
// directories live under ~/workspace/yoyo-canvas-projects (never the old
// canvas's ~/workspace/canvas-projects tree).
//
// Generation core (ported semantics from the proven Muse-canvas model):
//   - ALL generation dispatched from the canvas — images with or
//     without connected reference images, all videos, and config
//     audio — runs as a background Muse task that generates with
//     the agent media tools (consuming the reference FILES from the
//     project directory when references are connected) and delivers
//     through completeImageGeneration / completeVideoGeneration /
//     completeAudioGeneration, which validate the file is inside
//     that project's directory, store the bytes as a blob, and probe
//     the file's real pixel size into genSize (batch G, 2026-11-15).
//   - The in-action direct image channel (generateImageInAction,
//     below) is the direct engine dispatchImageGeneration routes
//     to when an image run's normalized ratio is one of the three
//     tiers it delivers exactly (16:9 / 9:16 / 1:1) and no reference
//     media is connected: synchronous, in-place, same assembled
//     prompt. Every other ratio, and any run carrying reference
//     media, takes the background-task channel above — the direct
//     channel's generate_media call accepts only a coarse
//     orientation and cannot consume reference files.
//   - Landing rule (landMediaResult): when the generating node IS a
//     node of the delivered kind — an image placeholder generating an
//     image, a video node a video, an audio node audio — the result
//     fills that node in place: no new node, no new edge. Config hubs
//     and cross-kind runs still get a fresh result node beside the
//     source. Failures land via failGeneration with a visible reason;
//     every run is retryable.
//   - Every generated image / video / audio is also recorded in the
//     asset library under its kind (recordMediaAsset), so the side
//     panel's 资产 tab collects generations alongside uploads and
//     hand-saved assets.
//   - The queue is real: enqueueGeneration marks nodes "queued";
//     processQueue claims them with an optimistic claim token and
//     dispatches, recovers orphaned "working" nodes (no live background
//     task, started over 10 minutes ago) into retryable failures,
//     backfills poster frames, and mirrors media blobs into their
//     project directories server-side (mirrorBlobToFile reads this
//     space's own blob-store object file on the host — the BlobClient
//     itself has no byte-read), reporting how many it mirrored and how
//     many still wait. Server-side mirroring is the only landing
//     path — there is no client-side mirror.
//   - Config nodes (runConfigNode) are the generation hub: the node's
//     chip prompt (@[node:id] references, upstream composer semantics)
//     plus its connected inputs — groups flattened — dispatched by mode
//     （生图/文本/视频/音频） through the same paths. Synchronous
//     inference is capped at 120s.
//   - Image size is one of eight real tiers, ratio -> pixels one-to-one
//     (16:9 = 2048x1152, 9:16 = 1152x2048, 1:1 = 1600x1600,
//     3:2 = 1920x1280, 2:3 = 1280x1920, 4:3 = 1792x1344,
//     3:4 = 1344x1792, 21:9 = 2352x1008 — all but the first three
//     measured 2026-11-15). genSize is always the MEASURED size of
//     the delivered file.

// generation.ts — 生成注册（图/视频/音频/配置/工具入口、队列消费、交付回调与海报）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z, type Ctx } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { nodeType, TOOL_TYPES, genStatusEnum, genKindEnum, okResponse, genResult, completeResult, type Db } from "./contracts";
import { getNodeRow, getProjectRow, landMediaResult, recordMediaAsset, markFailed, markWorking } from "./graph-helpers";
import { recordGenerationOutcome } from "./generation-records";
import { expandHome, isInProjectDir } from "./project-dirs";
import { clampVideoSeconds } from "./ratios";
import { dispatchImageGeneration, dispatchVideoGeneration, dispatchAudioGeneration, dispatchConfigGeneration, dispatchGeneration, queueKindFor } from "./generation-dispatch";
import { ensurePoster, backfillPosters, ensureProxy, backfillProxies, mirrorPendingMedia, repairMeasuredFrames, repairOrphanedMediaPointers, recoverStaleWorking, recoverStaleChats } from "./queue-sweep";
import { runToolDispatch } from "./tool-dispatch";

export const GenerationActions = {
  // ---------------------------------------------------------- generation
  generateImage: defineAction({
    description:
      "Starts image generation for a node, routed by dispatchImageGeneration: when the node's normalized ratio is one of the direct channel's three tiers (16:9 / 9:16 / 1:1) and no reference media is connected, it generates synchronously in-action through the direct channel and fills the node in place in the same call; otherwise a background Muse task generates at the exact pixel size of the node's ratio tier (using connected reference images when present) and delivers via completeImageGeneration, filling the node in place.",
    request: z.object({ projectId: z.string(), nodeId: z.string() }),
    response: genResult,
    privileged: [Contracts.mirrorBlobToFile, Contracts.probeMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId) {
        return { status: "failed" as const, error: "节点不存在" };
      }
      await markWorking(db, node.id, { genKind: "image" });
      const fresh = (await getNodeRow(db, node.id)) ?? node;
      const result = await dispatchImageGeneration(ctx, db, fresh);
      ctx.invalidateQueries();
      return { status: result.status, error: result.error };
    },
  }),

  generateVideo: defineAction({
    description:
      "Starts video generation for a node: a background Muse task generates the video (using connected reference images and the requested duration) and delivers it via completeVideoGeneration.",
    request: z.object({
      projectId: z.string(),
      nodeId: z.string(),
      duration: z.number().int().min(1).max(30).optional(),
    }),
    response: genResult,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId) {
        return { status: "failed" as const, error: "节点不存在" };
      }
      await markWorking(db, node.id, {
        genKind: "video",
        genDuration: clampVideoSeconds(args.duration ?? node.genDuration),
      });
      const fresh = (await getNodeRow(db, node.id)) ?? node;
      const result = await dispatchVideoGeneration(ctx, db, fresh);
      ctx.invalidateQueries();
      return {
        status: result.status === "working" ? ("working" as const) : ("failed" as const),
        error: result.error,
      };
    },
  }),

  generateAudio: defineAction({
    description:
      "Starts audio generation for an audio node: a background Muse task generates the audio into the project directory and delivers it via completeAudioGeneration.",
    request: z.object({ projectId: z.string(), nodeId: z.string() }),
    response: genResult,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId) {
        return { status: "failed" as const, error: "节点不存在" };
      }
      await markWorking(db, node.id, { genKind: "audio" });
      const fresh = (await getNodeRow(db, node.id)) ?? node;
      const result = await dispatchAudioGeneration(ctx, db, fresh);
      ctx.invalidateQueries();
      return {
        status: result.status === "working" ? ("working" as const) : ("failed" as const),
        error: result.error,
      };
    },
  }),

  runConfigNode: defineAction({
    description:
      "Runs a config （生成配置） node: gathers its chip prompt and connected reference images/videos/audios/text (groups flattened) and generates by the node's mode （生图/文本/视频/音频）, attaching the result as a new node beside it.",
    request: z.object({ projectId: z.string(), nodeId: z.string() }),
    response: genResult,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId || node.type !== "config") {
        return { status: "failed" as const, error: "配置节点不存在" };
      }
      await markWorking(db, node.id, { genKind: node.genMode ?? "image" });
      const fresh = (await getNodeRow(db, node.id)) ?? node;
      const result = await dispatchConfigGeneration(ctx, db, fresh);
      ctx.invalidateQueries();
      return { status: result.status, error: result.error };
    },
  }),

  runToolNode: defineAction({
    description:
      "Runs a tool node （视频抽帧/提取音频/视频配乐/提示词逆推） over its connected inputs: marks it working with a server-stamped genStartedAt, executes through the ffmpeg sidecar (frames/audio-extract/compose) or vision inference (prompt-reverse, 120s cap), and attaches result nodes beside it. Missing or unusable inputs fail visibly on the node with the precise reason; the run is retryable, and processQueue's orphan sweep covers tool nodes like generation nodes.",
    request: z.object({
      projectId: z.string(),
      nodeId: z.string(),
      options: z
        .object({
          framesAction: z.enum(["first", "last", "grid"]).optional(),
          grid: z.enum(["auto", "3x2", "3x3", "4x3", "4x4"]).optional(),
          firstOffsetSec: z.number().min(0).max(600).optional(),
          lastOffsetSec: z.number().min(0).max(600).optional(),
          loopAudio: z.boolean().optional(),
          reverseMode: z
            .enum(["concise", "chinese", "detailed", "english", "grid"])
            .optional(),
        })
        .optional(),
    }),
    response: genResult,
    privileged: [
      Contracts.extractFrames,
      Contracts.extractAudio,
      Contracts.composeVideo,
      Contracts.convertImageToPng,
      Contracts.shrinkImageForInference,
      Contracts.probeMediaFile,
      Contracts.readMediaFile,
      Contracts.makePoster,
      Contracts.makePlaybackProxy,
      Contracts.mirrorBlobToFile,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId || !TOOL_TYPES.has(node.type)) {
        return { status: "failed" as const, error: "工具节点不存在" };
      }
      await markWorking(db, node.id, { genKind: "tool" });
      const fresh = (await getNodeRow(db, node.id)) ?? node;
      const result = await runToolDispatch(ctx, db, fresh, args.options ?? {});
      ctx.invalidateQueries();
      return { status: result.status, error: result.error };
    },
  }),

  enqueueGeneration: defineAction({
    description:
      "Marks a node as queued for generation; the queue consumer (processQueue) claims and runs it. Config nodes run in their configured mode.",
    request: z.object({ projectId: z.string(), nodeId: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId) {
        throw new Error("enqueueGeneration: node not found");
      }
      if (TOOL_TYPES.has(node.type)) {
        throw new Error("enqueueGeneration: 工具节点不进生成队列，请在节点上点运行");
      }
      await db
        .update(schema.canvasNodes)
        .set({
          genStatus: "queued",
          genKind: queueKindFor(node),
          genError: null,
          genTaskId: null,
          genClaimToken: null,
          genStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.canvasNodes.id, node.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  listGenerationRequests: defineAction({
    description:
      "Lists nodes across all projects whose generation is queued or in flight, with their prompts — the board's generation queue.",
    request: z.object({}),
    response: z.object({
      requests: z.array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          nodeId: z.string(),
          nodeSeq: z.number().nullable(),
          nodeTitle: z.string(),
          nodeType: nodeType,
          genKind: genKindEnum.nullable(),
          genStatus: genStatusEnum,
          genStartedAt: z.string().nullable(),
          prompt: z.string(),
          genRatio: z.string().nullable(),
          genSize: z.string().nullable(),
          genDuration: z.number().nullable(),
          genError: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.canvasNodes)
        .where(inArray(schema.canvasNodes.genStatus, ["queued", "working"]))
        .orderBy(asc(schema.canvasNodes.updatedAt));
      const projectRows = await db.select().from(schema.projects);
      const names = new Map(projectRows.map((p) => [p.id, p.name]));
      return {
        requests: rows.map((n) => ({
          projectId: n.projectId,
          projectName: names.get(n.projectId) ?? "",
          nodeId: n.id,
          nodeSeq: n.seq,
          nodeTitle: n.title,
          nodeType: n.type,
          genKind: n.genKind,
          genStatus: n.genStatus,
          genStartedAt: n.genStartedAt ? n.genStartedAt.toISOString() : null,
          prompt: (n.prompt || n.content).trim(),
          genRatio: n.genRatio,
          genSize: n.genSize,
          genDuration: n.genDuration,
          genError: n.genError,
        })),
      };
    },
  }),

  processQueue: defineAction({
    description:
      "The generation-queue consumer: recovers orphaned 'working' nodes — generation AND tool nodes alike (no live background task, started over 10 minutes ago) — into retryable failures, backfills poster frames for older video nodes, backfills playback proxies (lightweight H.264 MP4 twins for smooth in-app playback) for older video nodes, mirrors media blobs into their project directories server-side (up to five per run; reports mirrored and still-pending counts), repairs generation-landed nodes whose frame no longer fits their measured genSize (a stale full-graph save can stamp a pre-landing placeholder frame back over the server's measured one; up to five per run, reported as framesRepaired; freeResize and aspect-preserving user resizes are never touched), repairs media nodes whose server-owned pointers were lost to the whole-graph save race (mediaBlobKey null while the asset library still holds the record filed for that node; restored from that record, up to five per run, reported as mediaRepaired), then claims up to three queued nodes (optionally within one project) with an optimistic claim token and dispatches their generation. It also sweeps stale chat-binding requests: projects in chatStatus=creating for over 10 minutes become failed with 「建聊请求超时未被接手」 and their request timestamp cleared (reported as chatRecovered).",
    request: z.object({ projectId: z.string().optional() }),
    response: z.object({
      processed: z.number(),
      remaining: z.number(),
      recovered: z.number(),
      postersBackfilled: z.number(),
      proxiesBackfilled: z.number(),
      mirrored: z.number(),
      pendingMirrors: z.number(),
      framesRepaired: z.number(),
      mediaRepaired: z.number(),
      chatRecovered: z.number(),
    }),
    privileged: [
      Contracts.makePoster,
      Contracts.makePlaybackProxy,
      Contracts.readMediaFile,
      Contracts.mirrorBlobToFile,
      Contracts.probeMediaFile,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const recovered = await recoverStaleWorking(db);
      const chatRecovered = await recoverStaleChats(db);
      const postersBackfilled = await backfillPosters(ctx, db);
      const proxiesBackfilled = await backfillProxies(ctx, db);
      const { mirrored, pending: pendingMirrors } = await mirrorPendingMedia(
        ctx,
        db,
        5,
      );
      const framesRepaired = await repairMeasuredFrames(db, 5);
      const mediaRepaired = await repairOrphanedMediaPointers(ctx, db, 5);
      const base = eq(schema.canvasNodes.genStatus, "queued");
      const queued = await db
        .select()
        .from(schema.canvasNodes)
        .where(args.projectId ? and(base, eq(schema.canvasNodes.projectId, args.projectId)) : base)
        .orderBy(asc(schema.canvasNodes.updatedAt));
      let processed = 0;
      for (const candidate of queued) {
        if (processed >= 3) break;
        const token = crypto.randomUUID();
        // Claim: only the consumer whose token lands on a still-queued
        // node owns it; a racing consumer's update matches nothing.
        const claimed = await db
          .update(schema.canvasNodes)
          .set({
            genStatus: "working",
            genClaimToken: token,
            genError: null,
            genStartedAt: new Date(),
            status: "loading",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.canvasNodes.id, candidate.id),
              eq(schema.canvasNodes.genStatus, "queued"),
            ),
          )
          .returning({
            id: schema.canvasNodes.id,
            token: schema.canvasNodes.genClaimToken,
          });
        const claim = claimed[0];
        if (!claim || claim.token !== token) continue;
        const node = (await getNodeRow(db, candidate.id)) ?? candidate;
        if (TOOL_TYPES.has(node.type)) {
          // Tool nodes never run through the generation queue (they are
          // executed directly by runToolNode); a queued tool node is a
          // client bug — fail it visibly instead of generating from it.
          await markFailed(db, node.id, "工具节点不进生成队列，请在节点上点运行");
        } else if (node.type === "config") {
          await dispatchConfigGeneration(ctx, db, node);
        } else {
          await dispatchGeneration(ctx, db, node, queueKindFor(node));
        }
        processed += 1;
      }
      const remainingRows = await db
        .select({ id: schema.canvasNodes.id })
        .from(schema.canvasNodes)
        .where(
          args.projectId
            ? and(base, eq(schema.canvasNodes.projectId, args.projectId))
            : base,
        );
      ctx.invalidateQueries();
      return {
        processed,
        remaining: remainingRows.length,
        recovered,
        postersBackfilled,
        proxiesBackfilled,
        mirrored,
        pendingMirrors,
        framesRepaired,
        mediaRepaired,
        chatRecovered,
      };
    },
  }),

  completeImageGeneration: defineAction({
    description:
      "Delivers a finished generated image for a node: validates the file is inside the project's working directory, stores it as a blob, probes its real pixel size into genSize, fills the node in place when it is an image node (a config hub gets a result node beside it), and records the image in the asset library.",
    request: z.object({
      nodeId: z.string(),
      filePath: z.string().min(1).max(1000),
      title: z.string().max(300).optional(),
    }),
    response: completeResult,
    privileged: [Contracts.readMediaFile, Contracts.probeMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      return deliverGeneratedFile(ctx, db, args, "image");
    },
  }),

  completeVideoGeneration: defineAction({
    description:
      "Delivers a finished generated video for a node: validates the file is inside the project's working directory, stores it as a blob, probes its real size, fills the node in place when it is a video node (a config hub gets a result node beside it), grabs the carrying node's poster frame (best-effort; playback uses the original, which stays untouched), and records the video in the asset library.",
    request: z.object({
      nodeId: z.string(),
      filePath: z.string().min(1).max(1000),
      title: z.string().max(300).optional(),
    }),
    response: completeResult,
    privileged: [Contracts.readMediaFile, Contracts.probeMediaFile, Contracts.makePoster, Contracts.makePlaybackProxy],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      return deliverGeneratedFile(ctx, db, args, "video");
    },
  }),

  completeAudioGeneration: defineAction({
    description:
      "Delivers a finished generated audio file for a node: validates the file is inside the project's working directory, stores it as a blob, fills the node in place when it is an audio node (a config hub gets a result node beside it), and records the audio in the asset library.",
    request: z.object({
      nodeId: z.string(),
      filePath: z.string().min(1).max(1000),
      title: z.string().max(300).optional(),
    }),
    response: completeResult,
    privileged: [Contracts.readMediaFile, Contracts.probeMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      return deliverGeneratedFile(ctx, db, args, "audio");
    },
  }),

  failGeneration: defineAction({
    description:
      "Marks a node's in-flight generation (image, video, or audio) as failed with a reason the node displays, ready to retry. A failure reported after the run already ended (delivered, failed, or stopped by the user) is ignored so it cannot clobber the node's settled state.",
    request: z.object({
      projectId: z.string(),
      nodeId: z.string(),
      error: z.string().max(1000),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (
        node &&
        (node.genStatus === "working" || node.genStatus === "queued")
      ) {
        await markFailed(db, args.nodeId, args.error);
        ctx.invalidateQueries();
      }
      return { ok: true };
    },
  }),

  stopGeneration: defineAction({
    description:
      "Stops a node's queued or in-flight generation at the user's request （生成配置's 停止 button and the queue drawer's 停止/取消 buttons): a queued node leaves the queue (recorded as cancelled in the generation history) and a working node returns to idle with its claim/task tokens and run clock cleared (recorded as stopped). A background task that still finishes afterwards is refused by the delivery/failure guards, so nothing lands after a stop.",
    request: z.object({ projectId: z.string(), nodeId: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.projectId !== args.projectId) {
        throw new Error("stopGeneration: node not found");
      }
      if (node.genStatus === "queued" || node.genStatus === "working") {
        // Terminal path: the stop settles the run — a queued run is
        // "cancelled" (it never started), a working run is "stopped".
        // Recorded from the pre-update row, whose genStartedAt is
        // part of the history idempotency key.
        await recordGenerationOutcome(db, node, {
          status: node.genStatus === "queued" ? "cancelled" : "stopped",
        });
        await db
          .update(schema.canvasNodes)
          .set({
            genStatus: "idle",
            genError: null,
            genTaskId: null,
            genClaimToken: null,
            genStartedAt: null,
            status: "idle",
            updatedAt: new Date(),
          })
          .where(eq(schema.canvasNodes.id, node.id));
        ctx.invalidateQueries();
      }
      return { ok: true };
    },
  }),

  preparePoster: defineAction({
    description:
      "Ensures a video node has its poster frame, grabbing it through the ffmpeg sidecar from the node's file in its project directory when missing. The original media is never modified; any failure just leaves the plain placeholder — playback always uses the original file.",
    request: z.object({ nodeId: z.string() }),
    response: z.object({
      status: z.enum(["done", "skipped", "failed"]),
      error: z.string().nullable(),
    }),
    privileged: [Contracts.makePoster, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || node.type !== "video" || !node.filePath) {
        return { status: "skipped" as const, error: null };
      }
      if (node.posterBlobKey) {
        return { status: "skipped" as const, error: null };
      }
      try {
        const built = await ensurePoster(ctx, db, node);
        ctx.invalidateQueries();
        return { status: built ? ("done" as const) : ("skipped" as const), error: null };
      } catch (err) {
        return {
          status: "failed" as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),
};

// ---------------------------------------------------------------------------
// Delivery shared by completeImageGeneration / completeVideoGeneration /
// completeAudioGeneration (declared as a hoisted function so the three
// actions above can share one implementation).
// ---------------------------------------------------------------------------

async function deliverGeneratedFile(
  ctx: Ctx,
  db: Db,
  args: { nodeId: string; filePath: string; title?: string },
  kind: "image" | "video" | "audio",
): Promise<z.infer<typeof completeResult>> {
  const node = await getNodeRow(db, args.nodeId);
  if (!node) {
    return { status: "failed", resultNodeId: null, error: "节点不存在" };
  }
  // A delivery only lands while its run is still in flight. After a
  // user stop (or any other settle) the run is over: refuse the late
  // file WITHOUT touching the node's state, so a stopped generation
  // never sprouts a result node afterwards.
  if (node.genStatus !== "working" && node.genStatus !== "queued") {
    return {
      status: "failed",
      resultNodeId: null,
      error: "该节点的生成已停止或已结束，忽略这次迟到交付",
    };
  }
  const project = await getProjectRow(db, node.projectId);
  try {
    if (project && !isInProjectDir(project, args.filePath)) {
      throw new Error(
        `成片不在本项目的工作目录内（${expandHome(project.workspaceDir)}），已拒绝回传`,
      );
    }
    const file = await ctx.executePrivileged(Contracts.readMediaFile, {
      path: args.filePath,
    });
    if (!file.contentType.startsWith(`${kind}/`)) {
      throw new Error(`交付的文件不是${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}文件（${file.contentType}）`);
    }
    // Measure the delivered file: genSize records the real pixels.
    let genSize: string | null = null;
    if (kind !== "audio") {
      try {
        const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
          path: args.filePath,
        });
        if (probe.width && probe.height) {
          genSize = `${probe.width}x${probe.height}`;
        }
      } catch {
        genSize = null;
      }
    }
    const resultId = crypto.randomUUID();
    const blobKey = `media/${node.projectId}/${resultId}`;
    const bytes = Buffer.from(file.dataBase64, "base64");
    await ctx.blobs.put(blobKey, bytes, { contentType: file.contentType });
    const defaultTitle =
      kind === "image"
        ? "生成图片"
        : kind === "video"
          ? "生成视频"
          : "生成音频";
    const resultTitle =
      args.title ??
      (node.title ? `${node.title} · ${defaultTitle}` : defaultTitle);
    const resultPrompt = (node.prompt || node.content).trim();
    // A node that generated its own kind (image placeholder → image,
    // video node → video, audio node → audio) is filled in place; a
    // config hub gets a fresh result node beside it, as before.
    const landedId = await landMediaResult(db, node, {
      id: resultId,
      type: kind,
      mediaBlobKey: blobKey,
      mimeType: file.contentType,
      filePath: expandHome(args.filePath),
      genSize,
      title: resultTitle,
      content: "",
      prompt: resultPrompt,
    });
    if (kind === "video") {
      // Poster frame for the node that now carries the video.
      // Best-effort: a failed grab never fails the delivery —
      // playback uses the original.
      try {
        const landedRow = await getNodeRow(db, landedId);
        if (landedRow) await ensurePoster(ctx, db, landedRow);
      } catch {
        // Poster is a stand-in still, not part of the delivery.
      }
      // Playback proxy (V1): a lightweight H.264 twin for smooth
      // in-app WebView playback. Best-effort exactly like the poster:
      // a failed transcode never fails the delivery, and the
      // processQueue sweep retries it later.
      try {
        const landedRow = await getNodeRow(db, landedId);
        if (landedRow) await ensureProxy(ctx, db, landedRow);
      } catch {
        // Proxy is a playback aid, not part of the delivery.
      }
    }
    // The generated media also enters the asset library under its
    // kind (image / video / audio), whichever node shape it took.
    const landedRow = await getNodeRow(db, landedId);
    if (landedRow) {
      await recordMediaAsset(db, landedRow, {
        title: resultTitle,
        prompt: resultPrompt,
      });
    }
    ctx.invalidateQueries();
    return { status: "done", resultNodeId: landedId, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(db, node.id, message);
    ctx.invalidateQueries();
    return { status: "failed", resultNodeId: null, error: message };
  }
}

