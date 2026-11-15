// Split dialog for the hover toolbar (upstream
// canvas-node-split-dialog.tsx). Split out of ImageEditorDialogs.tsx
// in batch S8; the shared shell lives in DialogShell.tsx.

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DialogShell,
  FooterButtons,
  clamp,
  useImageMeta,
} from "./DialogShell";

export type SplitParams = {
  rows: number;
  columns: number;
  horizontalLines: number[];
  verticalLines: number[];
};

// ---------------------------------------------------------------------------
// Split (upstream canvas-node-split-dialog.tsx)

function buildLines(count: number): number[] {
  return Array.from({ length: Math.max(1, count) - 1 }, (_, i) => (i + 1) / count);
}

export function SplitDialog({
  src,
  title,
  onClose,
  onConfirm,
}: {
  src: string;
  title: string;
  onClose: () => void;
  onConfirm: (params: SplitParams) => void;
}) {
  const meta = useImageMeta(src);
  const [rows, setRows] = useState(2);
  const [columns, setColumns] = useState(2);
  const [hLines, setHLines] = useState<number[]>([0.5]);
  const [vLines, setVLines] = useState<number[]>([0.5]);
  const [active, setActive] = useState<{
    axis: "h" | "v";
    index: number;
  } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const updateCount = (kind: "rows" | "columns", value: number) => {
    const count = clamp(Math.round(value) || 1, 1, 12);
    if (kind === "rows") {
      setRows(count);
      setHLines(buildLines(count));
    } else {
      setColumns(count);
      setVLines(buildLines(count));
    }
    setActive(null);
  };

  const startDrag = (
    axis: "h" | "v",
    index: number,
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setActive({ axis, index });
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (e: PointerEvent) => {
      if (axis === "h") {
        const value = clamp((e.clientY - box.top) / box.height, 0.02, 0.98);
        setHLines((current) => {
          const next = [...current];
          const lo = (next[index - 1] ?? 0) + 0.01;
          const hi = (next[index + 1] ?? 1) - 0.01;
          next[index] = clamp(value, lo, hi);
          return next;
        });
      } else {
        const value = clamp((e.clientX - box.left) / box.width, 0.02, 0.98);
        setVLines((current) => {
          const next = [...current];
          const lo = (next[index - 1] ?? 0) + 0.01;
          const hi = (next[index + 1] ?? 1) - 0.01;
          next[index] = clamp(value, lo, hi);
          return next;
        });
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const total = rows * columns;
  const piece = meta
    ? {
        width: Math.max(1, Math.floor(meta.width / columns)),
        height: Math.max(1, Math.floor(meta.height / rows)),
      }
    : null;

  return (
    <DialogShell
      title={`宫格切分 · ${title}`}
      description={`将切成 ${total} 个图片节点，排布在原图下方；分割线可拖动。`}
      onClose={onClose}
      wide
    >
      <div className="grid gap-5 md:grid-cols-[minmax(240px,1fr)_240px]">
        <div
          ref={boxRef}
          className="relative select-none overflow-hidden rounded-lg bg-black"
          style={
            meta
              ? { aspectRatio: `${meta.width} / ${meta.height}` }
              : { height: 260 }
          }
        >
          <img
            src={src}
            alt={title}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          {vLines.map((line, index) => (
            <div
              key={`v-${index}`}
              className="absolute inset-y-0 -ml-2 w-4 cursor-ew-resize"
              style={{ left: `${line * 100}%` }}
              onPointerDown={(e) => startDrag("v", index, e)}
              role="slider"
              aria-label={`竖分割线 ${index + 1}`}
              aria-valuenow={Math.round(line * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`absolute left-1/2 top-0 h-full border-l ${
                  active?.axis === "v" && active.index === index
                    ? "border-amber-300"
                    : "border-white/90"
                }`}
              />
            </div>
          ))}
          {hLines.map((line, index) => (
            <div
              key={`h-${index}`}
              className="absolute inset-x-0 -mt-2 h-4 cursor-ns-resize"
              style={{ top: `${line * 100}%` }}
              onPointerDown={(e) => startDrag("h", index, e)}
              role="slider"
              aria-label={`横分割线 ${index + 1}`}
              aria-valuenow={Math.round(line * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`absolute left-0 top-1/2 w-full border-t ${
                  active?.axis === "h" && active.index === index
                    ? "border-amber-300"
                    : "border-white/90"
                }`}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--dim)]">行数</span>
            <input
              type="number"
              min={1}
              max={12}
              value={rows}
              onChange={(e) => updateCount("rows", Number(e.target.value))}
              aria-label="切分行数"
              className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--dim)]">列数</span>
            <input
              type="number"
              min={1}
              max={12}
              value={columns}
              onChange={(e) => updateCount("columns", Number(e.target.value))}
              aria-label="切分列数"
              className="w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 outline-none focus:border-[var(--accent)]"
            />
          </label>
          <div className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[var(--dim)]">切分数量</span>
              <span className="font-semibold">{total} 个</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[var(--dim)]">单块约</span>
              <span className="font-semibold">
                {piece ? `${piece.width} x ${piece.height}` : "…"}
              </span>
            </div>
            {meta ? (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[var(--dim)]">原图</span>
                <span className="font-semibold">
                  {meta.width} x {meta.height}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <FooterButtons
        confirmLabel={`切分为 ${total} 个节点`}
        onCancel={onClose}
        onConfirm={() =>
          onConfirm({
            rows,
            columns,
            horizontalLines: hLines,
            verticalLines: vLines,
          })
        }
      />
    </DialogShell>
  );
}
