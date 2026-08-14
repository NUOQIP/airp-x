import { describe, expect, it } from "vitest";
import { HomepageDraftSchema } from "@airp/shared";
import { HEROINE_COVER_ID, HEROINE_ID, PLAYER_ID, createBlankStorySnapshot, createInitialStorySnapshot, ensureHeroineCoverIdentity } from "./defaults.js";

describe("blank story homepage", () => {
  it("starts with an empty, unconfigured homepage and a usable direct-message thread", () => {
    const snapshot = createBlankStorySnapshot();

    expect(snapshot.profile.sections).toEqual([]);
    expect(snapshot.posts).toEqual([]);
    expect(snapshot.profile.postCount).toBe(0);
    expect(snapshot.comments).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.mvu.extensions.homepageConfigured).toBe(false);
    expect(snapshot.threads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "dm",
        participantIds: [PLAYER_ID, HEROINE_COVER_ID],
        playerCanSend: true
      })
    ]));
    expect(snapshot.accounts.find((account) => account.id === HEROINE_COVER_ID)).toMatchObject({ handle: "Marin", isPrivate: false });
    expect(snapshot.accounts.find((account) => account.id === HEROINE_ID)?.isPrivate).toBe(true);
  });

  it("migrates the player DM from the private identity to the cover account", () => {
    const legacy = createInitialStorySnapshot();
    legacy.accounts = legacy.accounts.filter((account) => account.id !== HEROINE_COVER_ID);
    legacy.accounts.find((account) => account.id === HEROINE_ID)!.isPrivate = false;
    legacy.threads.find((thread) => thread.id === "dm-player-heroine")!.participantIds = [PLAYER_ID, HEROINE_ID];
    legacy.messages.find((message) => message.threadId === "dm-player-heroine")!.senderId = HEROINE_ID;

    const migrated = ensureHeroineCoverIdentity(legacy);

    expect(migrated.accounts.find((account) => account.id === HEROINE_ID)?.isPrivate).toBe(true);
    expect(migrated.accounts.find((account) => account.id === HEROINE_COVER_ID)).toMatchObject({ handle: "Marin", isPrivate: false });
    expect(migrated.threads.find((thread) => thread.id === "dm-player-heroine")?.participantIds).toEqual([PLAYER_ID, HEROINE_COVER_ID]);
    expect(migrated.messages.find((message) => message.threadId === "dm-player-heroine")?.senderId).toBe(HEROINE_COVER_ID);
    expect(migrated.profile.postCount).toBe(migrated.posts.filter((post) => post.authorId === HEROINE_ID && post.moderation !== "deleted").length);
  });

  it("accepts a fixed-schema homepage draft", () => {
    const draft = HomepageDraftSchema.parse({
      schemaVersion: "1.0",
      account: { displayName: "测试账号", handle: "test_profile", bio: "主页简介", verified: false, isPrivate: true },
      profile: {
        bannerTone: "sky",
        location: "成都",
        joinedAt: "2026年加入",
        followerCount: 3_400,
        postCount: 56,
        currentStoryTime: "2026-08-08T20:00+08:00",
        sections: [{
          id: "section-status",
          title: "当前状态",
          kind: "status",
          page: "live",
          order: 10,
          mutablePolicy: "ai_mutable",
          items: [{ id: "status-activity", label: "正在做", value: "测试主页", emphasis: "normal" }]
        }]
      },
      heroineState: { mood: "平静", location: "成都", activity: "测试主页", outfit: "" },
      notes: []
    });

    expect(draft.profile.followerCount).toBe(3_400);
    expect(draft.account.handle).toBe("test_profile");
    expect(draft.profile.sections[0]?.page).toBe("sidebar");
    expect(draft.profile.sections[0]?.items[0]?.permission).toBe("temporary");
    expect(draft.fanGoals).toEqual([]);
  });
});
