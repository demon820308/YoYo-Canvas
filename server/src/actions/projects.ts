// projects.ts — 项目注册（列表/创建/工作区/改名/删除/读取）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "../schema";
import { edgeShape, nodeShape, okResponse, toEdge, toNode } from "./contracts";
import { getProjectRow } from "./graph-helpers";
import { projectDirName, projectDirBase, projectWorkspaceDir } from "./project-dirs";

export const ProjectsActions = {
  listProjects: defineAction({
    description:
      "Lists this space's canvas projects with node counts and working directories, most recently active first.",
    request: z.object({}),
    response: z.object({
      projects: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          nodeCount: z.number(),
          workspaceDir: z.string(),
          updatedAt: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.projects)
        .orderBy(desc(schema.projects.updatedAt));
      const nodeRows = await db
        .select({
          projectId: schema.canvasNodes.projectId,
          id: schema.canvasNodes.id,
        })
        .from(schema.canvasNodes);
      const counts = new Map<string, number>();
      for (const n of nodeRows) {
        counts.set(n.projectId, (counts.get(n.projectId) ?? 0) + 1);
      }
      return {
        projects: rows.map((p) => ({
          id: p.id,
          name: p.name,
          nodeCount: counts.get(p.id) ?? 0,
          workspaceDir: p.workspaceDir,
          updatedAt: p.updatedAt.toISOString(),
        })),
      };
    },
  }),

  createProject: defineAction({
    description:
      "Creates a new empty canvas project and its dedicated working directory under ~/workspace/yoyo-canvas-projects/<name>-<id8>. The project is usable immediately — there is no binding or setup state.",
    request: z.object({ name: z.string().min(1).max(80) }),
    response: z.object({
      id: z.string(),
      workspaceDir: z.string(),
    }),
    privileged: [Contracts.ensureProjectDir],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const id = crypto.randomUUID();
      const dirName = projectDirName(args.name, id);
      let workspaceDir = projectWorkspaceDir(dirName);
      try {
        const ensured = await ctx.executePrivileged(Contracts.ensureProjectDir, {
          dirName,
        });
        workspaceDir = ensured.path;
      } catch {
        // Directory creation is retriable later via
        // ensureProjectWorkspace.
      }
      await db.insert(schema.projects).values({
        id,
        name: args.name,
        workspaceDir,
      });
      ctx.invalidateQueries();
      return {
        id,
        workspaceDir,
      };
    },
  }),

  ensureProjectWorkspace: defineAction({
    description:
      "Creates (if needed) the working directory for an existing project and returns its absolute path.",
    request: z.object({ projectId: z.string() }),
    response: z.object({ workspaceDir: z.string() }),
    privileged: [Contracts.ensureProjectDir],
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("ensureProjectWorkspace: project not found");
      const ensured = await ctx.executePrivileged(Contracts.ensureProjectDir, {
        dirName: projectDirBase(project),
      });
      if (ensured.path !== project.workspaceDir) {
        await db
          .update(schema.projects)
          .set({ workspaceDir: ensured.path, updatedAt: new Date() })
          .where(eq(schema.projects.id, project.id));
      }
      ctx.invalidateQueries();
      return { workspaceDir: ensured.path };
    },
  }),

  renameProject: defineAction({
    description: "Renames one canvas project.",
    request: z.object({ id: z.string(), name: z.string().min(1).max(80) }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.projects)
        .set({ name: args.name, updatedAt: new Date() })
        .where(eq(schema.projects.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteProject: defineAction({
    description: "Deletes one canvas project together with all of its nodes and edges.",
    request: z.object({ id: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db.batch([
        db
          .delete(schema.canvasNodes)
          .where(eq(schema.canvasNodes.projectId, args.id)),
        db
          .delete(schema.canvasEdges)
          .where(eq(schema.canvasEdges.projectId, args.id)),
        db.delete(schema.projects).where(eq(schema.projects.id, args.id)),
      ]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getProject: defineAction({
    description:
      "Returns one project with its saved viewport, working directory, and full node graph, or a null project when the id is unknown.",
    request: z.object({ id: z.string() }),
    response: z.object({
      project: z
        .object({
          id: z.string(),
          name: z.string(),
          workspaceDir: z.string(),
          viewport: z.object({
            x: z.number(),
            y: z.number(),
            zoom: z.number(),
          }),
        })
        .nullable(),
      nodes: z.array(nodeShape),
      edges: z.array(edgeShape),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const projectRows = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, args.id))
        .limit(1);
      const project = projectRows[0];
      if (!project) return { project: null, nodes: [], edges: [] };
      const nodeRows = await db
        .select()
        .from(schema.canvasNodes)
        .where(eq(schema.canvasNodes.projectId, args.id))
        .orderBy(asc(schema.canvasNodes.sortOrder), asc(schema.canvasNodes.createdAt));
      const edgeRows = await db
        .select()
        .from(schema.canvasEdges)
        .where(eq(schema.canvasEdges.projectId, args.id))
        .orderBy(asc(schema.canvasEdges.sortOrder), asc(schema.canvasEdges.createdAt));
      const nodes: z.infer<typeof nodeShape>[] = [];
      for (const row of nodeRows) nodes.push(await toNode(ctx, row));
      return {
        project: {
          id: project.id,
          name: project.name,
          workspaceDir: project.workspaceDir,
          viewport: {
            x: project.viewportX,
            y: project.viewportY,
            zoom: project.viewportZoom,
          },
        },
        nodes,
        edges: edgeRows.map(toEdge),
      };
    },
  }),
};