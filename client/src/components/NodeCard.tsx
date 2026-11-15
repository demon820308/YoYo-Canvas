// The canvas node card: header row (type icon, title, type label,
// status dot, #NN birth-number badge), the per-type body dispatch,
// the 生成中……/运行中…… badge and failure strip, the resize handle
// and the connection handles. The config body lives in
// ConfigNodeBody.tsx, tool bodies in ToolNodeBody.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigNodeBody } from "./ConfigNodeBody";
import { ToolNodeBody, type ToolRunOptions } from "./ToolNodeBody";
import {
  msOf,
  useElapsedSeconds,
  type NodeRunFeedback,
} from "./run-feedback";
import {
  IMAGE_PLACEHOLDER_BG,
  NODE_TYPE_LABEL,
  STATUS_COLOR,
  STICKY_DEFAULT_COLOR,
  type CanvasNode,
} from "../types";
import { isMediaUrl, isToolNodeType } from "../node-utils";
import {
  NODE_TYPE_ICON,
  IconMaximize,
  IconPlay,
  IconPlus,
} from "../icons";
import { noteVideoPlay, noteVideoStop } from "./video-playback";
import { getLocalPlaybackUrl } from "../playback-blob";

/** Set by the canvas long-press handler (App) and read by the video
 * surface in NodeCard: the pointer-up that ends a long press must
 * not ALSO toggle video play/pause. A timestamp (ms) — suppress
 * toggles that land before it. Module scope because NodeCard is a
 * sibling component, not a child that can receive the ref. */
let videoToggleSuppressUntil = 0;

/** Arm the suppression above (called by App's canvas long-press
 * handler when a long press ends): video surfaces ignore play/pause
 * toggles that land before the given timestamp (ms). */
export function suppressVideoToggleUntil(timestampMs: number): void {
  videoToggleSuppressUntil = timestampMs;
}

/** The zoom button on image/video node media: opens the shared
 * MediaPreviewDialog (the same popup the lists' eye buttons open).
 * Visible on hover/focus, and whenever the node is selected. */
export function NodeZoomButton({
  title,
  visible,
  onClick,
}: {
  title: string;
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-node-media
      data-node-zoom=""
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute right-1.5 top-1.5 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white shadow transition-opacity hover:bg-black/85 focus-visible:opacity-100 ${
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
      aria-label={`放大查看 ${title}`}
      title="放大查看"
    >
      <IconMaximize size={15} />
    </button>
  );
}

export function NodeCard({
  node,
  inputs,
  selected,
  hovered,
  flashing,
  connectTarget,
  showHandles,
  generating,
  feedback,
  showMediaInfo,
  onLiveResize,
  onResizeCommit,
  onPreview,
  onPatchNode,
  onGenerateNode,
  onStopNode,
  onRunToolNode,
  onOpenComposer,
}: {
  node: CanvasNode;
  inputs: CanvasNode[];
  selected: boolean;
  hovered: boolean;
  flashing: boolean;
  connectTarget: boolean;
  showHandles: boolean;
  /** A generation for this node was started from this page and its
   * request is still in flight (server genStatus not yet visible). */
  generating: boolean;
  /** Unified click-to-run feedback record for this node
   * (run-feedback.tsx); undefined when the node never ran here. */
  feedback?: NodeRunFeedback;
  /** Appearance toggle: show the measured-size badge on media nodes. */
  showMediaInfo: boolean;
  onLiveResize: (id: string, width: number, height: number) => void;
  onResizeCommit: () => void;
  /** Open the shared media previewer for this node (zoom button). */
  onPreview: (node: CanvasNode) => void;
  /** Patch node fields in place (config card's mode tabs). */
  onPatchNode: (id: string, patch: Partial<CanvasNode>) => void;
  /** Run this node's generation (config card's 开始生成）. */
  onGenerateNode: (node: CanvasNode) => void;
  /** Stop this node's in-flight generation (config card's 停止）. */
  onStopNode: (node: CanvasNode) => void;
  /** Run a tool node from its on-card controls. */
  onRunToolNode: (node: CanvasNode, options?: ToolRunOptions) => void;
  /** Open the 组装提示词 composer dialog (config card). */
  onOpenComposer: (node: CanvasNode) => void;
}) {
  const Icon = NODE_TYPE_ICON[node.type] ?? IconPlus;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoPressRef = useRef<{
    x: number;
    y: number;
    id: number;
    pointerType: string;
  } | null>(null);
  const [videoPaused, setVideoPaused] = useState(true);
  // V2 download-then-play: the <video> starts with NO src at all
  // (poster only, nothing pre-fetched). The first play tap downloads
  // the whole file through playback-blob and only then is a local
  // blob: URL put on the element (localVideoSrc). videoLoading
  // covers the download window so the tap visibly registers.
  const [localVideoSrc, setLocalVideoSrc] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  // Bumped whenever the underlying file changes or a new download
  // starts, so a late-resolving download for a stale file can never
  // overwrite the src of the current one.
  const videoLoadGenRef = useRef(0);
  // Elapsed seconds on the 生成中……/运行中…… badge: the server's
  // genStartedAt is the run's real clock; the local click time
  // covers the window before the server state becomes visible.
  const badgeActive =
    node.genStatus === "queued" || node.genStatus === "working" || generating;
  const badgeElapsed = useElapsedSeconds(
    msOf(node.genStartedAt) ?? feedback?.startedAt ?? null,
    badgeActive,
  );
  // Click-without-drag on the video picture toggles play/pause. The
  // press position is remembered on pointerdown; a release that moved
  // more than a few px was a drag (of the node or a seek attempt) and
  // must not toggle. Clicks landing on the native controls strip at
  // the bottom are left to the controls themselves.
  const isGroup = node.type === "group";
  const mediaSrc =
    node.mediaUrl ?? (isMediaUrl(node.content) ? node.content : null);
  // The remote playback source: the lightweight proxy (V1) when one
  // exists, else the original file. This URL is what gets downloaded
  // whole on the first play tap (V2); everything that PROCESSES the
  // video (download, frame extraction, compose, reverse) keeps using
  // mediaSrc / the project file and is unaffected.
  const videoSrc = node.proxyUrl ?? mediaSrc;
  // The node's file was replaced (new proxy/original pair): drop the
  // downloaded copy and go back to poster-only until the next tap.
  useEffect(() => {
    videoLoadGenRef.current += 1;
    setLocalVideoSrc(null);
    setVideoLoading(false);
  }, [videoSrc]);
  const toggleVideo = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    if (localVideoSrc) {
      // Already downloaded once: replay/pause toggling reuses the
      // cached local URL, no second download.
      void v.play().catch(() => undefined);
      return;
    }
    if (!videoSrc) return;
    const gen = (videoLoadGenRef.current += 1);
    setVideoLoading(true);
    void getLocalPlaybackUrl(videoSrc).then(
      (url) => {
        if (videoLoadGenRef.current !== gen) return;
        setLocalVideoSrc(url);
        setVideoLoading(false);
      },
      () => {
        if (videoLoadGenRef.current !== gen) return;
        // Download failed: stream the remote URL directly — never
        // worse than the pre-V2 behavior.
        setLocalVideoSrc(videoSrc);
        setVideoLoading(false);
      },
    );
  }, [localVideoSrc, videoSrc]);
  // Once the (local or fallback) src lands on the element, start
  // playback — the tap that triggered the download was a play tap.
  useEffect(() => {
    if (!localVideoSrc) return;
    const v = videoRef.current;
    if (v && v.paused) void v.play().catch(() => undefined);
  }, [localVideoSrc]);
  const handlesVisible = selected || showHandles;
  const handleClass = (side: "left" | "right") =>
    `absolute top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
      side === "left" ? "-left-6" : "-right-6"
    } ${
      handlesVisible
        ? "pointer-events-auto opacity-100"
        : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
    }`;
  return (
    <div
      data-node-id={node.id}
      className="group absolute flex touch-none select-none flex-col rounded-[10px] border"
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        background: isGroup ? "rgba(var(--accent-rgb),0.05)" : "var(--surface-2)",
        borderColor: connectTarget
          ? "var(--accent)"
          : selected
            ? "var(--accent)"
            : hovered || flashing
              ? "var(--accent)"
              : "var(--border)",
        boxShadow: flashing
          ? "0 0 0 3px rgba(var(--accent-rgb),0.55)"
          : connectTarget
            ? "0 0 0 3px rgba(var(--accent-rgb),0.45)"
            : selected
              ? "0 0 0 1.5px var(--accent), var(--shadow-node)"
              : "var(--shadow-node)",
        cursor: "grab",
        zIndex: isGroup ? 1 : 2,
      }}
      role="button"
      aria-label={`画布节点 ${node.title}`}
      aria-pressed={selected}
    >
      <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5">
        <span className="shrink-0 text-[var(--dim)]">
          <Icon size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {node.title}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--dim)]">
          {NODE_TYPE_LABEL[node.type]}
        </span>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: STATUS_COLOR[node.status] }}
          aria-hidden="true"
        />
        {/* Per-project birth number (Wei 2026-11-15 定版： 显示在卡片
         * 右上角）: a read-only badge pinned at the header row's right
         * end, past the type label and status dot. seq is assigned
         * server-side once at creation and never changes; pre-numbering
         * stock (seq null) renders no badge and is never backfilled.
         * The title already truncates in the space left over, so the
         * badge never pushes the card's fixed layout. */}
        {node.seq != null ? (
          <span
            className="shrink-0 rounded bg-[var(--accent-soft)] px-1 py-px text-[10px] font-semibold leading-4 text-[var(--accent)]"
            aria-label={`编号 ${node.seq}`}
          >
            #{String(node.seq).padStart(2, "0")}
          </span>
        ) : null}
      </div>
      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          (node.type === "image" || node.type === "video") && mediaSrc
            ? "mx-[7px] mb-[7px] rounded-md"
            : ""
        }`}
      >
        {node.type === "image" ? (
          mediaSrc ? (
            <div className="relative h-full w-full">
              <img
                src={mediaSrc}
                alt={node.title}
                className="h-full w-full object-cover"
                draggable={false}
              />
              <NodeZoomButton
                title={node.title}
                visible={selected}
                onClick={() => onPreview(node)}
              />
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center text-white/85"
              style={{ background: node.color ?? IMAGE_PLACEHOLDER_BG }}
            >
              <Icon size={30} />
            </div>
          )
        ) : node.type === "video" ? (
          mediaSrc ? (
            <div
              data-node-media
              data-node-drag-surface
              className="relative h-full w-full bg-black"
              onPointerDown={(e) => {
                videoPressRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  id: e.pointerId,
                  pointerType: e.pointerType,
                };
              }}
              onPointerUp={(e) => {
                const press = videoPressRef.current;
                videoPressRef.current = null;
                if (!press || press.id !== e.pointerId) return;
                // The release that ends a long-press (context menu
                // just opened) is not a play/pause tap.
                if (Date.now() < videoToggleSuppressUntil) return;
                // Fingers jitter more than a mouse: the tap radius
                // is wider for touch so a tap meant as play does
                // not read as a (tiny) drag.
                const tapRadius = press.pointerType === "touch" ? 12 : 6;
                if (
                  Math.hypot(e.clientX - press.x, e.clientY - press.y) >
                  tapRadius
                )
                  return;
                const rect = e.currentTarget.getBoundingClientRect();
                // The bottom strip belongs to the native controls —
                // except before the first download, when the element
                // has no src and its play button can do nothing: a
                // tap there is a play tap like any other.
                if (e.clientY > rect.bottom - 44 && localVideoSrc) return;
                toggleVideo();
              }}
              onPointerCancel={() => {
                videoPressRef.current = null;
              }}
            >
              <video
                ref={videoRef}
                src={localVideoSrc ?? undefined}
                poster={node.posterUrl ?? undefined}
                controls
                preload="metadata"
                className="h-full w-full"
                aria-label={`视频 ${node.title}（点画面播放/暂停）`}
                onPlay={() => {
                  setVideoPaused(false);
                  if (videoRef.current) noteVideoPlay(videoRef.current);
                }}
                onPause={() => {
                  setVideoPaused(true);
                  if (videoRef.current) noteVideoStop(videoRef.current);
                }}
                onEnded={() => {
                  if (videoRef.current) noteVideoStop(videoRef.current);
                }}
              />
              {videoPaused ? (
                <span
                  className="pointer-events-none absolute inset-0 bg-black/25"
                  aria-hidden="true"
                />
              ) : null}
              {videoPaused && !videoLoading ? (
                <span
                  className="pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white shadow-lg"
                  aria-hidden="true"
                >
                  <IconPlay size={28} />
                </span>
              ) : null}
              {videoLoading ? (
                <span
                  className="pointer-events-none absolute bottom-1.5 left-2 z-20 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-amber-100"
                  role="status"
                  aria-label="视频加载中"
                >
                  <span
                    className="h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]"
                    aria-hidden="true"
                  />
                  <span className="text-sm font-bold tracking-wide">
                    加载中……
                  </span>
                </span>
              ) : null}
              <NodeZoomButton
                title={node.title}
                visible={selected}
                onClick={() => onPreview(node)}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 bg-black/60 text-white/85">
              <IconPlay size={26} />
              <span className="px-2 text-center text-[11px] text-white/55">
                {node.content || "视频占位"}
              </span>
            </div>
          )
        ) : node.type === "audio" ? (
          mediaSrc ? (
            <div
              data-node-media
              className="flex h-full flex-col justify-center gap-1 px-3"
            >
              <audio
                src={mediaSrc}
                controls
                className="w-full"
                aria-label={`播放音频 ${node.title}`}
              />
              <span className="truncate text-[10px] text-[var(--dim)]">
                {node.title}
              </span>
            </div>
          ) : (
            <div className="flex h-full items-end justify-center gap-[3px] px-4 pb-3" aria-hidden="true">
              {[10, 22, 14, 30, 18, 34, 12, 26, 16, 28, 11, 20, 15, 24, 13, 19].map(
                (h, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded bg-[var(--accent)]"
                    style={{ height: h, opacity: 0.55 + (i % 4) * 0.12 }}
                  />
                ),
              )}
            </div>
          )
        ) : node.type === "text" ? (
          <div
            data-canvas-no-zoom
            data-text-scroll
            className="node-scroll h-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap px-2.5 pb-2 text-[var(--text)]"
            style={{
              fontSize: node.fontSize ?? 12,
              lineHeight: `${Math.round((node.fontSize ?? 12) * 1.65)}px`,
              // Touch swipes scroll the text natively (this element
              // is the scroll container, so its touch-action wins
              // over the card's none); the canvas gesture layer
              // leaves such presses alone — dragging the title bar
              // or the card edge still moves the node.
              touchAction: "pan-y",
            }}
          >
            {node.content || <span className="text-[var(--dim)]">（空文本，选中后在下方编辑）</span>}
          </div>
        ) : node.type === "config" ? (
          <ConfigNodeBody
            node={node}
            inputs={inputs}
            generating={generating}
            feedback={feedback}
            onPatchNode={onPatchNode}
            onGenerateNode={onGenerateNode}
            onStopNode={onStopNode}
            onOpenComposer={onOpenComposer}
          />
        ) : isToolNodeType(node.type) ? (
          <ToolNodeBody
            node={node}
            inputs={inputs}
            generating={generating}
            feedback={feedback}
            onRun={onRunToolNode}
          />
        ) : node.type === "sticky-note" ? (
          <div
            className="flex h-full flex-col px-3 py-2"
            style={{ background: node.color ?? STICKY_DEFAULT_COLOR }}
          >
            <p
              className="whitespace-pre-wrap text-[13px] leading-6"
              style={{ color: "#1c1917" }}
            >
              {node.content || (
                <span style={{ color: "rgba(28,25,23,0.45)" }}>
                  选中后在下方写便签…
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="px-2.5 text-[11px] text-[var(--dim)]">
            分组 · 选中多个节点后右键「打组」归入
          </p>
        )}
      </div>
      {node.genStatus === "queued" || node.genStatus === "working" || generating ? (
        <div
          className="pointer-events-none absolute bottom-1.5 left-2 z-20 flex items-center gap-1.5 rounded bg-black/60 px-1.5 py-0.5 text-amber-100"
          role="status"
          aria-label={isToolNodeType(node.type) ? "运行中" : "生成中"}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]" aria-hidden="true" />
          <span className="text-sm font-bold tracking-wide">
            {isToolNodeType(node.type) ? "运行中……" : "生成中……"}
            {badgeElapsed >= 1 ? (
              <span className="ml-1 font-semibold">{badgeElapsed}s</span>
            ) : null}
          </span>
        </div>
      ) : null}
      {node.genStatus === "failed" ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 truncate bg-[rgba(127,29,29,0.88)] px-2 py-1 text-[11px] text-red-100"
          title={node.genError ?? ""}
        >
          {isToolNodeType(node.type)
            ? `运行失败：${node.genError || "未知原因"}`
            : (node.genError || "").startsWith("导入缺失")
              ? node.genError || "未知原因"
              : (node.genError || "未知原因").startsWith("生成失败")
                ? node.genError || "未知原因"
                : `生成失败：${node.genError || "未知原因"}`}
        </div>
      ) : showMediaInfo && node.genSize && node.mediaBlobKey ? (
        <div className="pointer-events-none absolute bottom-1 right-1 z-20 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/85">
          {node.genSize}
        </div>
      ) : null}
      {selected && !isGroup ? (
        <div
          data-resize-node={node.id}
          className="absolute -bottom-1.5 -right-1.5 z-30 flex h-6 w-6 cursor-nwse-resize items-end justify-end rounded-sm"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = node.width;
            const startH = node.height;
            // The canvas gesture layer works in screen px; node sizes
            // are world units. Read the live zoom off the card's own
            // rendered width (rendered = world * zoom).
            const card = (e.currentTarget as HTMLElement).closest(
              "[data-node-id]",
            ) as HTMLElement | null;
            const zoom = card
              ? card.getBoundingClientRect().width / Math.max(1, startW)
              : 1;
            const lockAspect =
              node.type === "image" && !node.freeResize && startH > 0;
            const aspect = startW / Math.max(1, startH);
            const move = (ev: PointerEvent) => {
              let w = Math.max(60, startW + (ev.clientX - startX) / zoom);
              let h = Math.max(40, startH + (ev.clientY - startY) / zoom);
              if (lockAspect) h = Math.max(40, w / aspect);
              onLiveResize(node.id, Math.round(w), Math.round(h));
            };
            const stop = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", stop);
              window.removeEventListener("pointercancel", stop);
              onResizeCommit();
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          }}
          role="slider"
          aria-label={`调整节点 ${node.title} 大小${node.type === "image" ? (node.freeResize ? "（自由尺寸）" : "（保持比例）") : ""}`}
          aria-valuenow={Math.round(node.width)}
        >
          <div className="h-2.5 w-2.5 rounded-[3px] border-2 border-[var(--accent)] bg-[var(--surface)]" />
        </div>
      ) : null}
      {!isGroup ? (
        <div
          data-connect-node={node.id}
          data-connect-type="target"
          className={handleClass("left")}
          aria-hidden="true"
        >
          <div className="h-3 w-3 rounded-full border-2 border-[var(--dim)] bg-[var(--surface)] transition-transform hover:scale-125" />
        </div>
      ) : null}
      {!isGroup && node.type !== "config" ? (
        <div
          data-connect-node={node.id}
          data-connect-type="source"
          className={handleClass("right")}
          aria-hidden="true"
        >
          <div className="h-3 w-3 rounded-full border-2 border-[var(--dim)] bg-[var(--surface)] transition-transform hover:scale-125" />
        </div>
      ) : null}
    </div>
  );
}
