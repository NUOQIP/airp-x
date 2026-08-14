import type { AppSnapshot, ProfileSection } from "@airp/shared";
import { Activity, CalendarClock, Gauge, MapPin, Radio, Sparkles, TrendingUp } from "lucide-react";
import { compactNumber } from "../lib/format";
import { HistoryControls } from "./HistoryControls";

type RailMode = "full" | "trends";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function display(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function sectionItem(section: ProfileSection | undefined, patterns: RegExp[]) {
  const item = section?.items.find((candidate) => patterns.some((pattern) => pattern.test(candidate.label ?? "")));
  return item?.value.trim() ?? "";
}

function legacySection(snapshot: AppSnapshot, kind: ProfileSection["kind"], title?: RegExp) {
  return snapshot.profile.sections.find((section) => section.kind === kind && (!title || title.test(section.title)));
}

function liveItems(snapshot: AppSnapshot) {
  const heroine = record(snapshot.mvu.heroine) ?? {};
  const derived = record((snapshot.mvu as unknown as UnknownRecord).derived);
  const cycle = record(derived?.cycle);
  const legacy = legacySection(snapshot, "status");
  const legacyCycle = snapshot.profile.sections.flatMap((section) => section.items).find((item) => /排卵|周期/.test(item.label ?? ""));
  const phaseLabels: Record<string, string> = { menstruation: "经期", follicular: "卵泡期", ovulation: "排卵期", luteal: "黄体期", suspected: "疑似妊娠", pregnant: "妊娠中" };
  const phase = display(cycle?.phase);
  const cycleDay = display(cycle?.cycleDay);
  const values = [
    { label: "当前状态", value: display(heroine.status) || sectionItem(legacy, [/状态/, /实况/]), icon: Radio },
    { label: "当前活动", value: display(heroine.activity) || sectionItem(legacy, [/活动/, /行为/]), icon: Activity },
    { label: "当前穿搭", value: display(heroine.outfit) || sectionItem(legacy, [/穿搭/, /服装/]), icon: Sparkles },
    { label: "当前心情", value: display(heroine.mood) || sectionItem(legacy, [/心情/, /情绪/]), icon: Activity },
    { label: "当前位置", value: display(heroine.location) || snapshot.profile.location, icon: MapPin },
    { label: "当前周期", value: phase ? `${phaseLabels[phase] ?? phase}${cycleDay ? ` · 第 ${cycleDay} 天` : ""}` : sectionItem(legacy, [/排卵/, /周期/]) || legacyCycle?.value.trim() || "", icon: CalendarClock }
  ];
  const pregnancy = record(cycle?.pregnancy);
  if (pregnancy) {
    const status = display(pregnancy.status);
    const elapsed = display(pregnancy.elapsedDays);
    const duration = display(pregnancy.durationDays);
    const stage = display(pregnancy.stage);
    const progress = display(pregnancy.progressPercent);
    const stageLabels: Record<string, string> = { early: "早期", middle: "中期", late: "后期" };
    values.push({
      label: "妊娠进度",
      value: status === "confirmed"
        ? [stageLabels[stage] ?? stage, `${elapsed || "0"} / ${duration || "?"} 天`, progress ? `${progress}%` : ""].filter(Boolean).join(" · ")
        : ({ suspected: "疑似", ended: "已结束", none: "无" }[status] ?? status),
      icon: CalendarClock
    });
  }
  const knownLabels = /状态|实况|活动|行为|穿搭|服装|心情|情绪|位置|地点|排卵|周期|妊娠|下次/;
  const knownSources = new Set(["heroine.status", "heroine.activity", "heroine.outfit", "heroine.mood", "heroine.location", "cycle.phase", "cycle.nextChangeAt"]);
  for (const item of legacy?.items ?? []) {
    if (!item.value.trim() || knownLabels.test(item.label ?? "") || knownSources.has(item.source?.path ?? "")) continue;
    values.push({ label: item.label || "临时状态", value: item.value.trim(), icon: Sparkles });
  }
  return values.filter((item) => item.value);
}

function fanPlan(snapshot: AppSnapshot) {
  const derived = record((snapshot.mvu as unknown as UnknownRecord).derived);
  const plan = record(derived?.fanPlan);
  const legacy = legacySection(snapshot, "progress");
  const legacyText = legacy?.items.map((item) => `${item.label ?? ""} ${item.value}`).join(" ") ?? "";
  const legacyPercent = legacyText.match(/(\d{1,3}(?:\.\d+)?)\s*%/)?.[1];
  const percent = Math.max(0, Math.min(100, Number(plan?.progressPercent ?? legacyPercent ?? 0)));
  return {
    title: legacy?.title || "宠粉计划",
    target: typeof plan?.targetFollowers === "number" ? compactNumber(plan.targetFollowers) : display(plan?.targetFollowers) || sectionItem(legacy, [/目标/]),
    current: typeof plan?.currentFollowers === "number" ? compactNumber(plan.currentFollowers) : display(plan?.currentFollowers) || compactNumber(snapshot.profile.followerCount),
    reward: display(plan?.reward) || sectionItem(legacy, [/奖励/]),
    nextTarget: typeof plan?.nextTargetFollowers === "number" ? compactNumber(plan.nextTargetFollowers) : display(plan?.nextTargetFollowers),
    completed: plan?.completed === true,
    percent,
    hasPlan: Boolean(plan || legacy)
  };
}

function LiveStatusCard({ snapshot }: { snapshot: AppSnapshot }) {
  const items = liveItems(snapshot);
  const signature = items.map((item) => `${item.label}:${item.value}`).join("|");
  return <section key={signature} className="rail-card component-refresh overflow-hidden bg-slate-950 text-white">
    <div className="relative overflow-hidden px-4 pb-2 pt-4">
      <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="relative flex items-center gap-2"><Radio size={18} className="text-sky-300" /><h2 className="text-lg font-extrabold">母狗实况</h2></div>
    </div>
    {items.length > 0 ? <div className="relative space-y-1 px-2 pb-3">
      {items.map(({ label, value, icon: Icon }) => <div key={`${label}:${value}`} className="rounded-xl px-2 py-2.5 transition hover:bg-white/[.07]">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45"><Icon size={11} />{label}</div>
        <div className="plain-content text-[13px] font-semibold leading-5 text-white/90">{value}</div>
      </div>)}
    </div> : <p className="px-4 pb-4 text-sm text-white/55">剧情开始后，人物的动态状态会显示在这里。</p>}
  </section>;
}

function FanPlanCard({ snapshot }: { snapshot: AppSnapshot }) {
  const plan = fanPlan(snapshot);
  if (!plan.hasPlan) return null;
  const signature = `${plan.target}|${plan.current}|${plan.reward}|${plan.nextTarget}|${plan.percent}|${plan.completed}`;
  return <section key={signature} className="rail-card component-refresh bg-gradient-to-br from-white to-sky-50/80 p-4">
    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Gauge size={18} className="text-accent" /><h2 className="text-lg font-extrabold">{plan.title}</h2></div><span className="metric-pop text-xl font-black text-accent">{plan.completed ? "完成" : `${plan.percent}%`}</span></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-fuchsia-500 transition-[width] duration-700" style={{ width: `${plan.percent}%` }} /></div>
    <div className="mt-3 space-y-2 text-xs leading-5">
      {plan.target && <div><span className="font-bold text-muted">目标：</span>{plan.target}</div>}
      {plan.current && <div><span className="font-bold text-muted">当前：</span>{plan.current}</div>}
      {plan.reward && <div className="plain-content"><span className="font-bold text-muted">达成奖励：</span>{plan.reward}</div>}
      {plan.nextTarget && <div><span className="font-bold text-muted">下一目标：</span>{plan.nextTarget}</div>}
    </div>
  </section>;
}

function TrendsCard({ snapshot }: { snapshot: AppSnapshot }) {
  return <section className="rail-card overflow-hidden bg-[#f7f9f9]">
    <div className="flex items-center gap-2 px-4 pb-2 pt-3"><TrendingUp size={18} /><h2 className="text-xl font-extrabold">热门趋势</h2></div>
    {snapshot.trends.length ? snapshot.trends.map((trend) => <div key={`${trend.id ?? trend.label}:${trend.rank}:${trend.volumeLabel}:${trend.heatScore}:${trend.updatedAt}`} className="component-refresh px-4 py-3 transition hover:bg-slate-100">
      <div className="text-xs text-muted">{trend.rank} · 热门</div>
      <div className="font-bold">#{trend.label.replace(/^#/, "")}</div>
      <div className="text-xs text-muted">{trend.volumeLabel}</div>
    </div>) : <div className="px-4 pb-4 pt-1"><div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-4 text-center"><Sparkles size={17} className="mx-auto text-accent" /><div className="mt-2 text-sm font-bold">等待剧情升温</div><p className="mt-1 text-xs leading-5 text-muted">热点与趋势会随回合实时出现。</p></div></div>}
  </section>;
}

export function RightRail({ snapshot, mode }: { snapshot: AppSnapshot; mode: RailMode }) {
  return <div className="space-y-4 pb-5">
    {mode === "full" && <>
      <HistoryControls />
      <LiveStatusCard snapshot={snapshot} />
      <FanPlanCard snapshot={snapshot} />
    </>}
    <TrendsCard snapshot={snapshot} />
  </div>;
}
