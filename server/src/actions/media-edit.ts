// media-edit.ts — 媒体编辑注册（裁剪/切分/放大/替换/上传落盘）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { nodeShape, toNode } from "./contracts";
import { getNodeRow, getProjectRow } from "./graph-helpers";
import { reserveNodeSeqs, projectDirBase, expandHome, extForMime } from "./project-dirs";
import { ensurePoster, ensureProxy } from "./queue-sweep";
import { attachProducedFile, imageSourceFile } from "./tool-dispatch";

export const MediaEditActions = {
  cropNodeImage: defineAction({
    description:
      "Crops an image node's file (normalized 0..1 rect from the hover toolbar's crop dialog) through the ffmpeg sidecar and attaches the crop as a NEW image node with a probe-measured genSize and its file in the project directory. The source image is never modified.",
    request: z.object({
      nodeId: z.string(),
      rect: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().gt(0).max(1),
        height: z.number().gt(0).max(1),
      }),
    }),
    response: z.object({
      status: z.enum(["done", "failed"]),
      resultNodeId: z.string().nullable(),
      error: z.string().nullable(),
    }),
    privileged: [Contracts.cropImage, Contracts.probeMediaFile, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const found = await imageSourceFile(db, args.nodeId);
      if ("error" in found) {
        return { status: "failed" as const, resultNodeId: null, error: found.error };
      }
      try {
        const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
          path: found.filePath,
        });
        if (!probe.width || !probe.height) {
          return { status: "failed" as const, resultNodeId: null, error: "无法读取原图尺寸" };
        }
        const px = Math.max(0, Math.min(probe.width - 1, Math.round(args.rect.x * probe.width)));
        const py = Math.max(0, Math.min(probe.height - 1, Math.round(args.rect.y * probe.height)));
        const pw = Math.max(1, Math.min(probe.width - px, Math.round(args.rect.width * probe.width)));
        const ph = Math.max(1, Math.min(probe.height - py, Math.round(args.rect.height * probe.height)));
        const tag = found.node.id.slice(0, 8);
        const cropped = await ctx.executePrivileged(Contracts.cropImage, {
          input: found.filePath,
          outputDir: expandHome(found.project.workspaceDir),
          fileName: `crop-${tag}-${Date.now()}.png`,
          x: px,
          y: py,
          width: pw,
          height: ph,
        });
        const resultNodeId = await attachProducedFile(ctx, db, found.node, {
          filePath: cropped.path,
          type: "image",
          title: `${found.node.title || "图片"} · 裁剪`,
        });
        ctx.invalidateQueries();
        return { status: "done" as const, resultNodeId, error: null };
      } catch (err) {
        return {
          status: "failed" as const,
          resultNodeId: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  splitNodeImage: defineAction({
    description:
      "Splits an image node's file into a rows x columns grid (fractional split lines from the hover toolbar's split dialog) through the ffmpeg sidecar: each tile becomes its own image node with probe-measured genSize and its file in the project directory, laid out in a grid below the source image. The source image is never modified.",
    request: z.object({
      nodeId: z.string(),
      rows: z.number().int().min(1).max(12),
      columns: z.number().int().min(1).max(12),
      horizontalLines: z.array(z.number().gt(0).lt(1)).max(11),
      verticalLines: z.array(z.number().gt(0).lt(1)).max(11),
    }),
    response: z.object({
      status: z.enum(["done", "failed"]),
      resultNodeIds: z.array(z.string()),
      error: z.string().nullable(),
    }),
    privileged: [Contracts.splitImage, Contracts.probeMediaFile, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const found = await imageSourceFile(db, args.nodeId);
      if ("error" in found) {
        return { status: "failed" as const, resultNodeIds: [], error: found.error };
      }
      try {
        const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
          path: found.filePath,
        });
        if (!probe.width || !probe.height) {
          return { status: "failed" as const, resultNodeIds: [], error: "无法读取原图尺寸" };
        }
        const hLines = [...args.horizontalLines].sort((a, b) => a - b);
        const vLines = [...args.verticalLines].sort((a, b) => a - b);
        if (hLines.length !== args.rows - 1 || vLines.length !== args.columns - 1) {
          return {
            status: "failed" as const,
            resultNodeIds: [],
            error: "切分线数量与行列数不一致",
          };
        }
        const yBounds = [0, ...hLines.map((f) => Math.round(f * probe.height!)), probe.height];
        const xBounds = [0, ...vLines.map((f) => Math.round(f * probe.width!)), probe.width];
        const tag = found.node.id.slice(0, 8);
        const stamp = Date.now();
        const tiles: { fileName: string; x: number; y: number; width: number; height: number }[] = [];
        for (let r = 0; r < args.rows; r += 1) {
          for (let c = 0; c < args.columns; c += 1) {
            const x0 = xBounds[c] ?? 0;
            const x1 = xBounds[c + 1] ?? probe.width;
            const y0 = yBounds[r] ?? 0;
            const y1 = yBounds[r + 1] ?? probe.height;
            tiles.push({
              fileName: `split-${tag}-${stamp}-${r + 1}-${c + 1}.png`,
              x: x0,
              y: y0,
              width: Math.max(1, x1 - x0),
              height: Math.max(1, y1 - y0),
            });
          }
        }
        const split = await ctx.executePrivileged(Contracts.splitImage, {
          input: found.filePath,
          outputDir: expandHome(found.project.workspaceDir),
          tiles,
        });
        const resultNodeIds: string[] = [];
        for (let i = 0; i < split.paths.length; i += 1) {
          const path = split.paths[i];
          if (!path) continue;
          const r = Math.floor(i / args.columns);
          const c = i % args.columns;
          const id = await attachProducedFile(ctx, db, found.node, {
            filePath: path,
            type: "image",
            title: `${found.node.title || "图片"} · 切分 ${r + 1}-${c + 1}`,
          });
          resultNodeIds.push(id);
        }
        // Lay the tiles out in a grid below the source image (upstream
        // split behaviour), keeping each tile's attached card size.
        const tileRows = await db
          .select()
          .from(schema.canvasNodes)
          .where(inArray(schema.canvasNodes.id, resultNodeIds));
        const byId = new Map(tileRows.map((t) => [t.id, t]));
        const gap = 16;
        const colW = Math.max(80, ...tileRows.map((t) => t.width));
        const rowH = Math.max(80, ...tileRows.map((t) => t.height));
        const now = new Date();
        for (let i = 0; i < resultNodeIds.length; i += 1) {
          const id = resultNodeIds[i];
          if (!id || !byId.has(id)) continue;
          const r = Math.floor(i / args.columns);
          const c = i % args.columns;
          await db
            .update(schema.canvasNodes)
            .set({
              x: found.node.x + c * (colW + gap),
              y: found.node.y + found.node.height + 40 + r * (rowH + gap),
              updatedAt: now,
            })
            .where(eq(schema.canvasNodes.id, id));
        }
        ctx.invalidateQueries();
        return { status: "done" as const, resultNodeIds, error: null };
      } catch (err) {
        return {
          status: "failed" as const,
          resultNodeIds: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  upscaleNodeImage: defineAction({
    description:
      "Scales an image node's file up to a target long edge (algorithm: high=lanczos / bilinear / nearest, from the hover toolbar's upscale dialog; 超分 uses the same path with the high algorithm) through the ffmpeg sidecar and attaches the result as a NEW image node with a probe-measured genSize. The source image is never modified.",
    request: z.object({
      nodeId: z.string(),
      targetLongEdge: z.number().int().min(64).max(4096),
      algorithm: z.enum(["high", "bilinear", "nearest"]),
    }),
    response: z.object({
      status: z.enum(["done", "failed"]),
      resultNodeId: z.string().nullable(),
      error: z.string().nullable(),
    }),
    privileged: [Contracts.upscaleImage, Contracts.probeMediaFile, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const found = await imageSourceFile(db, args.nodeId);
      if ("error" in found) {
        return { status: "failed" as const, resultNodeId: null, error: found.error };
      }
      try {
        const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
          path: found.filePath,
        });
        if (!probe.width || !probe.height) {
          return { status: "failed" as const, resultNodeId: null, error: "无法读取原图尺寸" };
        }
        const longEdge = Math.max(probe.width, probe.height);
        if (args.targetLongEdge <= longEdge) {
          return {
            status: "failed" as const,
            resultNodeId: null,
            error: `原图长边已是 ${longEdge}px，不小于目标 ${args.targetLongEdge}px`,
          };
        }
        const scale = args.targetLongEdge / longEdge;
        const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
        const width = even(probe.width * scale);
        const height = even(probe.height * scale);
        const tag = found.node.id.slice(0, 8);
        const upscaled = await ctx.executePrivileged(Contracts.upscaleImage, {
          input: found.filePath,
          outputDir: expandHome(found.project.workspaceDir),
          fileName: `upscale-${tag}-${Date.now()}.png`,
          width,
          height,
          algorithm: args.algorithm,
        });
        const resultNodeId = await attachProducedFile(ctx, db, found.node, {
          filePath: upscaled.path,
          type: "image",
          title: `${found.node.title || "图片"} · 放大 ${args.targetLongEdge}`,
        });
        ctx.invalidateQueries();
        return { status: "done" as const, resultNodeId, error: null };
      } catch (err) {
        return {
          status: "failed" as const,
          resultNodeId: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  replaceNodeMedia: defineAction({
    description:
      "Replaces a media node's content with an uploaded file (the hover toolbar's 替换 / 上传）: the node's id, position, size and edges stay untouched; the new bytes become its blob, the file lands in the project directory, genSize is re-measured from the real file, and a video's poster is re-grabbed.",
    request: z.object({
      nodeId: z.string(),
      fileName: z.string().max(300),
      mimeType: z.string().max(120),
      dataBase64: z.string().max(14_000_000),
    }),
    response: z.object({ node: nodeShape, filePath: z.string().nullable() }),
    privileged: [Contracts.writeProjectFile, Contracts.probeMediaFile, Contracts.makePoster, Contracts.makePlaybackProxy, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const node = await getNodeRow(db, args.nodeId);
      if (!node || (node.type !== "image" && node.type !== "video" && node.type !== "audio")) {
        throw new Error("replaceNodeMedia: node not found or not a media node");
      }
      if (!args.mimeType.startsWith(`${node.type}/`)) {
        throw new Error(`replaceNodeMedia: mimeType ${args.mimeType} does not match node type ${node.type}`);
      }
      const project = await getProjectRow(db, node.projectId);
      if (!project) throw new Error("replaceNodeMedia: project not found");
      const blobKey = `media/${node.projectId}/${node.id}`;
      await ctx.blobs.put(blobKey, Buffer.from(args.dataBase64, "base64"), {
        contentType: args.mimeType,
      });
      let filePath: string | null = null;
      try {
        const written = await ctx.executePrivileged(Contracts.writeProjectFile, {
          dirName: projectDirBase(project),
          fileName: `${node.id}${extForMime(args.mimeType, ".bin")}`,
          dataBase64: args.dataBase64,
        });
        filePath = written.path;
      } catch {
        filePath = null;
      }
      let genSize: string | null = null;
      if (filePath && node.type !== "audio") {
        try {
          const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
            path: filePath,
          });
          if (probe.width && probe.height) {
            genSize = `${probe.width}x${probe.height}`;
          }
        } catch {
          genSize = null;
        }
      }
      await db
        .update(schema.canvasNodes)
        .set({
          title: args.fileName || node.title,
          content: "",
          status: "success",
          genStatus: "idle",
          genError: null,
          genSize,
          mediaBlobKey: blobKey,
          mimeType: args.mimeType,
          filePath,
          posterBlobKey: null,
          // The old file's playback proxy is stale the moment the
          // media is replaced; cleared so a fresh one is produced.
          proxyBlobKey: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.canvasNodes.id, node.id));
      if (node.type === "video" && filePath) {
        try {
          const fresh = await getNodeRow(db, node.id);
          if (fresh) await ensurePoster(ctx, db, fresh);
        } catch {
          // Poster is a stand-in still, not part of the replacement.
        }
        try {
          const fresh = await getNodeRow(db, node.id);
          if (fresh) await ensureProxy(ctx, db, fresh);
        } catch {
          // Proxy is a playback aid, not part of the replacement.
        }
      }
      const finalRow = await getNodeRow(db, node.id);
      if (!finalRow) throw new Error("replaceNodeMedia: node vanished");
      ctx.invalidateQueries();
      return { node: await toNode(ctx, finalRow), filePath };
    },
  }),

  uploadMedia: defineAction({
    description:
      "Stores a user-uploaded image, video, or audio file as a blob, mirrors the file into the project's working directory, probes its real size, and adds it to the board as a media node.",
    request: z.object({
      projectId: z.string(),
      kind: z.enum(["image", "video", "audio"]),
      fileName: z.string().max(300),
      mimeType: z.string().max(120),
      dataBase64: z.string().max(14_000_000),
      x: z.number(),
      y: z.number(),
      width: z.number().min(40).max(4000),
      height: z.number().min(30).max(4000),
    }),
    response: z.object({ node: nodeShape, filePath: z.string().nullable() }),
    privileged: [Contracts.writeProjectFile, Contracts.probeMediaFile, Contracts.makePoster, Contracts.makePlaybackProxy, Contracts.readMediaFile],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const prefix = `${args.kind}/`;
      if (!args.mimeType.startsWith(prefix)) {
        throw new Error(`uploadMedia: mimeType ${args.mimeType} does not match kind ${args.kind}`);
      }
      const project = await getProjectRow(db, args.projectId);
      const nodeId = crypto.randomUUID();
      const blobKey = `media/${args.projectId}/${nodeId}`;
      const bytes = Buffer.from(args.dataBase64, "base64");
      await ctx.blobs.put(blobKey, bytes, { contentType: args.mimeType });
      // Mirror into the project's working directory so the file can feed
      // reference generation. Best-effort: the blob is the durable copy.
      let filePath: string | null = null;
      if (project) {
        try {
          const written = await ctx.executePrivileged(Contracts.writeProjectFile, {
            dirName: projectDirBase(project),
            fileName: `${nodeId}${extForMime(args.mimeType, ".bin")}`,
            dataBase64: args.dataBase64,
          });
          filePath = written.path;
        } catch {
          filePath = null;
        }
      }
      let genSize: string | null = null;
      if (filePath && args.kind !== "audio") {
        try {
          const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
            path: filePath,
          });
          if (probe.width && probe.height) {
            genSize = `${probe.width}x${probe.height}`;
          }
        } catch {
          genSize = null;
        }
      }
      const now = new Date();
      const countRows = await db
        .select({ id: schema.canvasNodes.id })
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId));
      const [uploadSeq] = await reserveNodeSeqs(db, args.projectId, 1);
      await db.insert(schema.canvasNodes).values({
        id: nodeId,
        projectId: args.projectId,
        seq: uploadSeq ?? null,
        type: args.kind,
        title: args.fileName,
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        content: "",
        prompt: "",
        status: "success",
        hidden: false,
        groupId: null,
        color: null,
        genStatus: "idle",
        genRatio: args.kind === "video" ? "16:9" : args.kind === "image" ? "1:1" : null,
        genSize,
        genKind: args.kind,
        mediaBlobKey: blobKey,
        mimeType: args.mimeType,
        filePath,
        sortOrder: countRows.length,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .update(schema.projects)
        .set({ updatedAt: now })
        .where(eq(schema.projects.id, args.projectId));
      const row = await getNodeRow(db, nodeId);
      if (!row) throw new Error("uploadMedia: inserted node not found");
      if (args.kind === "video") {
        try {
          await ensurePoster(ctx, db, row);
        } catch {
          // Poster is a stand-in still, not part of the upload.
        }
        try {
          await ensureProxy(ctx, db, row);
        } catch {
          // Proxy is a playback aid, not part of the upload.
        }
      }
      const finalRow = (await getNodeRow(db, nodeId)) ?? row;
      ctx.invalidateQueries();
      return { node: await toNode(ctx, finalRow), filePath };
    },
  }),
};