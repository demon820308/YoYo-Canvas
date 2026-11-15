// Project-package domain of the privileged host handlers (split out
// of server/src/privileged.ts in batch S6 — a verbatim move, no
// behavior change): assembling and reading project package ZIPs
// under <spaceDir>/exports, extracting uploaded packages under
// <spaceDir>/imports, and staging cleanup. The ZIP writer/reader is
// dependency-free (STORE write, STORE+DEFLATE read) and lives here
// with the only code that uses it.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  MAX_BYTES,
  assertInProjectsRoot,
  readBlobObjectBytes,
} from "./files";

// ---------------------------------------------------------------------------
// ZIP (STORE write / STORE+DEFLATE read) — dependency-free, used only for
// project packages. Media formats are already compressed, so STORE costs
// nothing meaningful and keeps the writer trivially auditable.
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, entry.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(entry.data.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

type ZipEntryResult =
  | { name: string; ok: true; data: Buffer }
  | { name: string; ok: false };

/** Parses a ZIP via its central directory. Structural damage throws;
 * a single entry's decompression failure is reported per-entry. */
function parseZip(bytes: Buffer): ZipEntryResult[] {
  if (bytes.length < 22) throw new Error("package is not a ZIP file");
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 65536);
  for (let i = bytes.length - 22; i >= scanStart; i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("package is not a ZIP file (no end record)");
  const count = bytes.readUInt16LE(eocd + 10);
  let p = bytes.readUInt32LE(eocd + 16);
  if (count > 2000) throw new Error("package has too many entries");
  const results: ZipEntryResult[] = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50) {
      throw new Error("package central directory is damaged");
    }
    const method = bytes.readUInt16LE(p + 10);
    const expectedCrc = bytes.readUInt32LE(p + 16);
    const compSize = bytes.readUInt32LE(p + 20);
    const rawSize = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const localOffset = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((s) => s === ".." || s === "")
    ) {
      throw new Error(`package entry name is unsafe: ${name}`);
    }
    if (rawSize > MAX_BYTES || compSize > MAX_BYTES) {
      results.push({ name, ok: false });
      continue;
    }
    total += rawSize;
    if (total > 256 * 1024 * 1024) {
      throw new Error("package expands beyond 256MB");
    }
    try {
      if (
        localOffset + 30 > bytes.length ||
        bytes.readUInt32LE(localOffset) !== 0x04034b50
      ) {
        throw new Error("bad local header");
      }
      const lNameLen = bytes.readUInt16LE(localOffset + 26);
      const lExtraLen = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);
      if (comp.length !== compSize) throw new Error("truncated entry");
      let data: Buffer;
      if (method === 0) data = Buffer.from(comp);
      else if (method === 8) data = inflateRawSync(comp);
      else throw new Error(`unsupported compression method ${method}`);
      if (data.length !== rawSize) throw new Error("size mismatch");
      if (crc32(data) !== expectedCrc) throw new Error("crc mismatch");
      results.push({ name, ok: true, data });
    } catch {
      results.push({ name, ok: false });
    }
  }
  return results;
}

function stagingRoot(spaceDir: string, kind: "exports" | "imports"): string {
  return resolve(spaceDir, kind);
}

export const packageHandlers = {
  buildProjectPackage: async (args: {
    spaceDir: string;
    manifestJson: string;
    sources: { entry: string; blobKey: string | null; absPath: string | null }[];
  }) => {
    const manifest = JSON.parse(args.manifestJson) as {
      files?: { entry: string; bytes?: number; missing?: boolean }[];
    };
    const manifestFiles = new Map(
      (manifest.files ?? []).map((f) => [f.entry, f]),
    );
    const zipEntries: { name: string; data: Buffer }[] = [];
    const included: { entry: string; bytes: number }[] = [];
    const missing: string[] = [];
    let total = 0;
    for (const source of args.sources) {
      let bytes: Buffer | null = null;
      if (source.absPath) {
        try {
          const full = assertInProjectsRoot(source.absPath, "package source");
          const info = await stat(full);
          if (info.isFile() && info.size > 0 && info.size <= MAX_BYTES) {
            bytes = await readFile(full);
          }
        } catch {
          bytes = null;
        }
      }
      if (!bytes && source.blobKey) {
        try {
          bytes = await readBlobObjectBytes(args.spaceDir, source.blobKey);
        } catch {
          bytes = null;
        }
      }
      const manifestEntry = manifestFiles.get(source.entry);
      if (!bytes) {
        missing.push(source.entry);
        if (manifestEntry) manifestEntry.missing = true;
        continue;
      }
      total += bytes.byteLength;
      if (total > MAX_BYTES) {
        throw new Error("buildProjectPackage: package exceeds 64MB cap");
      }
      if (manifestEntry) manifestEntry.bytes = bytes.byteLength;
      included.push({ entry: source.entry, bytes: bytes.byteLength });
      zipEntries.push({ name: source.entry, data: bytes });
    }
    const finalManifest = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const zip = buildZip([
      { name: "manifest.json", data: finalManifest },
      ...zipEntries,
    ]);
    const dir = stagingRoot(args.spaceDir, "exports");
    await mkdir(dir, { recursive: true });
    const full = resolve(dir, `${crypto.randomUUID()}.zip`);
    await writeFile(full, zip);
    return { path: full, sizeBytes: zip.byteLength, included, missing };
  },
  readPackageFile: async (args: { spaceDir: string; path: string }) => {
    const root = stagingRoot(args.spaceDir, "exports");
    const full = resolve(args.path);
    if (!full.startsWith(root + "/") || extname(full).toLowerCase() !== ".zip") {
      throw new Error("readPackageFile: path must be a package ZIP in exports");
    }
    const info = await stat(full);
    if (!info.isFile()) throw new Error("readPackageFile: not a file");
    if (info.size > MAX_BYTES) {
      throw new Error("readPackageFile: package exceeds 64MB cap");
    }
    const bytes = await readFile(full);
    return { dataBase64: bytes.toString("base64"), sizeBytes: bytes.byteLength };
  },
  deleteStagingFile: async (args: { spaceDir: string; path: string }) => {
    const full = resolve(args.path);
    const allowed = [
      stagingRoot(args.spaceDir, "exports"),
      stagingRoot(args.spaceDir, "imports"),
    ];
    if (!allowed.some((root) => full.startsWith(root + "/"))) {
      throw new Error("deleteStagingFile: path outside staging trees");
    }
    await rm(full, { recursive: true, force: true });
    return { ok: true as const };
  },
  extractProjectPackage: async (args: {
    spaceDir: string;
    dataBase64: string;
  }) => {
    const zipBytes = Buffer.from(args.dataBase64, "base64");
    if (zipBytes.byteLength > MAX_BYTES) {
      throw new Error("extractProjectPackage: package exceeds 64MB cap");
    }
    const stagingDir = resolve(
      stagingRoot(args.spaceDir, "imports"),
      crypto.randomUUID(),
    );
    await mkdir(stagingDir, { recursive: true });
    const entries = parseZip(zipBytes);
    const manifestEntry = entries.find(
      (e) => e.name === "manifest.json" && e.ok,
    );
    if (!manifestEntry || !manifestEntry.ok) {
      throw new Error("extractProjectPackage: manifest.json missing or damaged");
    }
    const manifestJson = manifestEntry.data.toString("utf8");
    let declared = new Map<string, number>();
    try {
      const manifest = JSON.parse(manifestJson) as {
        files?: { entry: string; bytes?: number }[];
      };
      declared = new Map(
        (manifest.files ?? [])
          .filter((f) => typeof f.bytes === "number")
          .map((f) => [f.entry, f.bytes as number]),
      );
    } catch {
      throw new Error("extractProjectPackage: manifest.json is not valid JSON");
    }
    const filesDir = resolve(stagingDir, "files");
    await mkdir(filesDir, { recursive: true });
    const files: {
      entry: string;
      path: string;
      sizeBytes: number;
      sizeOk: boolean;
    }[] = [];
    const corrupt: string[] = [];
    for (const entry of entries) {
      if (entry.name === "manifest.json") continue;
      if (!entry.ok) {
        corrupt.push(entry.name);
        continue;
      }
      const dest = resolve(filesDir, entry.name);
      if (!dest.startsWith(filesDir + "/")) {
        throw new Error(`extractProjectPackage: unsafe entry ${entry.name}`);
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, entry.data);
      const expected = declared.get(entry.name);
      files.push({
        entry: entry.name,
        path: dest,
        sizeBytes: entry.data.byteLength,
        sizeOk: expected === undefined ? true : expected === entry.data.byteLength,
      });
    }
    return { stagingDir, manifestJson, files, corrupt };
  },
};
