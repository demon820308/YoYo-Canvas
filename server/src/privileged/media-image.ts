// Image half of the privileged media domain (split out of media.ts
// in batch S12 — a verbatim move, no behavior change): the ffmpeg
// image transforms (convert / shrink / crop / split / upscale).
// The video/audio half lives in ./media-video; the shared
// ffmpeg/ffprobe plumbing lives in ./media-common. All inputs and
// outputs stay inside ~/workspace/yoyo-canvas-projects, enforced
// by assertInProjectsRoot from ./files.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { assertInProjectsRoot, safeBase } from "./files";
import { FFMPEG_BIN, execFileAsync, probePixelSize } from "./media-common";

export const mediaImageHandlers = {
  convertImageToPng: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("convertImageToPng: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".png") {
      throw new Error("convertImageToPng: fileName must end in .png");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("convertImageToPng: output escapes outputDir");
    }
    await execFileAsync(FFMPEG_BIN, ["-y", "-i", input, "-frames:v", "1", out], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("convertImageToPng: ffmpeg produced no output");
    }
    return { path: out };
  },
  shrinkImageForInference: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
    maxEdge?: number;
    maxBytes?: number;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) {
      throw new Error("shrinkImageForInference: input is not a file");
    }
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    const ext = name ? extname(name).toLowerCase() : "";
    if (!name || (ext !== ".png" && ext !== ".jpg")) {
      throw new Error(
        "shrinkImageForInference: fileName must end in .png or .jpg",
      );
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("shrinkImageForInference: output escapes outputDir");
    }
    const maxEdge = args.maxEdge ?? 2048;
    const maxBytes = args.maxBytes ?? 3 * 1024 * 1024;
    const src = await probePixelSize(input);
    const srcW = src?.width ?? null;
    const srcH = src?.height ?? null;
    if (
      srcW != null &&
      srcH != null &&
      Math.max(srcW, srcH) <= maxEdge &&
      info.size <= maxBytes
    ) {
      // Already within both caps: the copy is byte-for-byte identical.
      await copyFile(input, out);
      return {
        path: out,
        width: srcW,
        height: srcH,
        sizeBytes: info.size,
        shrunk: false,
      };
    }
    // Encode a downscaled copy in the SAME format family (JPEG stays
    // JPEG so its compression keeps working; anything else lands as
    // PNG), stepping the long edge down until the payload fits — a
    // photo-like PNG shrinks poorly per-pixel, so dimensions do the
    // work. The source file is only read, never modified.
    let edge = maxEdge;
    let lastSize = 0;
    let lastW = srcW ?? 0;
    let lastH = srcH ?? 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const vf = `scale=w='min(iw,${edge})':h='min(ih,${edge})':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;
      const ffArgs =
        ext === ".jpg"
          ? ["-y", "-i", input, "-vf", vf, "-frames:v", "1", "-q:v", "3", out]
          : ["-y", "-i", input, "-vf", vf, "-frames:v", "1", out];
      await execFileAsync(FFMPEG_BIN, ffArgs, {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const produced = await stat(out);
      if (!produced.isFile() || produced.size === 0) {
        throw new Error("shrinkImageForInference: ffmpeg produced no output");
      }
      const dims = await probePixelSize(out);
      lastSize = produced.size;
      lastW = dims?.width ?? lastW;
      lastH = dims?.height ?? lastH;
      if (produced.size <= maxBytes || edge <= 320) break;
      edge = Math.max(320, Math.floor(edge * 0.75));
    }
    return {
      path: out,
      width: lastW,
      height: lastH,
      sizeBytes: lastSize,
      shrunk: true,
    };
  },
  cropImage: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("cropImage: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".png") {
      throw new Error("cropImage: fileName must end in .png");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("cropImage: output escapes outputDir");
    }
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        input,
        "-vf",
        `crop=${args.width}:${args.height}:${args.x}:${args.y}`,
        "-frames:v",
        "1",
        out,
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("cropImage: ffmpeg produced no output");
    }
    return { path: out };
  },
  splitImage: async (args: {
    input: string;
    outputDir: string;
    tiles: { fileName: string; x: number; y: number; width: number; height: number }[];
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("splitImage: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const paths: string[] = [];
    for (const tile of args.tiles) {
      const name = safeBase(tile.fileName);
      if (!name || extname(name).toLowerCase() !== ".png") {
        throw new Error("splitImage: tile fileName must end in .png");
      }
      const out = resolve(outDir, name);
      if (dirname(out) !== outDir) {
        throw new Error("splitImage: output escapes outputDir");
      }
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          input,
          "-vf",
          `crop=${tile.width}:${tile.height}:${tile.x}:${tile.y}`,
          "-frames:v",
          "1",
          out,
        ],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const produced = await stat(out);
      if (!produced.isFile() || produced.size === 0) {
        throw new Error(`splitImage: ffmpeg produced no output at ${out}`);
      }
      paths.push(out);
    }
    return { paths };
  },
  upscaleImage: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
    width: number;
    height: number;
    algorithm: "high" | "bilinear" | "nearest";
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("upscaleImage: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".png") {
      throw new Error("upscaleImage: fileName must end in .png");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("upscaleImage: output escapes outputDir");
    }
    const flags =
      args.algorithm === "high"
        ? "lanczos"
        : args.algorithm === "nearest"
          ? "neighbor"
          : "bilinear";
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        input,
        "-vf",
        `scale=${args.width}:${args.height}:flags=${flags}`,
        "-frames:v",
        "1",
        out,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("upscaleImage: ffmpeg produced no output");
    }
    return { path: out };
  },
};
