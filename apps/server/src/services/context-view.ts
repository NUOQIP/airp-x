import type { PlayerTurnInput, StorySnapshot } from "@airp/shared";

export function visibleTurnText(input: PlayerTurnInput) {
  return input.kind === "comment" ? input.text : input.speechSegments.join("\n");
}

export function hiddenDirectorInstruction(input: PlayerTurnInput) {
  return input.kind === "comment" ? undefined : input.directorInstruction?.trim() || undefined;
}

export function buildProfileContextState(snapshot: StorySnapshot) {
  const account = snapshot.accounts.find((candidate) => candidate.id === snapshot.profile.accountId);
  const accountContext = account ? {
    id: account.id,
    displayName: account.displayName,
    handle: account.handle,
    avatarSeed: account.avatarSeed,
    avatarText: account.avatarText,
    verified: account.verified,
    isPrivate: account.isPrivate,
    relationshipLabel: account.relationshipLabel
  } : undefined;
  const sections = snapshot.profile.sections.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.kind,
    page: section.page,
    order: section.order,
    origin: section.origin,
    items: section.items.map((item) => ({
      id: item.id,
      label: item.label,
      emphasis: item.emphasis,
      permission: item.permission,
      origin: item.origin,
      source: item.source,
      ...(["literal", "event_log"].includes(item.source.kind) ? { value: item.value } : {})
    }))
  }));
  return {
    account: accountContext,
    structure: {
      accountId: snapshot.profile.accountId,
      bannerTone: snapshot.profile.bannerTone,
      joinedAt: snapshot.profile.joinedAt,
      pinnedPostId: snapshot.profile.pinnedPostId,
      sections
    },
    platformComputed: {
      followerCount: snapshot.profile.followerCount,
      postCount: snapshot.profile.postCount,
      trends: snapshot.trends
    },
    fieldPermissions: {
      "account.id": { permission: "locked", source: { kind: "literal", path: "account.id" } },
      "account.handle": { permission: "locked", source: { kind: "literal", path: "account.handle" } },
      "account.isPrivate": { permission: "locked", source: { kind: "literal", path: "account.isPrivate" } },
      "account.displayName": { permission: "locked", source: { kind: "literal", path: "account.displayName" } },
      "account.avatar": { permission: "locked", source: { kind: "literal", path: "account.avatar" } },
      "account.verified": { permission: "locked", source: { kind: "literal", path: "account.verified" } },
      "account.bio": { permission: "temporary", source: { kind: "mvu", path: "heroine.bio" } },
      "account.usageNotice": { permission: "temporary", source: { kind: "mvu", path: "heroine.usageNotice" } },
      "profile.bannerUrl": { permission: "locked", source: { kind: "profile", path: "bannerUrl" } },
      "profile.bannerTone": { permission: "locked", source: { kind: "profile", path: "bannerTone" } },
      "profile.location": { permission: "temporary", source: { kind: "mvu", path: "heroine.location" } },
      "profile.joinedAt": { permission: "locked", source: { kind: "profile", path: "joinedAt" } },
      "profile.followerCount": { permission: "computed", source: { kind: "platform", path: "profile.followerCount" } },
      "profile.postCount": { permission: "computed", source: { kind: "platform", path: "profile.postCount" } },
      "profile.currentStoryTime": { permission: "temporary", source: { kind: "mvu", path: "storyTime" } },
      "profile.pinnedPostId": { permission: "temporary", source: { kind: "profile", path: "pinnedPostId" } },
      "profile.initialSectionStructure": { permission: "locked", source: { kind: "profile", path: "sections" } }
    },
    contract: "mvu/derived/platform/profile 来源项目的 section item.value 已省略，因为它只是渲染缓存；请只修改 registry 声明的唯一来源。"
  };
}
