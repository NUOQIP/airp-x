import { describe, expect, it } from "vitest";
import type { PlayerTurnInput, StorySnapshot } from "@airp/shared";
import { buildProfileContextState, hiddenDirectorInstruction, visibleTurnText } from "./context-view.js";

describe("context view", () => {
  it("keeps the hidden director instruction out of character-visible text", () => {
    const input: PlayerTurnInput = {
      kind: "dm",
      branchId: "branch",
      threadId: "thread",
      speechSegments: ["第一段", "第二段"],
      directorInstruction: "推进到第二天"
    };
    expect(visibleTurnText(input)).toBe("第一段\n第二段");
    expect(hiddenDirectorInstruction(input)).toBe("推进到第二天");
    expect(visibleTurnText(input)).not.toContain("推进到第二天");
  });

  it("supports a director-only turn without inventing visible speech", () => {
    const input: PlayerTurnInput = { kind: "dm", branchId: "branch", threadId: "thread", speechSegments: [], directorInstruction: "继续剧情" };
    expect(visibleTurnText(input)).toBe("");
    expect(hiddenDirectorInstruction(input)).toBe("继续剧情");
  });

  it("omits dynamic render-cache values while retaining literal and append-only history", () => {
    const snapshot = {
      accounts: [{ id: "account-heroine", displayName: "Heroine", handle: "heroine", avatarSeed: "seed", avatarUrl: "data:image/png;base64,secret", verified: false, bio: "canonical-in-mvu", isPrivate: true }],
      profile: {
        accountId: "account-heroine",
        bannerTone: "rose",
        bannerUrl: "data:image/png;base64,secret",
        location: "cache-location",
        joinedAt: "2026",
        followerCount: 10,
        postCount: 2,
        currentStoryTime: "2026-01-01T00:00+08:00",
        sections: [{
          id: "section",
          title: "记录",
          kind: "timeline",
          page: "records",
          order: 1,
          origin: "initial",
          items: [
            { id: "dynamic", value: "duplicate cache", emphasis: "normal", permission: "temporary", origin: "initial", source: { kind: "mvu", path: "heroine.status" } },
            { id: "computed", value: "duplicate computed", emphasis: "normal", permission: "computed", origin: "initial", source: { kind: "derived", path: "cycle.phase" } },
            { id: "literal", value: "fixed fact", emphasis: "normal", permission: "locked", origin: "initial", source: { kind: "literal", path: "profile.sections.section.items.literal.value" } },
            { id: "history", value: "old event", emphasis: "normal", permission: "append_only", origin: "initial", source: { kind: "event_log", path: "profile.sections.section.items" } }
          ]
        }]
      },
      trends: []
    } as unknown as StorySnapshot;
    const context = buildProfileContextState(snapshot);
    const items = context.structure.sections[0]!.items;
    expect(items.find((item) => item.id === "dynamic")).not.toHaveProperty("value");
    expect(items.find((item) => item.id === "computed")).not.toHaveProperty("value");
    expect(items.find((item) => item.id === "literal")).toHaveProperty("value", "fixed fact");
    expect(items.find((item) => item.id === "history")).toHaveProperty("value", "old event");
    expect(context.account).not.toHaveProperty("avatarUrl");
    expect(context.account).not.toHaveProperty("bio");
    expect(context.structure).not.toHaveProperty("bannerUrl");
    expect(context.structure).not.toHaveProperty("location");
    expect(context.structure).not.toHaveProperty("currentStoryTime");
  });
});
