import { parseDocument } from "yaml";
import { z } from "zod";

const RuleYamlSchema = z.object({
  schema_version: z.literal(1),
  rule_name: z.string().min(1),
  accounts: z.object({
    heroine_private: z.object({ id: z.literal("account-heroine"), handle: z.literal("BBC_Married_MeatToilet"), is_private: z.literal(true) }).strict(),
    heroine_cover: z.object({ id: z.literal("account-heroine-cover"), handle: z.literal("Marin"), is_private: z.literal(false) }).strict(),
    player: z.object({ id: z.literal("account-player"), handle: z.literal("Master") }).strict()
  }).strict(),
  hard_constraints: z.object({
    profile: z.object({ min_real_changes: z.number().int().min(0).max(100), require_profile_panel: z.boolean() }).strict(),
    render_plan: z.object({ min_panels: z.number().int().min(1).max(8), max_panels: z.number().int().min(1).max(8), require_strict_reveal_order: z.boolean(), require_valid_targets: z.boolean() }).strict(),
    posts: z.object({ representative_comments: z.number().int().min(0).max(100) }).strict(),
    live: z.object({ min_queue_items: z.number().int().min(0).max(500), max_queue_items: z.number().int().min(0).max(500), require_barrage: z.boolean() }).strict(),
    identity: z.object({ enforce_fixed_accounts: z.boolean() }).strict()
  }).strict(),
  original_rule: z.string()
}).strict();

export type ParsedRuleConfig = z.infer<typeof RuleYamlSchema>;

export function parseRuleConfig(rawText: string): ParsedRuleConfig | undefined {
  const document = parseDocument(rawText, { prettyErrors: true, strict: true });
  if (document.errors.length) return undefined;
  const result = RuleYamlSchema.safeParse(document.toJS());
  return result.success ? result.data : undefined;
}

export function assertRuleConfig(rawText: string) {
  const document = parseDocument(rawText, { prettyErrors: true, strict: true });
  if (document.errors.length) throw new Error(`规则 YAML 无效：${document.errors.map((error) => error.message).join("；")}`);
  const parsed = RuleYamlSchema.parse(document.toJS());
  if (parsed.hard_constraints.render_plan.min_panels > parsed.hard_constraints.render_plan.max_panels) throw new Error("规则 YAML 中最少面板不能大于最多面板");
  if (parsed.hard_constraints.live.min_queue_items > parsed.hard_constraints.live.max_queue_items) throw new Error("规则 YAML 中直播队列最小值不能大于最大值");
  return parsed;
}
