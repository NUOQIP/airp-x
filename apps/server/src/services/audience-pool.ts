import type { Account, AudiencePoolEntry, StorySnapshot } from "@airp/shared";

export const DEFAULT_AUDIENCE_POOL_SIZE = 20;
export const DEFAULT_AUDIENCE_ROSTER_SIZE = 12;

const fixedAccountIds = new Set(["account-heroine", "account-heroine-cover", "account-player"]);

const seedProfiles: Array<{
  id: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarText?: string;
  personaNote: string;
}> = [
  { id: "audience-liang-27", displayName: "小梁同学", handle: "liang_27", bio: "成都｜通勤摸鱼", avatarText: "梁", personaNote: "住在本地，发言随意；偶尔认得地点，但更多时候只聊自己的日常。" },
  { id: "audience-nightferry", displayName: "夜航船", handle: "nightferry_33", bio: "少喝咖啡", avatarText: "夜", personaNote: "习惯先观察再开口，句子短，偶尔抓住细节追问，不急着站队。" },
  { id: "audience-saltplanet", displayName: "盐焗小星球", handle: "saltplanet", bio: "川渝觅食中", avatarText: "盐", personaNote: "爱把平台内容联想到吃饭、出门和朋友群里的琐事，容易自然跑题。" },
  { id: "audience-momo", displayName: "momo不吃桃", handle: "momo_no_peach", bio: "今天也没早睡", avatarText: "桃", personaNote: "情绪来得快，常用半句话、表情和错别字，很少完整解释自己的立场。" },
  { id: "audience-grain404", displayName: "旧胶片", handle: "grain_404", bio: "相机和旧歌", avatarText: "旧", personaNote: "对照片、构图和修图细节敏感，说话克制，有时会认真纠正别人。" },
  { id: "audience-paperbagcat", displayName: "纸袋里的猫", handle: "paperbag_cat", bio: "偶尔上线", avatarText: "猫", personaNote: "大多潜水，出现时常接别人一句或问一个看似无关的小问题。" },
  { id: "audience-nemuiyang", displayName: "眠羊", handle: "nemui_yang", bio: "夜间出没", avatarText: "羊", personaNote: "语气软但不总是友善，喜欢用轻飘飘的表达说让人接不住的话。" },
  { id: "audience-no8am", displayName: "早八退散", handle: "no_morning8", bio: "在读｜周末失踪", avatarText: "8", personaNote: "学生气明显，跟梗快，容易被新鲜事吸引，也经常重复问已经说过的信息。" },
  { id: "audience-camelliafog", displayName: "山茶与雾", handle: "camelliafog", bio: "记录一些没用的事", avatarText: "茶", personaNote: "喜欢把现场说得像生活片段，偶尔共情，偶尔只留下一句模糊感想。" },
  { id: "audience-nana0816", displayName: "NANA", handle: "nana_0816", bio: "cos / games / coffee", avatarText: "N", personaNote: "熟悉Cos圈和活动现场，能认出行业习惯；态度会随对象变化，不固定捧或踩。" },
  { id: "audience-suzuki", displayName: "铃木没有车", handle: "suzuki_nowheel", bio: "日语学习中", avatarText: "鈴", personaNote: "爱玩谐音和旧梗，常回复其他用户而不是直接对博主说话。" },
  { id: "audience-yao-frame", displayName: "阿遥", handle: "yao_in_frame", bio: "拍照比上班认真", avatarText: "遥", personaNote: "关注拍摄现场与现实执行细节，既可能帮忙解释，也可能指出不合理处。" },
  { id: "audience-rion", displayName: "桃濑璃音", handle: "rion_momose", bio: "写真更新 / 依頼DM", avatarText: "璃", personaNote: "同类型内容创作者，好胜心强；表面亲热，常把比较、挤兑和引流包装成同行交流。" },
  { id: "audience-saya", displayName: "纱夜", handle: "saya_afterdark", bio: "cos / photo / late night", avatarText: "纱", personaNote: "同圈创作者，懂营业方式；有时真心交流，有时会借热度展示自己，与同行关系会累积变化。" },
  { id: "audience-melonpatrol", displayName: "瓜田巡逻员", handle: "melon_patrol", bio: "不接推广", avatarText: "瓜", personaNote: "习惯先怀疑营销、摆拍和数据，但也会继续围观；被反驳后不一定认错。" },
  { id: "audience-whitenoise", displayName: "白噪音", handle: "white_noise_17", bio: "不定期删动态", avatarText: "白", personaNote: "立场反复，可能前一条嫌吵，后一条又参与争论，像普通用户而不是固定阵营。" },
  { id: "audience-natsusoda", displayName: "夏夜汽水", handle: "natsu_soda", bio: "周末摄影随缘", avatarText: "夏", personaNote: "容易被氛围带动，愿意夸人，也会和熟悉账号互相捧场或开玩笑。" },
  { id: "audience-umeplum", displayName: "乌梅子酱", handle: "ume_plum_", bio: "随手转发", avatarText: "梅", personaNote: "常把内容转去朋友群后再回来补充反应，信息来源真假混杂。" },
  { id: "audience-march7", displayName: "叁月七日", handle: "march7_note", bio: "通勤、电影和猫", avatarText: "叁", personaNote: "有自己的价值判断，但不总是辩论；更常从现实后果或身边经验切入。" },
  { id: "audience-zheergen", displayName: "爱吃折耳根", handle: "zheergen_yes", bio: "本地口味保卫战", avatarText: "根", personaNote: "本地生活信息多，讲话直接，容易和外地用户为小事吵偏，也会热心回答路线问题。" }
];

function seedAccount(profile: (typeof seedProfiles)[number]): Account {
  return {
    id: profile.id,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarSeed: profile.handle,
    ...(profile.avatarText ? { avatarText: profile.avatarText } : {}),
    verified: false,
    bio: profile.bio,
    isPrivate: false
  };
}

export function createDefaultAudienceAccounts() {
  return seedProfiles.map(seedAccount);
}

export function createDefaultAudiencePool(storyTime: string): AudiencePoolEntry[] {
  return seedProfiles.map((profile) => ({ accountId: profile.id, joinedAt: storyTime, personaNote: profile.personaNote }));
}

function latestCommentAt(snapshot: StorySnapshot, accountId: string) {
  return snapshot.comments.filter((comment) => comment.authorId === accountId).map((comment) => comment.createdAt).sort().at(-1);
}

export function ensureAudiencePool(snapshot: StorySnapshot, targetSize = DEFAULT_AUDIENCE_POOL_SIZE) {
  const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  let pool: AudiencePoolEntry[] = [];
  const pooledIds = new Set<string>();
  for (const entry of snapshot.mvu.platform.audiencePool) {
    if (!accountsById.has(entry.accountId) || fixedAccountIds.has(entry.accountId) || pooledIds.has(entry.accountId)) continue;
    pool.push(entry);
    pooledIds.add(entry.accountId);
  }
  const existingAudience = snapshot.accounts
    .filter((account) => !fixedAccountIds.has(account.id) && !pooledIds.has(account.id))
    .sort((a, b) => (latestCommentAt(snapshot, b.id) ?? "").localeCompare(latestCommentAt(snapshot, a.id) ?? ""));
  for (const account of existingAudience) {
    if (pool.length >= targetSize) break;
    const lastActiveAt = latestCommentAt(snapshot, account.id);
    pool.push({ accountId: account.id, joinedAt: lastActiveAt ?? snapshot.mvu.storyTime, ...(lastActiveAt ? { lastActiveAt } : {}) });
    pooledIds.add(account.id);
  }
  for (const profile of seedProfiles) {
    if (pool.length >= targetSize) break;
    if (!accountsById.has(profile.id)) {
      const account = seedAccount(profile);
      snapshot.accounts.push(account);
      accountsById.set(account.id, account);
    }
    if (!pooledIds.has(profile.id)) {
      pool.push({ accountId: profile.id, joinedAt: snapshot.mvu.storyTime, personaNote: profile.personaNote });
      pooledIds.add(profile.id);
    }
  }
  snapshot.mvu.platform.audiencePool = pool
    .sort((a, b) => (b.lastActiveAt ?? b.joinedAt).localeCompare(a.lastActiveAt ?? a.joinedAt))
    .slice(0, targetSize);
  return snapshot;
}

export function touchAudiencePool(snapshot: StorySnapshot, accountId: string, eventTime: string, targetSize = DEFAULT_AUDIENCE_POOL_SIZE) {
  if (fixedAccountIds.has(accountId) || !snapshot.accounts.some((account) => account.id === accountId)) return;
  const existing = snapshot.mvu.platform.audiencePool.find((entry) => entry.accountId === accountId);
  if (existing) existing.lastActiveAt = eventTime;
  else snapshot.mvu.platform.audiencePool.push({ accountId, joinedAt: eventTime, lastActiveAt: eventTime });
  snapshot.mvu.platform.audiencePool = snapshot.mvu.platform.audiencePool
    .sort((a, b) => (b.lastActiveAt ?? b.joinedAt).localeCompare(a.lastActiveAt ?? a.joinedAt))
    .slice(0, targetSize);
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildAudienceRosterContext(snapshot: StorySnapshot, seed: string, sampleSize = DEFAULT_AUDIENCE_ROSTER_SIZE) {
  const accountsById = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const candidates = snapshot.mvu.platform.audiencePool
    .filter((entry) => accountsById.has(entry.accountId))
    .sort((a, b) => stableHash(`${seed}:${a.accountId}`) - stableHash(`${seed}:${b.accountId}`))
    .slice(0, sampleSize)
    .map((entry) => {
      const account = accountsById.get(entry.accountId)!;
      const recentVoice = snapshot.comments
        .filter((comment) => comment.authorId === account.id && comment.moderation === "visible")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 2)
        .reverse()
        .map((comment) => comment.text);
      return {
        id: account.id,
        displayName: account.displayName,
        handle: account.handle,
        ...(account.bio ? { bio: account.bio } : {}),
        ...(entry.personaNote ? { personaNote: entry.personaNote } : {}),
        ...(recentVoice.length ? { recentVoice } : {}),
        ...(entry.lastActiveAt ? { lastActiveAt: entry.lastActiveAt } : {})
      };
    });
  return { activePoolSize: snapshot.mvu.platform.audiencePool.length, candidates };
}
