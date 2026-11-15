// Mask edit dialog for the hover toolbar (upstream
// canvas-node-mask-edit-dialog.tsx). Split out of
// ImageEditorDialogs.tsx in batch S8; the shared shell lives in
// DialogShell.tsx.

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DialogShell, useImageMeta } from "./DialogShell";

export type MaskPayload = { prompt: string; maskDataUrl: string };

// ---------------------------------------------------------------------------
// Mask edit (upstream canvas-node-mask-edit-dialog.tsx). The mask is
// painted on a canvas over the image; on confirm the client composes
// 原图 + 蓝色半透明蒙版覆盖 into one PNG and hands it up — the server
// path then generates with 原图 + 蒙版图 as two references. This is an
// approximate redraw guided by the mask reference, not true inpainting.

export function MaskDialog({
  src,
  title,
  onClose,
  onConfirm,
}: {
  src: string;
  title: string;
  onClose: () => void;
  onConfirm: (payload: MaskPayload) => void;
}) {
  const meta = useImageMeta(src);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [mode, setMode] = useState<"paint" | "erase">("paint");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [hasPaint, setHasPaint] = useState(false);

  useEffect(() => {
    setHasPaint(false);
    setError("");
    const canvas = paintRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [src, meta]);

  const pointOf = (e: ReactPointerEvent) => {
    const canvas = paintRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
  };

  const strokeTo = (e: ReactPointerEvent) => {
    const canvas = paintRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const point = pointOf(e);
    const last = lastRef.current ?? point;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation =
      mode === "paint" ? "source-over" : "destination-out";
    ctx.strokeStyle = "rgba(37,99,235,0.55)";
    ctx.fillStyle = "rgba(37,99,235,0.55)";
    if (last.x === point.x && last.y === point.y) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastRef.current = point;
    if (mode === "paint") {
      setHasPaint(true);
      setError("");
    }
  };

  const clearMask = () => {
    const canvas = paintRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasPaint(false);
  };

  const submit = () => {
    if (!prompt.trim()) {
      setError("先填写重绘提示词");
      return;
    }
    if (!hasPaint) {
      setError("先在图上涂抹要重绘的区域");
      return;
    }
    const paint = paintRef.current;
    const img = imgRef.current;
    if (!paint || !img || !meta) return;
    const out = document.createElement("canvas");
    out.width = meta.width;
    out.height = meta.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, meta.width, meta.height);
    ctx.drawImage(paint, 0, 0, meta.width, meta.height);
    onConfirm({ prompt: prompt.trim(), maskDataUrl: out.toDataURL("image/png") });
  };

  return (
    <DialogShell
      title={`蒙版编辑 · ${title}`}
      description="在图上涂抹要改的区域，再写重绘提示词。说明：生成通道不做真正的局部重绘（inpaint），而是把原图和蒙版图一起作为参考、按提示词近似重绘整张图，蒙版标出的区域是重点修改区。"
      onClose={onClose}
      wide
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,1fr)_280px]">
        <div
          className="relative select-none overflow-hidden rounded-lg bg-black"
          style={
            meta
              ? { aspectRatio: `${meta.width} / ${meta.height}` }
              : { height: 300 }
          }
        >
          <img
            ref={imgRef}
            src={src}
            alt={title}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          {meta ? (
            <canvas
              ref={paintRef}
              width={meta.width}
              height={meta.height}
              className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                drawingRef.current = true;
                lastRef.current = null;
                strokeTo(e);
              }}
              onPointerMove={(e) => {
                if (drawingRef.current) strokeTo(e);
              }}
              onPointerUp={() => {
                drawingRef.current = false;
                lastRef.current = null;
              }}
              onPointerCancel={() => {
                drawingRef.current = false;
                lastRef.current = null;
              }}
              aria-label="蒙版涂抹画布"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("paint")}
              aria-pressed={mode === "paint"}
              className={`rounded px-3 py-2 text-sm ${
                mode === "paint"
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
                  : "bg-[var(--surface-3)] text-[var(--dim)]"
              }`}
            >
              涂抹
            </button>
            <button
              type="button"
              onClick={() => setMode("erase")}
              aria-pressed={mode === "erase"}
              className={`rounded px-3 py-2 text-sm ${
                mode === "erase"
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
                  : "bg-[var(--surface-3)] text-[var(--dim)]"
              }`}
            >
              擦除
            </button>
          </div>
          <label className="block text-sm">
            <span className="mb-1 flex items-center justify-between text-[var(--dim)]">
              笔刷大小 <span className="font-semibold text-[var(--text)]">{brushSize}px</span>
            </span>
            <input
              type="range"
              min={8}
              max={160}
              step={2}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              aria-label="笔刷大小"
              className="w-full accent-(--accent)"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--dim)]">重绘提示词</span>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setError("");
              }}
              rows={5}
              placeholder="例如：把蒙版区域换成一顶红色帽子，其余保持不变"
              aria-label="重绘提示词"
              className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            />
          </label>
          {error ? (
            <p className="text-xs font-medium text-[#f87171]" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-auto flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={clearMask}
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
            >
              清除蒙版
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)]"
            >
              生成重绘
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
