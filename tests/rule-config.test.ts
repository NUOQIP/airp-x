import { describe, expect, it } from "vitest";
import { assertRuleConfig, parseRuleConfig } from "../apps/server/src/services/rule-config";

const yamlRule = `schema_version: 1
rule_name: "X 平台拟真输出规则"
accounts:
  heroine_private:
    id: account-heroine
    handle: BBC_Married_MeatToilet
    is_private: true
  heroine_cover:
    id: account-heroine-cover
    handle: Marin
    is_private: false
  player:
    id: account-player
    handle: Master
hard_constraints:
  profile:
    min_real_changes: 3
    require_profile_panel: true
  render_plan:
    min_panels: 3
    max_panels: 5
    require_strict_reveal_order: true
    require_valid_targets: true
  posts:
    representative_comments: 15
  live:
    min_queue_items: 10
    max_queue_items: 25
    require_barrage: true
  identity:
    enforce_fixed_accounts: true
original_rule: |-
  <X>
  原始内容不改
  </X>`;

describe("rule YAML", () => {
  it("parses fixed accounts, hard constraints, and the untouched original block", () => {
    const parsed = assertRuleConfig(yamlRule);
    expect(parsed.accounts.heroine_private.id).toBe("account-heroine");
    expect(parsed.hard_constraints.posts.representative_comments).toBe(15);
    expect(parsed.original_rule).toBe("<X>\n原始内容不改\n</X>");
  });

  it("rejects a drifting fixed account identity", () => {
    expect(parseRuleConfig(yamlRule.replace("id: account-heroine\n", "id: account-other\n"))).toBeUndefined();
  });
});
