// 特征测试：项目↔专属聊天绑定整域移除（Wei 2026-11-16 定版）。
// 钉死三件事：① 迁移 0014 在「仅旧数据」上执行后五列消失、项目行
// 本身完好（第十七节三态中的旧→新）；② 全量迁移建出的新库 projects
// 表根本没有 chat 五列（仅新）；③ 项目类 action 的返回与
// processQueue 的输出不含任何 chat 字段 / chatRecovered，且四个
// 建聊 action 已不存在。用内存 libsql 库跑真实迁移建表，action
// handler 以桩 ctx 直调（db 为真实迁移库、特权层只回一个假目录）。

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "@hatch/space-sdk";
import * as schema from "../../schema";
import type { Db } from "../contracts";
import { ProjectsActions } from "../projects";
import { GenerationActions } from "../generation";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "..", "..", "drizzle");
const CHAT_COLUMNS = [
  "chat_status",
  "chat_id",
  "chat_title",
  "chat_error",
  "chat_requested_at",
];
const CHAT_KEYS = ["chatStatus", "chatId", "chatTitle", "chatError", "chatRequestedAt"];

function migrationFiles(upto?: string): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !upto || f <= upto);
}

async function applyMigrations(client: Client, files: string[]): Promise<void> {
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }
}

async function makeDb(upto?: string): Promise<{ client: Client; db: Db }> {
  const client = createClient({ url: ":memory:" });
  await applyMigrations(client, migrationFiles(upto));
  return { client, db: drizzle(client, { schema }) as Db };
}

async function projectColumns(client: Client): Promise<string[]> {
  const rs = await client.execute("PRAGMA table_info(projects)");
  return rs.rows.map((r) => String(r.name));
}

function stubCtx(db: Db): Ctx {
  return {
    db: () => db,
    invalidateQueries: () => {},
    executePrivileged: async () => ({ path: "/tmp/yoyo-chat-removal-test" }),
    blobs: { getUrl: async () => null },
  } as unknown as Ctx;
}

describe("迁移 0014 三态", () => {
  test("仅旧数据：bound 项目行迁移后完好、五列消失", async () => {
    const { client, db } = await makeDb("0013_drop_plugins_table_and_retire_doc_node_types.sql");
    await client.execute({
      sql: "INSERT INTO projects (id, name, workspace_dir, chat_status, chat_id, chat_title, chat_error, chat_requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: ["p-old", "旧项目", "/tmp/old", "bound", "chat-1", "专属窗", null, null, 1, 1],
    });
    await applyMigrations(client, ["0014_drop_project_chat_binding_columns.sql"]);
    const cols = await projectColumns(client);
    for (const c of CHAT_COLUMNS) expect(cols).not.toContain(c);
    const rows = await db.select().from(schema.projects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("旧项目");
    expect("chatStatus" in (rows[0] ?? {})).toBe(false);
  });

  test("仅新数据：全量迁移的 projects 表无 chat 五列，项目可正常插入", async () => {
    const { client, db } = await makeDb();
    const cols = await projectColumns(client);
    for ( const c of CHAT_COLUMNS) expect(cols).not.toContain(c);
    await db.insert(schema.projects).values({ id: "p-new", name: "新项目" });
    const rows = await db.select().from(schema.projects);
    expect(rows).toHaveLength(1);
  });
});

describe("项目 action 契约无 chat 字段", () => {
  test("四个建聊 action 已整域删除", () => {
    for (const name of ["requestProjectChat", "bindProjectChat", "failProjectChat", "clearProjectChat"]) {
      expect(ProjectsActions).not.toHaveProperty(name);
    }
  });

  test("createProject 返回只有 id 与 workspaceDir", async () => {
    const { db } = await makeDb();
    const ctx = stubCtx(db);
    const res = await ProjectsActions.createProject.handler(ctx, { name: "沙箱新项目" });
    expect(Object.keys(res).sort()).toEqual(["id", "workspaceDir"]);
    for (const k of CHAT_KEYS) expect(res).not.toHaveProperty(k);
  });

  test("listProjects / getProject 的项目对象不含 chat 字段", async () => {
    const { db } = await makeDb();
    const ctx = stubCtx(db);
    const created = await ProjectsActions.createProject.handler(ctx, { name: "沙箱项目" });
    const list = await ProjectsActions.listProjects.handler(ctx, {});
    expect(list.projects).toHaveLength(1);
    for (const k of CHAT_KEYS) expect(list.projects[0]).not.toHaveProperty(k);
    const got = await ProjectsActions.getProject.handler(ctx, { id: created.id });
    expect(got.project).not.toBeNull();
    for (const k of CHAT_KEYS) expect(got.project).not.toHaveProperty(k);
  });

  test("processQueue 输出不含 chatRecovered", async () => {
    const { db } = await makeDb();
    const ctx = stubCtx(db);
    const res = await GenerationActions.processQueue.handler(ctx, {});
    expect(res).not.toHaveProperty("chatRecovered");
    expect(res.processed).toBe(0);
  });
});
