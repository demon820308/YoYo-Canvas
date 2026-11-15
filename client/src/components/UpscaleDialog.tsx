// Upscale dialog for the hover toolbar (upstream
// canvas-node-upscale-dialog.tsx). Split out of
// ImageEditorDialogs.tsx in batch S8; the shared shell lives in
// DialogShell.tsx.

import { useEffect, useState } from "react";
import {
  DialogShell,
  FooterButtons,
  useImageMeta,
} from "./DialogShell";

export type UpscaleParams = {
  targetLongEdge: number;
  algorithm: "high" | "bilinear" | "nearest";
};

// ---------------------------------------------------------------------------
// Upscale (upstream canvas-node-upscale-dialog.tsx; 超分 = high algorithm)

const UPSCALE_TARGETS = [
  { label: "1K · 1024px", value: 1024 },
  { label: "2K · 2048px", value: 2048 },
  { label: "4K · 4096px", value: 4096 },
];
const ALGORITHMS: { value: UpscaleParams["algorithm"]; label: string; hint: string }[] = [
  { value: "high", label: "高质量", hint: "Lanczos，边缘最干净" },
  { value: "bilinear", label: "双线性", hint: "平滑过渡" },
  { value: "nearest", label: "最近邻", hint: "像素风、硬边缘" },
];

export function UpscaleDialog({
  src,
  title,
  superResolve,
  onClose,
  onConfirm,
}: {
  src: string;
  title: string;
  superResolve?: boolean;
  onClose: () => void;
  onConfirm: (params: UpscaleParams) => void;
}) {
  const meta = useImageMeta(src);
  const [target, setTarget] = useState(2048);
  const [algorithm, setAlgorithm] =
    useState<UpscaleParams["algorithm"]>("high");
  const sourceLong = meta ? Math.max(meta.width, meta.height) : 0;
  useEffect(() => {
    if (!meta) return;
    const next = UPSCALE_TARGETS.find((o) => sourceLong < o.value)?.value;
    setTarget(next ?? 4096);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);
  const output = meta
    ? (() => {
        const scale = target / sourceLong;
        const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
        return {
          width: even(meta.width * scale),
          height: even(meta.height * scale),
        };
      })()
    : null;
  const canUpscale = Boolean(meta && sourceLong < target);

  return (
    <DialogShell
      title={`${superResolve ? "超分" : "放大"} · ${title}`}
      description={
        superResolve
          ? "超分与放大是同一实现：高质量（Lanczos）缩放。"
          : undefined
      }
      onClose={onClose}
      wide
    >
      <div className="grid gap-5 md:grid-cols-[minmax(240px,1fr)_300px]">
        <div>
          <div className="grid min-h-[240px] place-items-center rounded-lg bg-black/40 p-3">
            <img
              src={src}
              alt={title}
              className="max-h-[300px] max-w-full rounded-lg object-contain"
              draggable={false}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-[var(--dim)]">原图</span>
            <span className="font-semibold">
              {meta ? `${meta.width} x ${meta.height} px` : "读取中…"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm text-[var(--dim)]">目标长边</p>
            <div className="flex gap-1" role="group" aria-label="目标长边">
              {UPSCALE_TARGETS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={Boolean(meta && sourceLong >= o.value)}
                  onClick={() => setTarget(o.value)}
                  aria-pressed={target === o.value}
                  className={`flex-1 rounded px-2 py-1.5 text-xs disabled:opacity-35 ${
                    target === o.value
                      ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
                      : "bg-[var(--surface-3)] text-[var(--dim)] hover:text-[var(--text)]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {meta && !canUpscale ? (
              <p className="mt-2 text-xs font-medium text-[#f87171]">
                原图长边已达 {sourceLong}px，不小于所选目标。
              </p>
            ) : null}
          </div>
          <div>
            <p className="mb-2 text-sm text-[var(--dim)]">缩放算法</p>
            <div className="flex flex-col gap-1" role="group" aria-label="缩放算法">
              {ALGORITHMS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAlgorithm(a.value)}
                  aria-pressed={algorithm === a.value}
                  disabled={superResolve && a.value !== "high"}
                  className={`rounded px-3 py-2 text-left disabled:opacity-35 ${
                    algorithm === a.value
                      ? "bg-[rgba(var(--accent-rgb),0.14)] text-[var(--text)]"
                      : "bg-[var(--surface-3)] text-[var(--dim)] hover:text-[var(--text)]"
                  }`}
                >
                  <span className="block text-sm font-medium">{a.label}</span>
                  <span className="block text-xs opacity-70">{a.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--dim)]">输出尺寸</span>
              <span className="font-semibold">
                {output ? `${output.width} x ${output.height} px` : "…"}
              </span>
            </div>
          </div>
        </div>
      </div>
      <FooterButtons
        confirmLabel={superResolve ? "开始超分" : "开始放大"}
        onCancel={onClose}
        onConfirm={() => onConfirm({ targetLongEdge: target, algorithm })}
        disabled={!canUpscale}
      />
    </DialogShell>
  );
}
