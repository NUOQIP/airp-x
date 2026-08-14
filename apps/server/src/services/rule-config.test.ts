import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildDefaultRuleConfig, normalizeRuleConfig, parseRuleConfig, upgradeOriginalRule } from "./rule-config.js";

const originalRule = `<X>\n原始玩法正文。\n旧说明：每轮至少 3 项主页变化。\n</X>`;

const legacyRule = `schema_version: 1
rule_name: X 平台拟真输出规则
accounts:
  heroine_private: { id: account-heroine, handle: BBC_Married_MeatToilet, is_private: true }
  heroine_cover: { id: account-heroine-cover, handle: Marin, is_private: false }
  player: { id: account-player, handle: Master }
hard_constraints:
  profile: { min_real_changes: 3, require_profile_panel: true }
  render_plan: { min_panels: 3, max_panels: 5, require_strict_reveal_order: true, require_valid_targets: true }
  posts: { representative_comments: 15 }
  live: { min_queue_items: 10, max_queue_items: 25, require_barrage: true }
  identity: { enforce_fixed_accounts: true }
original_rule: |-
  ${originalRule.replace(/\n/g, "\n  ")}
`;

describe("rule config v2", () => {
  it("upgrades a v1 rule without deleting or rewriting its original text", () => {
    const normalized = normalizeRuleConfig(legacyRule);
    expect(normalized.upgraded).toBe(true);
    expect(normalized.config.schema_version).toBe(2);
    expect(normalized.config.original_rule.startsWith(originalRule)).toBe(true);
    expect(normalized.config.original_rule).toContain("【主页权限与唯一数据源 v2】");
    expect(normalized.config.hard_constraints.profile.required_temporary_updates_each_turn).toEqual(["heroine.status", "heroine.outfit", "heroine.mood"]);
    expect(normalized.config.hard_constraints.profile.require_profile_panel).toBe(false);
    expect(normalized.config.hard_constraints.render_plan.min_panels).toBe(0);
    expect(normalized.config.hard_constraints.cycle.pregnancy_state_transition_chain).toEqual(["none", "suspected", "confirmed", "ended", "none"]);
    expect(normalized.config.hard_constraints.cycle.pregnancy_transition_skips_allowed).toBe(false);
    expect(normalized.config.hard_constraints.comments).toMatchObject({ audience_pool_size: 20, max_new_accounts_per_turn: 2, pool_reuse_min_ratio: 0.6 });
  });

  it("keeps the v2 append idempotent", () => {
    const once = upgradeOriginalRule(originalRule);
    expect(upgradeOriginalRule(once)).toBe(once);
    expect(once.match(/【主页权限与唯一数据源 v2】/g)).toHaveLength(1);
    expect(once.match(/【主页扩展事件补充 v2\.1】/g)).toHaveLength(1);
    expect(once.match(/【妊娠状态确认链 v2\.2】/g)).toHaveLength(1);
    expect(once.match(/【评论账号池与真实感补充 v2\.3】/g)).toHaveLength(1);
    expect(once).toContain("none → suspected → confirmed → ended → none");
    expect(once).toContain("会出现雌竞——女性围绕雄性资源互相比较/贬低/踩踏");
  });

  it("preserves the exact original bytes as a prefix, including trailing whitespace", () => {
    const exact = "<X>\n原始内容\n</X>\n \n";
    expect(upgradeOriginalRule(exact).startsWith(exact)).toBe(true);
  });

  it("migrates the interim v2 extension permission shape", () => {
    const interim = parse(buildDefaultRuleConfig(originalRule));
    interim.hard_constraints.homepage.ai_extension_permissions = ["temporary", "append_only"];
    delete interim.hard_constraints.homepage.ai_extension_initial_permissions;
    delete interim.hard_constraints.homepage.ai_extension_history_permission;
    delete interim.hard_constraints.homepage.ai_timeline_requires_empty_section_then_append;
    delete interim.hard_constraints.cycle.pregnancy_state_transition_chain;
    delete interim.hard_constraints.cycle.pregnancy_same_state_hold_allowed;
    delete interim.hard_constraints.cycle.pregnancy_transition_skips_allowed;
    delete interim.hard_constraints.cycle.new_cycle_anchor_required_on_ended;
    interim.original_rule = interim.original_rule.replace(/\n\s*【主页扩展事件补充 v2\.1】[\s\S]*$/, "");
    const normalized = normalizeRuleConfig(JSON.stringify(interim));
    expect(normalized.upgraded).toBe(true);
    expect(normalized.config.hard_constraints.homepage.ai_extension_initial_permissions).toEqual(["temporary"]);
    expect(normalized.config.hard_constraints.cycle.pregnancy_state_transition_chain).toEqual(["none", "suspected", "confirmed", "ended", "none"]);
    expect(normalized.config.original_rule).toContain("【主页扩展事件补充 v2.1】");
    expect(normalized.config.original_rule).toContain("【妊娠状态确认链 v2.2】");
  });

  it("builds a strict v2 YAML document from the original plain rule", () => {
    const rawText = buildDefaultRuleConfig(originalRule);
    expect(parse(rawText).schema_version).toBe(2);
    expect(parseRuleConfig(rawText)?.hard_constraints.cycle.length_days).toBe(7);
    expect(parseRuleConfig(rawText)?.hard_constraints.statistics.volume_unit).toBe("mL");
  });
});
