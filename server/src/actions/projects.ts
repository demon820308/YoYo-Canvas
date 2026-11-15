// projects.ts — 项目注册（列表/创建/工作区/改名/删除/聊天绑定四态机/读取）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "../schema";
import { chatFields, chatStatusEnum, edgeShape, nodeShape, okResponse, toChatFields, toEdge, toNode } from "./contracts";
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
          ...chatFields,
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
          ...toChatFields(p),
        })),
      };
    },
  }),

  createProject: defineAction({
    description:
      "Creates a new empty canvas project and its dedicated working directory under ~/workspace/yoyo-canvas-projects/<name>-<id8>. The project is born with chatStatus=creating and chatRequestedAt set: creating the project (and its directory) IS the chat-creation request — the external directory sentinel wakes a live session to create the window and call bindProjectChat.",
    request: z.object({ name: z.string().min(1).max(80) }),
    response: z.object({
      id: z.string(),
      workspaceDir: z.string(),
      chatStatus: chatStatusEnum,
      chatRequestedAt: z.string(),
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
        // ensureProjectWorkspace; the binding path is still recorded.
      }
      const requestedAt = new Date();
      await db.insert(schema.projects).values({
        id,
        name: args.name,
        workspaceDir,
        chatStatus: "creating",
        chatId: null,
        chatTitle: null,
        chatError: null,
        chatRequestedAt: requestedAt,
      });
      ctx.invalidateQueries();
      return {
        id,
        workspaceDir,
        chatStatus: "creating" as const,
        chatRequestedAt: requestedAt.toISOString(),
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

  requestProjectChat: defineAction({
    description:
      "Requests (or re-requests) the project's dedicated chat window: an unbound or failed project goes back to chatStatus=creating with a fresh chatRequestedAt and a cleared chatError, so the external sentinel picks it up. A bound project is left untouched, and a project already in creating keeps its original request timestamp (so the 10-minute timeout judgement is never disturbed) — both just return the current state.",
    request: z.object({ projectId: z.string() }),
    response: z.object({
      chatStatus: chatStatusEnum,
      chatRequestedAt: z.string().nullable(),
    }),
    handler: async (ctx, args) => {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (!project) throw new Error("requestProjectChat: project not found");
      if (project.chatStatus === "bound" || project.chatStatus === "creating") {
        return {
          chatStatus: project.chatStatus,
          chatRequestedAt: project.chatRequestedAt
            ? project.chatRequestedAt.toISOString()
            : null,
        };
      }
      const requestedAt = new Date();
      await db
        .update(schema.projects)
        .set({
          chatStatus: "creating",
          chatRequestedAt: requestedAt,
          chatError: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, project.id));
      ctx.invalidateQueries();
      return {
        chatStatus: "creating" as const,
        chatRequestedAt: requestedAt.toISOString(),
      };
    },
  }),

  bindProjectChat: defineAction({
    description:
      "Binds a created chat window to a project: sets chatStatus=bound with the chat's id and title, and clears any previous chatError and the outstanding request timestamp. Called by the live session that created the window (via the external sentinel), never by the page itself.",
    request: z.object({
      projectId: z.string(),
      chatId: z.string().min(1).max(200),
      chatTitle: z.string().max(200).default(""),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.projects)
        .set({
          chatStatus: "bound",
          chatId: args.chatId,
          chatTitle: args.chatTitle || null,
          chatError: null,
          chatRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, args.projectId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  failProjectChat: defineAction({
    description:
      "Marks a project's chat binding as failed with a visible reason (chatStatus=failed, chatError=reason), ready for a manual retry via requestProjectChat.",
    request: z.object({
      projectId: z.string(),
      reason: z.string().min(1).max(500),
    }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.projects)
        .set({
          chatStatus: "failed",
          chatError: args.reason,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, args.projectId));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  clearProjectChat: defineAction({
    description:
      "Clears a project's chat request state back to unbound (chatId/chatTitle/chatError/chatRequestedAt cleared). A BOUND project can never be unbound — the project ↔ dedicated-chat association is permanent by the owner's rule — so the call is rejected with an error when chatStatus is bound.",
    request: z.object({ projectId: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      const project = await getProjectRow(db, args.projectId);
      if (project?.chatStatus === "bound") {
        throw new Error("项目已与专属会话绑定，不能解绑");
      }
      await db
        .update(schema.projects)
        .set({
          chatStatus: "unbound",
          chatId: null,
          chatTitle: null,
          chatError: null,
          chatRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, args.projectId));
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
          ...chatFields,
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
          ...toChatFields(project),
        },
        nodes,
        edges: edgeRows.map(toEdge),
      };
    },
  }),
};