ALTER TABLE `turns` ADD `input_segments_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `input_record_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `director_instruction` text;