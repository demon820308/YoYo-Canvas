// project-dirs.ts — 节点编号发放（reserveNodeSeqs /
// assignNodeSeqs）、项目工作目录与 HOME 路径推导、MIME→扩展名。
// 拆分来源：批次 S1 自 server/src/actions.ts 整段搬移，行为不变。

import { eq, sql } from "drizzle-orm";
import * as schema from "../schema";
import type { Db, ProjectRow } from "./contracts";

/**
 * Reserves `count` fresh node sequence numbers for a project and
 * returns them in ascending order. The reservation is a single atomic
 * increment of projects.nodeSeqCounter, so two saves racing each
 * other can never be handed the same number; the counter only moves
 * forward, so a deleted node's number is never reissued. Numbers
 * reserved by a caller whose write then fails are simply burned —
 * gaps are acceptable, reuse is not.
 */
export async function reserveNodeSeqs(
  db: Db,
  projectId: string,
  count: number,
): Promise<number[]> {
  if (count <= 0) return [];
  const rows = await db
    .update(schema.projects)
    .set({
      nodeSeqCounter: sql`${schema.projects.nodeSeqCounter} + ${count}`,
    })
    .where(eq(schema.projects.id, projectId))
    .returning({ counter: schema.projects.nodeSeqCounter });
  const end = rows[0]?.counter ?? count;
  return Array.from({ length: count }, (_, i) => end - count + 1 + i);
}

/**
 * Decides the sequence number for every node a write is about to
 * store — the single implementation of the numbering rules, shared
 * by saveGraph and addNode (the server is the only numbering
 * authority):
 *   - a node whose row already exists keeps its stored number: a
 *     number can never be edited or moved, and rows that predate
 *     numbering (seq NULL) stay unnumbered;
 *   - a genuinely new node is issued the next fresh number, in the
 *     order the entries are given;
 *   - EXCEPT a new node carrying a claim that is a genuine
 *     undo-restore — a number this project issued before (at or
 *     below the counter) that no live row currently holds and no
 *     earlier entry in this same call claimed — gets its old
 *     number back instead of a fresh one.
 * Everything else (no claim, claim already held, claim beyond the
 * counter, duplicated claim) falls through to a fresh issue, so
 * repeats and races can never double-issue. Fresh numbers come
 * from reserveNodeSeqs, so the counter only moves forward and a
 * deleted node's number is never reissued.
 */
export async function assignNodeSeqs(
  db: Db,
  projectId: string,
  entries: { id: string; claim: number | null }[],
): Promise<Map<string, number | null>> {
  const existing = await db
    .select({ id: schema.canvasNodes.id, seq: schema.canvasNodes.seq })
    .from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.projectId, projectId));
  const projectRows = await db
    .select({ counter: schema.projects.nodeSeqCounter })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const issuedCounter = projectRows[0]?.counter ?? 0;
  const storedSeqById = new Map<string, number | null>(
    existing.map((r) => [r.id, r.seq]),
  );
  const heldSeqs = new Set<number>(
    existing.map((r) => r.seq).filter((s): s is number => s != null),
  );
  const seqById = new Map<string, number | null>();
  const freshIds: string[] = [];
  for (const entry of entries) {
    if (storedSeqById.has(entry.id)) {
      seqById.set(entry.id, storedSeqById.get(entry.id) ?? null);
      continue;
    }
    const claim = entry.claim;
    if (claim != null && claim <= issuedCounter && !heldSeqs.has(claim)) {
      heldSeqs.add(claim);
      seqById.set(entry.id, claim);
      continue;
    }
    freshIds.push(entry.id);
  }
  const freshSeqs = await reserveNodeSeqs(db, projectId, freshIds.length);
  freshIds.forEach((id, i) => {
    seqById.set(id, freshSeqs[i] ?? null);
  });
  return seqById;
}

// ---------------------------------------------------------------------------
// Project working directories (YoYo's own tree only)
// ---------------------------------------------------------------------------

export function projectDirName(name: string, id: string): string {
  const slug = name
    .trim()
    .replace(/[\\/:*?"<>|#]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return `${slug || "project"}-${id.slice(0, 8)}`;
}

export function projectDirBase(project: ProjectRow): string {
  return (
    project.workspaceDir.split("/").filter(Boolean).pop() ??
    projectDirName(project.name, project.id)
  );
}

/**
 * The user's home directory, read from the runtime environment (the
 * same value node:os homedir() resolves on this platform). Action code
 * cannot import node:os — host facts live in privileged.ts, which
 * derives its workspace root from homedir() directly — so this is the
 * one place actions read it, and there is deliberately no fallback:
 * an unset HOME fails loudly instead of guessing another user's dir.
 */
export function homeDir(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("homeDir: HOME is not set in the action runtime");
  }
  return home;
}

export function expandHome(path: string): string {
  return path.startsWith("~/") ? `${homeDir()}/${path.slice(2)}` : path;
}

/** Absolute working directory for a new project with this directory name. */
export function projectWorkspaceDir(dirName: string): string {
  return `${homeDir()}/workspace/yoyo-canvas-projects/${dirName}`;
}

/** True when filePath sits inside the project's own working directory. */
export function isInProjectDir(project: ProjectRow, filePath: string): boolean {
  const dir = expandHome(project.workspaceDir).replace(/\/+$/, "");
  const file = expandHome(filePath);
  return dir !== "" && (file === dir || file.startsWith(`${dir}/`));
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
};

export function extForMime(mimeType: string | null, fallback = ".png"): string {
  return (mimeType && EXT_BY_MIME[mimeType]) || fallback;
}
