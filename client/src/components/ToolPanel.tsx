// Tool nodes （视频抽帧 / 提取音频 / 视频配乐 / 逆推提示词）, shaped by
// the user's five-node spec sheets: the NODE CARD carries the compact
// controls (frame actions + grid + offsets / compose + loop toggle /
// extract / the five reverse modes), and clicking the node opens the
// panel below it — the 说明 panel with the sheet's title, a 关闭
// button, the three numbered steps and the footer note, word for word
// as the user approved them (their wording wins over local
// implementation trivia). The panel also keeps the connected inputs
// (with disconnect) and the run state. Tools run server-side through
// runToolNode. Per-node option choices persist as a page preference
// (localStorage), like the image quick-tools config.

import { useState } from "react";
import { IconX, NODE_TYPE_ICON } from "../icons";
import {
  EMPTY_RUN_FEEDBACK,
  RUN_FAILED_OUTLINE,
  RUN_PRESS,
  msOf,
  useElapsedSeconds,
  type NodeRunFeedback,
} from "./run-feedback";
import {
  NODE_TYPE_LABEL,
  type CanvasNode,
  type ReferenceInfo,
  type ToolNodeType,
} from "../types";
import { isToolNodeType } from "../node-utils";
import {
  readToolOptions,
  writeToolOptions,
  type ToolRunOptions,
} from "./ToolNodeBody";

/** The 说明 panel content per tool: panel title + three steps + the
 * footer note, verbatim from the user's reference sheets as approved
 * （音频提取's panel title differs from the node name, as in the
 * sheet). Do not "correct" these lines against the local ffmpeg/MP4
 * implementation — the user explicitly chose the sheets' wording. */
const TOOL_HELP: Record<
  ToolNodeType,
  { title: string; steps: string[]; note: string }
> = {
  "video-frames": {
    title: "视频抽帧",
    steps: [
      "把视频节点连到左边",
      "点「取首帧 / 取尾帧 / 六宫格」",
      "结果出现在右侧，可直接接进「图生视频」首尾帧模式",
    ],
    note: "纯浏览器抽帧，不走模型、不消耗额度",
  },
  "video-compose": {
    title: "视频配乐",
    steps: [
      "左边接一个视频节点 + 一个音频节点",
      "点「合成新视频」",
      "实时录制（约等于视频时长），产出 webm 视频节点",
    ],
    note: "原视频音频会被静音；音频比视频短会自动循环。",
  },
  "audio-extract": {
    title: "音频提取",
    steps: [
      "把视频节点连到左边",
      "点「提取音频」",
      "生成一个音频节点，可直接播放或下载",
    ],
    note: "纯浏览器解码，不走模型、不消耗额度",
  },
  "prompt-reverse": {
    title: "逆推提示词",
    steps: [
      "把图片节点或「视频抽帧」的六宫格连到左边",
      "在节点上选一种逆推方式",
      "结果生成文本节点，可直接接给生图做迭代",
    ],
    note: "需要画布里已配置支持看图的对话模型",
  },
};

/** The panel below a clicked tool node: the sheet's 说明 panel
 * (title + 关闭 + three steps + footer note, verbatim), then the
 * connected inputs and the run state. The run controls themselves
 * live on the node card (ToolNodeBody). */
export function ToolPanel({
  node,
  references,
  onDisconnect,
  onRun,
  busy,
  feedback,
}: {
  node: CanvasNode;
  references: ReferenceInfo[];
  onDisconnect: (edgeId: string) => void;
  onRun: (options?: ToolRunOptions) => void;
  busy: boolean;
  feedback?: NodeRunFeedback;
}) {
  const [helpDismissed, setHelpDismissed] = useState<boolean>(
    () => readToolOptions(node.id).helpDismissed,
  );
  const fb = feedback ?? EMPTY_RUN_FEEDBACK;
  const serverRunning =
    node.genStatus === "working" || node.genStatus === "queued";
  const elapsed = useElapsedSeconds(
    msOf(node.genStartedAt) ?? fb.startedAt,
    serverRunning || busy || fb.activeKey != null,
  );

  if (!isToolNodeType(node.type)) return null;
  const running = serverRunning;
  const help = TOOL_HELP[node.type];
  const setHelp = (dismissed: boolean) => {
    setHelpDismissed(dismissed);
    writeToolOptions(node.id, {
      ...readToolOptions(node.id),
      helpDismissed: dismissed,
    });
  };

  return (
    <div>
      {/* ------------------------------------------------ 说明 panel */}
      {helpDismissed ? (
        <button
          type="button"
          onClick={() => setHelp(false)}
          className="rounded px-1 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--hover)]"
          aria-label={`展开${help.title}使用说明`}
        >
          使用说明
        </button>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-semibold">{help.title}</span>
            <button
              type="button"
              onClick={() => setHelp(true)}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--text)]"
              aria-label="关闭使用说明"
            >
              关闭
            </button>
          </div>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs leading-5">
            {help.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] leading-4 text-[var(--dim)]">
            {help.note}
          </p>
        </div>
      )}

      {/* ------------------------------------------------ connected inputs */}
      <div className="mb-1 mt-3 flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--dim)]">
          已连入
        </span>
        <span className="text-[11px] text-[var(--dim)]">
          {references.length ? `${references.length} 个` : "无"}
        </span>
      </div>
      {references.length ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {references.map((ref) => {
            const Icon = NODE_TYPE_ICON[ref.node.type];
            const thumb =
              ref.node.type === "image"
                ? ref.node.mediaUrl
                : ref.node.type === "video"
                  ? ref.node.posterUrl
                  : null;
            return (
              <div
                key={`${ref.edgeId}:${ref.node.id}`}
                className="group/ref relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-3)]"
                title={ref.node.title}
              >
                {thumb ? (
                  <img src={thumb} alt={ref.node.title} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[var(--dim)]">
                    {Icon ? <Icon size={16} /> : null}
                    <span className="max-w-full truncate px-0.5 text-[9px]">
                      {NODE_TYPE_LABEL[ref.node.type]}
                    </span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onDisconnect(ref.edgeId)}
                  className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black focus-visible:opacity-100 group-hover/ref:opacity-100"
                  aria-label={`断开输入 ${ref.node.title}`}
                >
                  <IconX size={10} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-2 text-[11px] leading-4 text-[var(--dim)]">
          还没有连入节点：从源节点的右侧端口拖一条线到此节点左侧端口。输入缺失时运行会直接失败并写明缺什么。
        </p>
      )}

      {/* ------------------------------------------------ run state */}
      {running || fb.activeKey ? (
        <p className="mt-2 flex items-center gap-2 rounded bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--dim)]" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]" aria-hidden="true" />
          工具运行中…{elapsed >= 1 ? `已运行 ${elapsed} 秒，` : ""}结果节点完成后会出现在右侧。
        </p>
      ) : node.genStatus === "failed" ? (
        <div
          className={`mt-2 rounded bg-[rgba(239,68,68,0.12)] px-2 py-1.5 text-xs text-[#fca5a5] ${
            fb.flash?.kind === "failed" ? RUN_FAILED_OUTLINE : ""
          }`}
          role="alert"
        >
          <p>运行失败：{node.genError || "未知原因"}</p>
          <button
            type="button"
            onClick={() => onRun(undefined)}
            disabled={busy}
            className={`mt-1 rounded bg-[var(--danger)] px-2 py-1 font-medium text-white disabled:opacity-40 ${RUN_PRESS}`}
            aria-label="重试工具运行"
          >
            重试
          </button>
        </div>
      ) : node.genStatus === "done" ? (
        <p className="mt-2 rounded bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--dim)]" role="status">
          已完成 ✓ 结果节点在右侧。
        </p>
      ) : null}
    </div>
  );
}
