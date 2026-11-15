// The 生成配置 (generation config) node body, rendered inside
// NodeCard for config nodes.

import { RatioSelect } from "./RatioSelect";
import { VideoDurationSelect } from "./VideoDurationSelect";
import {
  RUN_DONE,
  RUN_FAILED,
  RUN_FAILED_OUTLINE,
  RUN_PRESS,
  type NodeRunFeedback,
} from "./run-feedback";
import {
  CONFIG_MODES,
  IMAGE_RATIOS,
  VIDEO_SECONDS_DEFAULT,
  type CanvasNode,
  type GenMode,
} from "../types";
import { IconCheck, IconPlay } from "../icons";

/** 生成配置 node body, structured after the user's spec sheet: mode
 * tabs on top, live reference-count chips (counted from the node's
 * actually connected inputs — groups arrive pre-flattened), the
 * 组装提示词 entry, the ratio / duration params inline under the
 * model row, and 开始生成 pinned to the
 * bottom. Generation results still land in a result node BESIDE the
 * config node — the config node never fills itself. The model row
 * shows the one channel this app actually generates through (the
 * platform channel, automatic) — there is no model choice to offer,
 * so the picker carries that single honest option. */
export function ConfigNodeBody({
  node,
  inputs,
  generating,
  feedback,
  onPatchNode,
  onGenerateNode,
  onStopNode,
  onOpenComposer,
}: {
  node: CanvasNode;
  inputs: CanvasNode[];
  generating: boolean;
  feedback?: NodeRunFeedback;
  onPatchNode: (id: string, patch: Partial<CanvasNode>) => void;
  onGenerateNode: (node: CanvasNode) => void;
  onStopNode: (node: CanvasNode) => void;
  onOpenComposer: (node: CanvasNode) => void;
}) {
  const mode: GenMode = node.genMode ?? "image";
  const textCount = inputs.filter((n) => n.type === "text").length;
  const imageCount = inputs.filter((n) => n.type === "image").length;
  const videoCount = inputs.filter((n) => n.type === "video").length;
  const audioCount = inputs.filter((n) => n.type === "audio").length;
  const running =
    generating || node.genStatus === "queued" || node.genStatus === "working";
  // The reference gate: composer content or any connected input
  // enables 开始生成 (audio mode needs a text input specifically);
  // with neither, the button is grey and inert.
  const canGenerate =
    node.prompt.trim().length > 0 ||
    (mode === "audio"
      ? textCount > 0
      : textCount + imageCount + videoCount + audioCount > 0);
  // No stored ratio yet (e.g. a config node whose mode was never
  // run): the default selection is 16:9 for image and video alike.
  const ratio = node.genRatio ?? "16:9";
  const sizeLabel = IMAGE_RATIOS.find((r) => r.ratio === ratio)?.size;
  const summary =
    mode === "image"
      ? `${ratio}${sizeLabel ? ` · ${sizeLabel}` : ""}`
      : mode === "video"
        ? `${ratio} · ${node.genDuration ?? VIDEO_SECONDS_DEFAULT} 秒`
        : mode === "audio"
          ? "音频"
          : "文本";
  const chipClass =
    "rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[11px] text-[var(--dim)]";
  return (
    // No data-node-media: clicks on the card's non-control areas
    // select the node and open the panel below it; every control
    // stops pointer-down propagation itself.
    <div className="flex h-full flex-col gap-1.5 px-2.5 pb-2">
      <div className="flex gap-1" role="group" aria-label="生成模式">
        {CONFIG_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => onPatchNode(node.id, { genMode: m.mode })}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex-1 rounded-md px-1 py-1 text-xs ${
              mode === m.mode
                ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
                : "bg-[var(--surface-3)] text-[var(--dim)] hover:text-[var(--text)]"
            }`}
            aria-pressed={mode === m.mode}
            aria-label={`模式 ${m.label}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <span className={chipClass}>提示词 {textCount} 个</span>
        <span className={chipClass}>参考图 {imageCount} 张</span>
        <span className={chipClass}>参考视频 {videoCount} 个</span>
        <span className={chipClass}>参考音频 {audioCount} 个</span>
        <button
          type="button"
          onClick={() => onOpenComposer(node)}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)] hover:brightness-110"
          aria-label="打开组装提示词面板"
        >
          组装提示词
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* Model row: this app's generation runs on the single
         * platform channel (no external API key, no channel config),
         * so the picker honestly offers that one channel; the params
         * row below it carries ONLY the parameters the platform
         * channel really honors （生图比例/尺寸、视频比例/时长） —
         * audio and text have none to offer. */}
        <select
          value="platform"
          onChange={() => undefined}
          onPointerDown={(e) => e.stopPropagation()}
          className="w-auto shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--text)]"
          aria-label="生成模型（本画布只有平台通道一个选项）"
        >
          <option value="platform">平台通道 · 自动</option>
        </select>
        {mode === "audio" || mode === "text" ? (
          <span className="shrink-0 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--dim)]">
            {summary}
          </span>
        ) : null}
      </div>
      {/* Params sit inline under the model row — the popover this
       * replaces carried only ratio (+ duration for video), the
       * same structure the video node's panel just inlined. Audio
       * and text modes have no adjustable params on the platform
       * channel, so they keep just the summary label above. */}
      {mode === "image" || mode === "video" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--dim)]">比例</span>
          <RatioSelect
            compact
            stopPointerDown
            value={ratio}
            onChange={(r) => onPatchNode(node.id, { genRatio: r })}
            showSize={mode === "image"}
          />
          {mode === "image" && sizeLabel ? (
            <span className="shrink-0 text-[11px] text-[var(--dim)]">
              {sizeLabel}
            </span>
          ) : null}
          {mode === "video" ? (
            <label className="ml-1 flex items-center gap-1 text-[11px] text-[var(--dim)]">
              时长
              <VideoDurationSelect
                value={node.genDuration ?? VIDEO_SECONDS_DEFAULT}
                onChange={(seconds) =>
                  onPatchNode(node.id, { genDuration: seconds })
                }
                stopPointerDown
                inputClassName="w-16 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1" />
      {running ? (
        <button
          type="button"
          onClick={() => onStopNode(node)}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--danger)] py-1.5 text-sm font-medium text-white hover:brightness-110"
          aria-label="停止生成"
        >
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
            aria-hidden="true"
          />
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-white" aria-hidden="true" />
          停止
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onGenerateNode(node)}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!canGenerate}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] py-1.5 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40 ${RUN_PRESS} ${
            feedback?.flash?.kind === "done"
              ? RUN_DONE
              : feedback?.flash?.kind === "failed"
                ? RUN_FAILED
                : node.genStatus === "failed"
                  ? RUN_FAILED_OUTLINE
                  : ""
          }`}
          aria-label="开始生成（结果出现在旁边的新节点）"
        >
          {feedback?.flash?.kind === "done" ? (
            <>
              <IconCheck size={13} />
              已完成
            </>
          ) : (
            <>
              <IconPlay size={13} />
              开始生成
            </>
          )}
        </button>
      )}
    </div>
  );
}
