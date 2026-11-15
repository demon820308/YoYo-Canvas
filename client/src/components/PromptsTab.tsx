// The side panel's 提示词库 tab: the server-side prompt library —
// shared across projects by design (prompts are global, unlike
// assets). Search, detail dialog, create, insert as a text node.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { InsertAssetPayload, PromptItem } from "../types";
import { IconPlus, IconSearch, IconTrash, IconX } from "../icons";

// ---------------------------------------------------------------------------
// 提示词库 tab: server-side prompt library — search, detail dialog, create,
// insert as a text node. No external prompt source.
// ---------------------------------------------------------------------------

export function PromptsTab({
  onInsert,
}: {
  onInsert: (payload: InsertAssetPayload) => void;
}) {
  const queryClient = useQueryClient();
  const promptsQ = useQuery({
    queryKey: ["prompts"],
    queryFn: () => api.listPrompts({}),
  });
  const [keyword, setKeyword] = useState("");
  const [detail, setDetail] = useState<PromptItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const addPrompt = useMutation({
    mutationFn: (args: { title: string; content: string }) =>
      api.addPrompt(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      setTitle("");
      setContent("");
      setShowForm(false);
    },
  });
  const removePrompt = useMutation({
    mutationFn: (id: string) => api.removePrompt({ id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["prompts"] }),
  });

  const prompts = promptsQ.data?.prompts ?? [];
  const query = keyword.trim().toLowerCase();
  const filtered = prompts.filter(
    (p) =>
      !query ||
      [p.title, p.content].join(" ").toLowerCase().includes(query),
  );

  const insertPrompt = (p: PromptItem) => {
    onInsert({
      kind: "text",
      title: p.title,
      content: p.content,
      prompt: "",
      color: null,
    });
    setDetail(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-3 pb-2">
        <label className="relative block">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--dim)]">
            <IconSearch size={14} />
          </span>
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索提示词"
            aria-label="搜索提示词"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] py-1.5 pl-8 pr-2 text-[13px] outline-none placeholder:text-[var(--dim)] focus:border-[var(--accent)]"
          />
        </label>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--dim)] hover:bg-[var(--hover)]"
          aria-expanded={showForm}
        >
          <IconPlus size={13} /> 新建提示词
        </button>
        {showForm ? (
          <div className="space-y-2 rounded-md bg-[var(--surface-2)] p-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="提示词标题"
              aria-label="提示词标题"
              className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="提示词全文"
              aria-label="提示词全文"
              rows={4}
              className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              disabled={!title.trim() || !content.trim() || addPrompt.isPending}
              onClick={() =>
                addPrompt.mutate({ title: title.trim(), content: content.trim() })
              }
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-ink)] disabled:opacity-40"
            >
              保存提示词
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {promptsQ.isPending ? (
          <p className="px-2 py-8 text-center text-[13px] text-[var(--dim)]">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-[var(--dim)]">
            {prompts.length === 0
              ? "提示词库还是空的，新建第一条提示词吧。"
              : "没有匹配的提示词。"}
          </p>
        ) : (
          filtered.map((p) => (
            <div
              key={p.id}
              className="group flex items-start gap-2 rounded-md px-2 py-2 hover:bg-[var(--hover)]"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setDetail(p)}
                aria-label={`查看提示词 ${p.title}`}
              >
                <span className="block truncate text-[13px] font-medium leading-5">
                  {p.title}
                </span>
                <span className="line-clamp-2 block text-xs leading-4 text-[var(--dim)]">
                  {p.content}
                </span>
              </button>
              <button
                type="button"
                onClick={() => removePrompt.mutate(p.id)}
                className="hit-40 flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)] hover:text-[var(--danger)]"
                aria-label={`删除提示词 ${p.title}`}
              >
                <IconTrash size={15} />
              </button>
            </div>
          ))
        )}
      </div>
      {detail ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`提示词详情 ${detail.title}`}
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <h3 className="flex-1 text-base font-semibold">{detail.title}</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="hit-40 flex h-8 w-8 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
                aria-label="关闭提示词详情"
              >
                <IconX size={16} />
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">
              {detail.content}
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => insertPrompt(detail)}
                className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]"
              >
                插入为文本节点
              </button>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
