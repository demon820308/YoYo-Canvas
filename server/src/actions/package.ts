// package.ts — 项目整包注册（导出包 / 导入包）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { asc, eq } from "drizzle-orm";
import * as schema from "../schema";
import { nodeType, type NodeRow } from "./contracts";
import { getNodeRow, getProjectRow } from "./graph-helpers";
import { projectDirName, expandHome, isInProjectDir, extForMime } from "./project-dirs";
import { ensurePoster } from "./queue-sweep";

export const PackageActions = {
  exportProjectPackage: defineAction({
    description:
      "Exports a whole project as one downloadable package file (ZIP): the full graph (nodes, edges, viewport, groups) in manifest.json plus the actual media bytes of every media node and poster — never just references. Assembled server-side; returns a download URL for the stored package blob and the titles of any nodes whose media bytes could not be found.",
    request: z.object({ projectId: z.string() }),
    response: z.object({
      url: z.string(),
      fileName: z.string(),
      sizeBytes: z.number(),
      mediaCount: z.number(),
      missing: z.array(z.string()),
    }),
    privileged: [
      Contracts.buildProjectPackage,
      Contracts.readPackageFile,
      Contracts.deleteStagingFile,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("exportProjectPackage: project not found");
      const nodeRows = await db
        .select()
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId))
        .orderBy(asc(schema.canvasNodes.sortOrder), asc(schema.canvasNodes.createdAt));
      const edgeRows = await db
        .select()
        .from(schema.canvasEdges)
        .where(eq(schema.canvasEdges.projectId, args.projectId))
        .orderBy(asc(schema.canvasEdges.sortOrder), asc(schema.canvasEdges.createdAt));
      const sources: {
        entry: string;
        blobKey: string | null;
        absPath: string | null;
      }[] = [];
      const files: {
        entry: string;
        nodeId: string;
        role: "media" | "poster";
        bytes: number;
      }[] = [];
      const titleByEntry = new Map<string, string>();
      const manifestNodes = nodeRows.map((n) => {
        let mediaEntry: string | null = null;
        let posterEntry: string | null = null;
        if (n.mediaBlobKey) {
          const fromPath = n.filePath
            ? n.filePath.slice(n.filePath.lastIndexOf("."))
            : "";
          const ext =
            fromPath && fromPath.length <= 6
              ? fromPath.toLowerCase()
              : extForMime(n.mimeType, ".bin");
          mediaEntry = `media/${n.id}${ext}`;
          sources.push({
            entry: mediaEntry,
            blobKey: n.mediaBlobKey,
            absPath:
              n.filePath && isInProjectDir(project, n.filePath)
                ? expandHome(n.filePath)
                : null,
          });
          files.push({ entry: mediaEntry, nodeId: n.id, role: "media", bytes: 0 });
          titleByEntry.set(mediaEntry, n.title);
        }
        if (n.posterBlobKey) {
          posterEntry = `media/${n.id}-poster.jpg`;
          sources.push({ entry: posterEntry, blobKey: n.posterBlobKey, absPath: null });
          files.push({ entry: posterEntry, nodeId: n.id, role: "poster", bytes: 0 });
          titleByEntry.set(posterEntry, n.title);
        }
        return {
          id: n.id,
          // Birth number travels with the package so an imported copy
          // keeps the source project's numbering (null for legacy).
          seq: n.seq,
          type: n.type,
          title: n.title,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          content: n.content,
          prompt: n.prompt,
          status: n.status,
          hidden: n.hidden,
          groupId: n.groupId,
          color: n.color,
          freeResize: n.freeResize,
          fontSize: n.fontSize,
          genStatus: n.genStatus,
          genError: n.genError,
          genRatio: n.genRatio,
          genSize: n.genSize,
          genDuration: n.genDuration,
          genKind: n.genKind,
          genMode: n.genMode,
          mimeType: n.mimeType,
          mediaEntry,
          posterEntry,
        };
      });
      const manifest = {
        app: "yoyo-canvas",
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
          name: project.name,
          viewport: {
            x: project.viewportX,
            y: project.viewportY,
            zoom: project.viewportZoom,
          },
        },
        nodes: manifestNodes,
        edges: edgeRows.map((e) => ({
          id: e.id,
          fromNodeId: e.fromNodeId,
          toNodeId: e.toNodeId,
        })),
        files,
      };
      const built = await ctx.executePrivileged(Contracts.buildProjectPackage, {
        spaceDir: ctx.spaceDir,
        manifestJson: JSON.stringify(manifest),
        sources,
      });
      try {
        const read = await ctx.executePrivileged(Contracts.readPackageFile, {
          spaceDir: ctx.spaceDir,
          path: built.path,
        });
        const blobKey = `exports/${project.id}/${Date.now()}.zip`;
        await ctx.blobs.put(blobKey, Buffer.from(read.dataBase64, "base64"), {
          contentType: "application/zip",
        });
        const url = await ctx.blobs.getUrl(blobKey);
        const safeName = project.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "YoYo画布项目";
        return {
          url,
          fileName: `${safeName}.yoyo-canvas.zip`,
          sizeBytes: built.sizeBytes,
          mediaCount: built.included.length,
          missing: built.missing.map((entry) => titleByEntry.get(entry) ?? entry),
        };
      } finally {
        try {
          await ctx.executePrivileged(Contracts.deleteStagingFile, {
            spaceDir: ctx.spaceDir,
            path: built.path,
          });
        } catch {
          // Staging cleanup is best-effort.
        }
      }
    },
  }),

  importProjectPackage: defineAction({
    description:
      "Imports a YoYo画布 project package (ZIP, base64) as a BRAND-NEW project — existing projects are never touched. Media bytes are written into the new project's own directory, nodes are re-pointed at the new files with genSize re-measured from them, and the graph (nodes/edges/groups/viewport) is fully restored with fresh ids. Media files that are missing, corrupt, or byte-mismatched in the package are reported per node and land as a visible failed state on that node instead of a silent empty node.",
    request: z.object({
      fileName: z.string().max(300).default(""),
      dataBase64: z.string().min(4).max(100_000_000),
    }),
    response: z.object({
      projectId: z.string(),
      name: z.string(),
      nodeCount: z.number(),
      edgeCount: z.number(),
      mediaImported: z.number(),
      mediaMissing: z.array(
        z.object({ title: z.string(), reason: z.string() }),
      ),
    }),
    privileged: [
      Contracts.extractProjectPackage,
      Contracts.importMediaFile,
      Contracts.readMediaFile,
      Contracts.probeMediaFile,
      Contracts.ensureProjectDir,
      Contracts.makePoster,
      Contracts.deleteStagingFile,
    ],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const extracted = await ctx.executePrivileged(
        Contracts.extractProjectPackage,
        { spaceDir: ctx.spaceDir, dataBase64: args.dataBase64 },
      );
      try {
        type PkgNode = {
          id: string;
          seq?: number | null;
          type: string;
          title: string;
          x: number;
          y: number;
          width: number;
          height: number;
          content: string;
          prompt: string;
          status: string;
          hidden: boolean;
          groupId: string | null;
          color: string | null;
          freeResize: boolean;
          fontSize: number | null;
          genStatus: string;
          genError: string | null;
          genRatio: string | null;
          genSize: string | null;
          genDuration: number | null;
          genKind: string | null;
          genMode: string | null;
          mimeType: string | null;
          mediaEntry: string | null;
          posterEntry: string | null;
        };
        const manifest = JSON.parse(extracted.manifestJson) as {
          app?: string;
          version?: number;
          project?: {
            name?: string;
            viewport?: { x: number; y: number; zoom: number };
          };
          nodes?: PkgNode[];
          edges?: { id: string; fromNodeId: string; toNodeId: string }[];
          files?: {
            entry: string;
            nodeId: string;
            role: string;
            bytes?: number;
            missing?: boolean;
          }[];
        };
        if (manifest.app !== "yoyo-canvas") {
          throw new Error("导入失败：这不是 YoYo画布的项目包");
        }
        if (manifest.version !== 1) {
          throw new Error(`导入失败：项目包版本 ${manifest.version ?? "?"} 不受支持`);
        }
        const validTypes = new Set<string>(nodeType.options);
        const name = (
          manifest.project?.name ||
          args.fileName.replace(/\.yoyo-canvas\.zip$/i, "").replace(/\.zip$/i, "") ||
          "导入的项目"
        ).slice(0, 80);
        const projectId = crypto.randomUUID();
        const dirName = projectDirName(name, projectId);
        const ensured = await ctx.executePrivileged(Contracts.ensureProjectDir, {
          dirName,
        });
        const viewport = manifest.project?.viewport;
        await db.insert(schema.projects).values({
          id: projectId,
          name,
          workspaceDir: ensured.path,
          viewportX: viewport?.x ?? 0,
          viewportY: viewport?.y ?? 0,
          viewportZoom: viewport?.zoom ?? 1,
        });
        const declaredByEntry = new Map(
          (manifest.files ?? []).map((f) => [f.entry, f]),
        );
        const extractedByEntry = new Map(
          extracted.files.map((f) => [f.entry, f]),
        );
        const corruptSet = new Set(extracted.corrupt);
        const idMap = new Map<string, string>();
        const mediaMissing: { title: string; reason: string }[] = [];
        let mediaImported = 0;
        const videoRowsNeedingPoster: string[] = [];
        const pkgNodes = manifest.nodes ?? [];
        // Numbering carried from the source project: a node's package
        // seq is kept when it is a valid positive integer and no
        // earlier node in the package claimed it; the new project's
        // counter then starts at the highest carried number so nodes
        // created after the import continue the sequence.
        const carriedSeqs = new Set<number>();
        let maxCarriedSeq = 0;
        for (const pn of pkgNodes) {
          const s = pn.seq;
          if (
            typeof s === "number" &&
            Number.isInteger(s) &&
            s > 0 &&
            !carriedSeqs.has(s)
          ) {
            carriedSeqs.add(s);
            if (s > maxCarriedSeq) maxCarriedSeq = s;
          }
        }
        const usedCarriedSeqs = new Set<number>();
        for (let index = 0; index < pkgNodes.length; index += 1) {
          const pn = pkgNodes[index]!;
          if (!validTypes.has(pn.type)) continue;
          const newId = crypto.randomUUID();
          idMap.set(pn.id, newId);
          let mediaBlobKey: string | null = null;
          let filePath: string | null = null;
          let posterBlobKey: string | null = null;
          let genSize: string | null = pn.genSize ?? null;
          let missingReason: string | null = null;
          // One package media entry → new project file + owned blob +
          // (for the main media) a re-measured genSize.
          const landEntry = async (
            entry: string,
            role: "media" | "poster",
          ): Promise<{ blobKey: string; path: string } | { error: string }> => {
            const declared = declaredByEntry.get(entry);
            if (declared?.missing) {
              return { error: "导出时该媒体字节已缺失" };
            }
            if (corruptSet.has(entry)) {
              return { error: "包内文件已损坏，无法解出" };
            }
            const file = extractedByEntry.get(entry);
            if (!file) return { error: "包内缺少该媒体文件" };
            if (!file.sizeOk) {
              return { error: "包内文件字节数与清单不一致" };
            }
            const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
            const copied = await ctx.executePrivileged(Contracts.importMediaFile, {
              fromPath: file.path,
              dirName,
              fileName: `${newId}${role === "poster" ? "-poster" : ""}${ext}`,
            });
            const read = await ctx.executePrivileged(Contracts.readMediaFile, {
              path: copied.path,
            });
            const blobKey =
              role === "poster"
                ? `posters/${projectId}/${newId}`
                : `media/${projectId}/${newId}`;
            await ctx.blobs.put(blobKey, Buffer.from(read.dataBase64, "base64"), {
              contentType: read.contentType,
            });
            return { blobKey, path: copied.path };
          };
          if (pn.mediaEntry) {
            const landed = await landEntry(pn.mediaEntry, "media");
            if ("error" in landed) {
              missingReason = landed.error;
              mediaMissing.push({ title: pn.title, reason: landed.error });
            } else {
              mediaBlobKey = landed.blobKey;
              filePath = landed.path;
              mediaImported += 1;
              if (pn.type === "image" || pn.type === "video") {
                try {
                  const probe = await ctx.executePrivileged(
                    Contracts.probeMediaFile,
                    { path: landed.path },
                  );
                  if (probe.width && probe.height) {
                    genSize = `${probe.width}x${probe.height}`;
                  }
                } catch {
                  // Keep the packaged genSize when probing fails.
                }
              }
            }
          }
          if (pn.posterEntry && mediaBlobKey) {
            const landedPoster = await landEntry(pn.posterEntry, "poster");
            if (!("error" in landedPoster)) {
              posterBlobKey = landedPoster.blobKey;
            }
          }
          const genStatusValue =
            missingReason !== null
              ? "failed"
              : pn.genStatus === "queued" || pn.genStatus === "working"
                ? "idle"
                : pn.genStatus === "done" || pn.genStatus === "failed"
                  ? pn.genStatus
                  : "idle";
          const carriedSeq =
            typeof pn.seq === "number" &&
            Number.isInteger(pn.seq) &&
            pn.seq > 0 &&
            carriedSeqs.has(pn.seq) &&
            !usedCarriedSeqs.has(pn.seq)
              ? pn.seq
              : null;
          if (carriedSeq != null) usedCarriedSeqs.add(carriedSeq);
          const now = new Date();
          await db.insert(schema.canvasNodes).values({
            id: newId,
            projectId,
            seq: carriedSeq,
            type: pn.type as NodeRow["type"],
            title: pn.title,
            x: pn.x,
            y: pn.y,
            width: pn.width,
            height: pn.height,
            content: pn.content ?? "",
            prompt: pn.prompt ?? "",
            status: missingReason
              ? "error"
              : pn.status === "success" || pn.status === "loading" || pn.status === "error"
                ? pn.status
                : "idle",
            hidden: Boolean(pn.hidden),
            groupId: null, // remapped in the second pass below
            color: pn.color ?? null,
            freeResize: Boolean(pn.freeResize),
            fontSize: pn.fontSize ?? null,
            genStatus: genStatusValue as NodeRow["genStatus"],
            genError: missingReason
              ? `导入缺失：${missingReason}`
              : (pn.genError ?? null),
            genStartedAt: null,
            genRatio: pn.genRatio ?? null,
            genSize,
            genDuration: pn.genDuration ?? null,
            genKind: (pn.genKind ?? null) as NodeRow["genKind"],
            genMode: (pn.genMode ?? null) as NodeRow["genMode"],
            genClaimToken: null,
            genTaskId: null,
            mediaBlobKey,
            mimeType: pn.mimeType ?? null,
            filePath,
            posterBlobKey,
            sortOrder: index,
            createdAt: now,
            updatedAt: now,
          });
          if (pn.type === "video" && mediaBlobKey && !posterBlobKey) {
            videoRowsNeedingPoster.push(newId);
          }
        }
        if (maxCarriedSeq > 0) {
          await db
            .update(schema.projects)
            .set({ nodeSeqCounter: maxCarriedSeq })
            .where(eq(schema.projects.id, projectId));
        }
        // Second pass: group membership can only be remapped once every
        // new node id exists.
        for (const pn of pkgNodes) {
          if (!pn.groupId) continue;
          const newId = idMap.get(pn.id);
          const newGroupId = idMap.get(pn.groupId);
          if (newId && newGroupId) {
            await db
              .update(schema.canvasNodes)
              .set({ groupId: newGroupId })
              .where(eq(schema.canvasNodes.id, newId));
          }
        }
        let edgeCount = 0;
        for (const pe of manifest.edges ?? []) {
          const from = idMap.get(pe.fromNodeId);
          const to = idMap.get(pe.toNodeId);
          if (!from || !to) continue;
          await db.insert(schema.canvasEdges).values({
            id: crypto.randomUUID(),
            projectId,
            fromNodeId: from,
            toNodeId: to,
            sortOrder: edgeCount,
          });
          edgeCount += 1;
        }
        for (const nodeId of videoRowsNeedingPoster) {
          try {
            const row = await getNodeRow(db, nodeId);
            if (row) await ensurePoster(ctx, db, row);
          } catch {
            // Poster is a stand-in still; import does not fail over it.
          }
        }
        ctx.invalidateQueries();
        return {
          projectId,
          name,
          nodeCount: idMap.size,
          edgeCount,
          mediaImported,
          mediaMissing,
        };
      } finally {
        try {
          await ctx.executePrivileged(Contracts.deleteStagingFile, {
            spaceDir: ctx.spaceDir,
            path: extracted.stagingDir,
          });
        } catch {
          // Staging cleanup is best-effort.
        }
      }
    },
  }),
};