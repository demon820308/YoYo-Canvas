// prompts.ts — 提示词库注册（列表/新增/删除，全局共用不按项目隔离）。批次 S2 自 server/src/actions.ts
// 注册段整段搬移：注册名、契约形状与 handler 行为不变，纯结构搬移。

import { defineAction, z } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import * as schema from "../schema";
import { okResponse } from "./contracts";

export const PromptsActions = {
  listPrompts: defineAction({
    description: "Lists this space's prompt library, newest first.",
    request: z.object({}),
    response: z.object({
      prompts: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          content: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.prompts)
        .orderBy(desc(schema.prompts.createdAt));
      return {
        prompts: rows.map((p) => ({
          id: p.id,
          title: p.title,
          content: p.content,
        })),
      };
    },
  }),

  addPrompt: defineAction({
    description: "Adds one prompt to the prompt library and returns its id.",
    request: z.object({
      title: z.string().min(1).max(120),
      content: z.string().min(1),
    }),
    response: z.object({ id: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const id = crypto.randomUUID();
      await db.insert(schema.prompts).values({
        id,
        title: args.title,
        content: args.content,
      });
      ctx.invalidateQueries();
      return { id };
    },
  }),

  removePrompt: defineAction({
    description: "Deletes one prompt from the prompt library.",
    request: z.object({ id: z.string() }),
    response: okResponse,
    handler: async (ctx, args): Promise<z.infer<typeof okResponse>> => {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.prompts).where(eq(schema.prompts.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
};