// Image quick-tool configuration for the node hover toolbar
// (HoverToolbar.tsx): which tools stay resident on an image
// node's toolbar, plus whether text labels show. Persisted as a
// localStorage page preference (upstream semantics); parsing is
// tolerant — a corrupt or legacy-shaped value falls back to the
// defaults rather than breaking the toolbar.

export type ImageToolId =
  | "copyPrompt"
  | "reversePrompt"
  | "replace"
  | "resize"
  | "maskEdit"
  | "crop"
  | "split"
  | "upscale"
  | "superResolve"
  | "angle"
  | "view";
export type QuickToolId =
  | "info"
  | "delete"
  | "saveAsset"
  | "download"
  | ImageToolId;

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "yoyo-canvas-image-quick-tools-v1";

const BASE_TOOL_IDS: QuickToolId[] = ["info", "delete", "saveAsset", "download"];

export const IMAGE_TOOL_DEFS: {
  id: ImageToolId;
  label: string;
  defaultVisible: boolean;
}[] = [
  { id: "copyPrompt", label: "复制提示词", defaultVisible: true },
  { id: "reversePrompt", label: "逆推提示词", defaultVisible: true },
  { id: "replace", label: "替换", defaultVisible: true },
  { id: "resize", label: "自由尺寸", defaultVisible: false },
  { id: "maskEdit", label: "蒙版编辑", defaultVisible: true },
  { id: "crop", label: "裁剪", defaultVisible: true },
  { id: "split", label: "宫格切分", defaultVisible: true },
  { id: "upscale", label: "放大", defaultVisible: true },
  { id: "superResolve", label: "超分", defaultVisible: false },
  { id: "angle", label: "换角度", defaultVisible: false },
  { id: "view", label: "查看大图", defaultVisible: true },
];

export const DEFAULT_QUICK_TOOL_IDS: QuickToolId[] = [
  ...BASE_TOOL_IDS,
  ...IMAGE_TOOL_DEFS.filter((t) => t.defaultVisible).map((t) => t.id),
];

export const ALL_QUICK_IDS: QuickToolId[] = [
  ...BASE_TOOL_IDS,
  ...IMAGE_TOOL_DEFS.map((t) => t.id),
];

export type QuickToolsConfig = { ids: QuickToolId[]; showLabels: boolean };

export function readQuickToolsConfig(): QuickToolsConfig {
  try {
    const raw = window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
    if (!raw) return { ids: DEFAULT_QUICK_TOOL_IDS, showLabels: false };
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        ids: ALL_QUICK_IDS.filter((id) =>
          (parsed as unknown[]).includes(id),
        ),
        showLabels: false,
      };
    }
    if (parsed && typeof parsed === "object") {
      const data = parsed as Partial<QuickToolsConfig>;
      return {
        ids: Array.isArray(data.ids)
          ? ALL_QUICK_IDS.filter((id) => data.ids!.includes(id))
          : DEFAULT_QUICK_TOOL_IDS,
        showLabels: data.showLabels === true,
      };
    }
  } catch {
    // Corrupt preference: fall back to defaults.
  }
  return { ids: DEFAULT_QUICK_TOOL_IDS, showLabels: false };
}

export function writeQuickToolsConfig(config: QuickToolsConfig) {
  try {
    window.localStorage.setItem(
      IMAGE_QUICK_TOOLS_STORAGE_KEY,
      JSON.stringify(config),
    );
  } catch {
    // Preference is best-effort.
  }
}
