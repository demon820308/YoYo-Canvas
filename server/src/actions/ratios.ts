// ratios.ts — 比例/尺寸体系：八档图片比例与确切像素、视频尺寸与
// 时长钳制、卡片框尺寸计算。服务端比例的唯一定义处。
// 拆分来源：批次 S1 自 server/src/actions.ts 整段搬移，行为不变。

import type { NodeRow } from "./contracts";

// ---------------------------------------------------------------------------
// Sizes: eight real image tiers. Ratio -> pixels one-to-one, matching
// what the generation service actually produces (3:2 / 2:3 and
// 4:3 / 3:4 / 21:9 measured 2026-11-15; 2352x1008 reduces to 7:3,
// the same proportion as 21:9). genSize is nevertheless always
// recorded from a probe of the delivered file.
// ---------------------------------------------------------------------------

/** The single server-side definition of the eight image ratios and
 * their pixel sizes, in canonical order. normalizeImageRatio derives
 * its legal set from these keys and sizeBrief reads sizes from here —
 * no second copy of the ratio list exists in this file. */
export const IMAGE_RATIO_SIZES: Record<string, string> = {
  "16:9": "2048x1152",
  "9:16": "1152x2048",
  "1:1": "1600x1600",
  "3:2": "1920x1280",
  "2:3": "1280x1920",
  "4:3": "1792x1344",
  "3:4": "1344x1792",
  "21:9": "2352x1008",
};

const IMAGE_RATIOS: ReadonlySet<string> = new Set(
  Object.keys(IMAGE_RATIO_SIZES),
);

export function parseRatio(value: string | null): { w: number; h: number } | null {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Canonical image ratio: the eight real tiers pass through; any other
 * parseable value is archived to the tier whose numeric ratio is
 * closest, measured by ratio-multiplicative distance
 * (|ln(input) − ln(tier)|, so 2:1 and 1:2 sit equally far from 1:1);
 * unparseable or empty values fall back to 1:1. The candidate values
 * are parsed from the IMAGE_RATIO_SIZES keys — this function keeps no
 * second copy of the tier list. */
export function normalizeImageRatio(ratio: string | null | undefined): string {
  const raw = String(ratio || "").trim();
  if (IMAGE_RATIOS.has(raw)) return raw;
  const parsed = parseRatio(raw || null);
  if (!parsed) return "1:1";
  const inputLog = Math.log(parsed.w / parsed.h);
  let best = "1:1";
  let bestDistance = Infinity;
  for (const tier of Object.keys(IMAGE_RATIO_SIZES)) {
    const tierParsed = parseRatio(tier);
    if (!tierParsed) continue;
    const distance = Math.abs(inputLog - Math.log(tierParsed.w / tierParsed.h));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tier;
    }
  }
  return best;
}

/** The three ratios the direct channel can actually deliver — one
 * per orientation the platform's generate_media call accepts, each
 * at its measured size in IMAGE_RATIO_SIZES (2048x1152 / 1152x2048 /
 * 1600x1600, batch F). dispatchImageGeneration routes an image run
 * to the direct channel only when its normalized ratio is in this
 * set and no reference media is connected. */
export const DIRECT_IMAGE_RATIOS: readonly string[] = ["16:9", "9:16", "1:1"];

/** Coarse orientation for a ratio — the only size input the direct
 * channel's generate_media call accepts (see
 * generateImageInAction). Derived from the normalized ratio. */
export function orientationForRatio(
  ratio: string | null,
): "square" | "landscape" | "portrait" {
  const parsed = parseRatio(normalizeImageRatio(ratio));
  if (!parsed) return "square";
  if (parsed.w > parsed.h) return "landscape";
  if (parsed.h > parsed.w) return "portrait";
  return "square";
}

/** Exact pixel size for a video generation (720p-equivalent short side). */
export function computeVideoSize(ratio: string | null): string {
  const r = ratio && ratio !== "" ? ratio : "16:9";
  if (r === "auto") return "auto";
  const parsed = parseRatio(r);
  if (!parsed) return "auto";
  const p = 720;
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const landscape = parsed.w >= parsed.h;
  const width = even(landscape ? (p * parsed.w) / parsed.h : p);
  const height = even(landscape ? p : (p * parsed.h) / parsed.w);
  return `${width}x${height}`;
}

const VIDEO_SECONDS_MIN = 1;
const VIDEO_SECONDS_MAX = 30;
const VIDEO_SECONDS_DEFAULT = 5;

export function clampVideoSeconds(value: number | null | undefined): number {
  const seconds = Math.floor(Number(value) || VIDEO_SECONDS_DEFAULT);
  return Math.max(VIDEO_SECONDS_MIN, Math.min(VIDEO_SECONDS_MAX, seconds));
}

/** Human line for background-task briefs: ratio + exact real pixels. */
export function sizeBrief(kind: "image" | "video", node: NodeRow): string {
  if (kind === "image") {
    const ratio = normalizeImageRatio(node.genRatio);
    const size = IMAGE_RATIO_SIZES[ratio] ?? "1600x1600";
    return `画幅比例：${ratio}，确切像素尺寸：${size}（宽x高，这是生成服务的真实出图尺寸，生成时请按这个尺寸出图，不要再缩放改尺寸）`;
  }
  const ratio = node.genRatio ?? "16:9";
  const size = computeVideoSize(node.genRatio);
  return size === "auto"
    ? `画幅比例：${ratio}（尺寸自适应）`
    : `画幅比例：${ratio}，确切像素尺寸：${size}（宽x高）`;
}

export function cardSizeForRatio(
  ratio: string | null,
  base: number,
  fallback: { w: number; h: number },
): { w: number; h: number } {
  const parsed = parseRatio(ratio && ratio !== "auto" ? ratio : "1:1");
  if (!parsed) return fallback;
  if (parsed.w >= parsed.h) {
    return { w: base, h: Math.max(120, Math.round((base * parsed.h) / parsed.w)) };
  }
  return { w: Math.max(140, Math.round((base * parsed.w) / parsed.h)), h: base };
}

/** Parses a measured genSize ("1152x2048") into pixel dimensions. */
export function parseGenSize(
  genSize: string | null | undefined,
): { w: number; h: number } | null {
  if (!genSize) return null;
  const match = /^(\d+)x(\d+)$/.exec(genSize.trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { w, h };
}

/** The card's fixed chrome around the media area: 7px side margins
 * on each side, and vertically the 26px title bar plus the media
 * area's 7px bottom margin. measuredCardSize compensates for it so
 * the MEDIA AREA matches the measured aspect exactly, and
 * frameFitsMeasuredSize measures a frame's media area with the
 * same compensation — the two must never drift apart. */
const CHROME_W = 14; // media area side margins (7px each side)
const CHROME_H = 33; // title bar 26px + media bottom margin 7px

/** Card size for a media result from its MEASURED pixel size: the
 * node frame takes the finished file's real aspect ratio (a 9:16
 * image lands in a 9:16 frame, never cropped into the placeholder's
 * old proportions), scaled to the same card bases the ratio-based
 * placement uses (image 320, video 420 on the frame's long edge).
 * The frame math compensates the card's fixed chrome (see CHROME_W
 * / CHROME_H above), so the MEDIA AREA itself, not just the outer
 * frame, matches the measured aspect exactly and object-cover has
 * nothing left to crop. Returns null when genSize is missing/unparseable. */
export function measuredCardSize(
  genSize: string | null | undefined,
  kind: "image" | "video",
): { w: number; h: number } | null {
  const measured = parseGenSize(genSize);
  if (!measured) return null;
  const base = kind === "video" ? 420 : 320;
  if (measured.w >= measured.h) {
    return {
      w: base,
      h: Math.max(120, Math.round(CHROME_H + ((base - CHROME_W) * measured.h) / measured.w)),
    };
  }
  return {
    w: Math.max(140, Math.round(CHROME_W + ((base - CHROME_H) * measured.w) / measured.h)),
    h: base,
  };
}

/** Whether a node's current frame already displays its measured
 * media without cropping: the frame's media area (frame minus the
 * card chrome) must carry the measured aspect, within a 2%
 * tolerance that absorbs the integer rounding in measuredCardSize
 * and in aspect-preserving user resizes (the resize gesture locks
 * the frame's aspect, so a user who enlarged a well-shaped frame
 * proportionally stays within tolerance; a frame inherited from a
 * placeholder or a stale full-graph save is off by far more).
 * Returns true when genSize is missing/unparseable — there is no
 * measurement to disagree with. This is the single test every
 * "should this frame be re-shaped to the measurement" decision
 * goes through (mirror landing, the queue's frame-repair sweep). */
export function frameFitsMeasuredSize(
  width: number,
  height: number,
  genSize: string | null | undefined,
): boolean {
  const measured = parseGenSize(genSize);
  if (!measured) return true;
  const mediaW = width - CHROME_W;
  const mediaH = height - CHROME_H;
  if (mediaW <= 0 || mediaH <= 0) return false;
  const frameAspect = mediaW / mediaH;
  const measuredAspect = measured.w / measured.h;
  return Math.abs(frameAspect - measuredAspect) / measuredAspect <= 0.02;
}
