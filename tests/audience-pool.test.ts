import { describe, expect, it } from "vitest";
import { createBlankStorySnapshot } from "../apps/server/src/db/defaults.js";
import { buildAudienceRosterContext, touchAudiencePool } from "../apps/server/src/services/audience-pool.js";

describe("audience account pool", () => {
  it("starts with twenty persistent profiles and selects a deterministic per-turn roster", () => {
    const snapshot = createBlankStorySnapshot();
    expect(snapshot.mvu.platform.audiencePool).toHaveLength(20);
    for (const entry of snapshot.mvu.platform.audiencePool) {
      expect(snapshot.accounts.some((account) => account.id === entry.accountId)).toBe(true);
      expect(entry.personaNote).toBeTruthy();
    }
    const first = buildAudienceRosterContext(snapshot, "turn-a", 12);
    const retry = buildAudienceRosterContext(snapshot, "turn-a", 12);
    const nextTurn = buildAudienceRosterContext(snapshot, "turn-b", 12);
    expect(first).toEqual(retry);
    expect(first.candidates).toHaveLength(12);
    expect(first.candidates.map((candidate) => candidate.id)).not.toEqual(nextTurn.candidates.map((candidate) => candidate.id));
  });

  it("admits a successful newcomer while preserving archived accounts", () => {
    const snapshot = createBlankStorySnapshot();
    const previousPool = new Set(snapshot.mvu.platform.audiencePool.map((entry) => entry.accountId));
    snapshot.accounts.push({
      id: "audience-newcomer",
      displayName: "青柠",
      handle: "lime_0712",
      avatarSeed: "lime_0712",
      verified: false,
      bio: "偶尔上线",
      isPrivate: false
    });
    touchAudiencePool(snapshot, "audience-newcomer", "2026-10-25T16:00+08:00");
    expect(snapshot.mvu.platform.audiencePool).toHaveLength(20);
    expect(snapshot.mvu.platform.audiencePool.some((entry) => entry.accountId === "audience-newcomer")).toBe(true);
    const evictedId = [...previousPool].find((accountId) => !snapshot.mvu.platform.audiencePool.some((entry) => entry.accountId === accountId));
    expect(evictedId).toBeTruthy();
    expect(snapshot.accounts.some((account) => account.id === evictedId)).toBe(true);
    expect(snapshot.accounts.some((account) => account.id === "audience-newcomer")).toBe(true);
  });
});
