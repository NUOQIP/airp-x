import { parseDocument, stringify } from "yaml";
import { z } from "zod";

const AccountsSchema = z.object({
  heroine_private: z.object({ id: z.literal("account-heroine"), handle: z.literal("BBC_Married_MeatToilet"), is_private: z.literal(true) }).strict(),
  heroine_cover: z.object({ id: z.literal("account-heroine-cover"), handle: z.literal("Marin"), is_private: z.literal(false) }).strict(),
  player: z.object({ id: z.literal("account-player"), handle: z.literal("Master") }).strict()
}).strict();

const LegacyRuleYamlSchema = z.object({
  schema_version: z.literal(1),
  rule_name: z.string().min(1),
  accounts: AccountsSchema,
  hard_constraints: z.object({
    profile: z.object({ min_real_changes: z.number().int().min(0).max(100), require_profile_panel: z.boolean() }).strict(),
    render_plan: z.object({ min_panels: z.number().int().min(1).max(8), max_panels: z.number().int().min(1).max(8), require_strict_reveal_order: z.boolean(), require_valid_targets: z.boolean() }).strict(),
    posts: z.object({ representative_comments: z.number().int().min(0).max(100) }).strict(),
    live: z.object({ min_queue_items: z.number().int().min(0).max(500), max_queue_items: z.number().int().min(0).max(500), require_barrage: z.boolean() }).strict(),
    identity: z.object({ enforce_fixed_accounts: z.boolean() }).strict()
  }).strict(),
  original_rule: z.string()
}).strict();

const PermissionSchema = z.enum(["locked", "temporary", "computed", "append_only"]);
const PermissionListSchema = z.array(PermissionSchema).length(4).refine((values) => new Set(values).size === 4, "权限列表必须包含四种不同权限");

const RuleYamlSchema = z.object({
  schema_version: z.literal(2),
  rule_name: z.string().min(1),
  accounts: AccountsSchema,
  hard_constraints: z.object({
    profile: z.object({
      permission_types: PermissionListSchema,
      required_temporary_updates_each_turn: z.array(z.string().min(1)).min(3),
      allow_other_temporary_unchanged: z.boolean(),
      temporary_requires_canonical_source: z.boolean(),
      locked_ai_writable: z.literal(false),
      computed_ai_writable: z.literal(false),
      append_only_requires_append_event: z.boolean(),
      require_profile_panel: z.literal(false)
    }).strict(),
    canonical_sources: z.object({
      character_temporary: z.literal("mvu"),
      calculated_display: z.literal("derived"),
      platform_state: z.literal("platform"),
      history: z.literal("event_log"),
      dynamic_profile_values_are_cache_only: z.literal(true)
    }).strict(),
    cycle: z.object({
      length_days: z.literal(7),
      phase_days: z.object({ menstruation: z.literal(1), follicular: z.literal(2), ovulation: z.literal(1), luteal: z.literal(3) }).strict(),
      anchor_date_source: z.literal("mvu.heroine.cycle.anchorDate"),
      initial_phase: z.literal("ovulation"),
      pregnancy_state_transition_chain: z.tuple([z.literal("none"), z.literal("suspected"), z.literal("confirmed"), z.literal("ended"), z.literal("none")]),
      pregnancy_same_state_hold_allowed: z.literal(true),
      pregnancy_transition_skips_allowed: z.literal(false),
      pregnancy_duration_source: z.literal("ai_on_confirmation"),
      pregnancy_duration_locked_after_confirmation: z.literal(true),
      pause_cycle_when_pregnancy_confirmed: z.literal(true),
      new_cycle_anchor_required_on_ended: z.literal(true)
    }).strict(),
    statistics: z.object({
      initial_insemination_count: z.literal(0),
      initial_insemination_volume_ml: z.literal(0),
      volume_unit: z.literal("mL"),
      append_event: z.literal("statistics.insemination.append"),
      totals_are_computed: z.literal(true)
    }).strict(),
    platform: z.object({
      impact_input: z.literal("qualitative_only"),
      impact_numbers_are_computed: z.literal(true),
      trends_are_incremental: z.literal(true),
      trend_rank_and_volume_are_computed: z.literal(true),
      fan_goal_event: z.literal("fan.goal.upsert"),
      completed_fan_goals_locked: z.literal(true),
      switch_to_next_unreached_automatically: z.literal(true)
    }).strict(),
    content: z.object({
      existing_posts_immutable: z.literal(true),
      existing_comments_immutable: z.literal(true),
      new_posts_and_comments_append_only: z.literal(true)
    }).strict(),
    messages: z.object({
      speech_segments_are_character_visible: z.literal(true),
      director_instruction_is_hidden: z.literal(true),
      allow_director_only_turn: z.literal(true),
      director_instruction_excluded_from_history_scan_and_snapshot: z.literal(true)
    }).strict(),
    homepage: z.object({
      tabs: z.tuple([z.literal("posts"), z.literal("records")]),
      sidebar_home: z.tuple([z.literal("live_status"), z.literal("fan_plan"), z.literal("trends")]),
      sidebar_messages: z.tuple([z.literal("live_status"), z.literal("fan_plan"), z.literal("trends")]),
      remove_live_tab: z.literal(true),
      remove_about_tab: z.literal(true),
      remove_following_count: z.literal(true),
      remove_local_narrative_homepage_label: z.literal(true),
      usage_notice_in_bio: z.literal(true),
      usage_notice_separate_from_main_bio: z.literal(true),
      registry_in_records: z.literal(true),
      ai_extension_placement: z.literal("records"),
      ai_extension_initial_permissions: z.tuple([z.literal("temporary")]),
      ai_extension_history_permission: z.literal("append_only"),
      ai_timeline_requires_empty_section_then_append: z.literal(true),
      max_ai_extension_sections: z.literal(8),
      max_items_per_ai_extension: z.literal(12),
      fixed_live_status_allows_ai_temporary_items: z.literal(true),
      temporary_item_add_event: z.literal("profile.item.add"),
      temporary_item_remove_event: z.literal("profile.item.remove"),
      initial_content_removable_by_ai: z.literal(false),
      ai_temporary_content_removable_by_ai: z.literal(true)
    }).strict(),
    render_plan: z.object({ min_panels: z.number().int().min(0).max(8), max_panels: z.number().int().min(1).max(8), require_strict_reveal_order: z.boolean(), require_valid_targets: z.boolean(), only_changed_components: z.literal(true) }).strict(),
    posts: z.object({ representative_comments: z.number().int().min(0).max(100) }).strict(),
    live: z.object({ min_queue_items: z.number().int().min(0).max(500), max_queue_items: z.number().int().min(0).max(500), require_barrage: z.boolean() }).strict(),
    identity: z.object({ enforce_fixed_accounts: z.boolean() }).strict()
  }).strict(),
  original_rule: z.string()
}).strict();

export type ParsedRuleConfig = z.infer<typeof RuleYamlSchema>;

const V2_MARKER = "【主页权限与唯一数据源 v2】";
const V2_EXTENSION_MARKER = "【主页扩展事件补充 v2.1】";
const V2_PREGNANCY_MARKER = "【妊娠状态确认链 v2.2】";

function appendWithoutChangingPrefix(source: string, addition: string) {
  const separator = source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${separator}${addition}`;
}

export function upgradeOriginalRule(originalRule: string) {
  let result = originalRule;
  if (!result.includes(V2_MARKER)) {
    result = appendWithoutChangingPrefix(result, `  ${V2_MARKER}\n${[
      "  - 本段是当前网页状态协议；若本文更早的技术描述与本段冲突，以本段及 schema_version: 2 的 hard_constraints 为准。上方原始玩法文本完整保留。",
      "  - 权限只有 locked、temporary、computed、append_only。locked 仅禁止 AI 修改，玩家仍可通过受控编辑功能修改；computed 禁止 AI 写最终值；temporary 写唯一状态源；append_only 只走专用追加事件。",
      "  - 不再要求每轮至少三项主页变化，也不强制 profile panel。renderPlan 只包含本轮确实变化且可见的组件，不为凑数创建空事件。",
      "  - 每轮必须真实更新 heroine.status、heroine.outfit、heroine.mood。heroine.activity、heroine.location 及其他 temporary 仅在剧情变化时更新，可以保持原值；location 变化时使用与剧情相符、格式自然的真实地名，不虚构可核验的具体设施。",
      "  - 人物 temporary 的唯一来源是 MVU；简介、使用须知与登记档动态项分别使用 heroine.bio、heroine.usageNotice、heroine.profileFacts。computed 从 MVU、平台状态或事件流水计算。页面 item.value 只是渲染缓存，不得与唯一来源重复更新。",
      "  - profile.patch 只用于获准的结构操作、置顶或首次创建 AI 扩展卡。初始卡不可覆盖、改名、移动或删除；AI 扩展卡只能放在 records，最多 8 张且每张最多 12 项。",
      "  - 里程碑与扩展历史使用 profile.item.append。统计只使用 statistics.insemination.append 追加 occurredAt、count、volumeMl 和可选 note；基数为 0/0/0mL，总数由程序计算。粉丝目标使用 fan.goal.upsert；未完成目标可更新，已完成目标锁定，程序自动选择首个未达成目标。",
      "  - 生理周期为 7 个故事日：经期 1 日、卵泡期 2 日、排卵期 1 日、黄体期 3 日；anchorDate 初始锚定排卵期。妊娠状态由 AI 按剧情决定；confirmed 时 AI 一次性给出 durationDays，之后时长及锚点锁定并暂停普通周期；ended 时 AI 必须同时给出新的 cycle.anchorDate，然后恢复周期。",
      "  - AI 对 platform.impact 只提交定性 kind 与 scale，具体粉丝、曝光和互动由程序按账号体量与漏斗计算并去重。趋势使用 platform.trend.upsert/remove，AI 给稳定 id、名称和定性热度，程序计算排名和显示量。",
      "  - 已有贴文与评论正文不可覆盖；post.upsert/comment.upsert 只创建新 id。新内容指标由程序初始化，之后由平台影响与本地操作计算。",
      "  - speechSegments 是諾奇角色可见的多段真实发言，每段独立气泡；directorInstruction 是 Master 仅当轮可见的隐藏导演指令，不生成消息、不进入消息快照、角色历史或世界书扫描。允许仅导演指令的回合。",
      "  - 主页只保留帖文和记录页。母狗实况、宠粉计划、热门趋势位于主页与私信右栏；使用须知在视觉上并入简介区，但与主简介保持两个独立数据源；种畜登记档进入记录页；移除实况页、档案页、正在关注数和“本地叙事主页”。"
    ].join("\n")}\n`);
  }
  if (!result.includes(V2_EXTENSION_MARKER)) {
    result = appendWithoutChangingPrefix(result, `  ${V2_EXTENSION_MARKER}\n${[
      "  - profile.patch 新建的 AI 扩展卡起始只能包含 origin=ai 的 temporary 项；temporary 项必须绑定 extensions.profileTemporary.<sectionId>.<itemId>。",
      "  - 新的 timeline 历史卡必须先用 profile.patch 创建空卡，再通过 profile.item.append 逐条追加 origin=ai、permission=append_only 的历史；不得在新卡创建事件中直接夹带 append_only 项。",
      "  - profile.item.add 可向固定的母狗实况 sidebar/status 卡，或 AI 创建的卡片，追加 origin=ai 的 temporary 其他临时状态；初始项目不可删除，新增项目可用 profile.item.remove 删除。"
    ].join("\n")}\n`);
  }
  if (!result.includes(V2_PREGNANCY_MARKER)) {
    result = appendWithoutChangingPrefix(result, `  ${V2_PREGNANCY_MARKER}\n${[
      "  - 妊娠主状态唯一合法顺序为 none → suspected → confirmed → ended → none；每轮允许保持当前状态，但禁止跳级、倒退或从 none 直接进入 confirmed。",
      "  - 仅在 suspected → confirmed 时，由 AI 一次性给出 durationDays、conceptionAt 与 confirmedAt；确认后这些时长及锚点锁定，不得改写。",
      "  - 仅按 confirmed → ended 结束妊娠；进入 ended 的同一轮必须给出新的 cycle.anchorDate，之后才可按 ended → none 回到普通周期。"
    ].join("\n")}\n`);
  }
  return result;
}

function createV2Object(ruleName: string, originalRule: string, legacy?: z.infer<typeof LegacyRuleYamlSchema>): ParsedRuleConfig {
  const representativeComments = legacy?.hard_constraints.posts.representative_comments ?? 15;
  const minPanels = 0;
  const maxPanels = Math.max(1, legacy?.hard_constraints.render_plan.max_panels ?? 5);
  return {
    schema_version: 2,
    rule_name: ruleName,
    accounts: legacy?.accounts ?? {
      heroine_private: { id: "account-heroine", handle: "BBC_Married_MeatToilet", is_private: true },
      heroine_cover: { id: "account-heroine-cover", handle: "Marin", is_private: false },
      player: { id: "account-player", handle: "Master" }
    },
    hard_constraints: {
      profile: {
        permission_types: ["locked", "temporary", "computed", "append_only"],
        required_temporary_updates_each_turn: ["heroine.status", "heroine.outfit", "heroine.mood"],
        allow_other_temporary_unchanged: true,
        temporary_requires_canonical_source: true,
        locked_ai_writable: false,
        computed_ai_writable: false,
        append_only_requires_append_event: true,
        require_profile_panel: false
      },
      canonical_sources: { character_temporary: "mvu", calculated_display: "derived", platform_state: "platform", history: "event_log", dynamic_profile_values_are_cache_only: true },
      cycle: { length_days: 7, phase_days: { menstruation: 1, follicular: 2, ovulation: 1, luteal: 3 }, anchor_date_source: "mvu.heroine.cycle.anchorDate", initial_phase: "ovulation", pregnancy_state_transition_chain: ["none", "suspected", "confirmed", "ended", "none"], pregnancy_same_state_hold_allowed: true, pregnancy_transition_skips_allowed: false, pregnancy_duration_source: "ai_on_confirmation", pregnancy_duration_locked_after_confirmation: true, pause_cycle_when_pregnancy_confirmed: true, new_cycle_anchor_required_on_ended: true },
      statistics: { initial_insemination_count: 0, initial_insemination_volume_ml: 0, volume_unit: "mL", append_event: "statistics.insemination.append", totals_are_computed: true },
      platform: { impact_input: "qualitative_only", impact_numbers_are_computed: true, trends_are_incremental: true, trend_rank_and_volume_are_computed: true, fan_goal_event: "fan.goal.upsert", completed_fan_goals_locked: true, switch_to_next_unreached_automatically: true },
      content: { existing_posts_immutable: true, existing_comments_immutable: true, new_posts_and_comments_append_only: true },
      messages: { speech_segments_are_character_visible: true, director_instruction_is_hidden: true, allow_director_only_turn: true, director_instruction_excluded_from_history_scan_and_snapshot: true },
      homepage: { tabs: ["posts", "records"], sidebar_home: ["live_status", "fan_plan", "trends"], sidebar_messages: ["live_status", "fan_plan", "trends"], remove_live_tab: true, remove_about_tab: true, remove_following_count: true, remove_local_narrative_homepage_label: true, usage_notice_in_bio: true, usage_notice_separate_from_main_bio: true, registry_in_records: true, ai_extension_placement: "records", ai_extension_initial_permissions: ["temporary"], ai_extension_history_permission: "append_only", ai_timeline_requires_empty_section_then_append: true, max_ai_extension_sections: 8, max_items_per_ai_extension: 12, fixed_live_status_allows_ai_temporary_items: true, temporary_item_add_event: "profile.item.add", temporary_item_remove_event: "profile.item.remove", initial_content_removable_by_ai: false, ai_temporary_content_removable_by_ai: true },
      render_plan: { min_panels: minPanels, max_panels: maxPanels, require_strict_reveal_order: legacy?.hard_constraints.render_plan.require_strict_reveal_order ?? true, require_valid_targets: legacy?.hard_constraints.render_plan.require_valid_targets ?? true, only_changed_components: true },
      posts: { representative_comments: representativeComments },
      live: legacy?.hard_constraints.live ?? { min_queue_items: 10, max_queue_items: 25, require_barrage: true },
      identity: legacy?.hard_constraints.identity ?? { enforce_fixed_accounts: true }
    },
    original_rule: upgradeOriginalRule(originalRule)
  };
}

export function buildDefaultRuleConfig(originalRule: string) {
  return stringify(createV2Object("X 平台拟真输出规则", originalRule), { lineWidth: 0 });
}

export function normalizeRuleConfig(rawText: string) {
  const document = parseDocument(rawText, { prettyErrors: true, strict: true });
  if (document.errors.length) {
    const originalRule = rawText.trim();
    if (originalRule.startsWith("<X>") && originalRule.endsWith("</X>")) {
      const config = createV2Object("X 平台拟真输出规则", rawText);
      return { config, rawText: stringify(config, { lineWidth: 0 }), upgraded: true };
    }
    throw new Error(`规则 YAML 无效：${document.errors.map((error) => error.message).join("；")}`);
  }
  const value = document.toJS();
  if (typeof value === "string" && value.trim().startsWith("<X>") && value.trim().endsWith("</X>")) {
    const config = createV2Object("X 平台拟真输出规则", rawText);
    return { config, rawText: stringify(config, { lineWidth: 0 }), upgraded: true };
  }
  const current = RuleYamlSchema.safeParse(value);
  if (current.success) {
    const originalRule = upgradeOriginalRule(current.data.original_rule);
    if (originalRule === current.data.original_rule) return { config: current.data, rawText, upgraded: false };
    const config = { ...current.data, original_rule: originalRule };
    return { config, rawText: stringify(config, { lineWidth: 0 }), upgraded: true };
  }
  if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).schema_version === 2) {
    const migratedValue = structuredClone(value) as Record<string, unknown>;
    const hardConstraints = migratedValue.hard_constraints as Record<string, unknown> | undefined;
    const cycle = hardConstraints?.cycle as Record<string, unknown> | undefined;
    const homepage = hardConstraints?.homepage as Record<string, unknown> | undefined;
    if (cycle) {
      cycle.pregnancy_state_transition_chain ??= ["none", "suspected", "confirmed", "ended", "none"];
      cycle.pregnancy_same_state_hold_allowed ??= true;
      cycle.pregnancy_transition_skips_allowed ??= false;
      cycle.new_cycle_anchor_required_on_ended ??= true;
    }
    if (homepage) {
      delete homepage.ai_extension_permissions;
      homepage.ai_extension_initial_permissions ??= ["temporary"];
      homepage.ai_extension_history_permission ??= "append_only";
      homepage.ai_timeline_requires_empty_section_then_append ??= true;
      homepage.fixed_live_status_allows_ai_temporary_items ??= true;
      homepage.temporary_item_add_event ??= "profile.item.add";
      homepage.temporary_item_remove_event ??= "profile.item.remove";
    }
    if (typeof migratedValue.original_rule === "string") migratedValue.original_rule = upgradeOriginalRule(migratedValue.original_rule);
    const migrated = RuleYamlSchema.safeParse(migratedValue);
    if (migrated.success) return { config: migrated.data, rawText: stringify(migrated.data, { lineWidth: 0 }), upgraded: true };
  }
  const legacy = LegacyRuleYamlSchema.safeParse(value);
  if (!legacy.success) throw current.error;
  const config = createV2Object(legacy.data.rule_name, legacy.data.original_rule, legacy.data);
  return { config, rawText: stringify(config, { lineWidth: 0 }), upgraded: true };
}

export function parseRuleConfig(rawText: string): ParsedRuleConfig | undefined {
  try { return normalizeRuleConfig(rawText).config; }
  catch { return undefined; }
}

const aiEventComponents = [
  "account.upsert", "post.upsert", "post.remove", "post.moderate", "comment.upsert", "comment.moderate",
  "thread.upsert", "message.add", "live.upsert", "profile.patch", "profile.item.append", "profile.item.add",
  "profile.item.remove", "statistics.insemination.append", "fan.goal.add", "fan.goal.upsert", "poll.resolve",
  "platform.impact", "platform.notice", "platform.trend.upsert", "platform.trend.remove", "platform.trends (legacy-only; forbidden)"
];

export function buildAiRulePrompt(rawText: string) {
  const config = normalizeRuleConfig(rawText).config;
  const hard = config.hard_constraints;
  return stringify({
    schema_version: config.schema_version,
    rule_name: config.rule_name,
    accounts: config.accounts,
    ai_runtime_contract: {
      component_catalog: {
        events: aiEventComponents,
        mvu_operations: ["set", "increment", "append", "remove"],
        render_panels: ["profile", "post", "comments", "dm", "group", "live", "poll", "notice"],
        homepage_tabs: hard.homepage.tabs,
        homepage_sidebar: hard.homepage.sidebar_home,
        profile_permissions: hard.profile.permission_types
      },
      canonical_sources: hard.canonical_sources,
      required_each_turn: hard.profile.required_temporary_updates_each_turn,
      state_boundaries: {
        locked_ai_writable: false,
        computed_ai_writable: false,
        append_only_requires_append_event: true,
        private_account_post_visibility: "followers",
        director_instruction_is_hidden: true,
        existing_posts_and_comments_immutable: true
      },
      derived_corruption: {
        source: "profile.followerCount",
        formula: "clamp(floor(followerCount / 1000), 1, 100)",
        bands: "1-10,11-20,21-30,31-40,41-50,51-60,61-70,71-80,81-90,91-100",
        ai_writable: false,
        instruction: "Never portray a corruption stage beyond mvu.derived.corruption; use its label and description as the current pacing ceiling."
      },
      event_timeline: {
        timestamps_are_program_normalized: true,
        output_story_time_is_extended_when_needed: true
      },
      cycle: hard.cycle,
      limits: {
        ai_extension_sections: hard.homepage.max_ai_extension_sections,
        items_per_ai_extension: hard.homepage.max_items_per_ai_extension,
        render_panels: [hard.render_plan.min_panels, hard.render_plan.max_panels],
        representative_comments_target: hard.posts.representative_comments,
        live_queue_items: [hard.live.min_queue_items, hard.live.max_queue_items],
        live_requires_barrage: hard.live.require_barrage
      }
    },
    original_rule: config.original_rule
  }, { lineWidth: 0, indent: 1 });
}

export function assertRuleConfig(rawText: string) {
  const normalized = normalizeRuleConfig(rawText);
  const parsed = RuleYamlSchema.parse(normalized.config);
  if (parsed.hard_constraints.render_plan.min_panels > parsed.hard_constraints.render_plan.max_panels) throw new Error("规则 YAML 中最少面板不能大于最多面板");
  if (parsed.hard_constraints.live.min_queue_items > parsed.hard_constraints.live.max_queue_items) throw new Error("规则 YAML 中直播队列最小值不能大于最大值");
  const permissions = new Set(parsed.hard_constraints.profile.permission_types);
  if (permissions.size !== 4 || !["locked", "temporary", "computed", "append_only"].every((permission) => permissions.has(permission as z.infer<typeof PermissionSchema>))) {
    throw new Error("规则 YAML 必须且只能声明 locked、temporary、computed、append_only 四种权限");
  }
  return parsed;
}
