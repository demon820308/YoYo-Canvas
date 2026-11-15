// ---------------------------------------------------------------------------
// 组装提示词 composer dialog for config nodes (opened from the config
// card's 组装提示词 button): the reference-content tiles of everything
// currently connected, a + tile that drops an "@" into the editor
// (the chip input's reference entry point), and the chip prompt
// input itself. References are renumbered from the CURRENT
// connections when the generation is sent — the dialog edits the
// same node.prompt the panel edits.

import { useRef, type CSSProperties } from "react";
import { ChipPromptInput, referenceLabels } from "./ChipPromptInput";
import {
  IconCheck,
  IconPlus,
  IconSpark,
  IconX,
  NODE_TYPE_ICON,
} from "../icons";
import {
  EMPTY_RUN_FEEDBACK,
  RUN_DONE,
  RUN_PRESS,
  RUN_RUNNING,
  RunSpinner,
  type NodeRunFeedback,
} from "./run-feedback";
import type { CanvasNode, GenMode, ReferenceInfo } from "../types";

export function ConfigComposerDialog({
  node,
  references,
  style,
  feedback,
  onPatch,
  onClose,
  onGenerate,
}: {
  node: CanvasNode;
  references: ReferenceInfo[];
  /** Anchors the panel under the config node (same placement math
   * as the detail editor); undefined falls back to centered. */
  style?: CSSProperties;
  feedback?: NodeRunFeedback;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const refLabels = referenceLabels(references);
  // Same gate as the reference implementation: the composer content
  // or any connected input enables 开始生成； audio mode needs a
  // text input (or content) — with neither, the button stays grey.
  const mode: GenMode = node.genMode ?? "image";
  const canGenerate =
    node.prompt.trim().length > 0 ||
    (mode === "audio"
      ? references.some((r) => r.node.type === "text")
      : references.length > 0);
  // Same run lifecycle as the card's 开始生成 (run-feedback.tsx).
  const fb = feedback ?? EMPTY_RUN_FEEDBACK;
  const composing =
    fb.activeKey != null ||
    node.genStatus === "working" ||
    node.genStatus === "queued";

  const insertMention = () => {
    const editor =
      dialogRef.current?.querySelector<HTMLElement>("[contenteditable]");
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // A freshly typed "@" is exactly what the chip input listens
    // for: it opens the connected-nodes mention menu.
    document.execCommand("insertText", false, "@");
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="组装提示词"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-detail-panel
        className={
          style
            ? "max-h-[min(560px,80vh)] overflow-y-auto rounded-[22px] bg-[var(--surface)] p-5 text-[var(--text)] shadow-[var(--shadow)]"
            : "w-full max-w-lg rounded-2xl bg-[var(--surface)] p-5 text-[var(--text)]"
        }
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">组装提示词</h3>
            <p className="mt-0.5 text-xs text-[var(--dim)]">
              @ 引用已连接资产，发送前按当前连接重新编号
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
            aria-label="关闭组装提示词面板"
          >
            <IconX size={16} />
          </button>
        </div>

        <p className="mt-4 text-xs font-medium text-[var(--dim)]">参考内容</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {references.map((ref) => {
            const Icon = NODE_TYPE_ICON[ref.node.type];
            const thumb =
            ref.node.type === "image"
                ? ref.node.mediaUrl
                : ref.node.type === "video"
                  ? ref.node.posterUrl
                  : null;
            return (
              <span
                key={ref.edgeId}
                className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-3)] text-[var(--dim)]"
                title={`${refLabels.get(ref.node.id) ?? ""} ${ref.node.title}`}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt={ref.node.title}
                    className="h-full w-full object-cover"
                  />
                ) : Icon ? (
                  <Icon size={18} />
                ) : null}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-0.5 text-center text-[9px] leading-3 text-white">
                  {refLabels.get(ref.node.id) ?? ""}
                </span>
              </span>
            );
          })}
          <button
            type="button"
            onClick={insertMention}
            disabled={references.length === 0}
            className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-[var(--border)] text-[var(--dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
            aria-label="添加引用（在输入框中插入 @）"
            title="添加引用"
          >
            <IconPlus size={18} />
          </button>
        </div>
        {references.length === 0 ? (
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--dim)]">
            还没有连接参考：先把图片、文本或分组节点连到这个配置节点的左侧端口。
          </p>
        ) : null}

        <div className="mt-3">
          <ChipPromptInput
            value={node.prompt}
            references={references}
            onChange={(serialized) => onPatch({ prompt: serialized })}
            ariaLabel="组装提示词输入"
            placeholder="输入提示词，按 @ 引用连接的图片、文本或组"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--border)] px-3 py-2 text-sm"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || composing}
            className={`flex items-center gap-1 rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)] ${RUN_PRESS} ${
              !canGenerate ? "opacity-40" : ""
            } ${
              fb.flash?.kind === "done"
                ? RUN_DONE
                : composing
                  ? RUN_RUNNING
                  : ""
            }`}
            aria-label="开始生成（结果出现在旁边的新节点）"
          >
            {fb.flash?.kind === "done" ? (
              <>
                <IconCheck size={14} />
                已完成
              </>
            ) : composing ? (
              <>
                <RunSpinner size={13} />
                生成中…
              </>
            ) : (
              <>
                <IconSpark size={14} />
                开始生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
