// Shared media previewer for the canvas node list AND the asset
// library (both lists' eye buttons open this same dialog).
//
// Display rule: media opens at its ORIGINAL pixel size — no
// upscaling, no downscaling — unless the original overflows the
// viewport, in which case it is fitted so its height fits the
// browser window (and its width fits too). From there the user can
// zoom in / out (percentages are relative to the original size) with
// the buttons or the mouse wheel, drag with the mouse / finger to
// pan a zoomed image or video, toggle fullscreen, and download the
// file. The preview lives in a sandboxed iframe where the host can
// deny the Fullscreen API, so fullscreen falls back to an in-page
// expanded mode (chrome shrinks, media gets the room) instead of
// silently doing nothing.

import {
useCallback,
useEffect,
useRef,
useState,
type MouseEvent as ReactMouseEvent,
type PointerEvent as ReactPointerEvent,
} from "react";
import {
IconDownload,
IconMaximize,
IconMinimize,
IconPlay,
IconX,
IconZoomIn,
IconZoomOut,
} from "../icons";
import { IMAGE_PLACEHOLDER_BG, type NodeType } from "../types";
import { downloadMediaFile } from "./download-media";
import { noteVideoPlay, noteVideoStop } from "./video-playback";
import { getLocalPlaybackUrl } from "../playback-blob";

export type PreviewTarget = {
  title: string;
  type: NodeType;
  /** Real media URL (blob-backed), when the item carries media.
   * Downloads always use this original; only video PLAYBACK prefers
   * proxyUrl below when one exists. */
  mediaUrl: string | null;
  /** Playback-proxy URL (V1, video nodes only): a lightweight H.264
   * twin the preview's <video> plays instead of the original so
   * in-app WebView playback stays smooth. Null when no proxy yet. */
  proxyUrl?: string | null;
  posterUrl?: string | null;
  /** Placeholder color for media-less image items. */
  color?: string | null;
  /** Text fallback for non-media items (content / prompt). */
  text?: string;
  /** Pre-built meta line shown under the title. */
  meta?: string;
  filePath?: string | null;
};

export function MediaPreviewDialog({
  target,
  onClose,
}: {
  target: PreviewTarget;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // zoom multiplies the fit-computed base scale; 1 = original size
  // (or fitted size when the original overflows the viewport).
  const [zoom, setZoom] = useState(1);
  const [nativeFs, setNativeFs] = useState(false);
  // In-page expanded mode, used when the host frame denies the
  // Fullscreen API: the button still has a visible effect — the
  // header meta and file-path footer hide and the media gets the
  // room (chromeH below shrinks the same way as real fullscreen).
  const [pseudoFs, setPseudoFs] = useState(false);
  const isFullscreen = nativeFs || pseudoFs;
  // Pan offset (px) for a zoomed image/video; press-and-drag moves
  // it. Clamped on render so the media can never be dragged out of
  // reach.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  // Multi-touch pinch: every live pointer on the preview body is
  // tracked; a second finger turns the single-pointer pan into a
  // pinch (zoom by finger distance, pan by the moving midpoint).
  // zoom/pan are mirrored into refs so the window-level pointer
  // handlers (bound once) always read the live values.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    startPanX: number;
    startPanY: number;
    startCx: number;
    startCy: number;
  } | null>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  // Set when a pan drag ends, so the click event trailing the
  // release neither closes the dialog nor toggles video playback.
  const suppressClickRef = useRef(false);
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const [downloading, setDownloading] = useState(false);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  // V2 download-then-play, same rule as the node cards: the preview
  // <video> starts with no src; the whole file is fetched through
  // the shared playback-blob cache (a video already downloaded in
  // its node card — or vice versa — is reused, not re-downloaded)
  // and only the resulting local blob: URL goes on the element.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [localVideoSrc, setLocalVideoSrc] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const isImage = target.type === "image";
  const isVideo = target.type === "video";
  const isAudio = target.type === "audio";
  const hasMedia = Boolean(target.mediaUrl) && (isImage || isVideo || isAudio);
  // Remote playback source (V1 rule): proxy first, original as the
  // fallback — and the fallback for a failed download below too.
  const videoRemoteSrc =
    isVideo && target.mediaUrl ? (target.proxyUrl ?? target.mediaUrl) : null;

  // Reset per-item state whenever a different item is previewed.
  useEffect(() => {
    setNatural(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPseudoFs(false);
    setDownloadNote(null);
    setLocalVideoSrc(null);
    setVideoLoading(false);
    pointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
  }, [target.mediaUrl, target.title, target.type]);

  // Opening the preview IS the play intent (the dialog autoplays):
  // start the whole-file download immediately and show the loading
  // badge until the local src is ready.
  useEffect(() => {
    if (!videoRemoteSrc) return;
    let cancelled = false;
    setVideoLoading(true);
    void getLocalPlaybackUrl(videoRemoteSrc).then(
      (url) => {
        if (cancelled) return;
        setLocalVideoSrc(url);
        setVideoLoading(false);
      },
      () => {
        if (cancelled) return;
        // Download failed: stream the remote URL directly — never
        // worse than the pre-V2 behavior.
        setLocalVideoSrc(videoRemoteSrc);
        setVideoLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [videoRemoteSrc]);

  // Once the (local or fallback) src lands, start playback.
  useEffect(() => {
    if (!localVideoSrc) return;
    const v = videoRef.current;
    if (v && v.paused) void v.play().catch(() => undefined);
  }, [localVideoSrc]);

  useEffect(() => {
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onFsChange = () =>
      setNativeFs(Boolean(document.fullscreenElement));
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pseudoFs) setPseudoFs(false);
      else if (!document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pseudoFs]);

  const toggleFullscreen = useCallback(() => {
    if (pseudoFs) {
      setPseudoFs(false);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const el = rootRef.current;
    if (
      !el ||
      !document.fullscreenEnabled ||
      typeof el.requestFullscreen !== "function"
    ) {
      setPseudoFs(true);
      return;
    }
    try {
      const result = el.requestFullscreen() as unknown as
        | Promise<void>
        | undefined;
      if (result && typeof result.catch === "function") {
        result.catch(() => setPseudoFs(true));
      }
      // Belt and braces: some hosts resolve the promise yet never
      // enter fullscreen — if no element is fullscreen shortly
      // after, fall back so the click still visibly does something.
      window.setTimeout(() => {
        if (!document.fullscreenElement) setPseudoFs(true);
      }, 350);
    } catch {
      setPseudoFs(true);
    }
  }, [pseudoFs]);

  // Save the file in place (see download-media.ts): the bytes are
  // fetched and handed to the share sheet (touch devices) or an
  // object-URL anchor — never to a navigable URL, which is what
  // used to unload the whole space on iPad. A failure only shows a
  // note under the header; the dialog and page stay exactly as-is.
  const download = useCallback(async () => {
    if (!target.mediaUrl || downloading) return;
    setDownloading(true);
    setDownloadNote(null);
    try {
      const result = await downloadMediaFile(
        target.mediaUrl,
        target.title || "media",
      );
      if (result === "failed") {
        setDownloadNote("下载失败，请稍后重试");
      }
    } finally {
      setDownloading(false);
    }
  }, [target.mediaUrl, target.title, downloading]);

  // Fit scale: original size, shrunk only as much as needed so the
  // media fits the viewport (height first — a too-tall original is
  // capped to the browser height; width is capped as well so a
  // too-wide original never overflows horizontally).
  const chromeH = isFullscreen ? 64 : 170;
  const chromeW = 32;
  const fitScale = natural
    ? Math.min(
        1,
        Math.max(120, viewport.h - chromeH) / natural.h,
        Math.max(120, viewport.w - chromeW) / natural.w,
      )
    : 1;
  const displayScale = fitScale * zoom;
  const displayW = natural ? Math.round(natural.w * displayScale) : null;
  const displayH = natural ? Math.round(natural.h * displayScale) : null;
  const percent = Math.round(displayScale * 100);

  // Pan range: how far the media overflows the available box, plus
  // a small slack. At fit size the range collapses to the slack, so
  // dragging an unzoomed image just settles back near center.
  const availW = Math.max(120, viewport.w - chromeW);
  const availH = Math.max(120, viewport.h - chromeH);
  const maxPanX = displayW ? Math.max(0, (displayW - availW) / 2 + 48) : 0;
  const maxPanY = displayH ? Math.max(0, (displayH - availH) / 2 + 48) : 0;
  const clampedPan = {
    x: Math.min(maxPanX, Math.max(-maxPanX, pan.x)),
    y: Math.min(maxPanY, Math.max(-maxPanY, pan.y)),
  };
  const mediaTransform = `translate(${clampedPan.x}px, ${clampedPan.y}px)`;

  const zoomTo = (next: number) => {
    const clamped = Math.min(8, Math.max(0.1, Math.round(next * 100) / 100));
    // Zoom about the media's center: the existing pan scales with
    // the zoom so the viewed region stays roughly in place.
    const ratio = zoom > 0 ? clamped / zoom : 1;
    setZoom(clamped);
    setPan((p) => ({ x: p.x * ratio, y: p.y * ratio }));
  };
  const zoomBy = (factor: number) => zoomTo(zoom * factor);

  const zoomable = hasMedia && (isImage || isVideo);

  // Mouse wheel zooms. React's onWheel is passive at the root, so
  // this is a native non-passive listener that can preventDefault
  // and keep the wheel from scrolling the page behind the dialog.
  const wheelZoomRef = useRef<(deltaY: number) => void>(() => undefined);
  wheelZoomRef.current = (deltaY: number) => {
    if (natural) zoomBy(deltaY < 0 ? 1.15 : 1 / 1.15);
  };
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !zoomable) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelZoomRef.current(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomable]);

  // Press-and-drag panning (mouse and touch via pointer events),
  // plus two-finger pinch zoom. Moves are tracked on the window so
  // a fast drag that leaves the media mid-gesture keeps following
  // the pointer.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const pinch = pinchRef.current;
      if (pinch) {
        const pts = [...pointersRef.current.values()];
        const a = pts[0];
        const b = pts[1];
        if (a && b) {
          const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
          const nextZoom = Math.min(
            8,
            Math.max(0.1, pinch.startZoom * (dist / pinch.startDist)),
          );
          setZoom(Math.round(nextZoom * 100) / 100);
          setPan({
            x: pinch.startPanX + ((a.x + b.x) / 2 - pinch.startCx),
            y: pinch.startPanY + ((a.y + b.y) / 2 - pinch.startCy),
          });
        }
        return;
      }
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setPan({ x: d.panX + dx, y: d.panY + dy });
    };
    const onUp = (e: PointerEvent) => {
      const hadPinch = pinchRef.current !== null;
      pointersRef.current.delete(e.pointerId);
      if (hadPinch) {
        if (pointersRef.current.size < 2) {
          pinchRef.current = null;
          suppressClickRef.current = true;
          // The finger still down keeps panning from where the
          // pinch left off, re-anchored at its current position.
          const rem = [...pointersRef.current.entries()][0];
          if (rem) {
            dragRef.current = {
              id: rem[0],
              startX: rem[1].x,
              startY: rem[1].y,
              panX: panRef.current.x,
              panY: panRef.current.y,
              moved: true,
            };
          } else {
            dragRef.current = null;
            setDragging(false);
          }
        }
        return;
      }
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id) return;
      if (d.moved) suppressClickRef.current = true;
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const onBodyPointerDown = (e: ReactPointerEvent) => {
    if (!zoomable || !natural) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button")) return;
    // Leave the video's own control strip (bottom edge) to the
    // video: seeking and the control buttons must not start a pan.
    if (t.tagName === "VIDEO") {
      const r = t.getBoundingClientRect();
      if (e.clientY > r.bottom - 48) return;
    }
    dragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: clampedPan.x,
      panY: clampedPan.y,
      moved: false,
    };
    setDragging(true);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (a && b) {
        pinchRef.current = {
          startDist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
          startZoom: zoomRef.current,
          startPanX: panRef.current.x,
          startPanY: panRef.current.y,
          startCx: (a.x + b.x) / 2,
          startCy: (a.y + b.y) / 2,
        };
        dragRef.current = null;
      }
    }
  };

  // Double-click / double-tap toggles between the fitted view and
  // a 2x zoom (the touch counterpart of the wheel zoom).
  const onBodyDoubleClick = (e: ReactMouseEvent) => {
    if (!zoomable || !natural) return;
    const t = e.target as HTMLElement;
    if (t.closest("button")) return;
    if (t.tagName === "VIDEO") {
      const r = t.getBoundingClientRect();
      if (e.clientY > r.bottom - 48) return;
    }
    if (zoomRef.current > 1.02) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      zoomTo(2);
    }
  };

  const controlBtn =
    "hit-40 flex h-8 w-8 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--text)] disabled:opacity-40";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[90] flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${target.title}`}
    >
      {/* ------------------------------------------------ header */}
      <div className="flex items-center gap-2 bg-[var(--surface)] px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--text)]">
            {target.title}
          </h3>
          {target.meta && !pseudoFs ? (
            <p className="truncate text-[11px] text-[var(--dim)]">{target.meta}</p>
          ) : null}
        </div>
        {hasMedia && (isImage || isVideo) ? (
          <div className="flex items-center gap-1" role="group" aria-label="预览缩放">
            <button
              type="button"
              className={controlBtn}
              onClick={() => zoomBy(1 / 1.25)}
              disabled={!natural || displayScale <= 0.05}
              aria-label="缩小预览"
              title="缩小"
            >
              <IconZoomOut size={16} />
            </button>
            <button
              type="button"
              className="min-w-12 rounded px-1 py-1 text-center text-xs text-[var(--dim)] hover:bg-[var(--hover-strong)]"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              aria-label="恢复原图尺寸显示"
              title="原图尺寸（过大时适配窗口高度）"
            >
              {natural ? `${percent}%` : "…"}
            </button>
            <button
              type="button"
              className={controlBtn}
              onClick={() => zoomBy(1.25)}
              disabled={!natural || displayScale >= 8}
              aria-label="放大预览"
              title="放大"
            >
              <IconZoomIn size={16} />
            </button>
          </div>
        ) : null}
        {hasMedia ? (
          <button
            type="button"
            className={controlBtn}
            onClick={() => void download()}
            disabled={downloading}
            aria-label={`下载 ${target.title}`}
            title="下载保存"
          >
            <IconDownload size={16} />
          </button>
        ) : null}
        {hasMedia && (isImage || isVideo) ? (
          <button
            type="button"
            className={controlBtn}
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "退出全屏" : "全屏预览"}
            title={isFullscreen ? "退出全屏" : "全屏"}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
          </button>
        ) : null}
        <button
          type="button"
          className={controlBtn}
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭"
        >
          <IconX size={16} />
        </button>
      </div>

      {downloadNote ? (
        <p
          role="alert"
          className="bg-[var(--surface)] px-4 pb-2 text-xs text-[var(--danger)]"
        >
          {downloadNote}
        </p>
      ) : null}

      {/* ------------------------------------------------ body */}
      <div
        ref={bodyRef}
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 ${
          zoomable ? "touch-none select-none" : ""
        }`}
        style={
          zoomable
            ? { cursor: dragging ? "grabbing" : "grab" }
            : undefined
        }
        onPointerDown={onBodyPointerDown}
        onDoubleClick={onBodyDoubleClick}
        onClickCapture={(e) => {
          // Swallow the click that trails a pan drag: it must not
          // close the dialog (backdrop click) or toggle the video.
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {isImage && target.mediaUrl ? (
          <img
            src={target.mediaUrl}
            alt={target.title}
            onLoad={(e) =>
              setNatural({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
            style={
              displayW
                ? { width: displayW, height: "auto", transform: mediaTransform }
                : {
                    maxWidth: "100%",
                    maxHeight: "100%",
                    transform: mediaTransform,
                  }
            }
            className="shrink-0 select-none"
            draggable={false}
          />
        ) : isVideo && target.mediaUrl ? (
          <video
            ref={videoRef}
            src={localVideoSrc ?? undefined}
            poster={target.posterUrl ?? undefined}
            controls
            autoPlay
            preload="metadata"
            onPlay={(e) => noteVideoPlay(e.currentTarget)}
            onPause={(e) => noteVideoStop(e.currentTarget)}
            onEnded={(e) => noteVideoStop(e.currentTarget)}
            onLoadedMetadata={(e) =>
              setNatural({
                w: e.currentTarget.videoWidth,
                h: e.currentTarget.videoHeight,
              })
            }
            style={
              displayW
                ? { width: displayW, height: "auto", transform: mediaTransform }
                : {
                    maxWidth: "100%",
                    maxHeight: "100%",
                    transform: mediaTransform,
                  }
            }
            className="shrink-0 bg-black"
            aria-label={`播放视频 ${target.title}`}
          />
        ) : isAudio && target.mediaUrl ? (
          <div className="w-full max-w-md rounded-xl bg-[var(--surface)] p-5">
            <audio
              src={target.mediaUrl}
              controls
              autoPlay
              className="w-full"
              aria-label={`播放音频 ${target.title}`}
            />
          </div>
        ) : isImage ? (
          <div
            className="flex h-56 w-full max-w-md items-center justify-center rounded-lg text-white/85"
            style={{ background: target.color ?? IMAGE_PLACEHOLDER_BG }}
          >
            <span className="text-sm">{target.title}（占位图）</span>
          </div>
        ) : isVideo ? (
          <div className="flex h-56 w-full max-w-md flex-col items-center justify-center gap-2 rounded-lg bg-black text-white/80">
            <IconPlay size={36} />
            <span className="text-xs text-white/60">该视频尚无媒体</span>
          </div>
        ) : (
          <p className="max-h-full w-full max-w-2xl overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text)]">
            {target.text || "（无内容）"}
          </p>
        )}
        {isVideo && videoLoading ? (
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded bg-black/70 px-2 py-1 text-amber-100"
            role="status"
            aria-label="视频加载中"
          >
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]"
              aria-hidden="true"
            />
            <span className="text-sm font-bold tracking-wide">加载中……</span>
          </span>
        ) : null}
      </div>

      {target.filePath && !pseudoFs ? (
        <p className="break-all bg-[var(--surface)] px-4 py-1.5 text-[11px] text-[var(--dim)]">
          项目目录文件：{target.filePath}
        </p>
      ) : null}
    </div>
  );
}
