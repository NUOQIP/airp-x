import { StorySnapshotSchema, type ProfileSection, type ProfileSectionItem, type StorySnapshot } from "@airp/shared";
import { storyTimeMinusDays, synchronizeDerivedState } from "./state-derived-service.js";

type RawRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is RawRecord => value !== null && typeof value === "object" && !Array.isArray(value);
const safePart = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "item";

function rawHasPath(root: unknown, path: string[]) {
  let current = root;
  for (const part of path) {
    if (!isRecord(current) || !(part in current)) return false;
    current = current[part];
  }
  return true;
}

function parseFollowerTarget(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([kKmM万]?)/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]?.toLocaleLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "万" ? 10_000 : 1;
  const result = Math.round(amount * multiplier);
  return result > 0 ? result : undefined;
}

function item(id: string, label: string, permission: ProfileSectionItem["permission"], sourceKind: ProfileSectionItem["source"]["kind"], path: string, value = "", emphasis: ProfileSectionItem["emphasis"] = "normal"): ProfileSectionItem {
  return { id, label, value, emphasis, permission, origin: "initial", source: { kind: sourceKind, path } };
}

function findSection(snapshot: StorySnapshot, ids: string[], titlePattern: RegExp) {
  return snapshot.profile.sections.find((section) => ids.includes(section.id) || (section.origin === "initial" && titlePattern.test(section.title)));
}

function populateMvuMap(target: Record<string, string>, sourceItems: ProfileSectionItem[]) {
  for (const current of sourceItems) {
    const key = safePart(current.id);
    if (!(key in target)) target[key] = current.value;
  }
}

function migrateUsageSection(snapshot: StorySnapshot) {
  const section = findSection(snapshot, ["usage-instructions", "usage-notice"], /使用须知|须知/u);
  if (!section) return;
  section.page = "bio";
  section.origin = "initial";
  populateMvuMap(snapshot.mvu.heroine.usageNotice, section.items);
  section.items = section.items.map((current) => ({
    ...current,
    permission: "temporary",
    origin: "initial",
    source: { kind: "mvu", path: `heroine.usageNotice.${safePart(current.id)}` }
  }));
}

function splitMeasurements(section: ProfileSection) {
  const current = section.items.find((candidate) => candidate.id === "measurements" || /三围/u.test(candidate.label ?? ""));
  if (!current) return;
  const height = current.value.match(/\b\d{2,3}(?:\.\d+)?\s*cm\b/i)?.[0];
  const weight = current.value.match(/\b\d{2,3}(?:\.\d+)?\s*kg\b/i)?.[0];
  let measurements = current.value;
  if (height) measurements = measurements.replace(height, "");
  if (weight) measurements = measurements.replace(weight, "");
  measurements = measurements.replace(/[·|/]+\s*$/g, "").replace(/\s*[·|]+\s*/g, " · ").replace(/\s*[·|/]+\s*$/g, "").trim();
  current.value = measurements;
  if (height && !section.items.some((candidate) => candidate.id === "height")) {
    const index = section.items.indexOf(current);
    section.items.splice(index + 1, 0, item("height", "身高", "locked", "literal", `profile.sections.${section.id}.items.height.value`, height));
  }
  if (weight && !section.items.some((candidate) => candidate.id === "weight")) {
    const index = section.items.findIndex((candidate) => candidate.id === "height");
    section.items.splice(index + 1, 0, item("weight", "体重", "temporary", "mvu", "heroine.profileFacts.weight", weight));
  }
}

function migrateRegistrationSection(snapshot: StorySnapshot) {
  const section = findSection(snapshot, ["breeding-registration", "registration"], /登记档|档案/u);
  if (!section) return;
  section.page = "records";
  section.origin = "initial";
  splitMeasurements(section);
  section.items = section.items.filter((current) => current.id !== "ovulation-cycle" && !/排卵|周期/u.test(current.label ?? ""));
  for (const current of section.items) {
    current.origin = "initial";
    if (current.id === "height" || /身高/u.test(current.label ?? "")) {
      current.permission = "locked";
      current.source = { kind: "literal", path: `profile.sections.${section.id}.items.${safePart(current.id)}.value` };
      continue;
    }
    current.permission = "temporary";
    current.source = { kind: "mvu", path: `heroine.profileFacts.${safePart(current.id)}` };
    const key = safePart(current.id);
    if (!(key in snapshot.mvu.heroine.profileFacts)) snapshot.mvu.heroine.profileFacts[key] = current.value;
  }
}

function ensureLiveSection(snapshot: StorySnapshot) {
  let section = findSection(snapshot, ["live-status", "section-live-status"], /实况|当前状态/u);
  if (!section) {
    section = { id: "live-status", title: "当前实况", kind: "status", page: "sidebar", order: 10, origin: "initial", items: [] };
    snapshot.profile.sections.push(section);
  }
  section.page = "sidebar";
  section.origin = "initial";
  const definitions = [
    ["current-status", "当前状态", "heroine.status"],
    ["current-outfit", "当前穿搭", "heroine.outfit"],
    ["current-mood", "当前心情", "heroine.mood"],
    ["current-activity", "当前活动", "heroine.activity"]
  ] as const;
  for (const [id, label, path] of definitions) {
    let current = section.items.find((candidate) => candidate.id === id || candidate.source.path === path
      || (path === "heroine.status" && /当前状态|状态/u.test(candidate.label ?? ""))
      || (path === "heroine.outfit" && /穿搭|服装/u.test(candidate.label ?? ""))
      || (path === "heroine.mood" && /心情/u.test(candidate.label ?? ""))
      || (path === "heroine.activity" && /活动|正在/u.test(candidate.label ?? "")));
    if (!current) {
      current = item(id, label, "temporary", "mvu", path);
      section.items.push(current);
    }
    current.id = id;
    current.label = label;
    current.permission = "temporary";
    current.origin = "initial";
    current.source = { kind: "mvu", path };
    const key = path.split(".").at(-1) as "status" | "outfit" | "mood" | "activity";
    if (!snapshot.mvu.heroine[key] && current.value) snapshot.mvu.heroine[key] = current.value;
  }
  for (const current of section.items) {
    if (definitions.some(([id]) => id === current.id)) continue;
    if (current.id === "cycle-phase" || /排卵|周期/u.test(current.label ?? "")) {
      current.id = "cycle-phase";
      current.label = "当前周期";
      current.permission = "computed";
      current.origin = "initial";
      current.source = { kind: "derived", path: "cycle.phase" };
      continue;
    }
    if (current.id === "cycle-next-change" || /下次.*变化/u.test(current.label ?? "")) {
      current.permission = "computed";
      current.origin = "initial";
      current.source = { kind: "derived", path: "cycle.nextChangeAt" };
      continue;
    }
    if (current.permission === "temporary") {
      const extensions = snapshot.mvu.extensions as Record<string, unknown>;
      const root = isRecord(extensions.profileTemporary) ? extensions.profileTemporary : {};
      extensions.profileTemporary = root;
      const sectionState = isRecord(root[section.id]) ? root[section.id] as Record<string, unknown> : {};
      root[section.id] = sectionState;
      sectionState[current.id] ??= current.value;
      current.source = { kind: "mvu", path: `extensions.profileTemporary.${safePart(section.id)}.${safePart(current.id)}` };
    }
  }
  if (!section.items.some((current) => current.id === "cycle-phase")) section.items.push(item("cycle-phase", "当前周期", "computed", "derived", "cycle.phase"));
  if (!section.items.some((current) => current.id === "cycle-next-change")) section.items.push(item("cycle-next-change", "下次阶段变化", "computed", "derived", "cycle.nextChangeAt"));
}

function migrateStatisticsSection(snapshot: StorySnapshot) {
  const section = findSection(snapshot, ["breeding-records", "statistics"], /种付记录|统计记录/u);
  if (!section) return;
  section.page = "records";
  section.origin = "initial";
  const definitions: Array<[string, string, string]> = [
    ["today-creampie-count", "今日次数", "statistics.todayCount"],
    ["total-creampie-count", "累计次数", "statistics.totalCount"],
    ["total-semen-volume", "累计总量", "statistics.totalVolumeMl"],
    ["recent-breeding", "最近记录", "statistics.lastRecord"]
  ];
  section.items = definitions.map(([id, label, path]) => {
    const existing = section.items.find((candidate) => candidate.id === id);
    return {
      ...(existing ?? item(id, label, "computed", "derived", path)),
      id,
      label,
      value: "",
      permission: "computed" as const,
      origin: "initial" as const,
      source: { kind: "derived" as const, path }
    };
  });
}

function migrateFanSection(snapshot: StorySnapshot, hadFanGoals: boolean) {
  const section = findSection(snapshot, ["fan-goal", "section-goal"], /宠粉|粉丝目标/u);
  if (!section) return;
  section.page = "sidebar";
  section.origin = "initial";
  if (!hadFanGoals && snapshot.mvu.platform.fanGoals.length === 0) {
    const targetItem = section.items.find((current) => current.id === "goal" || /目标/u.test(current.label ?? ""));
    const rewardItem = section.items.find((current) => current.id === "reward" || /奖励/u.test(current.label ?? ""));
    const targetFollowers = targetItem ? parseFollowerTarget(targetItem.value) : undefined;
    if (targetFollowers) snapshot.mvu.platform.fanGoals.push({
      id: `fan-goal-${targetFollowers}`,
      targetFollowers,
      reward: rewardItem?.value ?? "",
      createdAt: snapshot.mvu.storyTime
    });
  }
  const definitions: Array<[string, string, string]> = [
    ["goal", "粉丝目标", "fanPlan.targetFollowers"],
    ["current-progress", "当前进度数值", "fanPlan.currentFollowers"],
    ["progress-percent", "当前进度百分比", "fanPlan.progressPercent"],
    ["reward", "达成奖励", "fanPlan.reward"],
    ["goal-completed", "目标完成状态", "fanPlan.completed"],
    ["next-goal", "新一阶段目标", "fanPlan.nextTargetFollowers"]
  ];
  section.items = definitions.map(([id, label, path], index) => ({
    ...(section.items.find((current) => current.id === id) ?? item(id, label, "computed", "derived", path)),
    id,
    label,
    value: "",
    permission: (index === 0 || index === 3 || index === 5 ? "temporary" : "computed") as "temporary" | "computed",
    origin: "initial" as const,
    source: { kind: "derived" as const, path }
  }));
}

function migrateMilestones(snapshot: StorySnapshot) {
  const section = findSection(snapshot, ["milestones", "section-milestones"], /里程碑/u);
  if (!section) return;
  section.page = "records";
  section.origin = "initial";
  section.items = section.items.filter((current) => current.origin === "ai" || current.value.trim().length > 0).map((current) => current.origin === "ai"
    ? current
    : {
        ...current,
        permission: "locked" as const,
        origin: "initial" as const,
        source: { kind: "literal" as const, path: `profile.sections.${section.id}.items.${safePart(current.id)}.value` }
      }).sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
}

function preciseSectionMigration(snapshot: StorySnapshot, hadFanGoals: boolean) {
  const hasConfiguredSections = snapshot.profile.sections.length > 0;
  migrateUsageSection(snapshot);
  migrateRegistrationSection(snapshot);
  migrateStatisticsSection(snapshot);
  migrateFanSection(snapshot, hadFanGoals);
  migrateMilestones(snapshot);
  if (hasConfiguredSections) ensureLiveSection(snapshot);
  snapshot.profile.sections.sort((a, b) => a.order - b.order);
}

export function migrateStorySnapshotV2(value: unknown): StorySnapshot {
  const hadCycle = rawHasPath(value, ["mvu", "heroine", "cycle"]);
  const hadStatistics = rawHasPath(value, ["mvu", "heroine", "statistics"]);
  const hadBio = rawHasPath(value, ["mvu", "heroine", "bio"]);
  const hadFanGoals = rawHasPath(value, ["mvu", "platform", "fanGoals"]);
  const parsed = StorySnapshotSchema.parse(value) as StorySnapshot;

  if (!hadCycle) parsed.mvu.heroine.cycle.anchorDate = storyTimeMinusDays(parsed.mvu.storyTime, 3);
  if (!hadStatistics) parsed.mvu.heroine.statistics.inseminationEvents = [];
  if (!hadBio) parsed.mvu.heroine.bio = parsed.accounts.find((account) => account.id === parsed.profile.accountId)?.bio ?? "";
  if (!parsed.profile.pinnedPostId) {
    parsed.profile.pinnedPostId = parsed.posts.find((post) => post.pinned && post.moderation !== "deleted" && post.moderation !== "hidden")?.id;
  }
  for (const post of parsed.posts) post.pinned = false;
  preciseSectionMigration(parsed, hadFanGoals);
  for (const trend of parsed.trends) if (trend.updatedAt === "2026-01-01T00:00+08:00") trend.updatedAt = parsed.mvu.storyTime;
  return synchronizeDerivedState(parsed);
}

export function migrateStorySnapshotJson(value: string) {
  return JSON.stringify(migrateStorySnapshotV2(JSON.parse(value)));
}
