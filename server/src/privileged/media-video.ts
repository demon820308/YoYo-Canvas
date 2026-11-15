// Video/audio half of the privileged media domain (split out of
// media.ts in batch S12 — a verbatim move, no behavior change):
// poster grabs, the playback proxy, media probing, and frame /
// audio extraction and video composition. The image half lives in
// ./media-image; the shared ffmpeg/ffprobe plumbing lives in
// ./media-common. All inputs and outputs stay inside
// ~/workspace/yoyo-canvas-projects, enforced by
// assertInProjectsRoot from ./files.

import { mkdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { assertInProjectsRoot, safeBase } from "./files";
import {
  FFMPEG_BIN,
  FFPROBE_BIN,
  execFileAsync,
  probeDurationSeconds,
  probeHasAudioStream,
  probePixelSize,
} from "./media-common";

// Playback-proxy encoding parameters (named in batch S12; until
// then inline literals inside makePlaybackProxy — the ffmpeg
// argument list they interpolate into is unchanged): long-edge
// cap in px, video bitrate (also the -maxrate ceiling), and the
// AAC audio bitrate.
const PROXY_MAX_EDGE = 1280;
const PROXY_VIDEO_BITRATE = "4M";
const PROXY_AUDIO_BITRATE = "128k";

export const mediaVideoHandlers = {
  makePoster: async (args: {
    input: string;
    outputDir: string;
    posterName: string;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("makePoster: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const posterName = safeBase(args.posterName);
    if (!posterName) {
      throw new Error("makePoster: invalid output name");
    }
    const posterOutput = resolve(outDir, posterName);
    if (dirname(posterOutput) !== outDir) {
      throw new Error("makePoster: output escapes outputDir");
    }
    const durationSeconds = await probeDurationSeconds(input);
    // Poster: one frame ~10% in (or at 1s), grabbed with the select
    // filter. Best-effort: a failed grab returns null and the player
    // falls back to a plain placeholder — playback itself always uses
    // the original media and never depends on the poster.
    let posterPath: string | null = null;
    try {
      const at =
        durationSeconds != null
          ? Math.max(0, Math.min(durationSeconds - 0.05, Math.min(1, durationSeconds * 0.1)))
          : 0;
      const selectAt = Math.max(0, at - 0.07).toFixed(3);
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          input,
          "-vf",
          `select='gte(t\\,${selectAt})',scale=w=min(854\\,iw):h=min(854\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
          "-frames:v",
          "1",
          "-vsync",
          "vfr",
          "-q:v",
          "3",
          posterOutput,
        ],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      const posterInfo = await stat(posterOutput);
      if (posterInfo.isFile() && posterInfo.size > 0) {
        posterPath = posterOutput;
      }
    } catch {
      posterPath = null;
    }
    return { posterPath };
  },
  makePlaybackProxy: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("makePlaybackProxy: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".mp4") {
      throw new Error("makePlaybackProxy: fileName must end in .mp4");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("makePlaybackProxy: output escapes outputDir");
    }
    if (out === input) {
      throw new Error("makePlaybackProxy: output must not overwrite the source video");
    }
    // Playback proxy (V1): a decode-light twin of the original for
    // in-app WebView playback — H.264 + yuv420p is the combination
    // every WebKit build decodes in hardware; the 1280px long-edge
    // cap and ~4 Mbps ceiling keep per-frame decode cost low, and
    // +faststart moves the moov atom up front so playback starts
    // without fetching the whole file. The bounding-box scale below
    // never upscales (each side is min'ed with the source's own).
    const hasAudio = await probeHasAudioStream(input);
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        input,
        "-vf",
        `scale=w=min(${PROXY_MAX_EDGE}\\,iw):h=min(${PROXY_MAX_EDGE}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        PROXY_VIDEO_BITRATE,
        "-maxrate",
        PROXY_VIDEO_BITRATE,
        "-bufsize",
        "8M",
        ...(hasAudio ? ["-c:a", "aac", "-b:a", PROXY_AUDIO_BITRATE] : ["-an"]),
        "-movflags",
        "+faststart",
        out,
      ],
      { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("makePlaybackProxy: ffmpeg produced no output");
    }
    const dims = await probePixelSize(out);
    return {
      path: out,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      sizeBytes: produced.size,
    };
  },
  probeMediaFile: async (args: { path: string }) => {
    const full = assertInProjectsRoot(args.path, "path");
    const info = await stat(full);
    if (!info.isFile()) throw new Error("probeMediaFile: not a file");
    let width: number | null = null;
    let height: number | null = null;
    try {
      const { stdout } = await execFileAsync(
        FFPROBE_BIN,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "csv=p=0",
          full,
        ],
        { timeout: 30_000 },
      );
      const parts = stdout.trim().split(",").map((v) => Number.parseInt(v, 10));
      const w = parts[0];
      const h = parts[1];
      if (w != null && Number.isFinite(w) && w > 0) width = w;
      if (h != null && Number.isFinite(h) && h > 0) height = h;
    } catch {
      width = null;
      height = null;
    }
    const durationSeconds = await probeDurationSeconds(full);
    return { width, height, durationSeconds };
  },
  extractFrames: async (args: {
    input: string;
    outputDir: string;
    baseName: string;
    mode?: "first" | "last" | "grid" | "all";
    firstOffsetSec?: number;
    lastOffsetSec?: number;
    gridCols?: number;
    gridRows?: number;
    gridAuto?: boolean;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("extractFrames: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const base = safeBase(args.baseName);
    if (!base) throw new Error("extractFrames: invalid baseName");
    const firstPath = resolve(outDir, `${base}-first.png`);
    const lastPath = resolve(outDir, `${base}-last.png`);
    const gridPath = resolve(outDir, `${base}-grid.png`);
    for (const p of [firstPath, lastPath, gridPath]) {
      if (dirname(p) !== outDir) {
        throw new Error("extractFrames: output escapes outputDir");
      }
    }
    const mode = args.mode ?? "all";
    const wantFirst = mode === "first" || mode === "all";
    const wantLast = mode === "last" || mode === "all";
    const wantGrid = mode === "grid" || mode === "all";
    const firstOffset = args.firstOffsetSec ?? 0;
    const lastOffset = args.lastOffsetSec ?? 0.04;
    const duration = await probeDurationSeconds(input);
    const runOpts = { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 };
    // First frame: seek firstOffsetSec in from the start, take one.
    if (wantFirst) {
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-ss",
          firstOffset.toFixed(3),
          "-i",
          input,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          firstPath,
        ],
        runOpts,
      );
    }
    // Last frame: seek to lastOffsetSec before the end, take one.
    if (wantLast) {
      const lastAt = duration != null ? Math.max(0, duration - lastOffset) : 0;
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-ss",
          lastAt.toFixed(3),
          "-i",
          input,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          lastPath,
        ],
        runOpts,
      );
    }
    // Contact sheet: sample frames evenly across the duration and
    // tile them. Fixed grids take cols*rows frames; auto takes at
    // most one frame per second and picks a near-square grid.
    if (wantGrid) {
      let cols = args.gridCols ?? 3;
      let rows = args.gridRows ?? 2;
      if (args.gridAuto) {
        const count =
          duration != null && duration > 0
            ? Math.max(1, Math.min(36, Math.round(duration)))
            : 6;
        cols = Math.min(6, Math.ceil(Math.sqrt(count)));
        rows = Math.ceil(count / cols);
      }
      const total = cols * rows;
      const fps =
        duration != null && duration > 0 ? (total / duration).toFixed(6) : "1";
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i",
          input,
          "-vf",
          `fps=${fps},scale=w=min(480\\,iw):h=-2,tile=${cols}x${rows}`,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          gridPath,
        ],
        runOpts,
      );
    }
    const produced: { path: string; wanted: boolean }[] = [
      { path: firstPath, wanted: wantFirst },
      { path: lastPath, wanted: wantLast },
      { path: gridPath, wanted: wantGrid },
    ];
    for (const { path, wanted } of produced) {
      if (!wanted) continue;
      const stat1 = await stat(path);
      if (!stat1.isFile() || stat1.size === 0) {
        throw new Error(`extractFrames: ffmpeg produced no output at ${path}`);
      }
    }
    return {
      firstPath: wantFirst ? firstPath : null,
      lastPath: wantLast ? lastPath : null,
      gridPath: wantGrid ? gridPath : null,
    };
  },
  extractAudio: async (args: {
    input: string;
    outputDir: string;
    fileName: string;
  }) => {
    const input = assertInProjectsRoot(args.input, "input");
    const info = await stat(input);
    if (!info.isFile()) throw new Error("extractAudio: input is not a file");
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".mp3") {
      throw new Error("extractAudio: fileName must end in .mp3");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("extractAudio: output escapes outputDir");
    }
    await execFileAsync(
      FFMPEG_BIN,
      ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-q:a", "2", out],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("extractAudio: ffmpeg produced no output (源视频可能没有音轨）");
    }
    return { path: out };
  },
  composeVideo: async (args: {
    videoInput: string;
    audioInput: string;
    outputDir: string;
    fileName: string;
    loopAudio?: boolean;
  }) => {
    const videoInput = assertInProjectsRoot(args.videoInput, "videoInput");
    const audioInput = assertInProjectsRoot(args.audioInput, "audioInput");
    for (const p of [videoInput, audioInput]) {
      const info = await stat(p);
      if (!info.isFile()) throw new Error("composeVideo: input is not a file");
    }
    const outDir = assertInProjectsRoot(args.outputDir, "outputDir");
    await mkdir(outDir, { recursive: true });
    const name = safeBase(args.fileName);
    if (!name || extname(name).toLowerCase() !== ".mp4") {
      throw new Error("composeVideo: fileName must end in .mp4");
    }
    const out = resolve(outDir, name);
    if (dirname(out) !== outDir) {
      throw new Error("composeVideo: output escapes outputDir");
    }
    if (out === videoInput) {
      throw new Error("composeVideo: output must not overwrite the source video");
    }
    // The video's own audio is dropped (only 0:v and 1:a are mapped).
    // Looping: the audio input repeats endlessly and -shortest cuts
    // it at the video's end. Not looping: apad silence-pads the audio
    // to the video's full length instead.
    const loopAudio = args.loopAudio ?? true;
    await execFileAsync(
      FFMPEG_BIN,
      [
        "-y",
        "-i",
        videoInput,
        ...(loopAudio ? ["-stream_loop", "-1"] : []),
        "-i",
        audioInput,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        ...(loopAudio ? [] : ["-af", "apad"]),
        "-shortest",
        out,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = await stat(out);
    if (!produced.isFile() || produced.size === 0) {
      throw new Error("composeVideo: ffmpeg produced no output");
    }
    return { path: out };
  },
  probeStreams: async (args: { path: string }) => {
    const full = assertInProjectsRoot(args.path, "path");
    const info = await stat(full);
    if (!info.isFile()) throw new Error("probeStreams: not a file");
    let hasVideo = false;
    let hasAudio = false;
    try {
      const { stdout } = await execFileAsync(
        FFPROBE_BIN,
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type",
          "-of",
          "csv=p=0",
          full,
        ],
        { timeout: 30_000 },
      );
      const types = stdout.split(/\s+/).filter(Boolean);
      hasVideo = types.includes("video");
      hasAudio = types.includes("audio");
    } catch {
      hasVideo = false;
      hasAudio = false;
    }
    const durationSeconds = await probeDurationSeconds(full);
    return { hasVideo, hasAudio, durationSeconds };
  },
};
