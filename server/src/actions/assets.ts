// assets.ts — 资产库注册（列表/新增/上传/插入画布/删除/改名）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../schema";
import { nodeType, nodeShape, okResponse, blobUrl, toNode, parseTags } from "./contracts";
import { getNodeRow, getProjectRow } from "./graph-helpers";
import { reserveNodeSeqs, projectDirBase, extForMime } from "./project-dirs";
import { ensurePoster, ensureProxy } from "./queue-sweep";
import { measuredCardSize, normalizeImageRatio } from "./ratios";

export const AssetsActions = {
  listAssets: defineAction({
    description:
      "Lists one project's saved assets, newest first. Assets are per-project: rows belonging to other projects are never returned.",
    request: z.object({ projectId: z.string() }),
    response: z.object({
      assets: z.array(
        z.object({
          id: z.string(),
          projectId: z.string().nullable(),
          kind: nodeType,
          title: z.string(),
          content: z.string(),
          prompt: z.string(),
          color: z.string().nullable(),
          tags: z.array(z.string()),
          sourceNodeId: z.string().nullable(),
          mediaBlobKey: z.string().nullable(),
          mediaUrl: z.string().nullable(),
          mimeType: z.string().nullable(),
          filePath: z.string().nullable(),
          posterBlobKey: z.string().nullable(),
          posterUrl: z.string().nullable(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.projectId, args.projectId))
        .orderBy(desc(schema.assets.createdAt));
      const assets = await Promise.all(
        rows.map(async (a) => ({
          id: a.id,
          projectId: a.projectId,
          kind: a.kind,
          title: a.title,
          content: a.content,
          prompt: a.prompt,
          color: a.color,
          tags: parseTags(a.tags),
          sourceNodeId: a.sourceNodeId,
          mediaBlobKey: a.mediaBlobKey,
          mediaUrl: await blobUrl(ctx, a.mediaBlobKey),
          mimeType: a.mimeType,
          filePath: a.filePath,
          posterBlobKey: a.posterBlobKey,
          posterUrl: await blobUrl(ctx, a.posterBlobKey),
        })),
      );
      return { assets };
    },
  }),

  addAsset: defineAction({
    description:
      "Saves an asset to one project's asset library (from a canvas node of that same project — media nodes keep their real media blob — or a hand-written text asset) and returns its id.",
    request: z.object({
      projectId: z.string(),
      kind: nodeType,
      title: z.string().min(1).max(120),
      content: z.string().default(""),
      prompt: z.string().default(""),
      color: z.string().nullable().default(null),
      tags: z.array(z.string()).default([]),
      sourceNodeId: z.string().nullable().default(null),
      mediaBlobKey: z.string().nullable().default(null),
      mimeType: z.string().nullable().default(null),
      filePath: z.string().nullable().default(null),
      posterBlobKey: z.string().nullable().default(null),
    }),
    response: z.object({ id: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("addAsset: project not found");
      // A node-sourced asset must come from a node of THIS project —
      // otherwise one project could file another project's media
      // (and its blob reference) into its own library.
      if (args.sourceNodeId) {
        const sourceNode = await getNodeRow(db, args.sourceNodeId);
        if (!sourceNode || sourceNode.projectId !== args.projectId) {
          throw new Error("addAsset: source node does not belong to this project");
        }
      }
      const id = crypto.randomUUID();
      await db.insert(schema.assets).values({
        id,
        projectId: args.projectId,
        kind: args.kind,
        title: args.title,
        content: args.content,
        prompt: args.prompt,
        color: args.color,
        tags: JSON.stringify(args.tags),
        sourceNodeId: args.sourceNodeId,
        mediaBlobKey: args.mediaBlobKey,
        mimeType: args.mimeType,
        filePath: args.filePath,
        posterBlobKey: args.posterBlobKey,
      });
      ctx.invalidateQueries();
      return { id };
    },
  }),

  uploadAsset: defineAction({
    description:
      "Uploads an image, video, or audio file straight into one project's asset library (no canvas node is created): the bytes are stored as a blob and the asset is filed under the file's media kind, owned by that project only.",
    request: z.object({
      projectId: z.string(),
      kind: z.enum(["image", "video", "audio"]),
      fileName: z.string().min(1).max(300),
      mimeType: z.string().max(120),
      dataBase64: z.string().max(14_000_000),
    }),
    response: z.object({ id: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("uploadAsset: project not found");
      if (!args.mimeType.startsWith(`${args.kind}/`)) {
        throw new Error(
          `uploadAsset: mimeType ${args.mimeType} does not match kind ${args.kind}`,
        );
      }
      const id = crypto.randomUUID();
      const blobKey = `assets/${id}`;
      await ctx.blobs.put(blobKey, Buffer.from(args.dataBase64, "base64"), {
        contentType: args.mimeType,
      });
      await db.insert(schema.assets).values({
        id,
        projectId: args.projectId,
        kind: args.kind,
        title: args.fileName,
        content: "",
        prompt: "",
        color: null,
        tags: "[]",
        sourceNodeId: null,
        mediaBlobKey: blobKey,
        mimeType: args.mimeType,
        filePath: null,
        posterBlobKey: null,
      });
      ctx.invalidateQueries();
      return { id };
    },
  }),

  insertAssetToCanvas: defineAction({
    description:
      "Inserts a media asset (image / video / audio) onto a project's canvas as a real media node carrying the asset's blob: the file is mirrored into that project's working directory and its real size probed, so the node can immediately feed reference generation.",
    request: z.object({
      projectId: z.string(),
      assetId: z.string(),
      x: z.number(),
      y: z.number(),
    }),
    response: z.object({ node: nodeShape, filePath: z.string().nullable() }),
    privileged: [
      Contracts.mirrorBlobToFile,
      Contracts.probeMediaFile,
      Contracts.makePoster,
      Contracts.makePlaybackProxy,
      Contracts.readMediaFile,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const assetRows = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, args.assetId))
        .limit(1);
      const asset = assetRows[0];
      if (!asset || !asset.mediaBlobKey) {
        throw new Error("insertAssetToCanvas: asset not found or has no media");
      }
      // Assets are per-project: an asset owned by another project
      // can never be inserted here, even when its id is known.
      if (asset.projectId !== args.projectId) {
        throw new Error(
          "insertAssetToCanvas: asset does not belong to this project",
        );
      }
      if (
        asset.kind !== "image" &&
        asset.kind !== "video" &&
        asset.kind !== "audio"
      ) {
        throw new Error("insertAssetToCanvas: asset is not a media asset");
      }
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("insertAssetToCanvas: project not found");
      const kind = asset.kind;
      const nodeId = crypto.randomUUID();
      const size =
        kind === "image"
          ? { width: 320, height: 320 }
          : kind === "video"
            ? { width: 420, height: 236 }
            : { width: 340, height: 120 };
      // The node's ratio label follows its MEASURED size (nearest
      // of the eight tiers), never a fixed placeholder: a 9:16 asset
      // inserted as "1:1" would mislabel the node and misroute any
      // later generation run on it. Falls back to the historical
      // defaults only when no measurement exists.
      let genRatio: string | null =
        kind === "video" ? "16:9" : kind === "image" ? "1:1" : null;
      // Mirror the asset's bytes into this project's directory (a
      // fresh copy under the new node's id — the asset's own file, if
      // any, belongs to another project and stays untouched).
      let filePath: string | null = null;
      let genSize: string | null = null;
      try {
        const written = await ctx.executePrivileged(
          Contracts.mirrorBlobToFile,
          {
            spaceDir: ctx.spaceDir,
            blobKey: asset.mediaBlobKey,
            dirName: projectDirBase(project),
            fileName: `${nodeId}${extForMime(asset.mimeType)}`,
          },
        );
        filePath = written.path;
        if (kind !== "audio") {
          try {
            const probe = await ctx.executePrivileged(
              Contracts.probeMediaFile,
              { path: written.path },
            );
            if (probe.width && probe.height) {
              genSize = `${probe.width}x${probe.height}`;
              genRatio = normalizeImageRatio(
                `${probe.width}:${probe.height}`,
              );
              // Fit the card to the media's real proportions with
              // the single frame source (measuredCardSize — chrome
              // compensation included), so the inserted media is
              // not cropped into a merely ratio-shaped frame.
              const fitted = measuredCardSize(genSize, kind);
              if (fitted) {
                size.width = fitted.w;
                size.height = fitted.h;
              }
            }
          } catch {
            // Measurement is best-effort; the blob is the content.
          }
        }
      } catch {
        filePath = null;
      }
      const now = new Date();
      const countRows = await db
        .select({ id: schema.canvasNodes.id })
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId));
      const [insertSeq] = await reserveNodeSeqs(db, args.projectId, 1);
      await db.insert(schema.canvasNodes).values({
        id: nodeId,
        projectId: args.projectId,
        seq: insertSeq ?? null,
        type: kind,
        title: asset.title,
        x: args.x,
        y: args.y,
        width: size.width,
        height: size.height,
        content: "",
        prompt: asset.prompt,
        status: "success",
        hidden: false,
        groupId: null,
        color: asset.color,
        genStatus: "idle",
        genRatio,
        genSize,
        genKind: kind,
        mediaBlobKey: asset.mediaBlobKey,
        mimeType: asset.mimeType,
        filePath,
        posterBlobKey: asset.posterBlobKey,
        sortOrder: countRows.length,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .update(schema.projects)
        .set({ updatedAt: now })
        .where(eq(schema.projects.id, args.projectId));
      const row = await getNodeRow(db, nodeId);
      if (!row) throw new Error("insertAssetToCanvas: inserted node not found");
      if (kind === "video" && filePath && !asset.posterBlobKey) {
        try {
          await ensurePoster(ctx, db, row);
        } catch {
          // Poster is a stand-in still, not part of the insert.
        }
      }
      if (kind === "video" && filePath) {
        try {
          await ensureProxy(ctx, db, row);
        } catch {
          // Proxy is a playback aid, not part of the insert.
        }
      }
      const finalRow = (await getNodeRow(db, nodeId)) ?? row;
      ctx.invalidateQueries();
      return { node: await toNode(ctx, finalRow), filePath };
    },
  }),

  removeAsset: defineAction({
    description:
      "Deletes one asset from a project's asset library. The asset must belong to the given project; cross-project deletes are rejected.",
    request: z.object({ id: z.string(), projectId: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.assets)
        .where(
          and(
            eq(schema.assets.id, args.id),
            eq(schema.assets.projectId, args.projectId),
          ),
        );
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  renameAsset: defineAction({
    description:
      "Renames one asset in a project's asset library. The asset must belong to the given project; cross-project renames are rejected.",
    request: z.object({
      id: z.string(),
      projectId: z.string(),
      title: z.string().min(1).max(120),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({ id: schema.assets.id })
        .from(schema.assets)
        .where(
          and(
            eq(schema.assets.id, args.id),
            eq(schema.assets.projectId, args.projectId),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw new Error("renameAsset: asset not found in this project");
      }
      await db
        .update(schema.assets)
        .set({ title: args.title })
        .where(eq(schema.assets.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
};