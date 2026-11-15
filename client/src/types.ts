import type { ApiResponse } from "./api";
import type { api } from "./api";

export type ProjectSummary =
  ApiResponse<typeof api, "listProjects">["projects"][number];
export type CanvasNode =
  ApiResponse<typeof api, "getProject">["nodes"][number];
export type CanvasEdge =
  ApiResponse<typeof api, "getProject">["edges"][number];

/** A connection drag in flight: started on a node's handle. */
export type ConnectingState = {
  nodeId: string;
  handleType: "source" | "target";
};

/** World-space selection rectangle while box-selecting (upstream SelectionBox). */
export type SelectionBoxState = {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  initialSelectedNodeIds: string[];
};

/** Upstream sticky-note preset palette (plus custom colors via the
 * node's color value). */
export const STICKY_COLORS = [
  "#fde68a",
  "#fca5a5",
  "#fdba74",
  "#a7f3d0",
  "#bfdbfe",
  "#ddd6fe",
  "#f9a8d4",
  "#e7e5e4",
];
export const STICKY_DEFAULT_COLOR = "#fde68a";

export type ToolNodeType =
  | "video-frames"
  | "audio-extract"
  | "video-compose"
  | "prompt-reverse";

/** What each tool node needs connected into it, shown on the card/panel.
 * Wording follows the user's node spec sheets. */
export const TOOL_INPUT_HINT: Record<ToolNodeType, string> = {
  "video-frames": "把视频节点连到左边；首帧从开头算，尾帧从末尾往前算",
  "audio-extract": "把视频节点连到左边再点提取",
  "video-compose": "左边接一个视频节点 + 一个音频节点，再点合成",
  "prompt-reverse": "把图片节点或六宫格连到左边",
};

/** The five prompt-reverse modes, in the node's spec order. */
export const REVERSE_MODE_OPTIONS = [
  { mode: "concise", label: "简洁提示词" },
  { mode: "chinese", label: "中文 prompt" },
  { mode: "detailed", label: "详细描述" },
  { mode: "english", label: "英文 prompt" },
  { mode: "grid", label: "抽帧表逆推" },
] as const;
export type ReverseMode = (typeof REVERSE_MODE_OPTIONS)[number]["mode"];

/** Contact-sheet grid choices for 视频抽帧 （自动 = at most 1 frame/sec). */
export const FRAME_GRID_OPTIONS = [
  { grid: "auto", label: "自动≤1s" },
  { grid: "3x2", label: "3×2" },
  { grid: "3x3", label: "3×3" },
  { grid: "4x3", label: "4×3" },
  { grid: "4x4", label: "4×4" },
] as const;
export type FrameGrid = (typeof FRAME_GRID_OPTIONS)[number]["grid"];
export type FramesAction = "first" | "last" | "grid";
export type NodeType = CanvasNode["type"];
export type NodeStatus = CanvasNode["status"];
export type GenStatus = CanvasNode["genStatus"];
export type GenMode = NonNullable<CanvasNode["genMode"]>;

/** The eight real image ratios the picker offers, in the order the
 * dropdown lists them. Sizes are the generation service's measured
 * output pixels per ratio (3:2 / 2:3 measured 2026-11-15:
 * 1920×1280 / 1280×1920; 4:3 / 3:4 / 21:9 measured 2026-11-15:
 * 1792×1344 / 1344×1792 / 2352×1008 — 2352:1008 reduces to 7:3,
 * the same proportion as 21:9). Video shows the ratio only — its
 * delivered pixels are whatever genSize measures on the finished
 * file. */
export const IMAGE_RATIOS = [
  { ratio: "16:9", size: "2048×1152" },
  { ratio: "9:16", size: "1152×2048" },
  { ratio: "1:1", size: "1600×1600" },
  { ratio: "3:2", size: "1920×1280" },
  { ratio: "2:3", size: "1280×1920" },
  { ratio: "4:3", size: "1792×1344" },
  { ratio: "3:4", size: "1344×1792" },
  { ratio: "21:9", size: "2352×1008" },
] as const;

/** Video duration (seconds) is a single free-form input — no preset
 * dropdown. Any integer in [VIDEO_SECONDS_MIN, VIDEO_SECONDS_MAX] is
 * accepted; values above the max clamp to it and invalid input changes
 * nothing. New nodes default to VIDEO_SECONDS_DEFAULT. Legacy nodes
 * may still STORE other values (e.g. the retired 4s preset) — those
 * are data, echoed by the input as-is, and left untouched until the
 * user enters a new value. */
export const VIDEO_SECONDS_DEFAULT = 5;
export const VIDEO_SECONDS_MIN = 1;
export const VIDEO_SECONDS_MAX = 30;

export const CONFIG_MODES: { mode: GenMode; label: string }[] = [
  { mode: "image", label: "生图" },
  { mode: "text", label: "文本" },
  { mode: "video", label: "视频" },
  { mode: "audio", label: "音频" },
];

/** One connected input of a node, flattened (groups pre-expanded by the
 * caller): the node itself plus the edge that disconnects it. */
export type ReferenceInfo = { node: CanvasNode; edgeId: string };

/** Fields a client-side node constructor supplies; every gen/media
 * column not listed here is server-owned and filled with defaults. */
export type NodeDraft = Omit<
  CanvasNode,
  | "id"
  | "projectId"
  | "seq"
  | "genStatus"
  | "genError"
  | "genStartedAt"
  | "genSize"
  | "genKind"
  | "mediaBlobKey"
  | "mediaUrl"
  | "mimeType"
  | "filePath"
  | "posterBlobKey"
  | "posterUrl"
  | "proxyBlobKey"
  | "proxyUrl"
  | "genRatio"
  | "genDuration"
  | "genMode"
  | "freeResize"
  | "fontSize"
> &
  Partial<
    Pick<CanvasNode, "genRatio" | "genDuration" | "genMode" | "freeResize" | "fontSize">
  >;

export type Asset = ApiResponse<typeof api, "listAssets">["assets"][number];
export type PromptItem =
  ApiResponse<typeof api, "listPrompts">["prompts"][number];

/** Payload the side panel hands up when an asset or prompt is inserted.
 * Media assets (assetId + mediaBlobKey set) are inserted through the
 * server so the new node carries the asset's real media blob; text and
 * other assets take the plain local node path. */
export type InsertAssetPayload = {
  kind: NodeType;
  title: string;
  content: string;
  prompt: string;
  color: string | null;
  assetId?: string;
  mediaBlobKey?: string | null;
};

/** dataTransfer type for dragging an asset row onto the canvas: the
 * drop handler reads the InsertAssetPayload JSON stored under it and
 * lands the new node at the drop point. */
export const ASSET_DRAG_MIME = "application/x-yoyo-asset";

/** Type labels for the canvas list's numbered row format. These are
 * the words the row shows next to the node's birth number — note
 * config reads 生成配置 and the reverse tool 逆推提示词 here, which
 * differ from NODE_TYPE_LABEL's shorter filter-chip words. */
export const SEQ_TYPE_LABEL: Record<NodeType, string> = {
  image: "图片",
  video: "视频",
  text: "文本",
  audio: "音频",
  config: "生成配置",
  group: "分组",
  "video-frames": "视频抽帧",
  "audio-extract": "提取音频",
  "video-compose": "视频配乐",
  "prompt-reverse": "逆推提示词",
  "sticky-note": "便签",
};

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  image: "图片",
  video: "视频",
  text: "文本",
  audio: "音频",
  config: "配置",
  group: "分组",
  "video-frames": "视频抽帧",
  "audio-extract": "提取音频",
  "video-compose": "视频配乐",
  "prompt-reverse": "提示词逆推",
  "sticky-note": "便签",
};

export const STATUS_COLOR: Record<NodeStatus, string> = {
  success: "#2f8f79",
  loading: "#e8a33d",
  error: "#e0655a",
  idle: "transparent",
};

/** Default background of an image placeholder's middle area: the
 * neutral node-surface tone the user picked (图3, #23242b in dark
 * mode) — a CSS variable so light mode uses its matching surface.
 * A stored node color (an explicit pick from IMAGE_COLORS) still
 * wins; new image nodes store no color and land on this default. */
export const IMAGE_PLACEHOLDER_BG = "var(--surface-2)";

/** Optional placeholder hues a user can explicitly pick for an
 * image node in the detail editor. */
export const IMAGE_COLORS = [
  "#3fa08c",
  "#e3ac4e",
  "#5aa9e6",
  "#e66a8a",
  "#9a7fe0",
  "#e07b4f",
  "#4fc4c9",
  "#8a9199",
];

