ALTER TABLE `projects` ADD COLUMN `chat_status` text DEFAULT 'unbound' NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `chat_id` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `chat_title` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `chat_error` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `chat_requested_at` integer;
