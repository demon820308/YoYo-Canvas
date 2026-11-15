// Shared ffmpeg/ffprobe plumbing for the privileged media domain
// (split out of media.ts in batch S12 — a verbatim move, no behavior
// change): the tool command names, the promisified execFile, and
// the three probe helpers both media handler groups build on. The
// image handlers live in ./media-image, the video/audio handlers
// in ./media-video; this module is the one copy of the plumbing
// they share.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

// Media tool command names — the single place they are spelled out;
// every invocation in this file goes through these constants.
export const FFMPEG_BIN = "ffmpeg";
export const FFPROBE_BIN = "ffprobe";

export async function probePixelSize(
  path: string,
): Promise<{ width: number; height: number } | null> {
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
        path,
      ],
      { timeout: 30_000 },
    );
    const parts = stdout.trim().split(",").map((v) => Number.parseInt(v, 10));
    const w = parts[0];
    const h = parts[1];
    if (
      w != null &&
      h != null &&
      Number.isFinite(w) &&
      Number.isFinite(h) &&
      w > 0 &&
      h > 0
    ) {
      return { width: w, height: h };
    }
    return null;
  } catch {
    return null;
  }
}

export async function probeHasAudioStream(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        path,
      ],
      { timeout: 30_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function probeDurationSeconds(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
      ],
      { timeout: 30_000 },
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}
