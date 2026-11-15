// Image editor dialogs for the hover toolbar, ported from the upstream
// canvas-node-{crop,split,upscale,angle,mask-edit}-dialog.tsx onto this
// artifact's theme (no antd here). All geometry is normalized (0..1
// fractions of the source) except upscale's target long edge; the
// server converts fractions to pixels from the probed real size and
// runs ffmpeg, so what the dialogs promise is what gets measured.

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { IconX } from "../icons";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useImageMeta(src: string | null) {
  const [meta, setMeta] = useState<{ width: number; height: number } | null>(
    null,
  );
  useEffect(() => {
    setMeta(null);
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setMeta({ width: img.naturalWidth, height: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);
  return meta;
}

export function DialogShell({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      data-ui
      data-canvas-no-zoom
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-3"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-[var(--surface)] p-5 ${
          wide ? "max-w-3xl" : "max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-[var(--dim)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--dim)] hover:bg-[var(--hover-strong)]"
            aria-label={`关闭${title}`}
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function FooterButtons({
  confirmLabel,
  onCancel,
  onConfirm,
  disabled,
}: {
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-[var(--border)] px-3 py-2 text-sm"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-ink)] disabled:opacity-40"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
