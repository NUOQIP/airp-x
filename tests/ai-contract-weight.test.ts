import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { outputJsonSchema } from "../apps/server/src/services/ai-client.js";
import { buildAiRulePrompt, buildDefaultRuleConfig, parseRuleConfig } from "../apps/server/src/services/rule-config.js";

describe("AI-facing contract weight", () => {
  it("keeps every event and panel component visible in a referenced compact JSON Schema", () => {
    const serialized = JSON.stringify(outputJsonSchema);
    expect(serialized.length).toBeLessThan(20_500);
    expect(outputJsonSchema).toHaveProperty("$ref");
    expect(outputJsonSchema).toHaveProperty("definitions");
    const references: string[] = [];
    const collectReferences = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if ("$ref" in value && typeof value.$ref === "string") references.push(value.$ref);
      for (const child of Object.values(value)) collectReferences(child);
    };
    collectReferences(outputJsonSchema);
    for (const reference of references) {
      const target = reference.slice(2).split("/").reduce<unknown>((value, key) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined,
      outputJsonSchema);
      expect(target, `unresolved schema reference: ${reference}`).not.toBeUndefined();
    }
    for (const component of [
      "account.upsert", "post.upsert", "post.remove", "post.moderate", "comment.upsert", "comment.moderate",
      "thread.upsert", "message.add", "live.upsert", "profile.patch", "profile.item.append", "profile.item.add",
      "profile.item.remove", "statistics.insemination.append", "fan.goal.add", "fan.goal.upsert", "poll.resolve",
      "platform.impact", "platform.notice", "platform.trends", "platform.trend.upsert", "platform.trend.remove",
      "profile", "post", "comments", "dm", "group", "live", "poll", "notice"
    ]) expect(serialized).toContain(component);
  });

  it("compiles stored YAML into a smaller AI view without dropping the original rule or component catalog", () => {
    const raw = buildDefaultRuleConfig(`<X>\n${"完整玩法格式与规则。\n".repeat(200)}</X>`);
    const parsed = parseRuleConfig(raw)!;
    const prompt = buildAiRulePrompt(raw);

    expect(prompt.length).toBeLessThan(raw.length);
    expect(parse(prompt).original_rule).toBe(parsed.original_rule);
    for (const component of ["post.upsert", "message.add", "profile.item.append", "platform.trend.upsert", "dm", "comments", "live_status", "fan_plan", "trends"]) {
      expect(prompt).toContain(component);
    }
    expect(prompt).toContain("private_account_post_visibility: followers");
    expect(prompt).toContain("clamp(floor(followerCount / 1000), 1, 100)");
  });
});
