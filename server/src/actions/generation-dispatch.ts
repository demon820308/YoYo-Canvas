// generation-dispatch.ts — 生成分发主路径：图片/视频/音频的
// spawn/dispatch、配置节点分发与 dispatchGeneration 路由。队列扫尾
// 在 queue-sweep.ts、工具节点执行在 tool-dispatch.ts（批次 S2 分拆，
// 行为不变）。

import { z, type Ctx } from "@hatch/space-sdk";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import { type Db, type NodeRow } from "./contracts";
import { buildGenerationContext, type GenResource } from "./generation-context";
import { getNodeRow, getProjectRow, attachResultNode, landMediaResult, recordMediaAsset, markFailed } from "./graph-helpers";
import { expandHome } from "./project-dirs";
import { normalizeImageRatio, DIRECT_IMAGE_RATIOS, orientationForRatio, clampVideoSeconds, sizeBrief } from "./ratios";
import { mirrorNodeMedia } from "./queue-sweep";

// ---------------------------------------------------------------------------
// Dispatch: the single paths every entry point (generate buttons, queue
// consumer, config runs) funnels through. The node must already be
// marked "working" by the caller.
// ---------------------------------------------------------------------------

export type GenDispatch = { status: "done" | "working" | "failed"; error: string | null };

/** A node's own prompt text: its prompt field, falling back to its
 * content, trimmed. The title is deliberately NOT a fallback — it is
 * a display name (e.g. 「生视频」), and sending it as the prompt is
 * exactly what failed yoyo-02 #15 on 2026-11-15. Whether a run may
 * proceed is decided on the ASSEMBLED prompt (own prompt plus any
 * connected text, via buildGenerationContext): an empty assembled
 * prompt fails on the node with EMPTY_PROMPT_MESSAGE and never
 * reaches a generation call or a spawned task. */
function nodeOwnPrompt(node: NodeRow): string {
  return (node.prompt || node.content).trim();
}

const EMPTY_PROMPT_MESSAGE =
  "提示词为空：节点自身没有提示词，也没有连入任何文本内容";

export const INFERENCE_TIMEOUT_SECS = 120;



/** Image generation — the channel every canvas entry point uses:
 * spawn a background task that generates the image (using the
 * connected reference files when there are any), saves it into the
 * project directory, and delivers through completeImageGeneration.
 * The brief carries the normalized ratio's exact pixel size via
 * sizeBrief, so all eight tiers come out at their labeled dimensions
 * whether or not references are connected. */
async function spawnImageGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  prompt: string,
  refs: GenResource[],
): Promise<GenDispatch> {
  const project = await getProjectRow(db, node.projectId);
  const missing = refs.filter((r) => !r.filePath);
  if (missing.length > 0) {
    const message = `有 ${missing.length} 张参考图还没同步进项目目录，暂时无法带参考生成；打开画布稍等同步完成后再试`;
    await markFailed(db, node.id, message);
    return { status: "failed", error: message };
  }
  const refLines = refs
    .map((r, i) => `参考图 ${i + 1}（${r.title || "未命名"}）：${r.filePath}`)
    .join("\n");
  const message = [
    `任务：为YoYo画布的一个节点生成一张图片，并把成片文件路径通过 completeImageGeneration 动作回传（runtime 会注入调用该动作的说明）。`,
    `nodeId（原样回传，不要改动）：${node.id}`,
    `生成要求：${prompt}`,
    sizeBrief("image", node),
    refLines
      ? `必须使用下面这些本地图片文件作为参考图（人物长相/造型/构图以参考图为准，把它们作为生成工具的参考图输入，不要只看文字描述）：\n${refLines}`
      : ``,
    project
      ? `项目工作目录（本项目专属，生成图必须保存到这个目录里，文件名自定）：${expandHome(project.workspaceDir)}`
      : `图片保存到 ~/workspace/yoyo-canvas-projects 下任意合适位置。`,
    `要求：只生成这一张图片；拿到图片文件的本地路径后调用回传动作，filePath 传绝对路径，title 传「${node.title ? `${node.title} · 生成图` : "生成图片"}」。如果生成失败，调用 failGeneration，nodeId 同上，error 写清失败原因。`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const spawned = await ctx.agent.spawnTask(message, {
    expectsAction: "completeImageGeneration",
    dedupeKey: `yoyo-image-gen-${node.id}`,
  });
  if (!spawned.ok) {
    await markFailed(db, node.id, spawned.error);
    return { status: "failed", error: spawned.error };
  }
  await db
    .update(schema.canvasNodes)
    .set({
      genStatus: "working",
      genKind: "image",
      genError: null,
      genRatio: normalizeImageRatio(node.genRatio),
      genTaskId: spawned.taskId,
      genStartedAt: new Date(),
      status: "loading",
      updatedAt: new Date(),
    })
    .where(eq(schema.canvasNodes.id, node.id));
  return { status: "working", error: null };
}

/** The image-generation dispatch every canvas entry point uses
 * (image placeholder nodes, config hubs in image mode, the text
 * node's 生成图片 entry, the queue consumer). Routing by ratio and
 * references:
 *  - A run whose normalized ratio is one of the direct channel's
 *    three tiers (16:9 / 9:16 / 1:1) AND which has no connected
 *    reference media (reference images or videos) takes the
 *    in-action direct channel (generateImageInAction): synchronous,
 *    fills in place. For those three tiers the direct channel's
 *    delivered size IS the tier's labeled size (batch F
 *    measurements), so nothing is lost by skipping the task.
 *  - Everything else — the other five ratios, or any run with
 *    reference media connected (the direct channel cannot consume
 *    reference files, no exceptions) — goes through the background
 *    task channel (spawnImageGeneration), whose brief carries the
 *    exact pixel size of the node's normalized ratio.
 * The empty-prompt failure is decided on the assembled prompt
 * before any routing, exactly as before. */
export async function dispatchImageGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const rawPrompt = nodeOwnPrompt(node);
  const context = await buildGenerationContext(db, node, rawPrompt);
  if (!context.prompt) {
    await markFailed(db, node.id, EMPTY_PROMPT_MESSAGE);
    return { status: "failed", error: EMPTY_PROMPT_MESSAGE };
  }
  const ratio = normalizeImageRatio(node.genRatio);
  const hasReferenceMedia = context.refs.some(
    (r) => r.type === "image" || r.type === "video",
  );
  if (DIRECT_IMAGE_RATIOS.includes(ratio) && !hasReferenceMedia) {
    return generateImageInAction(ctx, db, node);
  }
  return spawnImageGeneration(ctx, db, node, context.prompt, context.imageRefs);
}

/** The in-action direct image channel: the direct engine
 * dispatchImageGeneration routes to whenever an image run's
 * normalized ratio is one of the three tiers this channel delivers
 * exactly (16:9 / 9:16 / 1:1) and no reference media is connected.
 * Generates synchronously through ctx.tool.generate_media from the
 * node's assembled prompt: the node's own prompt plus any connected
 * TEXT nodes' content, exactly like the task channel assembles
 * theirs. Connected media is never consumed as a reference — this
 * channel is text-to-image only, which is precisely why runs with
 * reference media never route here. The result lands on the
 * generating node in place (a config hub keeps its fan-out result
 * node), its file is mirrored into the project directory in the
 * same run (genSize probed from the real file there), and it is
 * recorded in the asset library as an image. generate_media's only
 * structured size input is a coarse orientation; for the three
 * routed tiers the orientation IS the exact delivered size —
 * landscape 2048x1152, portrait 1152x2048, square 1600x1600 — the
 * same sizes sizeBrief names from IMAGE_RATIO_SIZES. The actions
 * that reach this function declare the mirrorBlobToFile and
 * probeMediaFile privileged contracts its in-run mirror uses. */
export async function generateImageInAction(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const rawPrompt = nodeOwnPrompt(node);
  const context = await buildGenerationContext(db, node, rawPrompt);
  if (!context.prompt) {
    await markFailed(db, node.id, EMPTY_PROMPT_MESSAGE);
    return { status: "failed", error: EMPTY_PROMPT_MESSAGE };
  }
  const ratio = normalizeImageRatio(node.genRatio);
  await db
    .update(schema.canvasNodes)
    .set({ genRatio: ratio, updatedAt: new Date() })
    .where(eq(schema.canvasNodes.id, node.id));
  const sizedNode = { ...node, genRatio: ratio };
  try {
    // The ratio here is always one of the channel's three tiers,
    // and for those tiers the orientation IS the exact size:
    // landscape delivers 2048x1152, portrait 1152x2048, square
    // 1600x1600 — the same sizes sizeBrief names from
    // IMAGE_RATIO_SIZES, so the brief and the structured input
    // agree instead of the brief promising pixels the channel
    // cannot produce.
    const generated = await ctx.tool.generate_media(
      `${context.prompt}\n${sizeBrief("image", sizedNode)}`,
      { orientation: orientationForRatio(ratio) },
    );
    const assetTitle = node.title ? `${node.title} · 生成图` : "生成图片";
    const landedId = await landMediaResult(db, sizedNode, {
      id: crypto.randomUUID(),
      type: "image",
      mediaBlobKey: generated.blobKey,
      mimeType: generated.contentType,
      filePath: null,
      title: assetTitle,
      content: "",
      prompt: context.prompt,
    });
    // Land the file in the project directory in this same run,
    // server-side: the node carrying the result leaves with filePath
    // set and genSize measured, so it can feed reference generation
    // and the result-delivery chain with no page open. The copy is
    // retried a few times in-run; if it still fails the node keeps
    // its blob and processQueue's mirror sweep retries on its next
    // run (the generation itself succeeded either way, so the run
    // still reports done).
    const landedRow = await getNodeRow(db, landedId);
    if (landedRow) {
      await mirrorNodeMedia(ctx, db, landedRow, 3);
      const finalRow = (await getNodeRow(db, landedId)) ?? landedRow;
      await recordMediaAsset(db, finalRow, {
        title: assetTitle,
        prompt: context.prompt,
      });
    }
    return { status: "done", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(db, node.id, message);
    return { status: "failed", error: message };
  }
}

/** The single video-generation path: always a background task;
 * connected reference images are passed as files and the requested
 * duration is included. */
export async function dispatchVideoGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const rawPrompt = nodeOwnPrompt(node);
  const context = await buildGenerationContext(db, node, rawPrompt);
  if (!context.prompt) {
    await markFailed(db, node.id, EMPTY_PROMPT_MESSAGE);
    return { status: "failed", error: EMPTY_PROMPT_MESSAGE };
  }
  const project = await getProjectRow(db, node.projectId);
  const usableRefs = context.imageRefs.filter((r) => r.filePath);
  const missingCount = context.imageRefs.length - usableRefs.length;
  const refLines = usableRefs
    .map((r, i) => `参考图 ${i + 1}（${r.title || "未命名"}）：${r.filePath}`)
    .join("\n");
  const duration = clampVideoSeconds(node.genDuration);
  const message = [
    `任务：为YoYo画布的一个节点生成一段视频，并把成片文件路径通过 completeVideoGeneration 动作回传（runtime 会注入调用该动作的说明）。`,
    `nodeId（原样回传，不要改动）：${node.id}`,
    `视频提示词：${context.prompt}`,
    sizeBrief("video", node),
    `目标时长：约 ${duration} 秒`,
    refLines
      ? `必须使用下面这些本地图片文件作为参考图（人物长相/造型以参考图为准，把它们作为生成工具的参考图输入）：\n${refLines}`
      : ``,
    missingCount > 0
      ? `注意：另有 ${missingCount} 张连入的参考图尚未同步进项目目录，本次无法使用，已跳过。`
      : ``,
    project
      ? `项目工作目录（本项目专属，成片必须保存到这个目录里，文件名自定）：${expandHome(project.workspaceDir)}`
      : `成片保存到 ~/workspace/yoyo-canvas-projects 下任意合适位置。`,
    `要求：只生成这一段视频；拿到成片的本地文件路径后调用回传动作，filePath 传成片的绝对路径，title 传「${node.title ? `${node.title} · 生成视频` : "生成视频"}」。如果生成失败，调用 failGeneration，nodeId 同上，error 写清失败原因。`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const spawned = await ctx.agent.spawnTask(message, {
    expectsAction: "completeVideoGeneration",
    dedupeKey: `yoyo-video-gen-${node.id}`,
  });
  if (!spawned.ok) {
    await markFailed(db, node.id, spawned.error);
    return { status: "failed", error: spawned.error };
  }
  await db
    .update(schema.canvasNodes)
    .set({
      genStatus: "working",
      genKind: "video",
      genError: null,
      genDuration: duration,
      genTaskId: spawned.taskId,
      genStartedAt: new Date(),
      status: "loading",
      updatedAt: new Date(),
    })
    .where(eq(schema.canvasNodes.id, node.id));
  return { status: "working", error: null };
}

/** Audio generation: always a background task delivering through
 * completeAudioGeneration (used by audio nodes and config audio mode). */
export async function dispatchAudioGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const rawPrompt = nodeOwnPrompt(node);
  const context = await buildGenerationContext(db, node, rawPrompt);
  if (!context.prompt) {
    await markFailed(db, node.id, EMPTY_PROMPT_MESSAGE);
    return { status: "failed", error: EMPTY_PROMPT_MESSAGE };
  }
  const project = await getProjectRow(db, node.projectId);
  const refLines = context.refs
    .filter((r) => r.filePath)
    .map(
      (r) =>
        `参考${r.type === "audio" ? "音频" : r.type === "video" ? "视频" : "图片"}（${r.title || "未命名"}）：${r.filePath}`,
    )
    .join("\n");
  const message = [
    `任务：为YoYo画布的一个节点生成一段音频，并把音频文件路径通过 completeAudioGeneration 动作回传（runtime 会注入调用该动作的说明）。`,
    `nodeId（原样回传，不要改动）：${node.id}`,
    `音频内容要求：${context.prompt}`,
    refLines ? `可参考下面这些本地文件：\n${refLines}` : ``,
    project
      ? `项目工作目录（本项目专属，音频文件必须保存到这个目录里，文件名自定）：${expandHome(project.workspaceDir)}`
      : `音频保存到 ~/workspace/yoyo-canvas-projects 下任意合适位置。`,
    `要求：只生成这一段音频；拿到音频文件的本地路径后调用回传动作，filePath 传绝对路径，title 传「${node.title ? `${node.title} · 生成音频` : "生成音频"}」。如果生成失败，调用 failGeneration，nodeId 同上，error 写清失败原因。`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const spawned = await ctx.agent.spawnTask(message, {
    expectsAction: "completeAudioGeneration",
    dedupeKey: `yoyo-audio-gen-${node.id}`,
  });
  if (!spawned.ok) {
    await markFailed(db, node.id, spawned.error);
    return { status: "failed", error: spawned.error };
  }
  await db
    .update(schema.canvasNodes)
    .set({
      genStatus: "working",
      genKind: "audio",
      genError: null,
      genTaskId: spawned.taskId,
      genStartedAt: new Date(),
      status: "loading",
      updatedAt: new Date(),
    })
    .where(eq(schema.canvasNodes.id, node.id));
  return { status: "working", error: null };
}

/** Config node, text mode: the gathered context goes to inference and
 * the result lands as a text node beside the config node. */
async function dispatchConfigText(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const rawPrompt = nodeOwnPrompt(node);
  const context = await buildGenerationContext(db, node, rawPrompt);
  if (!context.prompt) {
    const message = "请先在配置节点里填写提示词，或连入文字节点";
    await markFailed(db, node.id, message);
    return { status: "failed", error: message };
  }
  try {
    const result = await ctx.inference.complete(
      [
        `任务要求：${context.prompt}`,
        `只输出正文，不要解释你的写作过程。`,
      ].join("\n\n"),
      {
        schema: z.object({ text: z.string().min(1).max(20000) }),
        system: "你是一位文字创作者，按用户的要求直接产出可用的文字成品。",
        timeout_secs: INFERENCE_TIMEOUT_SECS,
      },
    );
    await attachResultNode(db, node, {
      type: "text",
      mediaBlobKey: null,
      mimeType: null,
      filePath: null,
      title: node.title ? `${node.title} · 文本` : "生成文本",
      content: result.text,
      prompt: result.text,
    });
    return { status: "done", error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(db, node.id, message);
    return { status: "failed", error: message };
  }
}

/** The config node's dispatch: mode comes from genMode
 * ("image" | "text" | "video" | "audio", default image). */
export async function dispatchConfigGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
): Promise<GenDispatch> {
  const mode = node.genMode ?? "image";
  if (mode === "text") return dispatchConfigText(ctx, db, node);
  if (mode === "audio") return dispatchAudioGeneration(ctx, db, node);
  if (mode === "video") return dispatchVideoGeneration(ctx, db, node);
  return dispatchImageGeneration(ctx, db, node);
}

export async function dispatchGeneration(
  ctx: Ctx,
  db: Db,
  node: NodeRow,
  kind: "image" | "video" | "audio" | "text",
): Promise<GenDispatch> {
  if (kind === "video") return dispatchVideoGeneration(ctx, db, node);
  if (kind === "audio") return dispatchAudioGeneration(ctx, db, node);
  if (kind === "text") return dispatchConfigText(ctx, db, node);
  return dispatchImageGeneration(ctx, db, node);
}

/** The generation kind a queued node will run with: config nodes use
 * their mode; other nodes use their own type (falling back to image). */
export function queueKindFor(node: NodeRow): "image" | "video" | "audio" | "text" {
  if (node.type === "config") return node.genMode ?? "image";
  if (node.type === "video") return "video";
  if (node.type === "audio") return "audio";
  if (node.type === "text") return "text";
  return "image";
}
