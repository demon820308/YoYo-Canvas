// ---------------------------------------------------------------------------
// Shared hover preview for BOTH side-panel lists (canvas rows and
// asset rows): resting the mouse on a media row floats this large
// preview over the canvas — a title bar over the media inside the
// same rounded card, fading/scaling in and out. It stays lightweight:
// images show the image itself; videos show their POSTER only (no
// <video> element, no media download). Callers pass the canvas size
// so the media box follows the same fit rule for every row: natural
// size (measured genSize when known, otherwise measured on load),
// shrunk to at most 88% x 78% of the canvas.

import {
useEffect,
useState,
type CSSProperties,
} from "react";
import {
IconPlay,
} from "../icons";

export type HoverPreviewData = {
  title: string;
  kind: "image" | "video";
  /** Image URL for image rows; unused for video rows. */
  src: string | null;
  /** Poster URL for video rows (may be null → placeholder tile). */
  poster: string | null;
  natW?: number;
  natH?: number;
};

export function HoverMediaPreview({
  data,
  canvasWidth,
  canvasHeight,
}: {
  data: HoverPreviewData | null;
  canvasWidth: number;
  canvasHeight: number;
}) {
  // Retain the last preview so the overlay can fade out instead of
  // vanishing the moment the mouse leaves the row.
  const [shown, setShown] = useState<HoverPreviewData | null>(data);
  useEffect(() => {
    if (data) setShown(data);
  }, [data]);
  const mediaKey = shown
    ? `${shown.kind}:${shown.kind === "video" ? (shown.poster ?? "") : (shown.src ?? "")}`
    : "";
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null,
  );
  useEffect(() => {
    setMeasured(null);
  }, [mediaKey]);
  if (!shown) return null;

  const natW = shown.natW ?? measured?.w;
  const natH = shown.natH ?? measured?.h;
  const box =
    natW && natH
      ? {
          width: Math.max(
            120,
            Math.round(
              natW *
                Math.min(
                  (canvasWidth * 0.88) / Math.max(1, natW),
                  (canvasHeight * 0.78) / Math.max(1, natH),
                ),
            ),
          ),
          height: Math.max(
            90,
            Math.round(
              natH *
                Math.min(
                  (canvasWidth * 0.88) / Math.max(1, natW),
                  (canvasHeight * 0.78) / Math.max(1, natH),
                ),
            ),
          ),
        }
      : null;
  const fitStyle: CSSProperties = box
    ? { width: box.width, height: box.height, objectFit: "contain" }
    : {
        maxWidth: Math.max(120, canvasWidth * 0.88),
        maxHeight: Math.max(90, canvasHeight * 0.78),
        objectFit: "contain",
      };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
      style={{
        background: "color-mix(in srgb, var(--board) 62%, transparent)",
        opacity: data ? 1 : 0,
        transition: "opacity 160ms ease",
      }}
      aria-hidden="true"
    >
      <div
        className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
        style={{
          transform: data ? "scale(1)" : "scale(0.96)",
          transition: "transform 160ms ease",
        }}
      >
        <div className="flex h-9 items-center px-3 text-[13px] font-medium text-[var(--text)]">
          {shown.title}
        </div>
        {shown.kind === "video" ? (
          shown.poster ? (
            <img
              src={shown.poster}
              alt={shown.title}
              style={{ ...fitStyle, background: "#000" }}
              onLoad={(e) =>
                setMeasured({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                })
              }
              draggable={false}
            />
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 bg-black text-white/70"
              style={
                box
                  ? { width: box.width, height: box.height }
                  : { width: 320, height: 180 }
              }
            >
              <IconPlay size={30} />
              <span className="text-xs">视频（暂无封面）</span>
            </div>
          )
        ) : shown.src ? (
          <img
            src={shown.src}
            alt={shown.title}
            style={fitStyle}
            onLoad={(e) =>
              setMeasured({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            draggable={false}
          />
        ) : null}
      </div>
    </div>
  );
}
