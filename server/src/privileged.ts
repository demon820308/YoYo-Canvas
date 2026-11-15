// Privileged host handlers for YoYo画布.
//
// Contracts:
//   ensureProjectDir — create a project's working directory under
//     ~/workspace/yoyo-canvas-projects (YoYo's OWN tree; never the old
//     canvas's ~/workspace/canvas-projects, whose directory sentinel
//     would misread YoYo projects as old-canvas ones).
//   readMediaFile — read a media file under ~/workspace so an action can
//     store it as an owned blob.
//   writeProjectFile — write media bytes into a project's working
//     directory (uploads and client-mirrored media land there as real
//     files, which reference-fed generation consumes).
//   makePoster — grab one poster-frame JPEG for a video (playback itself
//     always uses the original file; there is no transcode derivative).
//   probeMediaFile — measure a media file's real pixel size (and a
//     video's duration) with ffprobe, so genSize records what the file
//     actually is, never what was requested.
//   mirrorBlobToFile — copy one of this space's own blob objects into a
//     project's working directory. The action-facing BlobClient has no
//     byte-read (put/getUrl/delete/head/list only) and generate_media
//     returns just a blob key, so server-side mirroring reads the blob
//     store's on-disk object file directly, at the single location
//     resolveBlobObjectPath names (see its comment for the one root
//     rule and the one object layout).
// Action-reachable code imports only the descriptors from
// "@space/privileged"; the implementations here run on the host.

// Layout (batch S6): the Contracts below stay literal in this file —
// the build generates server/.generated/privileged.contract.ts by
// extracting this definePrivilegedContracts(...) call from this
// file's source text, so the call itself cannot move into a
// submodule. Handler implementations live in ./privileged/ by domain
// (files.ts — project dirs, media files, blob reads; media-image.ts
// + media-video.ts — the ffmpeg/ffprobe operations, split by media
// kind in batch S12 over their shared plumbing in media-common.ts;
// package.ts — project package ZIPs); this file only assembles the
// Contracts and Handlers exports.
import {
  definePrivilegedContracts,
  definePrivilegedHandlers,
  z,
} from "@hatch/space-sdk";
import { filesHandlers } from "./privileged/files";
import { mediaImageHandlers } from "./privileged/media-image";
import { mediaVideoHandlers } from "./privileged/media-video";
import { packageHandlers } from "./privileged/package";

export const Contracts = definePrivilegedContracts({
  readMediaFile: {
    description:
      "Reads a generated media file under ~/workspace and returns its bytes as base64.",
    request: z.object({ path: z.string().min(1) }),
    response: z.object({
      dataBase64: z.string(),
      sizeBytes: z.number(),
      contentType: z.string(),
    }),
    capabilities: ["fs.read"],
  },
  ensureProjectDir: {
    description:
      "Creates (if needed) a YoYo画布 project's working directory under ~/workspace/yoyo-canvas-projects and returns its absolute path.",
    request: z.object({ dirName: z.string().min(1).max(120) }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.write"],
  },
  writeProjectFile: {
    description:
      "Writes media bytes (base64) to a named file inside a YoYo画布 project's working directory and returns the absolute path.",
    request: z.object({
      dirName: z.string().min(1).max(120),
      fileName: z.string().min(1).max(200),
      dataBase64: z.string().min(1),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.write"],
  },
  makePoster: {
    description:
      "Grabs a poster-frame JPEG for a video inside ~/workspace/yoyo-canvas-projects (one frame ~10% in, capped at 854px on the long edge), leaving the original file untouched. Returns the produced path (null when the grab failed). Playback always uses the original file; the poster is only the click-to-play stand-in still.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      posterName: z.string().min(1).max(200),
    }),
    response: z.object({
      posterPath: z.string().nullable(),
    }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  makePlaybackProxy: {
    description:
      "Transcodes a video file inside ~/workspace/yoyo-canvas-projects into a lightweight playback-proxy MP4 next to it: H.264 (libx264, yuv420p) capped at 1280px on the long edge (never upscaled), video bitrate capped at ~4 Mbps, +faststart, audio re-encoded to AAC 128k when the source has an audio stream (omitted entirely when it has none). The parameters target universal WebKit hardware decoding for in-app WebView playback. The source file is only read, never modified. Returns the produced path plus its measured pixel size and byte size.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
    }),
    response: z.object({
      path: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      sizeBytes: z.number(),
    }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  probeMediaFile: {
    description:
      "Probes a media file inside ~/workspace/yoyo-canvas-projects with ffprobe and returns its real pixel dimensions (null for audio) and duration in seconds (null when unknown). Used to record measured genSize at delivery time.",
    request: z.object({ path: z.string().min(1) }),
    response: z.object({
      width: z.number().nullable(),
      height: z.number().nullable(),
      durationSeconds: z.number().nullable(),
    }),
    capabilities: ["fs.read", "process.exec"],
  },
  extractFrames: {
    description:
      "Extracts stills from a video inside ~/workspace/yoyo-canvas-projects with ffmpeg, all PNG at the source's native frame size (contact-sheet tiles scaled to at most 480px wide). mode picks which stills: first (at firstOffsetSec from the start), last (lastOffsetSec back from the end, default 0.04s), grid (an evenly sampled contact sheet — fixed gridCols x gridRows, or gridAuto = at most one frame per second), or all three. The source file is only read, never modified. Returns the produced absolute paths (null for stills not requested).",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      baseName: z.string().min(1).max(120),
      mode: z.enum(["first", "last", "grid", "all"]).optional(),
      firstOffsetSec: z.number().min(0).max(600).optional(),
      lastOffsetSec: z.number().min(0).max(600).optional(),
      gridCols: z.number().int().min(1).max(8).optional(),
      gridRows: z.number().int().min(1).max(8).optional(),
      gridAuto: z.boolean().optional(),
    }),
    response: z.object({
      firstPath: z.string().nullable(),
      lastPath: z.string().nullable(),
      gridPath: z.string().nullable(),
    }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  extractAudio: {
    description:
      "Extracts a video's audio track to an MP3 file inside ~/workspace/yoyo-canvas-projects with ffmpeg (libmp3lame). The source file is only read, never modified. Returns the produced absolute path.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  composeVideo: {
    description:
      "Muxes an audio file into a video file, replacing the video's own audio (video stream copied untouched, audio encoded to AAC) and writes the result as a NEW file inside ~/workspace/yoyo-canvas-projects. loopAudio (default true) loops a too-short audio track to cover the video; without looping, the remainder is silence-padded so the full video length is kept either way. Neither input file is modified. Returns the produced absolute path.",
    request: z.object({
      videoInput: z.string().min(1),
      audioInput: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
      loopAudio: z.boolean().optional(),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  probeStreams: {
    description:
      "Reports whether a media file inside ~/workspace/yoyo-canvas-projects carries a video stream and/or an audio stream (ffprobe), plus its duration in seconds when known.",
    request: z.object({ path: z.string().min(1) }),
    response: z.object({
      hasVideo: z.boolean(),
      hasAudio: z.boolean(),
      durationSeconds: z.number().nullable(),
    }),
    capabilities: ["fs.read", "process.exec"],
  },
  convertImageToPng: {
    description:
      "Re-encodes an image file inside ~/workspace/yoyo-canvas-projects as a PNG copy with ffmpeg (e.g. a generated WebP that a PNG/JPEG-only consumer like vision inference must read). The source file is only read, never modified. Returns the produced absolute path.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  shrinkImageForInference: {
    description:
      "Writes a downscaled COPY of an image inside ~/workspace/yoyo-canvas-projects for a size-capped consumer (vision inference): long edge at most maxEdge px (default 2048) and payload at most maxBytes (default 3MB), stepping the scale down until the payload fits. An image already within both caps is copied byte-for-byte. The file extension of fileName (.png or .jpg) picks the copy's format. The source file is only read, never modified. Returns the copy's path plus its measured dimensions, byte size, and whether any scaling happened.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
      maxEdge: z.number().int().min(64).max(8192).optional(),
      maxBytes: z.number().int().min(1024).max(33554432).optional(),
    }),
    response: z.object({
      path: z.string(),
      width: z.number(),
      height: z.number(),
      sizeBytes: z.number(),
      shrunk: z.boolean(),
    }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  cropImage: {
    description:
      "Crops a rectangle (pixel coordinates) out of an image inside ~/workspace/yoyo-canvas-projects with ffmpeg and writes the result as a NEW PNG file in the same projects tree. The source file is only read, never modified. Returns the produced absolute path.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  splitImage: {
    description:
      "Cuts an image inside ~/workspace/yoyo-canvas-projects into tiles with ffmpeg (one crop per tile, pixel coordinates) and writes each tile as a NEW PNG file. The source file is only read, never modified. Returns the produced absolute paths in tile order.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      tiles: z
        .array(
          z.object({
            fileName: z.string().min(1).max(200),
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
          }),
        )
        .min(1)
        .max(144),
    }),
    response: z.object({ paths: z.array(z.string()) }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  upscaleImage: {
    description:
      "Scales an image inside ~/workspace/yoyo-canvas-projects to an exact pixel size with ffmpeg (flags: lanczos for high, bilinear, neighbor for nearest) and writes the result as a NEW PNG file. The source file is only read, never modified. Returns the produced absolute path.",
    request: z.object({
      input: z.string().min(1),
      outputDir: z.string().min(1),
      fileName: z.string().min(1).max(200),
      width: z.number().int().min(1).max(8192),
      height: z.number().int().min(1).max(8192),
      algorithm: z.enum(["high", "bilinear", "nearest"]),
    }),
    response: z.object({ path: z.string() }),
    capabilities: ["fs.read", "fs.write", "process.exec"],
  },
  mirrorBlobToFile: {
    description:
      "Copies one of this space's own blob objects into a YoYo画布 project's working directory and returns the absolute path and byte size. The blob store root is the HATCH_SPACE_BLOB_DIR environment value when the host process carries it, otherwise <spaceDir>/blobs; the object file is objects/<sha256(key)[:2]>/<sha256(key)>. Throws naming the root and object path tried when the object cannot be found.",
    request: z.object({
      spaceDir: z.string().min(1),
      blobKey: z.string().min(1).max(500),
      dirName: z.string().min(1).max(120),
      fileName: z.string().min(1).max(200),
    }),
    response: z.object({ path: z.string(), sizeBytes: z.number() }),
    capabilities: ["fs.read", "fs.write"],
  },
  buildProjectPackage: {
    description:
      "Assembles a YoYo画布 project package (single ZIP, STORE method) under <spaceDir>/exports: manifest.json (the given manifest with each file entry's real byte count filled in, or missing:true when its bytes cannot be found) plus one entry per media source. A source's bytes come from its project-directory file when present, else from this space's own blob store (same resolution as mirrorBlobToFile). Returns the package path, its size, and which entries were included or missing.",
    request: z.object({
      spaceDir: z.string().min(1),
      manifestJson: z.string().min(2).max(4_000_000),
      sources: z
        .array(
          z.object({
            entry: z.string().min(1).max(300),
            blobKey: z.string().max(500).nullable(),
            absPath: z.string().max(1000).nullable(),
          }),
        )
        .max(1000),
    }),
    response: z.object({
      path: z.string(),
      sizeBytes: z.number(),
      included: z.array(z.object({ entry: z.string(), bytes: z.number() })),
      missing: z.array(z.string()),
    }),
    capabilities: ["fs.read", "fs.write"],
  },
  readPackageFile: {
    description:
      "Reads a built project package ZIP under <spaceDir>/exports and returns its bytes as base64 (64MB cap), so the action can store it as a downloadable blob.",
    request: z.object({
      spaceDir: z.string().min(1),
      path: z.string().min(1),
    }),
    response: z.object({ dataBase64: z.string(), sizeBytes: z.number() }),
    capabilities: ["fs.read"],
  },
  deleteStagingFile: {
    description:
      "Deletes one staging file or directory under <spaceDir>/exports or <spaceDir>/imports (package build/import leftovers). Refuses any path outside those two trees.",
    request: z.object({
      spaceDir: z.string().min(1),
      path: z.string().min(1),
    }),
    response: z.object({ ok: z.literal(true) }),
    capabilities: ["fs.write"],
  },
  extractProjectPackage: {
    description:
      "Writes an uploaded project package ZIP (base64) into a fresh staging directory under <spaceDir>/imports, extracts it there with zip-slip protection, and reports the manifest JSON plus every extracted media file with its byte size and whether that size matches the byte count the manifest declares. Entries that fail to decompress are reported as corrupt instead of aborting the import.",
    request: z.object({
      spaceDir: z.string().min(1),
      dataBase64: z.string().min(4).max(100_000_000),
    }),
    response: z.object({
      stagingDir: z.string(),
      manifestJson: z.string(),
      files: z.array(
        z.object({
          entry: z.string(),
          path: z.string(),
          sizeBytes: z.number(),
          sizeOk: z.boolean(),
        }),
      ),
      corrupt: z.array(z.string()),
    }),
    capabilities: ["fs.read", "fs.write"],
  },
  importMediaFile: {
    description:
      "Copies one extracted package media file (from a staging path under ~/workspace) into a YoYo画布 project's working directory under a new name and returns the destination path and byte size. The source file is only read.",
    request: z.object({
      fromPath: z.string().min(1),
      dirName: z.string().min(1).max(120),
      fileName: z.string().min(1).max(200),
    }),
    response: z.object({ path: z.string(), sizeBytes: z.number() }),
    capabilities: ["fs.read", "fs.write"],
  },
});

export const Handlers = definePrivilegedHandlers(Contracts, {
  ...filesHandlers,
  ...mediaImageHandlers,
  ...mediaVideoHandlers,
  ...packageHandlers,
});
