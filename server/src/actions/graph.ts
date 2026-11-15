// graph.ts — 画布图注册（整图保存 saveGraph / 单节点新增 addNode）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { and, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "../schema";
import { nodeShape, nodeInput, edgeInput, saveGraphResponse, toNode } from "./contracts";
import {
  findServerMediaRestore,
  getNodeRow,
  planEdgeDeletions,
  planNodeDeletions,
  repairNodeMediaPointers,
  type ServerMediaRestore,
} from "./graph-helpers";
import { normalizeImageRatio, parseGenSize } from "./ratios";
import { assignNodeSeqs } from "./project-dirs";

export const GraphActions = {
  saveGraph: defineAction({
    description:
      "Saves a project's whole graph: viewport plus every node (layout, title, content, prompt, status, hidden, group, and the editable generation parameters) and every edge. Server-owned generation/media columns are never overwritten. Deletions are limited to rows the saving page has adopted from the server (knownNodeIds: its last getProject adoption/merge plus every id it has itself saved): a node born server-side after the page's snapshot — a tool/generation result landing — is absent from both the payload and that set, so a stale page's save preserves it and its edges instead of deleting a row it never saw. Callers that omit knownNodeIds keep the legacy payload-authoritative deletion. A payload node whose id has no row (a re-insert after a delete or an undo restore) recovers its server-owned media pointers from the asset-library record filed for that node, so the re-insert is lossless. Safety: an empty node payload that would delete existing nodes is refused unless explicitClear is set — only a deliberate in-page emptying (clear canvas, deleting the last node) sends that flag, so a stray save of a not-yet-loaded board can never wipe a project.",
    request: z.object({
      projectId: z.string(),
      viewport: z.object({
        x: z.number(),
        y: z.number(),
        zoom: z.number(),
      }),
      nodes: z.array(nodeInput),
      edges: z.array(edgeInput).default([]),
      explicitClear: z.boolean().default(false),
      // Node ids this page has adopted from the server (see the
      // description): the deletion boundary for this save. Optional
      // only so pre-field callers keep their legacy semantics.
      knownNodeIds: z.array(z.string()).optional(),
    }),
    response: saveGraphResponse,
    privileged: [Contracts.probeMediaFile],
    handler: async (ctx, args): Promise<z.infer<typeof saveGraphResponse>> => {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const existing = await db
        .select({ id: schema.canvasNodes.id, seq: schema.canvasNodes.seq })
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId));
      if (
        args.nodes.length === 0 &&
        existing.length > 0 &&
        !args.explicitClear
      ) {
        throw new Error(
          "saveGraph: refused an empty graph that would delete existing nodes without an explicit clear",
        );
      }
      // ---- node numbering (server is the only authority) ----
      const seqById = await assignNodeSeqs(
        db,
        args.projectId,
        args.nodes.map((n) => ({ id: n.id, claim: n.seq })),
      );
      const keep = new Set(args.nodes.map((n) => n.id));
      const existingIds = new Set(existing.map((r) => r.id));
      // ---- media restore for (re-)inserted nodes ----
      // A payload node with no row is being created by this save —
      // either genuinely new, or the second half of the delete /
      // re-insert race (or an undo restore). When the asset library
      // holds the media record filed for that exact node id, the
      // insert carries the server-owned pointers from it; the
      // conflict-update set below still never touches them.
      const restoreById = new Map<string, ServerMediaRestore>();
      for (const n of args.nodes) {
        if (existingIds.has(n.id)) continue;
        if (n.type !== "image" && n.type !== "video" && n.type !== "audio") {
          continue;
        }
        const restore = await findServerMediaRestore(
          ctx,
          db,
          args.projectId,
          n.id,
        );
        if (restore) restoreById.set(n.id, restore);
      }
      const knownIds =
        args.knownNodeIds === undefined
          ? undefined
          : new Set(args.knownNodeIds);
      const statements: BatchItem<"sqlite">[] = [
        db
          .update(schema.projects)
          .set({
            viewportX: args.viewport.x,
            viewportY: args.viewport.y,
            viewportZoom: args.viewport.zoom,
            updatedAt: now,
          })
          .where(eq(schema.projects.id, args.projectId)),
      ];
      args.nodes.forEach((n, index) => {
        const restore = restoreById.get(n.id);
        const restoreKind =
          restore &&
          (n.type === "image" || n.type === "video" || n.type === "audio")
            ? n.type
            : null;
        statements.push(
          db
            .insert(schema.canvasNodes)
            .values({
              id: n.id,
              projectId: args.projectId,
              // Number decided above; the conflict-update set below
              // deliberately omits seq so a re-save can never move or
              // re-issue an existing row's number.
              seq: seqById.get(n.id) ?? null,
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
              genRatio:
                restoreKind === "image" && restore?.genSize
                  ? normalizeImageRatio(restore.genSize.replace("x", ":"))
                  : n.genRatio,
              genDuration: n.genDuration,
              genMode: n.genMode,
              ...(restore && restoreKind
                ? {
                    genSize: restore.genSize,
                    genKind: restoreKind,
                    mediaBlobKey: restore.mediaBlobKey,
                    mimeType: restore.mimeType,
                    filePath: restore.filePath,
                    posterBlobKey: restore.posterBlobKey,
                  }
                : {}),
              sortOrder: index,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.canvasNodes.id,
              set: {
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
                genRatio: n.genRatio,
                genDuration: n.genDuration,
                genMode: n.genMode,
                sortOrder: index,
                updatedAt: now,
              },
            }),
        );
      });
      for (const id of planNodeDeletions(
        existing.map((r) => r.id),
        keep,
        knownIds,
      )) {
        statements.push(
          db.delete(schema.canvasNodes).where(eq(schema.canvasNodes.id, id)),
        );
      }
      const keptEdges = args.edges.filter(
        (e) => keep.has(e.fromNodeId) && keep.has(e.toNodeId),
      );
      const keepEdgeIds = new Set(keptEdges.map((e) => e.id));
      const existingEdges = await db
        .select({
          id: schema.canvasEdges.id,
          fromNodeId: schema.canvasEdges.fromNodeId,
          toNodeId: schema.canvasEdges.toNodeId,
        })
        .from(schema.canvasEdges)
        .where(eq(schema.canvasEdges.projectId, args.projectId));
      keptEdges.forEach((e, index) => {
        statements.push(
          db
            .insert(schema.canvasEdges)
            .values({
              id: e.id,
              projectId: args.projectId,
              fromNodeId: e.fromNodeId,
              toNodeId: e.toNodeId,
              sortOrder: index,
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: schema.canvasEdges.id,
              set: {
                fromNodeId: e.fromNodeId,
                toNodeId: e.toNodeId,
                sortOrder: index,
              },
            }),
        );
      });
      for (const id of planEdgeDeletions(
        existingEdges,
        keepEdgeIds,
        keep,
        knownIds,
      )) {
        statements.push(
          db.delete(schema.canvasEdges).where(eq(schema.canvasEdges.id, id)),
        );
      }
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      return {
        ok: true as const,
        seqs: args.nodes.map((n) => ({
          id: n.id,
          seq: seqById.get(n.id) ?? null,
        })),
      };
    },
  }),

  addNode: defineAction({
    description: "Adds a single node to a project and returns the stored node.",
    request: z.object({ projectId: z.string(), node: nodeInput }),
    response: z.object({ node: nodeShape }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      const countRows = await db
        .select({ id: schema.canvasNodes.id })
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.projectId));
      const seqById = await assignNodeSeqs(db, args.projectId, [
        { id: args.node.id, claim: args.node.seq },
      ]);
      const seq = seqById.get(args.node.id) ?? null;
      const inserted = await db
        .insert(schema.canvasNodes)
        .values({
          id: args.node.id,
          projectId: args.projectId,
          seq,
          type: args.node.type,
          title: args.node.title,
          x: args.node.x,
          y: args.node.y,
          width: args.node.width,
          height: args.node.height,
          content: args.node.content,
          prompt: args.node.prompt,
          status: args.node.status,
          hidden: args.node.hidden,
          groupId: args.node.groupId,
          color: args.node.color,
          freeResize: args.node.freeResize,
          fontSize: args.node.fontSize,
          genRatio: args.node.genRatio,
          genDuration: args.node.genDuration,
          genMode: args.node.genMode,
          sortOrder: countRows.length,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error("addNode: insert returned no rows");
      await db
        .update(schema.projects)
        .set({ updatedAt: now })
        .where(eq(schema.projects.id, args.projectId));
      return { node: await toNode(ctx, row) };
    },
  }),

  unhideAllNodes: defineAction({
    description:
      "Restores every hidden canvas node to visible across all projects and reports how many were unhidden. The node hide/show toggle was removed from the detail editor at the user's call, so any node still flagged hidden would have no in-page way back; this is the sanctioned one-time repair for that state. Only the hidden flag is touched — layout, content and every other column stay as they are. Idempotent: with no hidden nodes left it reports zero.",
    request: z.object({}),
    response: z.object({
      ok: z.literal(true),
      unhidden: z.number(),
    }),
    handler: async (ctx): Promise<{ ok: true; unhidden: number }> => {
      const db = ctx.db<typeof schema>();
      const updated = await db
        .update(schema.canvasNodes)
        .set({ hidden: false, updatedAt: new Date() })
        .where(eq(schema.canvasNodes.hidden, true))
        .returning({ id: schema.canvasNodes.id });
      return { ok: true as const, unhidden: updated.length };
    },
  }),

  reconcileNodeRatioLabel: defineAction({
    description:
      "Re-derives one node's stored ratio label (gen_ratio) from its MEASURED media size (gen_size) through the ratios fact source (normalizeImageRatio) and rewrites the label when it disagrees — the sanctioned way to repair a stale label on an existing node (e.g. an asset-inserted node labelled 1:1 whose file actually measures 9:16). Only the label is touched: frame, status and every other column stay as they are. Refused while the node is queued/working, and refused when the node carries no measured size to derive from. Idempotent: a node whose label already matches its measurement is reported unchanged.",
    request: z.object({
      projectId: z.string(),
      nodeId: z.string(),
    }),
    response: z.object({
      ok: z.literal(true),
      nodeId: z.string(),
      previousRatio: z.string().nullable(),
      genRatio: z.string(),
      changed: z.boolean(),
    }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      const row = await getNodeRow(db, args.nodeId);
      if (!row || row.projectId !== args.projectId) {
        throw new Error("reconcileNodeRatioLabel: node not found in project");
      }
      if (row.genStatus === "queued" || row.genStatus === "working") {
        throw new Error(
          "reconcileNodeRatioLabel: node has a generation run in flight",
        );
      }
      const measured = parseGenSize(row.genSize);
      if (!measured) {
        throw new Error(
          "reconcileNodeRatioLabel: node has no measured size to derive a label from",
        );
      }
      const derived = normalizeImageRatio(`${measured.w}:${measured.h}`);
      if (row.genRatio === derived) {
        return {
          ok: true as const,
          nodeId: row.id,
          previousRatio: row.genRatio,
          genRatio: derived,
          changed: false,
        };
      }
      const now = new Date();
      // Guard on the label value just read: if a concurrent save
      // changed it in between, this update matches nothing and the
      // caller hears about it instead of silently overwriting.
      const updated = await db
        .update(schema.canvasNodes)
        .set({ genRatio: derived, updatedAt: now })
        .where(
          and(
            eq(schema.canvasNodes.id, row.id),
            row.genRatio === null
              ? isNull(schema.canvasNodes.genRatio)
              : eq(schema.canvasNodes.genRatio, row.genRatio),
          ),
        )
        .returning({ id: schema.canvasNodes.id });
      if (updated.length === 0) {
        throw new Error(
          "reconcileNodeRatioLabel: label changed concurrently; retry",
        );
      }
      await db
        .update(schema.projects)
        .set({ updatedAt: now })
        .where(eq(schema.projects.id, args.projectId));
      return {
        ok: true as const,
        nodeId: row.id,
        previousRatio: row.genRatio,
        genRatio: derived,
        changed: true,
      };
    },
  }),

  reconcileNodeMediaPointers: defineAction({
    description:
      "Repairs media nodes whose server-owned pointers (mediaBlobKey / filePath / mimeType / genSize) were lost — the damage left behind when a whole-graph save deleted a freshly landed result node and a later save re-inserted it from the client payload, which carries no media columns (yoyo-02 #38). The pointers are restored from the asset-library record filed for that exact node (recordMediaAsset, keyed by sourceNodeId in the node's own project), with genSize re-measured from the landed file. Scans one project, or every project when projectId is omitted. Idempotent: nodes whose pointers are intact, and damaged nodes with no surviving asset record, are reported untouched — a second run repairs zero.",
    request: z.object({
      projectId: z.string().optional(),
    }),
    response: z.object({
      ok: z.literal(true),
      repaired: z.array(
        z.object({
          nodeId: z.string(),
          projectId: z.string(),
          seq: z.number().nullable(),
          mediaBlobKey: z.string(),
        }),
      ),
    }),
    privileged: [Contracts.probeMediaFile],
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      const damaged = await db
        .select()
        .from(schema.canvasNodes)
        .where(
          args.projectId
            ? and(
                eq(schema.canvasNodes.projectId, args.projectId),
                isNull(schema.canvasNodes.mediaBlobKey),
              )
            : isNull(schema.canvasNodes.mediaBlobKey),
        );
      const repaired: {
        nodeId: string;
        projectId: string;
        seq: number | null;
        mediaBlobKey: string;
      }[] = [];
      for (const row of damaged) {
        if (await repairNodeMediaPointers(ctx, db, row)) {
          const fresh = await getNodeRow(db, row.id);
          if (fresh?.mediaBlobKey) {
            repaired.push({
              nodeId: fresh.id,
              projectId: fresh.projectId,
              seq: fresh.seq,
              mediaBlobKey: fresh.mediaBlobKey,
            });
          }
        }
      }
      return { ok: true as const, repaired };
    },
  }),
};