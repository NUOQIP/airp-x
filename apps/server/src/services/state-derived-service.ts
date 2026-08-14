import type { MvuState, StorySnapshot } from "@airp/shared";

const DAY_MS = 86_400_000;
const cyclePhaseLabels = {
  menstruation: "经期",
  follicular: "卵泡期",
  ovulation: "排卵期",
  luteal: "黄体期",
  suspected: "疑似妊娠",
  pregnant: "妊娠中"
} as const;

const corruptionStages = [
  { minimum: 1, maximum: 10, label: "试探期", description: "账号刚起步，对越界表达仍以试探、暗示和保留退路为主。" },
  { minimum: 11, maximum: 20, label: "适应期", description: "开始适应关注与反馈，会主动重复带来正反馈的轻度越界行为。" },
  { minimum: 21, maximum: 30, label: "主动营业期", description: "会主动设计贴文与互动吸引关注，但仍维持清晰的公开边界。" },
  { minimum: 31, maximum: 40, label: "边界松动期", description: "对更大胆的公开表达逐渐习惯，现实生活与账号经营开始互相影响。" },
  { minimum: 41, maximum: 50, label: "公开挑逗期", description: "享受被围观和讨论，会有意识地利用暧昧、争议与信息差经营账号。" },
  { minimum: 51, maximum: 60, label: "欲望主导期", description: "账号反馈开始明显左右选择，个人欲望与平台目标优先级上升。" },
  { minimum: 61, maximum: 70, label: "沉浸失控期", description: "线上身份深度侵入日常生活，越界行为更频繁且更难回到原有尺度。" },
  { minimum: 71, maximum: 80, label: "身份反转期", description: "私密账号逐渐成为主要自我认同，原有身份更多用于维持表面关系。" },
  { minimum: 81, maximum: 90, label: "深度堕落期", description: "会主动追求更强烈的关注与刺激，并把平台影响当作持续推进的动力。" },
  { minimum: 91, maximum: 100, label: "彻底沉沦期", description: "账号人格与现实选择高度统一，几乎不再为曾经的边界保留退路。" }
] as const;

function timezoneOffsetMinutes(value: string) {
  const match = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const amount = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -amount : amount;
}

function formatAtOffset(epochMs: number, offsetMinutes: number) {
  const shifted = new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 16);
  if (offsetMinutes === 0) return shifted;
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${shifted}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return formatAtOffset(parsed + days * DAY_MS, timezoneOffsetMinutes(value));
}

function localDay(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor((parsed + timezoneOffsetMinutes(value) * 60_000) / DAY_MS);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function trendVolumeLabel(score: number) {
  if (score >= 1_000_000) return `${Number((score / 1_000_000).toFixed(1))}M 帖文`;
  if (score >= 1_000) return `${Number((score / 1_000).toFixed(1))}K 帖文`;
  return `${score} 帖文`;
}

function deriveCycle(mvu: MvuState): MvuState["derived"]["cycle"] {
  const storyTime = mvu.storyTime;
  const source = mvu.heroine.cycle;
  const pregnancy = source.pregnancy;
  if (pregnancy.status === "confirmed" && pregnancy.conceptionAt && pregnancy.durationDays) {
    const elapsedDays = Math.max(0, localDay(storyTime) - localDay(pregnancy.conceptionAt));
    const durationDays = pregnancy.durationDays;
    const firstBoundary = Math.max(1, Math.ceil(durationDays / 3));
    const secondBoundary = Math.max(firstBoundary + 1, Math.ceil(durationDays * 2 / 3));
    const stage = elapsedDays < firstBoundary ? "early" : elapsedDays < secondBoundary ? "middle" : "late";
    const nextBoundary = stage === "early" ? firstBoundary : stage === "middle" ? secondBoundary : durationDays;
    return {
      phase: "pregnant",
      cycleDay: 1,
      nextChangeAt: addDays(pregnancy.conceptionAt, nextBoundary),
      pregnancy: {
        status: "confirmed",
        elapsedDays,
        durationDays,
        progressPercent: clamp(Number(((elapsedDays / durationDays) * 100).toFixed(2)), 0, 100),
        stage,
        nextChangeAt: addDays(pregnancy.conceptionAt, nextBoundary)
      }
    };
  }
  if (pregnancy.status === "suspected") {
    return { phase: "suspected", cycleDay: 1, nextChangeAt: addDays(pregnancy.suspectedAt ?? storyTime, 1) };
  }

  // Seven story days: menstruation 1, follicular 2, ovulation 1, luteal 3.
  const elapsed = localDay(storyTime) - localDay(source.anchorDate);
  const dayIndex = ((elapsed % 7) + 7) % 7;
  const phase = dayIndex === 0 ? "menstruation" : dayIndex <= 2 ? "follicular" : dayIndex === 3 ? "ovulation" : "luteal";
  const nextBoundary = dayIndex === 0 ? 1 : dayIndex <= 2 ? 3 : dayIndex === 3 ? 4 : 7;
  return { phase, cycleDay: dayIndex + 1, nextChangeAt: addDays(source.anchorDate, elapsed - dayIndex + nextBoundary) };
}

function nextMidnight(storyTime: string) {
  const offset = timezoneOffsetMinutes(storyTime);
  const day = localDay(storyTime);
  return formatAtOffset((day + 1) * DAY_MS - offset * 60_000, offset);
}

function deriveStatistics(mvu: MvuState): MvuState["derived"]["statistics"] {
  const ordered = [...mvu.heroine.statistics.inseminationEvents].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const storyDay = localDay(mvu.storyTime);
  let todayCount = 0;
  let totalCount = 0;
  let totalVolumeMl = 0;
  for (const record of ordered) {
    totalCount += record.count;
    totalVolumeMl += record.volumeMl;
    if (localDay(record.occurredAt) === storyDay) todayCount += record.count;
  }
  const lastRecord = ordered.at(-1);
  return {
    todayCount,
    totalCount,
    totalVolumeMl,
    nextDailyResetAt: nextMidnight(mvu.storyTime),
    ...(lastRecord ? { lastRecord } : {})
  };
}

function deriveFanPlan(snapshot: StorySnapshot): MvuState["derived"]["fanPlan"] {
  const currentFollowers = snapshot.profile.followerCount;
  const goals = [...snapshot.mvu.platform.fanGoals].sort((a, b) => a.targetFollowers - b.targetFollowers || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (goals.length === 0) return undefined;
  const firstUnreached = goals.find((goal) => goal.targetFollowers > currentFollowers);
  const active = firstUnreached ?? goals.at(-1)!;
  const activeIndex = goals.findIndex((goal) => goal.id === active.id);
  const next = goals.slice(activeIndex + 1).find((goal) => goal.targetFollowers > active.targetFollowers);
  return {
    activeGoalId: active.id,
    targetFollowers: active.targetFollowers,
    currentFollowers,
    progressPercent: clamp(Number(((currentFollowers / active.targetFollowers) * 100).toFixed(2)), 0, 100),
    reward: active.reward,
    completed: currentFollowers >= active.targetFollowers,
    ...(next ? { nextTargetFollowers: next.targetFollowers } : {})
  };
}

export function deriveCorruption(followerCount: number): MvuState["derived"]["corruption"] {
  const score = clamp(Math.floor(Math.max(0, followerCount) / 1_000), 1, 100);
  const stage = corruptionStages.find((candidate) => score >= candidate.minimum && score <= candidate.maximum) ?? corruptionStages.at(-1)!;
  return {
    score,
    range: `${stage.minimum}-${stage.maximum}`,
    label: stage.label,
    description: stage.description,
    ...(stage.maximum < 100 ? { nextStageAtFollowers: (stage.maximum + 1) * 1_000 } : {})
  };
}

function getAtPath(root: unknown, path: string) {
  let current = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function displayValue(path: string, value: unknown) {
  if (value === undefined || value === null) return "";
  if (path === "cycle.phase" && typeof value === "string" && value in cyclePhaseLabels) return cyclePhaseLabels[value as keyof typeof cyclePhaseLabels];
  if (path === "statistics.totalVolumeMl" && typeof value === "number") return `${value} mL`;
  if (path.endsWith("progressPercent") && typeof value === "number") return `${value}%`;
  if (path === "statistics.lastRecord" && value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { occurredAt?: unknown; count?: unknown; volumeMl?: unknown; note?: unknown };
    return [record.occurredAt, typeof record.count === "number" ? `${record.count}次` : undefined, typeof record.volumeMl === "number" ? `${record.volumeMl} mL` : undefined, record.note]
      .filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function synchronizeDerivedState(snapshot: StorySnapshot): StorySnapshot {
  const privateAccountIds = new Set(snapshot.accounts.filter((account) => account.isPrivate).map((account) => account.id));
  for (const post of snapshot.posts) if (privateAccountIds.has(post.authorId)) post.visibility = "followers";
  snapshot.trends.sort((a, b) => b.heatScore - a.heatScore || a.label.localeCompare(b.label));
  snapshot.trends = snapshot.trends.slice(0, 20).map((trend, index) => ({ ...trend, rank: index + 1, volumeLabel: trendVolumeLabel(trend.heatScore) }));
  const fanPlan = deriveFanPlan(snapshot);
  snapshot.mvu.derived = {
    cycle: deriveCycle(snapshot.mvu),
    statistics: deriveStatistics(snapshot.mvu),
    ...(fanPlan ? { fanPlan } : {}),
    corruption: deriveCorruption(snapshot.profile.followerCount)
  };
  snapshot.profile.location = snapshot.mvu.heroine.location;
  snapshot.profile.currentStoryTime = snapshot.mvu.storyTime;
  snapshot.mvu.platform.activeTrends = snapshot.trends.slice(0, 20).map((trend) => trend.label);
  const heroine = snapshot.accounts.find((account) => account.id === snapshot.profile.accountId);
  if (heroine) heroine.bio = snapshot.mvu.heroine.bio;

  for (const section of snapshot.profile.sections) {
    for (const item of section.items) {
      let value: unknown;
      if (item.source.kind === "mvu") value = getAtPath(snapshot.mvu, item.source.path);
      if (item.source.kind === "derived") value = getAtPath(snapshot.mvu.derived, item.source.path);
      if (item.source.kind === "profile") value = getAtPath(snapshot.profile, item.source.path);
      if (item.source.kind === "platform") value = getAtPath(snapshot, item.source.path);
      if (item.source.kind === "event_log" && item.source.path === "mvu.heroine.statistics.inseminationEvents") value = snapshot.mvu.heroine.statistics.inseminationEvents;
      if (["mvu", "derived", "profile", "platform"].includes(item.source.kind)) item.value = displayValue(item.source.path, value);
      else if (value !== undefined) item.value = displayValue(item.source.path, value);
    }
  }
  return snapshot;
}

export function storyTimeMinusDays(storyTime: string, days: number) {
  return addDays(storyTime, -days);
}
