// Crop dialog for the hover toolbar (upstream
// canvas-node-crop-dialog.tsx). Split out of ImageEditorDialogs.tsx
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

export type CropRect = { x: number; y: number; width: number; height: number };

// ---------------------------------------------------------------------------
// Crop (upstream canvas-node-crop-dialog.tsx)

const DEFAULT_CROP: CropRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
const RATIO_PRESETS: { label: string; value: string; ratio: number | null }[] = [
  { label: "自由", value: "free", ratio: null },
  { label: "原图", value: "original", ratio: null },
  { label: "1:1", value: "1:1", ratio: 1 },
  { label: "4:3", value: "4:3", ratio: 4 / 3 },
  { label: "16:9", value: "16:9", ratio: 16 / 9 },
  { label: "9:16", value: "9:16", ratio: 9 / 16 },
];


export function CropDialog({
  src,
  title,
  onClose,
  onConfirm,
}: {
  src: string;
  title: string;
  onClose: () => void;
  onConfirm: (rect: CropRect) => void;
}) {
  const meta = useImageMeta(src);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [preset, setPreset] = useState("free");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    mode: "move" | "se";
    startX: number;
    startY: number;
    crop: CropRect;
  } | null>(null);

  const activeRatio = (() => {
    const found = RATIO_PRESETS.find((p) => p.value === preset);
    if (!found) return null;
    if (found.value === "original") {
      return meta ? meta.width / meta.height : null;
    }
    return found.ratio;
  })();

  const applyPreset = (value: string) => {
    setPreset(value);
    const found = RATIO_PRESETS.find((p) => p.value === value);
    const ratio =
      found?.value === "original"
        ? meta
          ? meta.width / meta.height
          : null
        : (found?.ratio ?? null);
    if (ratio && meta) {
      // Fit the current box into the ratio (in normalized space the
      // ratio scales by the image's own aspect).
      const normalized = ratio * (meta.height / meta.width);
      setCrop((current) => {
        let width = current.width;
        let height = width / normalized;
        if (height > current.height) {
          height = current.height;
          width = height * normalized;
        }
        if (width > 1) {
          width = 1;
          height = width / normalized;
        }
        if (height > 1) {
          height = 1;
          width = height * normalized;
        }
        return {
          width,
          height,
          x: clamp(current.x + (current.width - width) / 2, 0, 1 - width),
          y: clamp(current.y + (current.height - height) / 2, 0, 1 - height),
        };
      });
    }
  };

  const startDrag = (
    mode: "move" | "se",
    event: ReactPointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      crop,
    };
    const move = (e: PointerEvent) => {
      const drag = dragRef.current;
      const box = boxRef.current?.getBoundingClientRect();
      if (!drag || !box) return;
      const dx = (e.clientX - drag.startX) / box.width;
      const dy = (e.clientY - drag.startY) / box.height;
      if (drag.mode === "move") {
        setCrop({
          ...drag.crop,
          x: clamp(drag.crop.x + dx, 0, 1 - drag.crop.width),
          y: clamp(drag.crop.y + dy, 0, 1 - drag.crop.height),
        });
        return;
      }
      let width = clamp(drag.crop.width + dx, 0.06, 1 - drag.crop.x);
      let height = clamp(drag.crop.height + dy, 0.06, 1 - drag.crop.y);
      if (activeRatio && meta) {
        const normalized = activeRatio * (box.height / box.width);
        height = width / normalized;
        if (drag.crop.y + height > 1) {
          height = 1 - drag.crop.y;
          width = height * normalized;
        }
      }
      setCrop({ ...drag.crop, width, height });
    };
    const stop = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const cropSize = meta
    ? {
        width: Math.max(1, Math.round(crop.width * meta.width)),
        height: Math.max(1, Math.round(crop.height * meta.height)),
      }
    : null;

  return (
    <DialogShell title={`裁剪 · ${title}`} onClose={onClose} wide>
      <div
        ref={boxRef}
        className="relative mx-auto max-h-[52vh] select-none overflow-hidden rounded-lg bg-black"
        style={
          meta
            ? { aspectRatio: `${meta.width} / ${meta.height}`, maxWidth: "100%" }
            : { height: 300 }
        }
      >
        <img
          src={src}
          alt={title}
          className="absolute inset-0 h-full w-full object-contain opacity-90"
          draggable={false}
        />
        <div
          className="absolute inset-x-0 top-0 bg-black/55"
          style={{ height: `${crop.y * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-x-0 bottom-0 bg-black/55"
          style={{ height: `${(1 - crop.y - crop.height) * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute bg-black/55"
          style={{
            left: 0,
            top: `${crop.y * 100}%`,
            width: `${crop.x * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          aria-hidden="true"
        />
        <div
          className="absolute bg-black/55"
          style={{
            right: 0,
            top: `${crop.y * 100}%`,
            width: `${(1 - crop.x - crop.width) * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          aria-hidden="true"
        />
        <div
          className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          onPointerDown={(e) => startDrag("move", e)}
          role="img"
          aria-label="裁剪框（拖动移动）"
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
          <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
          <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
          <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
          <button
            type="button"
            className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border border-black bg-white"
            onPointerDown={(e) => startDrag("se", e)}
            aria-label="拖动调整裁剪框大小"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[var(--dim)]">
        <span>
          裁剪尺寸：
          {cropSize ? `${cropSize.width} x ${cropSize.height}` : "读取中…"}
        </span>
        {meta ? (
          <span>
            原图：{meta.width} x {meta.height}
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="flex gap-1" role="group" aria-label="裁剪比例预设">
          {RATIO_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => applyPreset(p.value)}
              aria-pressed={preset === p.value}
              className={`rounded px-2 py-1 text-xs ${
                preset === p.value
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-ink)]"
                  : "bg-[var(--surface-3)] text-[var(--dim)] hover:text-[var(--text)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </span>
      </div>
      <FooterButtons
        confirmLabel="确认裁剪"
        onCancel={onClose}
        onConfirm={() => onConfirm(crop)}
      />
    </DialogShell>
  );
}
