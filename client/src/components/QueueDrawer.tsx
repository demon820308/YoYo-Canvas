// QueueDrawer — 右侧生成抽屉：队列 | 记录 双页签。
//
// 队列页签：全项目 queued / working 列表（原抽屉行为），每行带
// 定位与停止/取消——working 显示「停止」、queued 显示「取消」，
// 都走服务端 stopGeneration（停止后晚到的后台结果不落地），
// working 行显示已耗时方便判断「生成太久」。
// 记录页签：顶部是当前项目的进行中（同带耗时与停止/取消），
// 下面是当前项目的持久生成历史（listGenerationRecords，最近
// 50 条）：完成 / 失败（含原因）/ 已停止 / 已取消都在，节点被
// 覆盖或删除后记录仍在，行内可定位（节点还在时）、预览、下载。
//
// 关闭口径：右上角 ❌、点抽屉外 backdrop、Esc 三路（与项目菜单
// 的外部点击/Esc 口径一致）；backdrop 只盖抽屉外区域，不拦截
// 抽屉内操作，关闭不触碰任何画布状态。

import { useEffect, useState } from "react";
import type { ApiResponse } from "../api";
import type { api } from "../api";
import { IconQueue, IconX } from "../icons";
import { stripChipTokens } from "../node-utils";
import { NODE_TYPE_LABEL } from "../types";
import { downloadMediaFile } from "./download-media";

export type QueueRequest =
  ApiResponse<typeof api, "listGenerationRequests">["requests"][number];
export type GenerationRecord =
  ApiResponse<typeof api, "listGenerationRecords">["records"][number];

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const RECORD_STATUS_META: Record<
  GenerationRecord["status"],
  { label: string; color: string }
> = {
  done: { label: "已完成", color: "var(--ok)" },
  failed: { label: "失败", color: "var(--danger)" },
  stopped: { label: "已停止", color: "var(--dim)" },
  cancelled: { label: "已取消", color: "var(--dim)" },
};

function InFlightRow({
  r,
  nowMs,
  showProject,
  stopping,
  onLocateNode,
  onStopRequest,
}: {
  r: QueueRequest;
  nowMs: number;
  showProject: boolean;
  stopping: boolean;
  onLocateNode: (projectId: string, nodeId: string) => void;
  onStopRequest: (projectId: string, nodeId: string) => void;
}) {
  const working = r.genStatus === "working";
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 animate-pulse rounded-full"
          style={{ background: working ? "var(--accent)" : "#f59e0b" }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {r.nodeSeq != null ? `#${r.nodeSeq} - ` : ""}
          {r.nodeTitle || "未命名节点"}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--dim)]">
          {working ? "生成中" : "排队中"}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[var(--dim)]">
        {showProject ? `${r.projectName} · ` : ""}
        {NODE_TYPE_LABEL[r.nodeType]}
        {r.genKind ? ` · ${r.genKind}` : ""}
        {r.genDuration ? ` · ${r.genDuration} 秒` : ""}
        {working && r.genStartedAt
          ? ` · 已生成 ${formatElapsed(nowMs - new Date(r.genStartedAt).getTime())}`
          : ""}
      </p>
      {r.prompt ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--dim)]">
          {stripChipTokens(r.prompt)}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onLocateNode(r.projectId, r.nodeId)}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
          aria-label={`定位到节点 ${r.nodeTitle}`}
        >
          定位节点
        </button>
        <button
          type="button"
          onClick={() => onStopRequest(r.projectId, r.nodeId)}
          disabled={stopping}
          className="rounded px-1.5 py-0.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-40"
          aria-label={`${working ? "停止" : "取消"}节点 ${r.nodeTitle} 的生成`}
        >
          {stopping ? "处理中…" : working ? "停止" : "取消"}
        </button>
      </div>
    </li>
  );
}

function RecordRow({
  record,
  projectId,
  onLocateNode,
  onPreviewRecord,
  showToast,
}: {
  record: GenerationRecord;
  projectId: string;
  onLocateNode: (projectId: string, nodeId: string) => void;
  onPreviewRecord: (record: GenerationRecord) => void;
  showToast: (message: string) => void;
}) {
  const meta = RECORD_STATUS_META[record.status];
  const locateId = record.resultNodeExists
    ? record.resultNodeId
    : record.nodeExists
      ? record.nodeId
      : null;
  const isImage = record.mimeType?.startsWith("image/") ?? false;
  const isVideo = record.mimeType?.startsWith("video/") ?? false;
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      <div className="flex items-start gap-2.5">
        {record.mediaUrl && (isImage || isVideo) ? (
          isImage ? (
            <img
              src={record.mediaUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded object-cover"
            />
          ) : (
            <video
              src={record.mediaUrl}
              muted
              playsInline
              preload="metadata"
              className="h-11 w-11 shrink-0 rounded object-cover"
              aria-hidden="true"
            />
          )
        ) : (
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-[var(--surface-3)] text-[10px] text-[var(--dim)]"
            aria-hidden="true"
          >
            {NODE_TYPE_LABEL[record.nodeType]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {record.seq != null ? `#${record.seq} - ` : ""}
              {record.title || "未命名节点"}
            </span>
            <span
              className="shrink-0 text-[11px] font-medium"
              style={{ color: meta.color }}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--dim)]">
            {formatClock(record.finishedAt)}
            {` · 耗时 ${formatElapsed(new Date(record.finishedAt).getTime() - new Date(record.startedAt).getTime())}`}
            {record.genRatio ? ` · ${record.genRatio}` : ""}
            {record.genSize ? ` · 实测 ${record.genSize}` : ""}
            {record.genDuration ? ` · ${record.genDuration} 秒` : ""}
          </p>
        </div>
      </div>
      {record.prompt ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--dim)]">
          {stripChipTokens(record.prompt)}
        </p>
      ) : null}
      {record.status === "failed" && record.error ? (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--danger)]">
          {record.error}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-1">
        {locateId ? (
          <button
            type="button"
            onClick={() => onLocateNode(projectId, locateId)}
            className="rounded px-1.5 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
            aria-label={`定位到节点 ${record.title}`}
          >
            定位节点
          </button>
        ) : (
          <span className="px-1.5 py-0.5 text-xs text-[var(--dim)]">
            节点已删除
          </span>
        )}
        {record.mediaUrl ? (
          <>
            <button
              type="button"
              onClick={() => onPreviewRecord(record)}
              className="rounded px-1.5 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
              aria-label={`预览 ${record.title} 的生成结果`}
            >
              预览
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadMediaFile(record.mediaUrl ?? "", record.title).then(
                  (result) => {
                    if (result === "failed") showToast("下载失败，请稍后重试");
                  },
                );
              }}
              className="rounded px-1.5 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
              aria-label={`下载 ${record.title} 的生成结果`}
            >
              下载
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

export function QueueDrawer({
  currentProjectId,
  requests,
  queueLoading,
  records,
  recordsLoading,
  onClose,
  onProcessQueue,
  processingQueue,
  onLocateNode,
  onStopRequest,
  stoppingNodeId,
  onPreviewRecord,
  showToast,
}: {
  currentProjectId: string | null;
  requests: QueueRequest[];
  queueLoading: boolean;
  records: GenerationRecord[];
  recordsLoading: boolean;
  onClose: () => void;
  onProcessQueue: () => void;
  processingQueue: boolean;
  onLocateNode: (projectId: string, nodeId: string) => void;
  onStopRequest: (projectId: string, nodeId: string) => void;
  stoppingNodeId: string | null;
  onPreviewRecord: (record: GenerationRecord) => void;
  showToast: (message: string) => void;
}) {
  const [tab, setTab] = useState<"queue" | "records">("queue");
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Esc closes, mirroring the project menu's discipline.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // One-second tick so working rows' 已耗时 stays live while open.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const inFlightHere = requests.filter((r) => r.projectId === currentProjectId);

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Backdrop: covers everything outside the drawer; a click
       * here closes. It sits below the panel and never intercepts
       * clicks meant for the panel itself. */}
      <div
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        data-ui
        className="absolute inset-y-0 right-0 flex w-[min(360px,92vw)] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl pt-safe"
        role="dialog"
        aria-label="生成队列"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <IconQueue size={17} />
          <h3 className="flex-1 text-sm font-semibold">
            生成队列
            {requests.length > 0 ? `（${requests.length}）` : ""}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
            aria-label="关闭生成队列"
          >
            <IconX size={16} />
          </button>
        </div>
        <div
          className="flex gap-1 border-b border-[var(--border)] px-3 pt-2"
          role="tablist"
          aria-label="生成队列与记录"
        >
          {(
            [
              { key: "queue", label: "队列" },
              { key: "records", label: "记录" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-t px-3 py-1.5 text-sm ${
                tab === t.key
                  ? "bg-[var(--surface-2)] font-medium text-[var(--text)]"
                  : "text-[var(--dim)] hover:bg-[var(--hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "queue" ? (
          <>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {queueLoading ? (
                <p className="text-sm text-[var(--dim)]">加载中…</p>
              ) : requests.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--dim)]">
                  队列是空的。在节点的生成面板里点「生成」即可直接开始生成。
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {requests.map((r) => (
                    <InFlightRow
                      key={r.nodeId}
                      r={r}
                      nowMs={nowMs}
                      showProject
                      stopping={stoppingNodeId === r.nodeId}
                      onLocateNode={onLocateNode}
                      onStopRequest={onStopRequest}
                    />
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--border)] p-3">
              <button
                type="button"
                onClick={onProcessQueue}
                disabled={processingQueue}
                className="w-full rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40"
              >
                {processingQueue ? "处理中…" : "立即处理队列"}
              </button>
              <p className="mt-2 text-[11px] leading-4 text-[var(--dim)]">
                处理队列会认领排队节点并派发；运行超过 10 分钟且没有后台任务在飞的节点会被回收为可重试的失败。
              </p>
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {inFlightHere.length > 0 ? (
              <>
                <h4 className="mb-2 text-xs font-semibold text-[var(--dim)]">
                  进行中
                </h4>
                <ul className="mb-4 flex flex-col gap-2">
                  {inFlightHere.map((r) => (
                    <InFlightRow
                      key={r.nodeId}
                      r={r}
                      nowMs={nowMs}
                      showProject={false}
                      stopping={stoppingNodeId === r.nodeId}
                      onLocateNode={onLocateNode}
                      onStopRequest={onStopRequest}
                    />
                  ))}
                </ul>
              </>
            ) : null}
            <h4 className="mb-2 text-xs font-semibold text-[var(--dim)]">
              历史记录
            </h4>
            {recordsLoading ? (
              <p className="text-sm text-[var(--dim)]">加载中…</p>
            ) : records.length === 0 ? (
              <p className="text-sm leading-6 text-[var(--dim)]">
                还没有生成记录。生成完成、失败、被停止或取消后，这里会留下记录，节点删掉也不会消失。
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {records.map((record) => (
                  <RecordRow
                    key={record.id}
                    record={record}
                    projectId={currentProjectId ?? ""}
                    onLocateNode={onLocateNode}
                    onPreviewRecord={onPreviewRecord}
                    showToast={showToast}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
