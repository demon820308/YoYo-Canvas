ALTER TABLE `projects` ADD COLUMN `node_seq_counter` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `canvas_nodes` ADD COLUMN `seq` integer;
