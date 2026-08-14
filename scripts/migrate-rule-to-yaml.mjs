import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

const baseUrl = process.env.AIRP_LOCAL_API ?? "http://127.0.0.1:4317";
const configResponse = await fetch(`${baseUrl}/api/config`);
if (!configResponse.ok) throw new Error(`无法读取当前规则：HTTP ${configResponse.status}`);
const config = await configResponse.json();
const rule = config.rulePreset;
const original = rule.rawText;

const existing = parseDocument(original, { strict: true });
if (!existing.errors.length && existing.get("schema_version") === 1 && typeof existing.get("original_rule") === "string") {
  const recovered = existing.get("original_rule");
  console.log(JSON.stringify({
    status: "already_migrated",
    yamlLength: original.length,
    originalLength: recovered.length,
    originalSha256: createHash("sha256").update(recovered).digest("hex")
  }, null, 2));
  process.exit(0);
}

const block = original.split("\n").map((line) => `  ${line}`).join("\n");
const yaml = [
  "schema_version: 1",
  'rule_name: "X 平台拟真输出规则"',
  "accounts:",
  "  heroine_private:",
  "    id: account-heroine",
  "    handle: BBC_Married_MeatToilet",
  "    is_private: true",
  "  heroine_cover:",
  "    id: account-heroine-cover",
  "    handle: Marin",
  "    is_private: false",
  "  player:",
  "    id: account-player",
  "    handle: Master",
  "hard_constraints:",
  "  profile:",
  `    min_real_changes: ${rule.minProfileChanges}`,
  "    require_profile_panel: true",
  "  render_plan:",
  `    min_panels: ${rule.minPanels}`,
  `    max_panels: ${rule.maxPanels}`,
  "    require_strict_reveal_order: true",
  "    require_valid_targets: true",
  "  posts:",
  `    representative_comments: ${rule.representativeComments}`,
  "  live:",
  "    min_queue_items: 10",
  "    max_queue_items: 25",
  "    require_barrage: true",
  "  identity:",
  "    enforce_fixed_accounts: true",
  "original_rule: |-",
  block
].join("\n");

const parsed = parseDocument(yaml, { prettyErrors: true, strict: true });
if (parsed.errors.length) throw new Error(parsed.errors.map((error) => error.message).join("\n"));
const recovered = parsed.get("original_rule");
if (recovered !== original) throw new Error("原始规则正文在 YAML 包装过程中发生变化，已中止保存。");

const saveResponse = await fetch(`${baseUrl}/api/config/rules/${encodeURIComponent(rule.id)}`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    rawText: yaml,
    minProfileChanges: rule.minProfileChanges,
    minPanels: rule.minPanels,
    maxPanels: rule.maxPanels,
    representativeComments: rule.representativeComments
  })
});
if (!saveResponse.ok) throw new Error(`保存规则 YAML 失败：${await saveResponse.text()}`);

console.log(JSON.stringify({
  originalLength: original.length,
  yamlLength: yaml.length,
  originalSha256: createHash("sha256").update(original).digest("hex"),
  recoveredSha256: createHash("sha256").update(recovered).digest("hex")
}, null, 2));
