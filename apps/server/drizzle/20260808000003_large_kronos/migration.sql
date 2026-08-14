CREATE TABLE `branches` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`parent_branch_id` text,
	`forked_from_turn_id` text,
	`current_snapshot_json` text NOT NULL,
	`rolling_summary` text DEFAULT '' NOT NULL,
	`pending_actions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_branches_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY,
	`branch_id` text NOT NULL,
	`turn_id` text,
	`sequence` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`summary_text` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_checkpoints_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `local_actions` (
	`id` text PRIMARY KEY,
	`branch_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`value_json` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_local_actions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `prompt_blocks` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`injection_position` text DEFAULT 'relative' NOT NULL,
	`injection_depth` integer DEFAULT 0 NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_cards` (
	`id` text PRIMARY KEY,
	`role` text NOT NULL,
	`name` text NOT NULL,
	`version` text DEFAULT '1' NOT NULL,
	`raw_text` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_presets` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`raw_text` text NOT NULL,
	`min_profile_changes` integer DEFAULT 3 NOT NULL,
	`min_panels` integer DEFAULT 3 NOT NULL,
	`max_panels` integer DEFAULT 5 NOT NULL,
	`representative_comments` integer DEFAULT 15 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`active_branch_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `turn_candidates` (
	`id` text PRIMARY KEY,
	`turn_id` text NOT NULL,
	`output_json` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_turn_candidates_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY,
	`branch_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`input_kind` text NOT NULL,
	`input_target_id` text NOT NULL,
	`input_parent_id` text,
	`input_text` text NOT NULL,
	`input_record_id` text NOT NULL,
	`base_snapshot_json` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_turns_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `worldbook_entries` (
	`id` text PRIMARY KEY,
	`book_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`constant` integer DEFAULT false NOT NULL,
	`primary_keys_json` text DEFAULT '[]' NOT NULL,
	`secondary_keys_json` text DEFAULT '[]' NOT NULL,
	`secondary_logic` text DEFAULT 'and_any' NOT NULL,
	`scan_depth` integer DEFAULT 2 NOT NULL,
	`recursive` integer DEFAULT false NOT NULL,
	`probability` integer DEFAULT 100 NOT NULL,
	`ignore_budget` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`case_sensitive` integer DEFAULT false NOT NULL,
	`whole_word` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'system' NOT NULL,
	`position` text DEFAULT 'after_cards' NOT NULL,
	`injection_depth` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_worldbook_entries_book_id_worldbooks_id_fk` FOREIGN KEY (`book_id`) REFERENCES `worldbooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `worldbooks` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`token_budget_percent` integer DEFAULT 25 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_branches_session_updated` ON `branches` (`session_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_checkpoints_branch_sequence` ON `checkpoints` (`branch_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_local_actions_branch_consumed` ON `local_actions` (`branch_id`,`consumed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_prompt_blocks_order` ON `prompt_blocks` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_role_cards_role_active` ON `role_cards` (`role`,`active`);--> statement-breakpoint
CREATE INDEX `idx_candidates_turn_created` ON `turn_candidates` (`turn_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_turns_branch_sequence` ON `turns` (`branch_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_turns_branch_created` ON `turns` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_worldbook_entries_book_order` ON `worldbook_entries` (`book_id`,`sort_order`);