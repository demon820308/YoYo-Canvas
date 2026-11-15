// tool-dispatch.ts — 工具节点执行：抽帧/提取音频/配乐/逆推四个工具
// 节点的确定性 ffmpeg 流水线与产物落地（attachProducedFile）。
// runToolDispatch 只做分发路由，各工具分支为独立函数（批次 S2 自
// generation-dispatch.ts 整段搬移并按分支提取，分支逻辑逐字不变）。

import { z, type Ctx } from "@hatch/space-sdk";
import { Contracts } from "@space/privileged";
import { type Db, type NodeRow, type ProjectRow } from "./contracts";
import { collectInputs } from "./generation-context";
import { getNodeRow, getProjectRow, attachResultNode, recordMediaAsset, markFailed } from "./graph-helpers";
import { expandHome, isInProjectDir } from "./project-dirs";
import { ensurePoster, ensureProxy, mirrorNodeMedia } from "./queue-sweep";
import { INFERENCE_TIMEOUT_SECS, type GenDispatch } from "./generation-dispatch";

// ---------------------------------------------------------------------------
// Tool nodes (runToolNode): deterministic media tools over connected
// inputs, executed through the ffmpeg sidecar — no model generation.
// They share the generation run-state fields wholesale: markWorking
// stamps genStartedAt server-side, success lands through
// attachResultNode (which marks the tool node done), failures land
// through markFailed with a visible reason, and processQueue's orphan
// sweep (recoverStaleWorking) covers tool nodes exactly like
// generation nodes — a tool node stuck in "working" for over 10
// minutes with no background task becomes a retryable failure.
// ---------------------------------------------------------------------------

/** Prompt-reverse sends the linked image to vision inference as a
 * downscaled copy when the original is large (long edge capped at
 * 2048px, payload at ~3MB): full-size originals (e.g. a 1920×3416
 * frame grid at 7.4MB) made the platform call fail outright. The
 * canvas file itself is never modified — only the copy sent at
 * click time is shrunk （抽帧产出不压，Wei 2026-11-15 拍板 B 方案）. */
const REVERSE_SEND_MAX_EDGE = 2048;
const REVERSE_SEND_MAX_BYTES = 3 * 1024 * 1024;

/** Reads a produced file from the project directory, stores it as a
 * blob, probes its real size, and attaches it as a result node. */
export async function attachProducedFile(
  ctx: Ctx,
  db: Db,
  source: NodeRow,
  args: {
    filePath: string;
    type: "image" | "video" | "audio";
    title: string;
  },
): Promise<string> {
  const file = await ctx.executePrivileged(Contracts.readMediaFile, {
    path: args.filePath,
  });
  let genSize: string | null = null;
  let durationSeconds: number | null = null;
  try {
    const probe = await ctx.executePrivileged(Contracts.probeMediaFile, {
      path: args.filePath,
    });
    if (probe.width && probe.height) {
      genSize = `${probe.width}x${probe.height}`;
    }
    durationSeconds = probe.durationSeconds;
  } catch {
    // Measurement is best-effort here; the file itself is the result.
  }
  const resultId = crypto.randomUUID();
  const blobKey = `media/${source.projectId}/${resultId}`;
  await ctx.blobs.put(blobKey, Buffer.from(file.dataBase64, "base64"), {
    contentType: file.contentType,
  });
  const landedId = await attachResultNode(db, source, {
    id: resultId,
    type: args.type,
    mediaBlobKey: blobKey,
    mimeType: file.contentType,
    filePath: expandHome(args.filePath),
    genSize,
    durationSeconds,
    title: args.title,
    content: "",
    prompt: "",
  });
  // Produced media enters the asset library under its kind, exactly
  // like generated media does — this is the channel the tool nodes
  // （提取音频 / 视频抽帧 / 视频配乐） and the image editors land
  // through, and it previously skipped the library entirely, which is
  // why extracted audio never showed up under an 音频 group.
  const landedRow = await getNodeRow(db, landedId);
  if (landedRow) {
    await recordMediaAsset(db, landedRow, { title: args.title, prompt: "" });
  }
  if (args.type === "video" && landedRow) {
    // Playback proxy (V1) for produced videos (e.g. 视频配乐 results),
    // best-effort like everywhere else: a failed transcode never
    // fails the tool run, and the queue sweep retries it later.
    try {
      await ensureProxy(ctx, db, landedRow);
    } catch {
      // Proxy is a playback aid, not part of the tool result.
    }
  }
  return landedId;
}

/** An image node whose real file can feed the ffmpeg image tools:
 * has a file, and the file sits inside its project's directory. */
export async function imageSourceFile(
  db: Db,
  nodeId: string,
): Promise<
  | { node: NodeRow; project: ProjectRow; filePath: string }
  | { error: string }
> {
  const node = await getNodeRow(db, nodeId);
  if (!node || node.type !== "image") return { error: "图片节点不存在" };
  const project = await getProjectRow(db, node.projectId);
  if (!project) return { error: "项目不存在" };
  if (!node.filePath) {
    return {
      error: `图片「${node.title}」还没有文件落盘到项目目录，暂时无法处理（等它落盘完成后重试）`,
    };
  }
  if (!isInProjectDir(project, node.filePath)) {
    return { error: `图片「${node.title}」的文件不在本项目目录内，无法处理` };
  }
  return { node, project, filePath: expandHome(node.filePath) };
}

type ToolFail = { status: "failed"; error: string };

async function toolFail(
  db: Db,
  nodeId: string,
  message: string,
): Promise<ToolFail> {
  await markFailed(db, nodeId, message);
  return { status: "failed", error: message };
}

/** A connected input that can feed a file-based tool: right type, has
 * a file, and the file sits inside this project's directory. Returns
 * either the row or the precise reason it cannot be used. */
function usableFileInput(
  project: ProjectRow,
  inputs: NodeRow[],
  want: "video" | "audio",
  toolLabel: string,
): { row: NodeRow; filePath: string } | { error: string } {
  const ofType = inputs.filter((r) => r.type === want);
  const row = ofType[0];
  if (!row) {
    return {
      error: `${toolLabel}需要连入一个${want === "video" ? "视频" : "音频"}节点：请把${want === "video" ? "视频" : "音频"}节点连到此节点左侧端口`,
    };
  }
  if (!row.filePath) {
    return {
      error: `连入的${want === "video" ? "视频" : "音频"}「${row.title}」还没有文件落盘到项目目录，暂时无法处理（等它落盘完成后重试）`,
    };
  }
  if (!isInProjectDir(project, row.filePath)) {
    return {
      error: `连入的${want === "video" ? "视频" : "音频"}「${row.title}」的文件不在本项目目录内，无法处理`,
    };
  }
  return { row, filePath: expandHome(row.filePath) };
}

/** Per-run tool options, chosen in the node's panel: which frame
 * extraction to run and its grid/offsets, whether composed audio
 * loops, and which prompt-reverse mode to produce. All optional —
 * absent options reproduce the tools' default behavior. */
export type ToolRunOptions = {
  framesAction?: "first" | "last" | "grid";
  grid?: "auto" | "3x2" | "3x3" | "4x3" | "4x4";
  firstOffsetSec?: number;
  lastOffsetSec?: number;
  loopAudio?: boolean;
  reverseMode?: "concise" | "chinese" | "detailed" | "english" | "grid";
};

/** 视频抽帧 / 提取音频分支（共用连入视频的定位与校验，再按节点类型分流）。批次 S2 自 runToolDispatch 整段提取，分支逻辑逐字不变。 */
async function runFramesExtractTool(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  project: ProjectRow,
  inputs: NodeRow[],
  options: ToolRunOptions,
  outDir: string,
  tag: string,
): Promise<GenDispatch> {
  const label = node.type === "video-frames" ? "视频抽帧" : "提取音频";
  const found = usableFileInput(project, inputs, "video", label);
  if ("error" in found) return toolFail(db, node.id, found.error);
  const video = found.row;
  if (node.type === "video-frames") {
    const gridSpec =
      options.grid === "3x3"
        ? { gridCols: 3, gridRows: 3, gridAuto: false }
        : options.grid === "4x3"
          ? { gridCols: 4, gridRows: 3, gridAuto: false }
          : options.grid === "4x4"
            ? { gridCols: 4, gridRows: 4, gridAuto: false }
            : options.grid === "auto"
              ? { gridCols: 3, gridRows: 2, gridAuto: true }
              : { gridCols: 3, gridRows: 2, gridAuto: false };
    const frames = await ctx.executePrivileged(Contracts.extractFrames, {
      input: found.filePath,
      outputDir: outDir,
      baseName: `frames-${tag}`,
      mode: options.framesAction ?? "all",
      firstOffsetSec: options.firstOffsetSec ?? 0,
      lastOffsetSec: options.lastOffsetSec ?? 0.04,
      ...gridSpec,
    });
    const base = video.title || "视频";
    if (frames.firstPath) {
      await attachProducedFile(ctx, db, node, {
        filePath: frames.firstPath,
        type: "image",
        title: `${base} · 首帧`,
      });
    }
    if (frames.lastPath) {
      await attachProducedFile(ctx, db, node, {
        filePath: frames.lastPath,
        type: "image",
        title: `${base} · 尾帧`,
      });
    }
    if (frames.gridPath) {
      await attachProducedFile(ctx, db, node, {
        filePath: frames.gridPath,
        type: "image",
        title:
          options.grid && options.grid !== "3x2"
            ? `${base} · 抽帧表`
            : `${base} · 六宫格`,
      });
    }
    return { status: "done", error: null };
  }
  const extracted = await ctx.executePrivileged(Contracts.extractAudio, {
    input: found.filePath,
    outputDir: outDir,
    fileName: `audio-${tag}.mp3`,
  });
  await attachProducedFile(ctx, db, node, {
    filePath: extracted.path,
    type: "audio",
    title: `${video.title || "视频"} · 音频`,
  });
  return { status: "done", error: null };
}

/** 视频配乐分支。批次 S2 自 runToolDispatch 整段提取，分支逻辑逐字不变。 */
async function runVideoComposeTool(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  project: ProjectRow,
  inputs: NodeRow[],
  options: ToolRunOptions,
  outDir: string,
  tag: string,
): Promise<GenDispatch> {
  const videoFound = usableFileInput(project, inputs, "video", "视频配乐");
  if ("error" in videoFound) return toolFail(db, node.id, videoFound.error);
  const audioFound = usableFileInput(project, inputs, "audio", "视频配乐");
  if ("error" in audioFound) return toolFail(db, node.id, audioFound.error);
  const composed = await ctx.executePrivileged(Contracts.composeVideo, {
    videoInput: videoFound.filePath,
    audioInput: audioFound.filePath,
    outputDir: outDir,
    fileName: `composed-${tag}.mp4`,
    loopAudio: options.loopAudio ?? true,
  });
  const resultId = await attachProducedFile(ctx, db, node, {
    filePath: composed.path,
    type: "video",
    title: `${videoFound.row.title || "视频"} · 配乐版`,
  });
  // Poster for the composed result (best-effort, like deliveries).
  try {
    const resultRow = await getNodeRow(db, resultId);
    if (resultRow) await ensurePoster(ctx, db, resultRow);
  } catch {
    // Poster is a stand-in still, not part of the tool result.
  }
  return { status: "done", error: null };
}

/** 提示词逆推分支。批次 S2 自 runToolDispatch 整段提取，分支逻辑逐字不变。 */
async function runPromptReverseTool(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  project: ProjectRow,
  inputs: NodeRow[],
  options: ToolRunOptions,
  outDir: string,
  tag: string,
): Promise<GenDispatch> {
  const images = inputs.filter((r) => r.type === "image");
  if (images.length === 0) {
    return toolFail(
      db,
      node.id,
      "提示词逆推需要连入一个图片节点：请把图片节点连到此节点左侧端口",
    );
  }
  // In grid mode the contact sheet is the intended input even
  // when a plain image is also connected: prefer an input that
  // is recognisably a frames sheet (its title from the frames
  // tool, or its landed "-grid" file name) over the first image.
  let image = images[0];
  if (options.reverseMode === "grid") {
    const sheet = images.find(
      (r) =>
        r.title.includes("抽帧表") ||
        r.title.includes("六宫格") ||
        (r.filePath ?? "").includes("-grid"),
    );
    if (sheet) image = sheet;
  }
  if (!image) {
    return toolFail(db, node.id, "提示词逆推需要连入一个图片节点");
  }
  // A blob-only image is landed into the project directory first
  // (server-side mirror), so the file read below always has a path.
  if (!image.filePath && image.mediaBlobKey) {
    await mirrorNodeMedia(ctx, db, image);
    image = (await getNodeRow(db, image.id)) ?? image;
  }
  if (!image.filePath) {
    return toolFail(
      db,
      node.id,
      `连入的图片「${image.title}」还没有文件落盘到项目目录，暂时无法逆推（等它落盘完成后重试）`,
    );
  }
  if (!isInProjectDir(project, image.filePath)) {
    return toolFail(
      db,
      node.id,
      `连入的图片「${image.title}」的文件不在本项目目录内，无法逆推`,
    );
  }
  let file = await ctx.executePrivileged(Contracts.readMediaFile, {
    path: expandHome(image.filePath),
  });
  // The on-disk file the bytes above came from (changes when the
  // WebP→PNG re-encode below runs); the send-time shrink step
  // reads from this path.
  let sendSourcePath = expandHome(image.filePath);
  // Vision inference only takes PNG/JPEG, but this app's own
  // generated images land as WebP — re-encode those to a PNG copy
  // first (local ffmpeg), so generated pictures can be reversed
  // exactly like uploaded PNG/JPG ones.
  if (file.contentType !== "image/png" && file.contentType !== "image/jpeg") {
    const converted = await ctx.executePrivileged(
      Contracts.convertImageToPng,
      {
        input: expandHome(image.filePath),
        outputDir: outDir,
        fileName: `reverse-${tag}.png`,
      },
    );
    sendSourcePath = converted.path;
    file = await ctx.executePrivileged(Contracts.readMediaFile, {
      path: converted.path,
    });
  }
  if (file.contentType !== "image/png" && file.contentType !== "image/jpeg") {
    return toolFail(
      db,
      node.id,
      `逆推只支持 PNG / JPG 图片，这张是 ${file.contentType}，本地转码后仍无法读取`,
    );
  }
  // Send-time shrink （点击时缩小）: vision inference rejects
  // oversized payloads, so an image past the edge/byte caps goes
  // out as a locally downscaled copy; the canvas file itself is
  // never touched. Images already within the caps are sent as-is.
  const probedSend = await ctx.executePrivileged(
    Contracts.probeMediaFile,
    { path: sendSourcePath },
  );
  let sentWidth = probedSend.width;
  let sentHeight = probedSend.height;
  const sendTooBig =
    file.sizeBytes > REVERSE_SEND_MAX_BYTES ||
    (probedSend.width != null &&
      probedSend.height != null &&
      Math.max(probedSend.width, probedSend.height) >
        REVERSE_SEND_MAX_EDGE);
  if (sendTooBig) {
    const shrunk = await ctx.executePrivileged(
      Contracts.shrinkImageForInference,
      {
        input: sendSourcePath,
        outputDir: outDir,
        fileName: `reverse-send-${tag}.${file.contentType === "image/jpeg" ? "jpg" : "png"}`,
        maxEdge: REVERSE_SEND_MAX_EDGE,
        maxBytes: REVERSE_SEND_MAX_BYTES,
      },
    );
    file = await ctx.executePrivileged(Contracts.readMediaFile, {
      path: shrunk.path,
    });
    sentWidth = shrunk.width;
    sentHeight = shrunk.height;
  }
  // Past the checks above the payload is PNG or JPEG (the
  // shrink copy is written as one of the two by construction);
  // pin the narrowed type for the inference call.
  const sendMimeType: "image/png" | "image/jpeg" =
    file.contentType === "image/jpeg" ? "image/jpeg" : "image/png";
  // One run produces ONE text node, in the mode picked on the
  // node （简洁提示词 / 中文 prompt / 详细描述 / 英文 prompt /
  // 抽帧表逆推）. The grid mode reads a contact sheet cell by
  // cell; the others read a single image.
  const reverseMode = options.reverseMode ?? "concise";
  const REVERSE_MODES = {
    concise: {
      label: "简洁提示词",
      instruction:
        "写一段可以直接用于 AI 生图的简洁提示词：抓住主体、关键外观、场景、构图与风格，简洁有力，一段话即可。",
    },
    chinese: {
      label: "中文 prompt",
      instruction:
        "写一段完整、可直接用于 AI 生图的中文提示词：主体与外观、服饰与动作、场景与背景、光线与色彩、镜头与构图、风格与氛围都要覆盖，比简洁版更完整细致，一段话即可。",
    },
    detailed: {
      label: "详细描述",
      instruction:
        "完整详细地描述这张图片的内容：主体是谁/什么、外观与服饰细节、动作与表情、场景与背景、光线、色彩、构图、风格与氛围，尽量具体，可以分段。",
    },
    english: {
      label: "英文 prompt",
      instruction:
        "Write one English prompt ready for AI image generation: subject and appearance, clothing and action, setting and background, lighting and color, composition and camera, style and mood. A single paragraph.",
    },
    grid: {
      label: "抽帧表逆推",
      instruction:
        "这张图是一张视频抽帧表（多帧拼成的宫格图）。先逐格简述每一格的画面内容与前后变化，再在最后总结出一段可直接用于 AI 生图/生视频的提示词，覆盖主体、场景、动作走向与风格。",
    },
  } as const;
  const modeSpec = REVERSE_MODES[reverseMode];
  let result: { text: string };
  try {
    result = await ctx.inference.complete(
      [`请仔细看这张图片，按下面的要求输出：`, modeSpec.instruction].join(
        "\n",
      ),
      {
        schema: z.object({
          text: z.string().min(1).max(12000),
        }),
        system: "你是一位图片分析师，擅长把图片逆推成生图提示词与详细画面描述。",
        images: [
          {
            dataBase64: file.dataBase64,
            mimeType: sendMimeType,
            filename: image.title || "image",
          },
        ],
        timeout_secs: INFERENCE_TIMEOUT_SECS,
      },
    );
  } catch (err) {
    // The platform's failure carries no sub-code; name what was
    // actually sent (post-shrink dimensions + payload size) so
    // the next diagnosis starts from facts, not guesses.
    const base = err instanceof Error ? err.message : String(err);
    const dimsText =
      sentWidth != null && sentHeight != null
        ? `${sentWidth}×${sentHeight}`
        : "尺寸未知";
    const bytesText =
      file.sizeBytes >= 1024 * 1024
        ? `${(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`;
    throw new Error(`${base}（本次发送图片 ${dimsText}，${bytesText}）`);
  }
  await attachResultNode(db, node, {
    type: "text",
    mediaBlobKey: null,
    mimeType: null,
    filePath: null,
    title: `${image.title || "图片"} · ${modeSpec.label}`,
    content: result.text,
    prompt: result.text,
  });
  return { status: "done", error: null };
}

export async function runToolDispatch(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  options: ToolRunOptions = {},
): Promise<GenDispatch> {
  const project = await getProjectRow(db, node.projectId);
  if (!project) return toolFail(db, node.id, "项目不存在");
  const inputs = await collectInputs(db, node);
  const outDir = expandHome(project.workspaceDir);
  const tag = node.id.slice(0, 8);
  try {
    if (node.type === "video-frames" || node.type === "audio-extract") {
      return runFramesExtractTool(ctx, db, node, project, inputs, options, outDir, tag);
    }
    if (node.type === "video-compose") {
      return runVideoComposeTool(ctx, db, node, project, inputs, options, outDir, tag);
    }
    if (node.type === "prompt-reverse") {
      return runPromptReverseTool(ctx, db, node, project, inputs, options, outDir, tag);
    }
    return toolFail(db, node.id, "不是工具节点");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolFail(db, node.id, message);
  }
}
