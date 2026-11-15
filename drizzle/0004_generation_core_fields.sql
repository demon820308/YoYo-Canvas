ALTER TABLE projects ADD COLUMN workspace_dir TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_status TEXT NOT NULL DEFAULT 'idle';
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_error TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_started_at INTEGER;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_ratio TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_size TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_duration INTEGER;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_kind TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_mode TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_claim_token TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN gen_task_id TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN media_blob_key TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN mime_type TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN file_path TEXT;
--> statement-breakpoint
ALTER TABLE canvas_nodes ADD COLUMN poster_blob_key TEXT;
