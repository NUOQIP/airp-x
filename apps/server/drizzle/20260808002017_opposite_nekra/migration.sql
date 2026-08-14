CREATE TABLE `regex_rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`pattern` text NOT NULL,
	`replacement` text NOT NULL,
	`flags` text DEFAULT 'g' NOT NULL,
	`field` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_macros` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`scope` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_regex_rules_enabled_order` ON `regex_rules` (`enabled`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_macros_name_scope` ON `user_macros` (`name`,`scope`);