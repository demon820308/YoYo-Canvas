// 特征测试：project-dirs.ts 的节点编号发放规则（reserveNodeSeqs /
// assignNodeSeqs）。用内存 SQLite + 本仓 drizzle 迁移建出真实表结构后
// 直测当前行为：计数器只进不退、存量号不变、撤销恢复认领规则。
// 拆分前后必须同一套全绿（批次 S1）。

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../schema";
import type { Db } from "../contracts";
import { assignNodeSeqs, reserveNodeSeqs } from "../project-dirs";

function makeDb(): { db: Db; projectId: string } {
  const sqlite = new Database(":memory:");
  const drizzleDir = join(import.meta.dir, "../../../../drizzle");
  for (const file of readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(join(drizzleDir, file), "utf8"));
  }
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  return { db, projectId: "proj-1" };
}

async function seedProject(db: Db, projectId: string): Promise<void> {
  await db.insert(schema.projects).values({ id: projectId, name: "测试项目" });
}

async function seedNode(
  db: Db,
  projectId: string,
  id: string,
  seq: number | null,
): Promise<void> {
  await db.insert(schema.canvasNodes).values({
    id,
    projectId,
    seq,
    type: "text",
    title: id,
  });
}

async function counterOf(db: Db, projectId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.projects.id, counter: schema.projects.nodeSeqCounter })
    .from(schema.projects);
  return rows.find((r) => r.id === projectId)?.counter ?? -1;
}

describe("reserveNodeSeqs", () => {
  test("count ≤ 0 返回空数组且不动计数器", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    expect(await reserveNodeSeqs(db, projectId, 0)).toEqual([]);
    expect(await reserveNodeSeqs(db, projectId, -3)).toEqual([]);
    expect(await counterOf(db, projectId)).toBe(0);
  });

  test("连续发放升序、计数器只进不退", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    expect(await reserveNodeSeqs(db, projectId, 3)).toEqual([1, 2, 3]);
    expect(await reserveNodeSeqs(db, projectId, 2)).toEqual([4, 5]);
    expect(await reserveNodeSeqs(db, projectId, 1)).toEqual([6]);
    expect(await counterOf(db, projectId)).toBe(6);
  });
});

describe("assignNodeSeqs", () => {
  test("全新节点按给定顺序发新号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "a", claim: null },
      { id: "b", claim: null },
    ]);
    expect(seqs.get("a")).toBe(1);
    expect(seqs.get("b")).toBe(2);
    expect(await counterOf(db, projectId)).toBe(2);
  });

  test("已存节点保持原号、计数器不动", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 7);
    await seedNode(db, projectId, "old", 7);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "old", claim: null },
    ]);
    expect(seqs.get("old")).toBe(7);
    expect(await counterOf(db, projectId)).toBe(7);
  });

  test("编号前的存量节点（seq NULL）保持无号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await seedNode(db, projectId, "legacy", null);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "legacy", claim: null },
    ]);
    expect(seqs.get("legacy")).toBeNull();
  });

  test("撤销恢复认领：号已发放且无人持有时认回原号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 5);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "restored", claim: 3 },
    ]);
    expect(seqs.get("restored")).toBe(3);
    // 认领不消耗新号，计数器仍是 5。
    expect(await counterOf(db, projectId)).toBe(5);
  });

  test("认领的号已被存活节点持有时改发新号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 5);
    await seedNode(db, projectId, "holder", 3);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "newbie", claim: 3 },
    ]);
    expect(seqs.get("newbie")).toBe(6);
  });

  test("认领超过计数器（从未发放）时改发新号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 5);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "newbie", claim: 9 },
    ]);
    expect(seqs.get("newbie")).toBe(6);
  });

  test("同一次调用里重复认领同一个号：先到者认回、后到者发新号", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 5);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "first", claim: 3 },
      { id: "second", claim: 3 },
    ]);
    expect(seqs.get("first")).toBe(3);
    expect(seqs.get("second")).toBe(6);
  });

  test("混合批次：存量保号、认领回号、全新发号互不干扰", async () => {
    const { db, projectId } = makeDb();
    await seedProject(db, projectId);
    await reserveNodeSeqs(db, projectId, 5);
    await seedNode(db, projectId, "old", 5);
    const seqs = await assignNodeSeqs(db, projectId, [
      { id: "old", claim: null },
      { id: "restored", claim: 2 },
      { id: "fresh", claim: null },
    ]);
    expect(seqs.get("old")).toBe(5);
    expect(seqs.get("restored")).toBe(2);
    expect(seqs.get("fresh")).toBe(6);
    expect(await counterOf(db, projectId)).toBe(6);
  });
});
