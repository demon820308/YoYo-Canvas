// Angle dialog for the hover toolbar (upstream
// canvas-node-angle-dialog.tsx). Split out of ImageEditorDialogs.tsx
// in batch S8; the shared shell lives in DialogShell.tsx.

import { useState } from "react";
import {
  DialogShell,
  FooterButtons,
  clamp,
} from "./DialogShell";

export type AngleParams = {
  horizontalAngle: number;
  pitchAngle: number;
  cameraDistance: number;
};

// ---------------------------------------------------------------------------
// Angle (upstream canvas-node-angle-dialog.tsx)

export function AngleDialog({
  src,
  title,
  onClose,
  onConfirm,
}: {
  src: string;
  title: string;
  onClose: () => void;
  onConfirm: (params: AngleParams) => void;
}) {
  const [horizontal, setHorizontal] = useState(0);
  const [pitch, setPitch] = useState(9);
  const [distance, setDistance] = useState(4.8);
  const scale = clamp(1.08 - distance * 0.035, 0.72, 1.08);

  return (
    <DialogShell
      title={`换角度 · ${title}`}
      description="确认后会带这张图走既有的带参考图生成通道，按下面三个参数拼成的提示词重新生成一个视角。"
      onClose={onClose}
      wide
    >
      <div className="grid gap-6 md:grid-cols-[minmax(240px,1fr)_320px]">
        <div className="grid min-h-[260px] place-items-center rounded-xl border border-[var(--border)] p-4">
          <img
            src={src}
            alt={title}
            className="h-48 w-48 rounded-2xl object-cover shadow-2xl"
            draggable={false}
            style={{
              transform: `perspective(520px) rotateY(${horizontal * -0.45}deg) rotateX(${pitch * 0.35}deg) scale(${scale})`,
            }}
          />
        </div>
        <div className="flex flex-col gap-6 py-2">
          <AngleSlider
            label="方位角"
            value={horizontal}
            min={-60}
            max={60}
            step={1}
            suffix="°"
            onChange={setHorizontal}
          />
          <AngleSlider
            label="俯仰角"
            value={pitch}
            min={-45}
            max={45}
            step={1}
            suffix="°"
            onChange={setPitch}
          />
          <AngleSlider
            label="相机距离"
            value={distance}
            min={1}
            max={10}
            step={0.1}
            onChange={setDistance}
          />
          <button
            type="button"
            onClick={() => {
              setHorizontal(0);
              setPitch(9);
              setDistance(4.8);
            }}
            className="w-fit rounded border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            重置
          </button>
        </div>
      </div>
      <FooterButtons
        confirmLabel="AI 生成新视角"
        onCancel={onClose}
        onConfirm={() =>
          onConfirm({
            horizontalAngle: horizontal,
            pitchAngle: pitch,
            cameraDistance: distance,
          })
        }
      />
    </DialogShell>
  );
}

function AngleSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[76px_1fr_64px] items-center gap-3 text-sm">
      <span className="text-[var(--dim)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full accent-(--accent)"
      />
      <span className="text-right font-semibold">
        {Number.isInteger(value) ? value : value.toFixed(1)}
        {suffix}
      </span>
    </label>
  );
}
