import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
};

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const roleCards = sqliteTable("role_cards", {
  id: text("id").primaryKey(),
  role: text("role", { enum: ["player", "heroine"] }).notNull(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1"),
  rawText: text("raw_text").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  ...timestamps
}, (table) => [
  index("idx_role_cards_role_active").on(table.role, table.active)
]);

export const promptBlocks = sqliteTable("prompt_blocks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull(),
  injectionPosition: text("injection_position", { enum: ["relative", "in_chat"] }).notNull().default("relative"),
  injectionDepth: integer("injection_depth").notNull().default(0),
  protected: integer("protected", { mode: "boolean" }).notNull().default(false),
  ...timestamps
}, (table) => [
  uniqueIndex("idx_prompt_blocks_order").on(table.sortOrder)
]);

export const worldbooks = sqliteTable("worldbooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope", { enum: ["global", "player", "heroine", "session"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  tokenBudgetPercent: integer("token_budget_percent").notNull().default(25),
  ...timestamps
});

export const worldbookEntries = sqliteTable("worldbook_entries", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => worldbooks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  constant: integer("constant", { mode: "boolean" }).notNull().default(false),
  primaryKeysJson: text("primary_keys_json").notNull().default("[]"),
  secondaryKeysJson: text("secondary_keys_json").notNull().default("[]"),
  secondaryLogic: text("secondary_logic", { enum: ["and_any", "and_all", "not_any", "not_all"] }).notNull().default("and_any"),
  scanDepth: integer("scan_depth").notNull().default(2),
  recursive: integer("recursive", { mode: "boolean" }).notNull().default(false),
  probability: integer("probability").notNull().default(100),
  ignoreBudget: integer("ignore_budget", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(100),
  caseSensitive: integer("case_sensitive", { mode: "boolean" }).notNull().default(false),
  wholeWord: integer("whole_word", { mode: "boolean" }).notNull().default(false),
  role: text("role", { enum: ["system", "user", "assistant"] }).notNull().default("system"),
  position: text("position", { enum: ["before_cards", "after_cards", "before_history", "after_history", "author_note_top", "author_note_bottom", "at_depth"] }).notNull().default("after_cards"),
  injectionDepth: integer("injection_depth").notNull().default(0),
  ...timestamps
}, (table) => [
  index("idx_worldbook_entries_book_order").on(table.bookId, table.sortOrder)
]);

export const rulePresets = sqliteTable("rule_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rawText: text("raw_text").notNull(),
  minProfileChanges: integer("min_profile_changes").notNull().default(3),
  minPanels: integer("min_panels").notNull().default(3),
  maxPanels: integer("max_panels").notNull().default(5),
  representativeComments: integer("representative_comments").notNull().default(15),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  activeBranchId: text("active_branch_id").notNull(),
  ...timestamps
});

export const branches = sqliteTable("branches", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentBranchId: text("parent_branch_id"),
  forkedFromTurnId: text("forked_from_turn_id"),
  currentSnapshotJson: text("current_snapshot_json").notNull(),
  rollingSummary: text("rolling_summary").notNull().default(""),
  pendingActionsJson: text("pending_actions_json").notNull().default("[]"),
  ...timestamps
}, (table) => [
  index("idx_branches_session_updated").on(table.sessionId, table.updatedAt)
]);

export const turns = sqliteTable("turns", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  status: text("status", { enum: ["pending", "complete", "failed"] }).notNull(),
  inputKind: text("input_kind", { enum: ["comment", "dm", "group", "seed"] }).notNull(),
  inputTargetId: text("input_target_id").notNull(),
  inputParentId: text("input_parent_id"),
  inputText: text("input_text").notNull(),
  inputRecordId: text("input_record_id").notNull(),
  baseSnapshotJson: text("base_snapshot_json").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  uniqueIndex("idx_turns_branch_sequence").on(table.branchId, table.sequence),
  index("idx_turns_branch_created").on(table.branchId, table.createdAt)
]);

export const turnCandidates = sqliteTable("turn_candidates", {
  id: text("id").primaryKey(),
  turnId: text("turn_id").notNull().references(() => turns.id, { onDelete: "cascade" }),
  outputJson: text("output_json").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  summaryText: text("summary_text").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull()
}, (table) => [
  index("idx_candidates_turn_created").on(table.turnId, table.createdAt)
]);

export const checkpoints = sqliteTable("checkpoints", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  turnId: text("turn_id"),
  sequence: integer("sequence").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  summaryText: text("summary_text").notNull().default(""),
  createdAt: text("created_at").notNull()
}, (table) => [
  uniqueIndex("idx_checkpoints_branch_sequence").on(table.branchId, table.sequence)
]);

export const localActions = sqliteTable("local_actions", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").notNull().references(() => branches.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  targetId: text("target_id").notNull(),
  valueJson: text("value_json").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull()
}, (table) => [
  index("idx_local_actions_branch_consumed").on(table.branchId, table.consumedAt)
]);

export const userMacros = sqliteTable("user_macros", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  value: text("value").notNull(),
  scope: text("scope", { enum: ["global", "player", "heroine", "session"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps
}, (table) => [
  uniqueIndex("idx_user_macros_name_scope").on(table.name, table.scope)
]);

export const regexRules = sqliteTable("regex_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  pattern: text("pattern").notNull(),
  replacement: text("replacement").notNull(),
  flags: text("flags").notNull().default("g"),
  field: text("field", { enum: ["account_text", "post_text", "comment_text", "message_text", "profile_text", "media_text", "live_text", "notice_text"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull(),
  ...timestamps
}, (table) => [
  index("idx_regex_rules_enabled_order").on(table.enabled, table.sortOrder)
]);
