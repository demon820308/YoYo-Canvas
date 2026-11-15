// File / blob domain of the privileged host handlers (split out of
// server/src/privileged.ts in batch S6 — a verbatim move, no behavior
// change): project working directories under
// ~/workspace/yoyo-canvas-projects, media file reads/writes inside
// them, and reads of this space's own blob store objects (the single
// root + layout rule lives in resolveBlobObjectPath below). The
// path/blob helpers here are shared by the media and package domains,
// which import them from this module.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";

const WORKSPACE_ROOT = resolve(homedir(), "workspace");
const PROJECTS_ROOT = resolve(WORKSPACE_ROOT, "yoyo-canvas-projects");

const ALLOWED_EXTS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".ogg",
]);

export const MAX_BYTES = 64 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

export function safeBase(name: string): string {
  return basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-");
}

function projectDirPath(dirName: string): string {
  const safe = safeBase(dirName);
  if (!safe || safe === "." || safe === "..") {
    throw new Error("invalid project dirName");
  }
  const full = resolve(PROJECTS_ROOT, safe);
  if (!full.startsWith(PROJECTS_ROOT + "/")) {
    throw new Error("project dir escapes yoyo-canvas-projects");
  }
  return full;
}

export function assertInProjectsRoot(path: string, what: string): string {
  const full = resolve(path);
  if (!full.startsWith(PROJECTS_ROOT + "/")) {
    throw new Error(`${what} must be inside ~/workspace/yoyo-canvas-projects`);
  }
  return full;
}

/** Resolves one of this space's own blob objects to its single on-disk
 * location — the one place the store layout is defined, shared by every
 * blob read and mirror in this file. The store root has exactly one
 * deterministic source: the HATCH_SPACE_BLOB_DIR environment value when
 * the host process carries it, otherwise the canonical <spaceDir>/blobs.
 * The object file is objects/<sha256(key)[:2]>/<sha256(key)> — the only
 * layout. Nothing else is ever tried: a miss is an error naming the root
 * and object path that were actually attempted, never a cue to look
 * somewhere else. */
function resolveBlobObjectPath(
  spaceDir: string,
  key: string,
): { root: string; objectPath: string } {
  const segments = key.split("/");
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    segments.some((s) => s === "" || s === "." || s === "..")
  ) {
    throw new Error("invalid blob key");
  }
  const envRoot = process.env.HATCH_SPACE_BLOB_DIR?.trim();
  const root = envRoot ? resolve(envRoot) : resolve(spaceDir, "blobs");
  const objectId = createHash("sha256").update(key, "utf8").digest("hex");
  return {
    root,
    objectPath: resolve(root, "objects", objectId.slice(0, 2), objectId),
  };
}

/** Reads one of this space's own blob objects' bytes from the location
 * resolveBlobObjectPath names. */
export async function readBlobObjectBytes(
  spaceDir: string,
  key: string,
): Promise<Buffer> {
  const { root, objectPath } = resolveBlobObjectPath(spaceDir, key);
  let info;
  try {
    info = await stat(objectPath);
  } catch {
    throw new Error(
      `blob object not found for key "${key}" (root: ${root}, object: ${objectPath})`,
    );
  }
  if (!info.isFile() || info.size === 0) {
    throw new Error(
      `blob object not found for key "${key}" (root: ${root}, object: ${objectPath})`,
    );
  }
  if (info.size > MAX_BYTES) {
    throw new Error("blob exceeds 64MB cap");
  }
  return await readFile(objectPath);
}

export const filesHandlers = {
  ensureProjectDir: async (args: { dirName: string }) => {
    const full = projectDirPath(args.dirName);
    await mkdir(full, { recursive: true });
    return { path: full };
  },
  readMediaFile: async (args: { path: string }) => {
    const full = resolve(args.path);
    if (!full.startsWith(WORKSPACE_ROOT + "/")) {
      throw new Error("readMediaFile: path must be under ~/workspace");
    }
    const ext = extname(full).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new Error(`readMediaFile: unsupported extension ${ext}`);
    }
    const info = await stat(full);
    if (!info.isFile()) {
      throw new Error("readMediaFile: not a file");
    }
    if (info.size > MAX_BYTES) {
      throw new Error("readMediaFile: file exceeds 64MB cap");
    }
    const bytes = await readFile(full);
    return {
      dataBase64: bytes.toString("base64"),
      sizeBytes: bytes.byteLength,
      contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    };
  },
  writeProjectFile: async (args: {
    dirName: string;
    fileName: string;
    dataBase64: string;
  }) => {
    const dir = projectDirPath(args.dirName);
    const name = safeBase(args.fileName);
    if (!name || name === "." || name === "..") {
      throw new Error("writeProjectFile: invalid fileName");
    }
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new Error(`writeProjectFile: unsupported extension ${ext}`);
    }
    const bytes = Buffer.from(args.dataBase64, "base64");
    if (bytes.byteLength > MAX_BYTES) {
      throw new Error("writeProjectFile: file exceeds 64MB cap");
    }
    await mkdir(dir, { recursive: true });
    const full = resolve(dir, name);
    await writeFile(full, bytes);
    return { path: full };
  },
  mirrorBlobToFile: async (args: {
    spaceDir: string;
    blobKey: string;
    dirName: string;
    fileName: string;
  }) => {
    let bytes: Buffer;
    try {
      bytes = await readBlobObjectBytes(args.spaceDir, args.blobKey);
    } catch (err) {
      throw new Error(
        `mirrorBlobToFile: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const dir = projectDirPath(args.dirName);
    const name = safeBase(args.fileName);
    if (!name || name === "." || name === "..") {
      throw new Error("mirrorBlobToFile: invalid fileName");
    }
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new Error(`mirrorBlobToFile: unsupported extension ${ext}`);
    }
    await mkdir(dir, { recursive: true });
    const full = resolve(dir, name);
    await writeFile(full, bytes);
    return { path: full, sizeBytes: bytes.byteLength };
  },
  importMediaFile: async (args: {
    fromPath: string;
    dirName: string;
    fileName: string;
  }) => {
    const from = resolve(args.fromPath);
    if (!from.startsWith(WORKSPACE_ROOT + "/")) {
      throw new Error("importMediaFile: source must be under ~/workspace");
    }
    const info = await stat(from);
    if (!info.isFile()) throw new Error("importMediaFile: source not a file");
    if (info.size > MAX_BYTES) {
      throw new Error("importMediaFile: source exceeds 64MB cap");
    }
    const dir = projectDirPath(args.dirName);
    const name = safeBase(args.fileName);
    if (!name || name === "." || name === "..") {
      throw new Error("importMediaFile: invalid fileName");
    }
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new Error(`importMediaFile: unsupported extension ${ext}`);
    }
    await mkdir(dir, { recursive: true });
    const full = resolve(dir, name);
    await copyFile(from, full);
    return { path: full, sizeBytes: info.size };
  },
};
