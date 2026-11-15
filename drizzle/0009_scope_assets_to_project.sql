ALTER TABLE `assets` ADD COLUMN `project_id` text;
--> statement-breakpoint
UPDATE `assets`
SET `project_id` = (
  SELECT `project_id` FROM `canvas_nodes` WHERE `canvas_nodes`.`id` = `assets`.`source_node_id`
)
WHERE `project_id` IS NULL
  AND `source_node_id` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `canvas_nodes` WHERE `canvas_nodes`.`id` = `assets`.`source_node_id`
  );
--> statement-breakpoint
UPDATE `assets`
SET `project_id` = (
  SELECT `id` FROM `projects`
  WHERE `projects`.`workspace_dir` <> ''
    AND substr(`assets`.`file_path`, 1, length(`projects`.`workspace_dir`)) = `projects`.`workspace_dir`
  LIMIT 1
)
WHERE `project_id` IS NULL
  AND `file_path` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `projects`
    WHERE `projects`.`workspace_dir` <> ''
      AND substr(`assets`.`file_path`, 1, length(`projects`.`workspace_dir`)) = `projects`.`workspace_dir`
  );
--> statement-breakpoint
UPDATE `assets`
SET `project_id` = '4e3de610-521a-448a-9c60-013d0c66c130'
WHERE `project_id` IS NULL;
