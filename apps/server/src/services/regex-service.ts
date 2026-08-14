import { asc, eq } from "drizzle-orm";
import { AiTurnOutputSchema, type AiTurnOutput, type RegexRule } from "@airp/shared";
import { db } from "../db/client.js";
import { regexRules } from "../db/schema.js";

function replace(value: string | undefined, rules: RegexRule[]) {
  if (value === undefined) return undefined;
  return rules.reduce((text, rule) => text.replace(new RegExp(rule.pattern, rule.flags), rule.replacement), value);
}

export async function applyOutputRegex(output: AiTurnOutput) {
  const rows = await db.select().from(regexRules).where(eq(regexRules.enabled, true)).orderBy(asc(regexRules.sortOrder));
  if (rows.length === 0) return output;
  const rules = rows.map((rule) => ({ id: rule.id, name: rule.name, pattern: rule.pattern, replacement: rule.replacement, flags: rule.flags, field: rule.field, enabled: rule.enabled, order: rule.sortOrder } satisfies RegexRule));
  const byField = (field: RegexRule["field"]) => rules.filter((rule) => rule.field === field);
  const next = structuredClone(output);
  for (const event of next.events) {
    if (event.type === "account.upsert") {
      const fieldRules = byField("account_text");
      event.account.displayName = replace(event.account.displayName, fieldRules)!;
      event.account.bio = replace(event.account.bio, fieldRules)!;
      if (event.account.relationshipLabel) event.account.relationshipLabel = replace(event.account.relationshipLabel, fieldRules)!;
    }
    if (event.type === "post.upsert") {
      event.post.text = replace(event.post.text, byField("post_text"))!;
      const mediaRules = byField("media_text");
      event.post.media = event.post.media.map((media) => ({
        ...media,
        ...(media.title ? { title: replace(media.title, mediaRules)! } : {}),
        description: replace(media.description, mediaRules)!,
        ...(media.altText ? { altText: replace(media.altText, mediaRules)! } : {}),
        ...(media.subtitle ? { subtitle: replace(media.subtitle, mediaRules)! } : {})
      }));
    }
    if (event.type === "comment.upsert") event.comment.text = replace(event.comment.text, byField("comment_text"))!;
    if (event.type === "message.add") event.message.text = replace(event.message.text, byField("message_text"))!;
    if (event.type === "profile.patch") {
      const fieldRules = byField("profile_text");
      if (event.patch.location) event.patch.location = replace(event.patch.location, fieldRules)!;
      event.patch.upsertSections = event.patch.upsertSections.map((section) => ({
        ...section,
        title: replace(section.title, fieldRules)!,
        items: section.items.map((item) => ({ ...item, ...(item.label ? { label: replace(item.label, fieldRules)! } : {}), value: replace(item.value, fieldRules)! }))
      }));
    }
    if (event.type === "live.upsert") {
      const fieldRules = byField("live_text");
      event.live.title = replace(event.live.title, fieldRules)!;
      event.live.sceneDescription = replace(event.live.sceneDescription, fieldRules)!;
      event.live.queue = event.live.queue.map((item) => {
        if ("text" in item) return { ...item, text: replace(item.text, fieldRules)! };
        if (item.kind === "gift") return { ...item, giftName: replace(item.giftName, fieldRules)! };
        return item;
      });
    }
    if (event.type === "platform.notice") event.text = replace(event.text, byField("notice_text"))!;
    if (event.type === "platform.trends") event.trends = event.trends.map((trend) => ({ ...trend, label: replace(trend.label, byField("notice_text"))!, volumeLabel: replace(trend.volumeLabel, byField("notice_text"))! }));
  }
  return AiTurnOutputSchema.parse(next);
}

