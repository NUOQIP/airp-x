import { describe, expect, it } from "vitest";
import { AccountSchema, AvatarTextSchema } from "@airp/shared";
import { normalizeModelOutput } from "../apps/server/src/services/ai-client";

describe("avatar text validation", () => {
  it("accepts one or two letters, Han characters, or emoji graphemes", () => {
    for (const value of ["M", "M1", "海梦", "♠️", "🎀", "👩‍❤️‍💋‍👨"]) {
      expect(AvatarTextSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("rejects empty or more than two visible characters", () => {
    expect(AvatarTextSchema.safeParse("").success).toBe(false);
    expect(AvatarTextSchema.safeParse("ABC").success).toBe(false);
    expect(AvatarTextSchema.safeParse("...").success).toBe(false);
    expect(AvatarTextSchema.safeParse("\u200B").success).toBe(false);
    expect(AvatarTextSchema.safeParse("\u202EAB").success).toBe(false);
    expect(AvatarTextSchema.safeParse("👩‍❤️‍💋‍👨👨‍👩‍👧‍👦").success).toBe(true);
    expect(AvatarTextSchema.safeParse("🎀❤️♠️").success).toBe(false);
  });

  it("normalizes harmless model avatar text and omits invalid optional values", () => {
    const account = {
      id: "account-npc",
      displayName: "NPC",
      handle: "npc",
      avatarSeed: "npc",
      avatarText: "  ",
      verified: false,
      bio: "",
      isPrivate: false
    };
    const normalized = normalizeModelOutput({ events: [{ type: "account.upsert", account }] }) as { events: Array<{ account: Record<string, unknown> }> };
    expect(normalized.events[0]!.account).not.toHaveProperty("avatarText");
    expect(AccountSchema.safeParse(normalized.events[0]!.account).success).toBe(true);

    const fullWidth = normalizeModelOutput({ events: [{ type: "account.upsert", account: { ...account, avatarText: "Ｍ１" } }] }) as { events: Array<{ account: Record<string, unknown> }> };
    expect(fullWidth.events[0]!.account.avatarText).toBe("M1");

    const tooLong = normalizeModelOutput({ events: [{ type: "account.upsert", account: { ...account, avatarText: "MARIN" } }] }) as { events: Array<{ account: Record<string, unknown> }> };
    expect(tooLong.events[0]!.account).not.toHaveProperty("avatarText");

    const wrongType = normalizeModelOutput({ events: [{ type: "account.upsert", account: { ...account, avatarText: 7 } }] });
    expect(() => AccountSchema.parse((wrongType as { events: Array<{ account: unknown }> }).events[0]!.account)).toThrow();
  });

  it("drops model writes to fixed accounts and locked profile projections", () => {
    const normalized = normalizeModelOutput({ events: [
      { type: "account.upsert", account: { id: "account-heroine-cover", displayName: "changed" } },
      { type: "account.upsert", account: { id: "account-npc", displayName: "NPC" } },
      { type: "profile.patch", patch: { bannerTone: "rose", location: "changed", pinnedPostId: "post-new", upsertSections: [], removeSectionIds: [] } }
    ] }) as { events: Array<Record<string, unknown>> };

    expect(normalized.events).toHaveLength(2);
    expect((normalized.events[0]!.account as { id: string }).id).toBe("account-npc");
    expect(normalized.events[1]!.patch).toEqual({ pinnedPostId: "post-new", upsertSections: [], removeSectionIds: [] });
  });
});
