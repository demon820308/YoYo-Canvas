// The tool node card body （视频抽帧 / 提取音频 / 视频配乐 / 逆推
// 提示词）: the compact controls on the card itself, plus the
// per-node tool options state that the card and the 说明 panel
// (ToolPanel.tsx) share — option choices persist as a page
// preference (localStorage), like the image quick-tools config.

import { useEffect, useState } from "react";
import { IconCheck } from "../icons";
import {
  EMPTY_RUN_FEEDBACK,
  RUN_DONE,
  RUN_FAILED,
  RUN_FAILED_OUTLINE,
  RUN_MODE,
  RUN_PRESS,
  RUN_PRIMARY,
  RUN_RUNNING,
  RUN_SIBLING_DIM,
  RunSpinner,
  msOf,
  useElapsedSeconds,
  type NodeRunFeedback,
} from "./run-feedback";
import {
  FRAME_GRID_OPTIONS,
  REVERSE_MODE_OPTIONS,
  TOOL_INPUT_HINT,
  type CanvasNode,
  type FrameGrid,
  type FramesAction,
  type ReverseMode,
} from "../types";
import { isToolNodeType } from "../node-utils";

export type ToolRunOptions = {
  framesAction?: FramesAction;
  grid?: FrameGrid;
  firstOffsetSec?: number;
  lastOffsetSec?: number;
  loopAudio?: boolean;
  reverseMode?: ReverseMode;
};

type ToolOptionsState = {
  grid: FrameGrid;
  firstOffset: string;
  lastOffset: string;
  loopAudio: boolean;
  reverseMode: ReverseMode;
  helpDismissed: boolean;
};

const DEFAULT_OPTIONS: ToolOptionsState = {
  grid: "auto",
  firstOffset: "0",
  lastOffset: "0.04",
  loopAudio: true,
  reverseMode: "concise",
  helpDismissed: false,
};

const optionsKey = (nodeId: string) => `yoyo-canvas-tool-options-v1:${nodeId}`;

export function readToolOptions(nodeId: string): ToolOptionsState {
  try {
    const raw = window.localStorage.getItem(optionsKey(nodeId));
    if (!raw) return DEFAULT_OPTIONS;
    const parsed = JSON.parse(raw) as Partial<ToolOptionsState>;
    return {
      grid: FRAME_GRID_OPTIONS.some((o) => o.grid === parsed.grid)
        ? (parsed.grid as FrameGrid)
        : DEFAULT_OPTIONS.grid,
      firstOffset:
        typeof parsed.firstOffset === "string"
          ? parsed.firstOffset
          : DEFAULT_OPTIONS.firstOffset,
      lastOffset:
        typeof parsed.lastOffset === "string"
          ? parsed.lastOffset
          : DEFAULT_OPTIONS.lastOffset,
      loopAudio:
        typeof parsed.loopAudio === "boolean"
          ? parsed.loopAudio
          : DEFAULT_OPTIONS.loopAudio,
      reverseMode: REVERSE_MODE_OPTIONS.some((o) => o.mode === parsed.reverseMode)
        ? (parsed.reverseMode as ReverseMode)
        : DEFAULT_OPTIONS.reverseMode,
      helpDismissed: parsed.helpDismissed === true,
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export function writeToolOptions(nodeId: string, opts: ToolOptionsState) {
  try {
    window.localStorage.setItem(optionsKey(nodeId), JSON.stringify(opts));
  } catch {
    // Preference is best-effort.
  }
}

/** Options state shared by the node card's controls. The panel's
 * help-dismiss flag lives in the same record; the panel merges its
 * writes so the two never clobber each other. */
function useToolOptions(nodeId: string) {
  const [opts, setOpts] = useState<ToolOptionsState>(() =>
    readToolOptions(nodeId),
  );
  useEffect(() => {
    writeToolOptions(nodeId, opts);
  }, [nodeId, opts]);
  const patch = (p: Partial<ToolOptionsState>) =>
    setOpts((cur) => ({ ...cur, ...p }));
  return { opts, patch };
}

const parseSec = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The compact controls ON the tool node card (the upper half of the
 * spec sheets). Runs go through the same runToolNode path as before;
 * every control stops pointer-down propagation so pressing it never
 * starts a node drag. */
export function ToolNodeBody({
  node,
  inputs,
  generating,
  feedback,
  onRun,
}: {
  node: CanvasNode;
  inputs: CanvasNode[];
  generating: boolean;
  feedback?: NodeRunFeedback;
  onRun: (node: CanvasNode, options?: ToolRunOptions) => void;
}) {
  const { opts, patch } = useToolOptions(node.id);
  const fb = feedback ?? EMPTY_RUN_FEEDBACK;
  // A run is live from the local click (feedback.activeKey) — not
  // only once the server's genStatus lands — so the buttons react
  // in the same frame as the press.
  const running =
    generating ||
    node.genStatus === "working" ||
    node.genStatus === "queued" ||
    fb.activeKey != null;
  const elapsed = useElapsedSeconds(
    msOf(node.genStartedAt) ?? fb.startedAt,
    running,
  );
  if (!isToolNodeType(node.type)) return null;
  /** Lifecycle classes for the run button named `key`: the running
   * one gets the sweeping dynamic orange + spinner treatment, a
   * settled one flashes green/red, siblings dim while a run lives. */
  const runBtnClass = (key: string, base: string) => {
    if (fb.flash && (fb.flash.key === key || fb.flash.key == null)) {
      return `${base} ${fb.flash.kind === "done" ? RUN_DONE : RUN_FAILED}`;
    }
    if (fb.activeKey === key) return `${base} ${RUN_RUNNING}`;
    if (running) return `${base} ${RUN_SIBLING_DIM}`;
    return base;
  };
  /** Button content for the run button named `key`: a check during
   * the done flash, a spinner while it is the running one. */
  const runBtnContent = (key: string, label: string) => {
    if (
      fb.flash?.kind === "done" &&
      (fb.flash.key === key || fb.flash.key == null)
    ) {
      return (
        <>
          <IconCheck size={12} />
          完成
        </>
      );
    }
    if (fb.activeKey === key) {
      return (
        <>
          <RunSpinner size={11} />
          {label}
        </>
      );
    }
    return label;
  };
  const framesOptions = (framesAction: FramesAction): ToolRunOptions => ({
    framesAction,
    grid: opts.grid,
    firstOffsetSec: parseSec(opts.firstOffset, 0),
    lastOffsetSec: parseSec(opts.lastOffset, 0.04),
  });
  const videoInput = inputs.find((n) => n.type === "video");
  const audioInput = inputs.find((n) => n.type === "audio");
  const stopPd = (e: React.PointerEvent) => e.stopPropagation();
  const chipBtn = (active: boolean) =>
    `rounded-md px-1.5 py-1 text-[11px] ${
      active
        ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
        : "bg-[var(--surface-3)] text-[var(--dim)] hover:text-[var(--text)]"
    }`;
  const actionBtn = `flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs ${RUN_PRIMARY} disabled:opacity-40`;
  const hint = (
    <p className="text-[11px] leading-4 text-[var(--dim)]">
      {TOOL_INPUT_HINT[node.type]}
    </p>
  );

  return (
    // No data-node-media here: clicks on the card's non-control
    // areas must still select the node and open the panel below it
    // (the gesture layer returns early inside media regions). Every
    // control stops pointer-down propagation itself, so pressing a
    // button/input never starts a node drag either.
    <div className="flex h-full flex-col gap-1.5 px-2.5 pb-2">
      {node.type === "video-frames" ? (
        <>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onRun(node, framesOptions("first"))}
              onPointerDown={stopPd}
              disabled={running}
              className={runBtnClass("frames:first", actionBtn)}
              aria-label="取首帧"
            >
              {runBtnContent("frames:first", "取首帧")}
            </button>
            <button
              type="button"
              onClick={() => onRun(node, framesOptions("last"))}
              onPointerDown={stopPd}
              disabled={running}
              className={runBtnClass("frames:last", actionBtn)}
              aria-label="取尾帧"
            >
              {runBtnContent("frames:last", "取尾帧")}
            </button>
            <button
              type="button"
              onClick={() => onRun(node, framesOptions("grid"))}
              onPointerDown={stopPd}
              disabled={running}
              className={runBtnClass("frames:grid", actionBtn)}
              aria-label="生成抽帧表"
            >
              {runBtnContent("frames:grid", "抽帧表")}
            </button>
          </div>
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label="抽帧表格数"
          >
            <span className="mr-0.5 text-[11px] text-[var(--dim)]">格数</span>
            {FRAME_GRID_OPTIONS.map((o) => (
              <button
                key={o.grid}
                type="button"
                onClick={() => patch({ grid: o.grid })}
                onPointerDown={stopPd}
                className={chipBtn(opts.grid === o.grid)}
                aria-pressed={opts.grid === o.grid}
                aria-label={`格数 ${o.label}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--dim)]">
            <label className="flex items-center gap-1">
              首帧
              <input
                type="number"
                min={0}
                step={0.1}
                value={opts.firstOffset}
                onChange={(e) => patch({ firstOffset: e.target.value })}
                onPointerDown={stopPd}
                className="w-14 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
                aria-label="首帧偏移（秒）"
              />
              秒
            </label>
            <label className="flex items-center gap-1">
              尾帧倒推
              <input
                type="number"
                min={0}
                step={0.01}
                value={opts.lastOffset}
                onChange={(e) => patch({ lastOffset: e.target.value })}
                onPointerDown={stopPd}
                className="w-14 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
                aria-label="尾帧倒推（秒）"
              />
              秒
            </label>
          </div>
          {hint}
        </>
      ) : node.type === "video-compose" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRun(node, { loopAudio: opts.loopAudio })}
              onPointerDown={stopPd}
              disabled={running}
              className={runBtnClass(
                "compose",
                `flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${RUN_PRIMARY} disabled:opacity-40 ${
                  node.genStatus === "failed" && !fb.flash
                    ? RUN_FAILED_OUTLINE
                    : ""
                }`,
              )}
              aria-label="合成新视频"
            >
              {fb.flash?.kind === "done" && fb.flash.key === "compose" ? (
                <>
                  <IconCheck size={12} />
                  完成
                </>
              ) : running ? (
                <>
                  <RunSpinner size={11} />
                  合成中{elapsed >= 1 ? ` ${elapsed}s` : "…"}
                </>
              ) : (
                "合成新视频"
              )}
            </button>
            <label
              className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--dim)]"
              onPointerDown={stopPd}
            >
              <input
                type="checkbox"
                checked={opts.loopAudio}
                onChange={(e) => patch({ loopAudio: e.target.checked })}
                className="h-3.5 w-3.5 accent-(--accent)"
                aria-label="音频不足时循环"
              />
              音频不足时循环
            </label>
          </div>
          <p
            className="truncate text-[11px] text-[var(--dim)]"
            title={`视频 ${videoInput ? videoInput.title : "未连入"} | 音频 ${audioInput ? audioInput.title : "未连入"}`}
          >
            视频 {videoInput ? "✓" : "×"} | 音频 {audioInput ? "✓" : "×"}
          </p>
          <p className="text-[11px] leading-4 text-[var(--dim)]">
            原视频静音，换成选中的音频（时长短会自动循环）。
          </p>
          <p className="text-[11px] leading-4 text-[var(--dim)]">
            v1.2.1 · 本地 ffmpeg
          </p>
        </>
      ) : node.type === "audio-extract" ? (
        <>
          <div>
            <button
              type="button"
              onClick={() => onRun(node, undefined)}
              onPointerDown={stopPd}
              disabled={running}
              className={runBtnClass(
                "extract",
                `flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${RUN_PRIMARY} disabled:opacity-40 ${
                  node.genStatus === "failed" && !fb.flash
                    ? RUN_FAILED_OUTLINE
                    : ""
                }`,
              )}
              aria-label="提取音频"
            >
              {fb.flash?.kind === "done" && fb.flash.key === "extract" ? (
                <>
                  <IconCheck size={12} />
                  完成
                </>
              ) : running ? (
                <>
                  <RunSpinner size={11} />
                  提取中{elapsed >= 1 ? ` ${elapsed}s` : "…"}
                </>
              ) : (
                "提取音频"
              )}
            </button>
          </div>
          {hint}
        </>
      ) : (
        <>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="逆推方式（点按即运行）"
          >
            {REVERSE_MODE_OPTIONS.map((o) => {
              const key = `reverse:${o.mode}`;
              const selected = opts.reverseMode === o.mode;
              // At rest the modes are orange at a glance (Wei's
              // rule: never grey) — the last-used mode is solid, the
              // rest are orange-bordered on a light orange fill.
              const base = `flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ${
                selected
                  ? `bg-[var(--accent)] font-medium text-[var(--accent-ink)] ${RUN_PRESS}`
                  : RUN_MODE
              }`;
              const cls = `${runBtnClass(key, base)}${
                !fb.flash && node.genStatus === "failed" && selected
                  ? ` ${RUN_FAILED_OUTLINE}`
                  : ""
              }`;
              return (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => {
                    patch({ reverseMode: o.mode });
                    onRun(node, { reverseMode: o.mode });
                  }}
                  onPointerDown={stopPd}
                  disabled={running}
                  className={cls}
                  aria-pressed={selected}
                  aria-label={`逆推方式 ${o.label}`}
                >
                  {runBtnContent(key, o.label)}
                </button>
              );
            })}
          </div>
          {hint}
        </>
      )}
    </div>
  );
}
