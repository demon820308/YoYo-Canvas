import { useEffect, useState, type ReactNode } from "react";
import {
IconX,
} from "../icons";
import { NODE_TYPE_LABEL, type CanvasNode } from "../types";

// ---------------------------------------------------------------------------
// Node info modal (upstream CanvasNodeInfoModal: info rows + JSON tab)

export function NodeInfoModal({
  node,
  onClose,
}: {
  node: CanvasNode;
  onClose: () => void;
}) {
  const [view, setView] = useState<"info" | "json">("info");
  const [fileSize, setFileSize] = useState<string | null>(null);

  useEffect(() => {
    setView("info");
    setFileSize(null);
    const url = node.mediaUrl;
    if (!url) return;
    let cancelled = false;
    void fetch(url, { method: "HEAD" })
      .then((res) => {
        const len = Number(res.headers.get("content-length"));
        if (!cancelled && Number.isFinite(len) && len > 0) {
          setFileSize(formatBytes(len));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [node.id, node.mediaUrl]);

  const json = JSON.stringify(
    node,
    (key, value) =>
      key === "mediaUrl" || key === "posterUrl" ? "[media url]" : value,
    2,
  );

  return (
    <div
      data-ui
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="节点详情"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-[var(--surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-base font-semibold">节点详情</h3>
          <span
            className="flex rounded-lg bg-[var(--surface-2)] p-0.5 text-xs"
            role="group"
            aria-label="详情视图切换"
          >
            <button
              type="button"
              onClick={() => setView("info")}
              aria-pressed={view === "info"}
              className={`rounded-md px-2.5 py-1 ${view === "info" ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]" : "text-[var(--dim)]"}`}
            >
              信息
            </button>
            <button
              type="button"
              onClick={() => setView("json")}
              aria-pressed={view === "json"}
              className={`rounded-md px-2.5 py-1 ${view === "json" ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]" : "text-[var(--dim)]"}`}
            >
              JSON
            </button>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
            aria-label="关闭节点详情"
          >
            <IconX size={16} />
          </button>
        </div>
        {view === "info" ? (
          <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
            <InfoRow label="ID" value={node.id} />
            <InfoRow label="名称" value={node.title || "未命名"} />
            <InfoRow label="类型" value={NODE_TYPE_LABEL[node.type]} />
            <InfoRow
              label="尺寸"
              value={`${Math.round(node.width)} x ${Math.round(node.height)}`}
            />
            <InfoRow
              label="位置"
              value={`${Math.round(node.x)}, ${Math.round(node.y)}`}
            />
            <InfoRow label="状态" value={node.status} />
            {node.genSize ? (
              <InfoRow label="成品实测" value={node.genSize} />
            ) : null}
            {fileSize ? <InfoRow label="文件大小" value={fileSize} /> : null}
            {node.prompt ? <InfoRow label="提示词" value={node.prompt} /> : null}
            {node.filePath ? (
              <InfoRow label="文件" value={node.filePath} />
            ) : null}
            {node.genError ? (
              <div className="rounded-lg border border-[rgba(239,68,68,0.4)] p-3 text-[#fca5a5]">
                {node.genError}
              </div>
            ) : null}
          </div>
        ) : (
          <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-5">
            {json}
          </pre>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <span className="text-[var(--dim)]">{label}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
