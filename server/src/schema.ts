// Drizzle schema for YoYo画布 — this space's own tables, fully isolated from
// the old canvas space (wu-xian-hua-bu). Projects hold a node graph; assets
// and prompts are this space's own server-side libraries for the side panel.

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // The project's own working directory on disk (absolute path under
  // ~/workspace/yoyo-canvas-projects). Deliberately NOT under
  // ~/workspace/canvas-projects — that tree belongs to the old canvas.
  workspaceDir: text("workspace_dir").notNull().default(""),
  viewportX: real("viewport_x").notNull().default(0),
  viewportY: real("viewport_y").notNull().default(0),
  viewportZoom: real("viewport_zoom").notNull().default(1),
  // ---- project chat binding (four-state machine, ported from the old
  // canvas's proven semantics; the chat window itself is created by an
  // external sentinel watching the project directory, never in-page) ----
  // unbound: no chat requested. creating: a request is outstanding —
  // chatRequestedAt is its clock; processQueue fails requests older
  // than 10 minutes so they become retryable. bound: chatId/chatTitle
  // filled by bindProjectChat. failed: chatError holds the reason.
  chatStatus: text("chat_status", {
    enum: ["unbound", "creating", "bound", "failed"],
  })
    .notNull()
    .default("unbound"),
  chatId: text("chat_id"),
  chatTitle: text("chat_title"),
  chatError: text("chat_error"),
  chatRequestedAt: integer("chat_requested_at", { mode: "timestamp_ms" }),
  // Per-project node numbering counter: the highest sequence number
  // ever issued in this project. Only ever increases — a deleted
  // node's number is never reissued (see canvas_nodes.seq).
  nodeSeqCounter: integer("node_seq_counter").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const canvasNodes = sqliteTable("canvas_nodes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  // Per-project birth number of the node (1-based), assigned by the
  // server exactly once when the node is first created and never
  // changed or reused afterwards. NULL for nodes that predate the
  // numbering feature — legacy nodes are deliberately NOT backfilled.
  seq: integer("seq"),
  type: text("type", {
    enum: [
      "image",
      "video",
      "text",
      "audio",
      "config",
      "group",
      "video-frames",
      "audio-extract",
      "video-compose",
      "prompt-reverse",
      "sticky-note",
    ],
  }).notNull(),
  title: text("title").notNull(),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  width: real("width").notNull().default(240),
  height: real("height").notNull().default(160),
  content: text("content").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  status: text("status", {
    enum: ["idle", "loading", "success", "error"],
  })
    .notNull()
    .default("idle"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  groupId: text("group_id"),
  color: text("color"),
  // ---- hover-toolbar state (client-writable, persisted via saveGraph) ----
  // freeResize: the image toolbar's 自由尺寸 toggle — when true the node
  // may be resized non-proportionally; when false an image node keeps
  // its aspect ratio while resizing. fontSize: text nodes' display size
  // in px (null = default), adjusted by the toolbar's 字号 ± buttons.
  freeResize: integer("free_resize", { mode: "boolean" })
    .notNull()
    .default(false),
  fontSize: real("font_size"),
  // ---- generation core (server-owned except ratio/duration/mode) ----
  // genStartedAt is stamped server-side when a run enters "working" and
  // cleared on done/failed; saveGraph never writes it, so it is a
  // trustworthy run clock for the queue's orphan sweep. genSize is the
  // MEASURED pixel size of the delivered media file, probed from the
  // real file at delivery/mirror time — never copied from the request.
  genStatus: text("gen_status", {
    enum: ["idle", "queued", "working", "done", "failed"],
  })
    .notNull()
    .default("idle"),
  genError: text("gen_error"),
  genStartedAt: integer("gen_started_at", { mode: "timestamp_ms" }),
  genRatio: text("gen_ratio"),
  genSize: text("gen_size"),
  genDuration: integer("gen_duration"),
  genKind: text("gen_kind", { enum: ["image", "video", "audio", "text", "tool"] }),
  genMode: text("gen_mode", { enum: ["image", "text", "video", "audio"] }),
  genClaimToken: text("gen_claim_token"),
  genTaskId: text("gen_task_id"),
  mediaBlobKey: text("media_blob_key"),
  mimeType: text("mime_type"),
  filePath: text("file_path"),
  posterBlobKey: text("poster_blob_key"),
  // Playback proxy (V1): a lightweight H.264 MP4 transcode of a video
  // node's original file, produced best-effort by makePlaybackProxy
  // purely so in-app WebView playback stays smooth. The original file
  // (mediaBlobKey / filePath) is never touched; downloads and every
  // processing entry point keep using it. Null until a proxy exists.
  proxyBlobKey: text("proxy_blob_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const canvasEdges = sqliteTable("canvas_edges", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fromNodeId: text("from_node_id").notNull(),
  toNodeId: text("to_node_id").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  // Owning project: assets are NOT shared across projects. Every
  // creation path stamps the project it was produced in, listAssets
  // filters on it, and every by-id operation verifies it. Nullable
  // only so the 0009 migration can add the column before backfilling
  // the pre-isolation rows; new rows always carry a project.
  projectId: text("project_id"),
  kind: text("kind", {
    enum: [
      "image",
      "video",
      "text",
      "audio",
      "config",
      "group",
      "video-frames",
      "audio-extract",
      "video-compose",
      "prompt-reverse",
      "sticky-note",
    ],
  }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  color: text("color"),
  // JSON-encoded string array of tag labels.
  tags: text("tags").notNull().default("[]"),
  sourceNodeId: text("source_node_id"),
  // ---- media payload (generated results + direct uploads) ----
  // Media assets (kind image/video/audio) carry their real bytes as a
  // blob, exactly like canvas nodes do; text/config assets leave these
  // null and live in content/prompt alone. filePath points at the copy
  // inside the originating project's working directory when one exists
  // (null for library uploads, which have no project).
  mediaBlobKey: text("media_blob_key"),
  mimeType: text("mime_type"),
  filePath: text("file_path"),
  posterBlobKey: text("poster_blob_key"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Persistent per-run generation history. One row per generation /
// tool run, written exactly once when the run reaches a terminal
// state (done / failed / stopped / cancelled) by the shared
// recordGenerationOutcome helper. The row is a SNAPSHOT: node title,
// seq, prompt, ratio, measured size and the media pointers are copied
// at settle time, and nodeId / resultNodeId are plain text with no
// foreign key — re-generating over a node or deleting it afterwards
// never touches its history. Idempotency key is (nodeId, startedAt):
// one run settles once, so a second write for the same run is a no-op.
export const generationRecords = sqliteTable("generation_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  // The node that ran. Plain text, deliberately NOT a foreign key:
  // the record must survive the node's deletion.
  nodeId: text("node_id").notNull(),
  // The node that ended up carrying the result (the running node
  // itself for in-place fills, the fresh result node for fan-out
  // runs); null for failed / stopped / cancelled runs.
  resultNodeId: text("result_node_id"),
  nodeSeq: integer("node_seq"),
  nodeTitle: text("node_title").notNull().default(""),
  nodeType: text("node_type", {
    enum: [
      "image",
      "video",
      "text",
      "audio",
      "config",
      "group",
      "video-frames",
      "audio-extract",
      "video-compose",
      "prompt-reverse",
      "sticky-note",
    ],
  }).notNull(),
  genKind: text("gen_kind", {
    enum: ["image", "video", "audio", "text", "tool"],
  }),
  prompt: text("prompt").notNull().default(""),
  genRatio: text("gen_ratio"),
  // Measured pixel size of the delivered file (same provenance rule
  // as canvas_nodes.genSize: probed from the real file, never the
  // request). Null when the run produced no measured media.
  genSize: text("gen_size"),
  genDuration: integer("gen_duration"),
  mediaBlobKey: text("media_blob_key"),
  mimeType: text("mime_type"),
  filePath: text("file_path"),
  status: text("status", {
    enum: ["done", "failed", "stopped", "cancelled"],
  }).notNull(),
  error: text("error"),
  // When the run started: the node's genStartedAt for a claimed /
  // dispatched run; for a run cancelled while still queued (never
  // claimed, genStartedAt still null) the enqueue time is used.
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
