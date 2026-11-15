/**
 * Save a media file to the device WITHOUT ever navigating the page.
 *
 * The old implementation's failure mode (Wei 2026-11-15, iPad): when
 * the byte fetch failed it fell back to clicking an anchor pointed
 * at the raw media URL — a cross-origin `download` attribute is
 * ignored, so the embedded browser navigated the whole space to the
 * file address and the shell came back with 「无法加载此空间」. And
 * even the primary path (blob object URL + anchor click) is treated
 * as a navigation by some in-app webviews, with the same result.
 *
 * So the bytes are always fetched first and the save never touches
 * a navigable URL:
 * - On touch-class devices (the shared test in ../device) whose
 *   browser can share files, the file goes through the system
 *   share sheet, where the user saves it to Files / Photos — the
 *   page never moves.
 * - Everywhere else, an in-page object URL + `download` anchor
 *   saves it in place.
 * A failed fetch simply reports "failed" — there is deliberately
 * no fallback that could navigate.
 */

import { isTouchClassDevice } from "../device";

export type MediaDownloadResult = "downloaded" | "shared" | "failed";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

function fileNameFor(title: string, blobType: string): string {
  const ext = EXT_BY_MIME[blobType] ?? "bin";
  const base =
    (title || "media").replace(/[\\/:*?"<>|]/g, "_").trim() || "media";
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}

export async function downloadMediaFile(
  mediaUrl: string,
  title: string,
): Promise<MediaDownloadResult> {
  let blob: Blob;
  try {
    const res = await fetch(mediaUrl);
    if (!res.ok) return "failed";
    blob = await res.blob();
  } catch {
    return "failed";
  }
  const fileName = fileNameFor(title, blob.type);

  if (
    isTouchClassDevice() &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  ) {
    try {
      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return "shared";
      }
    } catch (e) {
      // The user dismissing the share sheet is a completed save
      // flow, not an error; any other failure falls through to the
      // in-page anchor download below.
      if (e instanceof DOMException && e.name === "AbortError") {
        return "shared";
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
