// 特征测试：generation-records.ts 的记录写入语义——终态单点写入、
// (nodeId, startedAt) 幂等、queued 取消以入队时刻为 startedAt、
// 节点删除后记录仍在。用内存 libsql 库跑真实迁移建表，测的是
// recordGenerationOutcome / markFailed / landMediaResult 三条共享
// 终态路径的真实写库行为，不是纯函数替身。

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../schema";
import type { Db, NodeRow } from "../contracts";
import {
  amendGenerationRecordMedia,
  recordGenerationOutcome,
  runStartedAt,
} from "../generation-records";
import { landMediaResult, markFailed } from "../graph-helpers";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "..", "..", "drizzle");

async function makeDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }
  return drizzle(client, { schema }) as Db;
}

const T0 = new Date("2026-11-15T10:00:00.000Z");
const T1 = new Date("2026-11-15T10:01:30.000Z");

async function seedNode(
  db: Db,
  partial: Partial<NodeRow> & { id: string },
): Promise<NodeRow> {
  await db.insert(schema.projects).values({
    id: "proj-1",
    name: "测试项目",
    workspaceDir: "",
  }).onConflictDoNothing();
  const now = new Date();
  await db.insert(schema.canvasNodes).values({
    projectId: "proj-1",
    type: "image",
    title: "生图",
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    content: "",
    prompt: "一只猫",
    status: "idle",
    hidden: false,
    genStatus: "idle",
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
  const rows = await db
    .select()
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.id, partial.id));
  const row = rows[0];
  if (!row) throw new Error("seed failed");
  return row;
}

async function recordsOf(db: Db) {
  return db.select().from(schema.generationRecords);
}

describe("runStartedAt", () => {
  test("有 genStartedAt 用它，没有时回退到 updatedAt（入队时刻）", async () => {
    const db = await makeDb();
    const working = await seedNode(db, {
      id: "n-working",
      genStatus: "working",
      genStartedAt: T1,
      updatedAt: T0,
    });
    expect(runStartedAt(working).getTime()).toBe(T1.getTime());
    const queued = await seedNode(db, {
      id: "n-queued",
      genStatus: "queued",
      genStartedAt: null,
      updatedAt: T0,
    });
    expect(runStartedAt(queued).getTime()).toBe(T0.getTime());
  });
});

describe("recordGenerationOutcome", () => {
  test("done 写入快照：编号/标题/提示词/实测尺寸/媒体键齐全", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n1",
      seq: 7,
      genStatus: "working",
      genKind: "image",
      genRatio: "9:16",
      genStartedAt: T0,
    });
    await recordGenerationOutcome(db, node, {
      status: "done",
      resultNodeId: "n1",
      mediaBlobKey: "media/proj-1/abc",
      mimeType: "image/png",
      filePath: "/tmp/a.png",
      genSize: "1152x2048",
    });
    const rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    const r = rows[0];
    if (!r) throw new Error("no record");
    expect(r.projectId).toBe("proj-1");
    expect(r.nodeId).toBe("n1");
    expect(r.resultNodeId).toBe("n1");
    expect(r.nodeSeq).toBe(7);
    expect(r.nodeTitle).toBe("生图");
    expect(r.genKind).toBe("image");
    expect(r.prompt).toBe("一只猫");
    expect(r.genRatio).toBe("9:16");
    expect(r.genSize).toBe("1152x2048");
    expect(r.mediaBlobKey).toBe("media/proj-1/abc");
    expect(r.status).toBe("done");
    expect(r.startedAt.getTime()).toBe(T0.getTime());
  });

  test("同一轮运行重复写只落一行（幂等）", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n2",
      genStatus: "working",
      genStartedAt: T0,
    });
    await recordGenerationOutcome(db, node, { status: "done" });
    await recordGenerationOutcome(db, node, { status: "done" });
    expect((await recordsOf(db)).length).toBe(1);
    // 下一轮运行（新的 startedAt）是新的一行。
    const nextRun = { ...node, genStartedAt: T1, updatedAt: T1 };
    await recordGenerationOutcome(db, nextRun, { status: "failed", error: "x" });
    expect((await recordsOf(db)).length).toBe(2);
  });

  test("queued 被取消：状态 cancelled、startedAt 为入队时刻", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n3",
      genStatus: "queued",
      genStartedAt: null,
      updatedAt: T0,
    });
    await recordGenerationOutcome(db, node, { status: "cancelled" });
    const rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.startedAt.getTime()).toBe(T0.getTime());
  });
});

describe("共享终态路径", () => {
  test("markFailed 给在飞运行写 failed 记录且只写一次", async () => {
    const db = await makeDb();
    await seedNode(db, {
      id: "n4",
      genStatus: "working",
      genStartedAt: T0,
    });
    await markFailed(db, "n4", "通道超时");
    let rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.error).toBe("通道超时");
    // 节点已 settle，第二次 markFailed 不再写记录（状态守卫）。
    await markFailed(db, "n4", "重复失败");
    rows = await recordsOf(db);
    expect(rows.length).toBe(1);
  });

  test("landMediaResult 原地填充写 done 记录，resultNodeId 为本节点", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n5",
      genStatus: "working",
      genKind: "image",
      genStartedAt: T0,
    });
    const landedId = await landMediaResult(db, node, {
      type: "image",
      title: "生图 · 生成图",
      content: "",
      prompt: "一只猫",
      mediaBlobKey: "media/proj-1/x",
      mimeType: "image/png",
      filePath: null,
      genSize: "1600x1600",
    });
    expect(landedId).toBe("n5");
    const rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("done");
    expect(rows[0]?.resultNodeId).toBe("n5");
    expect(rows[0]?.genSize).toBe("1600x1600");
  });

  test("landMediaResult 跨类扇出（config→图）只写一行，resultNodeId 为新节点", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n6",
      type: "config",
      genStatus: "working",
      genKind: "image",
      genStartedAt: T0,
    });
    const landedId = await landMediaResult(db, node, {
      type: "image",
      title: "生成图片",
      content: "",
      prompt: "一只猫",
      mediaBlobKey: "media/proj-1/y",
      mimeType: "image/png",
      filePath: null,
      genSize: "1600x1600",
    });
    expect(landedId).not.toBe("n6");
    const rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.nodeId).toBe("n6");
    expect(rows[0]?.resultNodeId).toBe(landedId);
  });

  test("amendGenerationRecordMedia 按 blob 键回填实测尺寸与路径，只动 done 记录", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n8",
      genStatus: "working",
      genStartedAt: T0,
    });
    await recordGenerationOutcome(db, node, {
      status: "done",
      mediaBlobKey: "media/proj-1/z",
      genSize: null,
    });
    await amendGenerationRecordMedia(db, "media/proj-1/z", {
      genSize: "2048x1152",
      filePath: "/tmp/z.png",
    });
    let rows = await recordsOf(db);
    expect(rows[0]?.genSize).toBe("2048x1152");
    expect(rows[0]?.filePath).toBe("/tmp/z.png");
    // 不存在的键不动任何行。
    await amendGenerationRecordMedia(db, "media/proj-1/nope", {
      genSize: "1x1",
      filePath: "/tmp/nope.png",
    });
    rows = await recordsOf(db);
    expect(rows.length).toBe(1);
    expect(rows[0]?.genSize).toBe("2048x1152");
  });

  test("节点删除后记录仍在（无级联）", async () => {
    const db = await makeDb();
    const node = await seedNode(db, {
      id: "n7",
      genStatus: "working",
      genStartedAt: T0,
    });
    await recordGenerationOutcome(db, node, { status: "done" });
    await db
      .delete(schema.canvasNodes)
      .where(eq(schema.canvasNodes.id, "n7"));
    expect((await recordsOf(db)).length).toBe(1);
  });
});
