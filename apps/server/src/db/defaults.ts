import fs from "node:fs";
import type { StorySnapshot } from "@airp/shared";
import { synchronizeDerivedProfileStats } from "../services/snapshot-normalizer.js";

export const PLAYER_ID = "account-player";
export const HEROINE_ID = "account-heroine";
export const HEROINE_COVER_ID = "account-heroine-cover";
export const SESSION_ID = "session-main";
export const BRANCH_ID = "branch-main";

export const materialPaths = {
  playerCard: "C:\\Users\\ASUS\\.codex\\attachments\\c7dafb78-ab6f-4886-9fb4-6890b298860a\\pasted-text.txt",
  heroineCard: "C:\\Users\\ASUS\\.codex\\attachments\\b64b8da6-407c-4c8e-82e3-e3d0f02dc60f\\pasted-text.txt",
  globalRule: "C:\\Users\\ASUS\\.codex\\attachments\\e48292fc-a2f1-4239-805a-069cdee7f175\\pasted-text.txt"
} as const;

export function readMaterial(path: string, fallback: string) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

const seedTime = "2026-10-25T15:07+08:00";

export function createHeroineCoverAccount(): StorySnapshot["accounts"][number] {
  return {
    id: HEROINE_COVER_ID,
    displayName: "喜多川海梦",
    handle: "Marin",
    avatarSeed: "marin-cover",
    verified: false,
    bio: "Cosplay · 日常",
    isPrivate: false,
    relationshipLabel: "女主的表账号"
  };
}

export function ensureHeroineCoverIdentity(snapshot: StorySnapshot): StorySnapshot {
  const next = structuredClone(snapshot);
  const privateAccount = next.accounts.find((account) => account.id === HEROINE_ID);
  if (privateAccount) {
    privateAccount.isPrivate = true;
    privateAccount.relationshipLabel = "女主的私密账号";
  }
  let coverAccount = next.accounts.find((account) => account.id === HEROINE_COVER_ID)
    ?? next.accounts.find((account) => account.id !== HEROINE_ID && account.handle.toLocaleLowerCase() === "marin");
  if (!coverAccount) {
    coverAccount = createHeroineCoverAccount();
    next.accounts.push(coverAccount);
  } else {
    coverAccount.isPrivate = false;
    coverAccount.relationshipLabel = "女主的表账号";
  }
  const playerThread = next.threads.find((thread) => thread.id === "dm-player-heroine");
  if (playerThread) {
    playerThread.title = `${coverAccount.displayName} · @${coverAccount.handle}`;
    playerThread.participantIds = [PLAYER_ID, coverAccount.id];
  }
  for (const message of next.messages) {
    if (message.threadId === "dm-player-heroine" && message.senderId === HEROINE_ID) message.senderId = coverAccount.id;
  }
  next.mvu.extensions.identityLinks = {
    heroine: { privateAccountId: HEROINE_ID, coverAccountId: coverAccount.id }
  };
  return synchronizeDerivedProfileStats(next);
}

export function createBlankStorySnapshot(): StorySnapshot {
  const blankTime = "2026-01-01T00:00+08:00";
  return {
    accounts: [
      {
        id: HEROINE_ID,
        displayName: "待建设主页",
        handle: "profile_pending",
        avatarSeed: "heroine-pending",
        verified: false,
        bio: "",
        isPrivate: true,
        relationshipLabel: "女主的私密账号"
      },
      createHeroineCoverAccount(),
      {
        id: PLAYER_ID,
        displayName: "諾奇",
        handle: "Master",
        avatarSeed: "master",
        verified: false,
        bio: "",
        isPrivate: true,
        relationshipLabel: "玩家"
      }
    ],
    profile: {
      accountId: HEROINE_ID,
      bannerTone: "sky",
      location: "",
      joinedAt: "",
      followingCount: 0,
      followerCount: 0,
      postCount: 0,
      currentStoryTime: blankTime,
      sections: []
    },
    posts: [],
    comments: [],
    threads: [{
      id: "dm-player-heroine",
      kind: "dm",
      title: "喜多川海梦 · @Marin",
      participantIds: [PLAYER_ID, HEROINE_COVER_ID],
      playerCanSend: true,
      updatedAt: blankTime,
      unreadCount: 0
    }],
    messages: [],
    lives: [],
    mvu: {
      revision: 0,
      storyTime: blankTime,
      heroine: { mood: "", location: "", activity: "", outfit: "", relationship: {} },
      player: { relationship: {} },
      platform: { activeTrends: [], flags: {} },
      extensions: { homepageConfigured: false, homepageSource: "", identityLinks: { heroine: { privateAccountId: HEROINE_ID, coverAccountId: HEROINE_COVER_ID } } }
    },
    trends: [],
    notices: []
  };
}

export function createInitialStorySnapshot(): StorySnapshot {
  return {
    accounts: [
      {
        id: HEROINE_ID,
        displayName: "喜多川海梦",
        handle: "marin_cos",
        avatarSeed: "marin",
        verified: true,
        bio: "Cosplay · 日常 · 直播记录",
        isPrivate: true,
        relationshipLabel: "女主的私密账号"
      },
      createHeroineCoverAccount(),
      {
        id: PLAYER_ID,
        displayName: "諾奇",
        handle: "Master",
        avatarSeed: "master",
        verified: false,
        bio: "",
        isPrivate: true,
        relationshipLabel: "玩家"
      },
      {
        id: "account-fan-a",
        displayName: "海盐汽水",
        handle: "salt_soda",
        avatarSeed: "fan-a",
        verified: false,
        bio: "关注新鲜事",
        isPrivate: false
      },
      {
        id: "account-fan-b",
        displayName: "镜头之外",
        handle: "off_camera",
        avatarSeed: "fan-b",
        verified: false,
        bio: "街拍与现场记录",
        isPrivate: false
      }
    ],
    profile: {
      accountId: HEROINE_ID,
      bannerTone: "rose",
      location: "成都",
      joinedAt: "2025年3月加入",
      followingCount: 890,
      followerCount: 113_000,
      postCount: 2,
      currentStoryTime: seedTime,
      pinnedPostId: "post-pinned",
      sections: [
        {
          id: "section-live-status",
          title: "当前状态",
          kind: "status",
          order: 10,
          mutablePolicy: "ai_mutable",
          items: [
            { id: "status-location", label: "位置", value: "成都 · IFS", emphasis: "accent" },
            { id: "status-activity", label: "正在做", value: "进行一场公开直播", emphasis: "normal" },
            { id: "status-mood", label: "心情", value: "兴奋又期待", emphasis: "success" }
          ]
        },
        {
          id: "section-goal",
          title: "粉丝目标",
          kind: "progress",
          order: 20,
          mutablePolicy: "computed",
          items: [
            { id: "goal-followers", label: "进度", value: "113K / 150K（75%）", emphasis: "accent" }
          ]
        },
        {
          id: "section-milestones",
          title: "里程碑",
          kind: "timeline",
          order: 30,
          mutablePolicy: "ai_mutable",
          items: [
            { id: "milestone-start", value: "2025.03.18 · 账号开始记录", emphasis: "normal" },
            { id: "milestone-100k", value: "2026.10.01 · 达成 100K 粉丝", emphasis: "success" }
          ]
        }
      ]
    },
    posts: [
      {
        id: "post-pinned",
        authorId: HEROINE_ID,
        createdAt: "2026-10-25T13:30+08:00",
        text: "今天的直播会持续更新。评论区告诉我你们正在从哪里观看。",
        media: [{
          id: "media-pinned",
          kind: "video",
          title: "直播预告",
          description: "竖屏镜头里是城市街区入口，画面边缘不断掠过赶来的观众。",
          durationSeconds: 42,
          subtitle: "14:00 准时开始",
          tone: "warm"
        }],
        metrics: { replies: 386, reposts: 1_204, likes: 9_830, views: 286_000, bookmarks: 719 },
        pinned: true,
        visibility: "public",
        moderation: "visible"
      },
      {
        id: "post-live-now",
        authorId: HEROINE_ID,
        createdAt: seedTime,
        text: "直播进行中。现场比预想中热闹，接下来会到中庭。",
        media: [{
          id: "media-live-now",
          kind: "live_replay",
          title: "正在直播",
          description: "运动相机视角跟随主播穿过人群，背景里能听见观众的呼喊。",
          subtitle: "实时文字转播",
          tone: "dramatic"
        }],
        metrics: { replies: 153, reposts: 437, likes: 3_240, views: 95_100, bookmarks: 202 },
        pinned: false,
        visibility: "public",
        moderation: "visible"
      }
    ],
    comments: [
      {
        id: "comment-a",
        postId: "post-live-now",
        authorId: "account-fan-a",
        createdAt: "2026-10-25T15:08+08:00",
        text: "刚进直播间，现场声音好热闹。",
        metrics: { replies: 2, reposts: 0, likes: 43, views: 890, bookmarks: 0 },
        moderation: "visible"
      },
      {
        id: "comment-b",
        postId: "post-live-now",
        authorId: "account-fan-b",
        createdAt: "2026-10-25T15:09+08:00",
        text: "中庭这边已经有人在等了。",
        metrics: { replies: 1, reposts: 2, likes: 76, views: 1_020, bookmarks: 1 },
        moderation: "visible"
      }
    ],
    threads: [
      {
        id: "dm-player-heroine",
        kind: "dm",
        title: "喜多川海梦 · @Marin",
        participantIds: [PLAYER_ID, HEROINE_COVER_ID],
        playerCanSend: true,
        updatedAt: seedTime,
        unreadCount: 1
      },
      {
        id: "dm-fan-heroine",
        kind: "dm",
        title: "海盐汽水",
        participantIds: [HEROINE_ID, "account-fan-a"],
        playerCanSend: false,
        updatedAt: "2026-10-25T15:05+08:00",
        unreadCount: 0
      },
      {
        id: "group-live-team",
        kind: "group",
        title: "直播现场协作",
        participantIds: [PLAYER_ID, HEROINE_ID, "account-fan-b"],
        playerCanSend: true,
        updatedAt: "2026-10-25T15:06+08:00",
        unreadCount: 2
      }
    ],
    messages: [
      { id: "msg-welcome", threadId: "dm-player-heroine", senderId: HEROINE_COVER_ID, createdAt: seedTime, text: "我到中庭了，你能看到直播画面吗？", status: "read", isPlayerInput: false },
      { id: "msg-fan", threadId: "dm-fan-heroine", senderId: "account-fan-a", createdAt: "2026-10-25T15:05+08:00", text: "今天的直播很顺利，期待后续。", status: "read", isPlayerInput: false },
      { id: "msg-group-a", threadId: "group-live-team", senderId: "account-fan-b", createdAt: "2026-10-25T15:05+08:00", text: "中庭路线已经确认。", status: "read", isPlayerInput: false },
      { id: "msg-group-b", threadId: "group-live-team", senderId: HEROINE_ID, createdAt: "2026-10-25T15:06+08:00", text: "收到，我正在过去。", status: "read", isPlayerInput: false }
    ],
    lives: [
      {
        id: "live-main",
        hostId: HEROINE_ID,
        title: "城市现场 · 实时文字直播",
        startedAt: "2026-10-25T14:00+08:00",
        status: "live",
        sceneDescription: "移动镜头正从步行街进入商场中庭，现场人声逐渐变得密集。",
        viewerCount: 18_630,
        queue: [
          { id: "live-q1", kind: "host", offsetMs: 500, text: "镜头轻微晃动，主播向中庭方向走去。" },
          { id: "live-q2", kind: "barrage", offsetMs: 1_200, accountId: "account-fan-a", text: "终于到中庭了！" },
          { id: "live-q3", kind: "viewer_count", offsetMs: 2_100, viewers: 19_042 },
          { id: "live-q4", kind: "superchat", offsetMs: 3_000, accountId: "account-fan-b", text: "现场收音很清楚", amount: 50, currency: "CNY" }
        ]
      }
    ],
    mvu: {
      revision: 0,
      storyTime: seedTime,
      heroine: { mood: "兴奋又期待", location: "成都 · IFS", activity: "公开直播中", outfit: "直播造型", relationship: { player: "信任" } },
      player: { relationship: { heroine: "亲密" } },
      platform: { activeTrends: ["#城市现场", "#实时直播"], flags: { liveInProgress: true } },
      extensions: { identityLinks: { heroine: { privateAccountId: HEROINE_ID, coverAccountId: HEROINE_COVER_ID } } }
    },
    trends: [
      { label: "城市现场", volumeLabel: "12.8K 帖文", rank: 1 },
      { label: "周末直播", volumeLabel: "8,962 帖文", rank: 2 },
      { label: "Cosplay", volumeLabel: "36.5K 帖文", rank: 3 }
    ],
    notices: []
  };
}
