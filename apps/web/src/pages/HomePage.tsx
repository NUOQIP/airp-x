import type { ProfileSection } from "@airp/shared";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flag,
  Gauge,
  MapPin,
  Pencil,
  Radio,
  Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";
import { AccountProfileEditor } from "../components/AccountProfileEditor";
import { AvatarEditor } from "../components/AvatarEditor";
import { BannerEditor } from "../components/BannerEditor";
import { PostCard } from "../components/PostCard";
import { Avatar, Empty, Spinner, Verified } from "../components/ui";
import { useSnapshot } from "../hooks/use-airp";
import { compactNumber, storyDate } from "../lib/format";

const bannerClass = {
  sky: "from-sky-400 via-cyan-200 to-blue-100",
  rose: "from-rose-400 via-fuchsia-200 to-orange-100",
  violet: "from-violet-500 via-indigo-300 to-sky-200",
  amber: "from-amber-400 via-orange-200 to-rose-200",
  night: "from-slate-950 via-indigo-950 to-violet-800"
};

const emphasisClass = {
  normal: "text-ink",
  accent: "text-accent",
  success: "text-emerald-600",
  warning: "text-amber-600",
  danger: "text-rose-600"
};

const kindMeta = {
  facts: { label: "人物资料", icon: Flag },
  stats: { label: "数据记录", icon: BarChart3 },
  progress: { label: "目标进度", icon: Gauge },
  timeline: { label: "时间线", icon: Clock3 },
  status: { label: "实时状态", icon: Radio },
  notice: { label: "重要说明", icon: BellRing }
};

type ProfilePage = "posts" | "records";

const profileTabs: Array<{ value: ProfilePage; label: string }> = [
  { value: "posts", label: "帖文" },
  { value: "records", label: "记录" }
];

function progressValue(section: ProfileSection) {
  const text = section.items.map((item) => `${item.label ?? ""} ${item.value}`).join(" ");
  const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : 0;
}

function SectionHeading({ section, inverted = false }: { section: ProfileSection; inverted?: boolean }) {
  const meta = kindMeta[section.kind];
  const Icon = meta.icon;
  return <div className="flex items-start justify-between gap-3">
    <div className="flex items-center gap-2.5">
      <span className={`grid h-8 w-8 place-items-center rounded-xl ${inverted ? "bg-white/12 text-white" : "bg-slate-100 text-ink"}`}><Icon size={16} /></span>
      <div><h2 className="font-extrabold leading-5">{section.title}</h2><div className={`mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${inverted ? "text-white/50" : "text-muted"}`}>{meta.label}</div></div>
    </div>
  </div>;
}

function ProfileSectionCard({ section }: { section: ProfileSection }) {
  if (section.kind === "status") return <article className="profile-panel relative col-span-2 overflow-hidden border-0 bg-slate-950 p-5 text-white shadow-[0_18px_45px_-28px_rgba(15,23,42,.9)]">
    <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-fuchsia-500/20 blur-3xl" />
    <div className="absolute -bottom-24 left-24 h-44 w-44 rounded-full bg-sky-400/15 blur-3xl" />
    <div className="relative"><SectionHeading section={section} inverted /><div className="mt-4 grid grid-cols-2 gap-2.5">
      {section.items.map((item, index) => <div key={item.id} className={`${index === 0 && section.items.length % 2 === 1 ? "col-span-2" : ""} rounded-2xl border border-white/10 bg-white/[.07] px-3.5 py-3 backdrop-blur-sm`}>
        {item.label && <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-white/45">{item.label}</div>}
        <div className="plain-content text-[13px] font-semibold leading-5 text-white/90">{item.value}</div>
      </div>)}
    </div></div>
  </article>;

  if (section.kind === "progress") {
    const percentage = progressValue(section);
    return <article className="profile-panel bg-gradient-to-br from-white to-sky-50/80 p-4">
      <SectionHeading section={section} />
      <div className="mt-4 flex items-end justify-between"><div className="text-3xl font-black tracking-tight text-ink">{percentage ? `${percentage}%` : "进行中"}</div><Activity size={20} className="mb-1 text-accent" /></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-fuchsia-500 transition-all" style={{ width: `${percentage || 12}%` }} /></div>
      <div className="mt-3 space-y-2">{section.items.map((item) => <div key={item.id} className="text-xs leading-5"><span className="font-bold text-muted">{item.label ? `${item.label}：` : ""}</span><span className={`plain-content ${emphasisClass[item.emphasis]}`}>{item.value}</span></div>)}</div>
    </article>;
  }

  if (section.kind === "stats") return <article className="profile-panel bg-white p-4">
    <SectionHeading section={section} />
    <div className="mt-3 grid grid-cols-2 gap-2">{section.items.map((item) => <div key={item.id} className="rounded-xl bg-slate-50 px-3 py-2.5">
      {item.label && <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{item.label}</div>}
      <div className={`plain-content mt-1 font-extrabold leading-5 ${item.value.length > 18 ? "text-xs" : "text-base"} ${emphasisClass[item.emphasis]}`}>{item.value}</div>
    </div>)}</div>
  </article>;

  if (section.kind === "timeline") return <article className="profile-panel bg-white p-4">
    <SectionHeading section={section} />
    <div className="relative mt-4 space-y-3 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-slate-200">{section.items.map((item, index) => <div key={item.id} className="relative pl-5">
      <span className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-[3px] border-white ${index === 0 ? "bg-accent ring-2 ring-sky-100" : "bg-slate-300"}`} />
      {item.label && <div className="text-[11px] font-extrabold text-ink">{item.label}</div>}
      <div className={`plain-content text-xs leading-5 ${emphasisClass[item.emphasis]}`}>{item.value}</div>
    </div>)}</div>
  </article>;

  if (section.kind === "notice") return <article className="profile-panel bg-gradient-to-br from-amber-50 to-white p-4">
    <SectionHeading section={section} />
    <div className="mt-3 space-y-2">{section.items.map((item) => <div key={item.id} className="flex gap-2 rounded-xl border border-amber-100/80 bg-white/75 px-2.5 py-2">
      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-amber-500" /><div className="plain-content text-xs leading-5">{item.label && <span className="font-extrabold">{item.label}：</span>}<span className={emphasisClass[item.emphasis]}>{item.value}</span></div>
    </div>)}</div>
  </article>;

  return <article className="profile-panel col-span-2 bg-white p-4">
    <SectionHeading section={section} />
    <div className="mt-3 grid grid-cols-2 gap-x-5">{section.items.map((item) => <div key={item.id} className="border-t border-slate-100 py-2.5 first:border-t-0">
      {item.label && <div className="text-[10px] font-bold uppercase tracking-wide text-muted">{item.label}</div>}
      <div className={`plain-content mt-0.5 text-[13px] font-semibold leading-5 ${emphasisClass[item.emphasis]}`}>{item.value}</div>
    </div>)}</div>
  </article>;
}

function UsageNotice({ section }: { section: ProfileSection }) {
  return <section key={section.items.map((item) => `${item.id}:${item.value}`).join("|")} className="component-refresh mt-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-white">
    <div className="flex items-center gap-2 border-b border-amber-100 px-3.5 py-2.5"><BellRing size={15} className="text-amber-600" /><h2 className="text-sm font-extrabold">{section.title}</h2></div>
    <div className="space-y-2 px-3.5 py-3">{section.items.map((item) => <div key={item.id} className="flex gap-2 text-[13px] leading-5">
      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-amber-500" />
      <div className="plain-content">{item.label && <span className="font-extrabold">{item.label}：</span>}<span className={emphasisClass[item.emphasis]}>{item.value}</span></div>
    </div>)}</div>
  </section>;
}

export function HomePage() {
  const { data, isLoading, error } = useSnapshot();
  const [activePage, setActivePage] = useState<ProfilePage>("posts");
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [bannerEditorOpen, setBannerEditorOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  if (isLoading) return <div className="p-8"><Spinner label="载入主页" /></div>;
  if (!data || error) return <Empty title="主页暂时不可用" detail={error instanceof Error ? error.message : "请确认本地服务已经启动"} />;
  if (data.mvu.extensions.homepageConfigured === false) return <div>
    <header className="sticky top-0 z-20 flex h-[53px] items-center border-b border-line bg-white/90 px-4 backdrop-blur-md"><h1 className="text-xl font-extrabold">主页</h1></header>
    <div className="mx-auto flex min-h-[620px] max-w-lg flex-col items-center justify-center px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-accent"><Sparkles size={30} /></div>
      <h2 className="mt-5 text-2xl font-extrabold">这个主页还是空白的</h2>
      <p className="mt-2 text-sm leading-6 text-muted">粘贴一段自然语言主页，AI 会先把账号、数字、栏目和当前状态整理成可预览的结构；确认后才会写入当前会话。</p>
      <Link to="/config?tab=homepage" className="x-primary mt-6">建设主页</Link>
      <p className="mt-3 text-xs text-muted">这一步不推进剧情，也不会自动生成帖文或私信。</p>
    </div>
  </div>;
  const account = data.accounts.find((item) => item.id === data.profile.accountId);
  if (!account) return <Empty title="主页账号缺失" detail="请从备份恢复或重新建设主页。" />;
  const posts = [...data.posts].filter((post) => post.authorId === account.id && post.moderation !== "deleted" && post.moderation !== "hidden").sort((a, b) =>
    Number(b.id === data.profile.pinnedPostId) - Number(a.id === data.profile.pinnedPostId) || b.createdAt.localeCompare(a.createdAt)
  );
  const sections = [...data.profile.sections].sort((a, b) => {
    const priority = { facts: 0, stats: 1, timeline: 2, notice: 3, status: 4, progress: 5 };
    return priority[a.kind] - priority[b.kind] || a.order - b.order;
  });
  const usageSections = sections.filter((section) => (section.page as string | undefined) === "bio" || (section.kind === "notice" && /使用须知|须知/.test(section.title)));
  const usageSectionIds = new Set(usageSections.map((section) => section.id));
  const recordSections = sections.filter((section) => {
    if (usageSectionIds.has(section.id) || section.kind === "status" || section.kind === "progress") return false;
    const page = section.page as string | undefined;
    return page === "records" || page === "about" || (!page && section.kind !== "notice");
  }).map((section) => section.kind === "facts" ? {
    ...section,
    items: section.items.filter((item) => !/排卵|周期/.test(item.label ?? "") && !/(?:^|\.)cycle(?:\.|$)/.test(item.source?.path ?? ""))
  } : section).filter((section) => section.items.length > 0);
  const currentLocation = data.mvu.heroine.location || data.profile.location;
  const emptyCopy = { title: "主页资料已经就绪", detail: "目前还没有可展示的帖文。通过私信开启剧情后，AI 可以生成包含文字、图片、视频与直播表现的首批动态。" };
  const safeBannerUrl = data.profile.bannerUrl && /^data:image\/(?:png|jpeg|webp);base64,/i.test(data.profile.bannerUrl) ? data.profile.bannerUrl : undefined;
  return <div>
    <header className="sticky top-0 z-20 flex h-[53px] items-center border-b border-line bg-white/90 px-4 backdrop-blur-md">
      <div className="min-w-0"><h1 className="truncate text-xl font-extrabold leading-5">{account.displayName}</h1><div key={`post-count:${data.profile.postCount}`} className="component-refresh text-xs text-muted">{compactNumber(data.profile.postCount)} 帖文</div></div>
    </header>
    <section>
      <div className={`profile-banner relative h-[200px] overflow-hidden bg-gradient-to-br ${bannerClass[data.profile.bannerTone]}`} style={safeBannerUrl ? { backgroundImage: `url(${safeBannerUrl})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}>
        {!safeBannerUrl && <><div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-white/20" /><div className="absolute bottom-5 left-40 h-24 w-80 -rotate-6 rounded-full bg-white/15" /></>}
        <button type="button" onClick={() => setBannerEditorOpen(true)} className="absolute right-4 top-3 flex items-center gap-1.5 rounded-full border border-white/40 bg-black/35 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md transition hover:bg-black/55"><Pencil size={13} />编辑封面</button>
        <div className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full border border-white/40 bg-black/20 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-md"><Clock3 size={13} />{storyDate(data.mvu.storyTime)}</div>
      </div>
      <div className="relative px-4 pb-5">
        <div className="absolute -top-[70px] left-4">
          <button
            type="button"
            aria-label="编辑头像"
            className="group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            onClick={() => setAvatarEditorOpen(true)}
          >
            <Avatar name={account.displayName} seed={account.avatarSeed} text={account.avatarText} url={account.avatarUrl} size="xl" />
            <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-black/65 text-white shadow-lg transition group-hover:bg-accent"><Pencil size={14} /></span>
          </button>
        </div>
        <div className="flex h-[76px] items-start justify-end pt-3"><button type="button" className="x-secondary flex items-center gap-1.5 text-sm" onClick={() => setProfileEditorOpen(true)}><Pencil size={14} />编辑资料</button></div>
        <h1 className="text-xl font-extrabold leading-6">{account.displayName}{account.verified && <Verified />}</h1>
        <div className="text-[15px] text-muted">@{account.handle}</div>
        <p key={`bio:${account.bio}`} className="component-refresh plain-content mt-3 text-[15px] leading-5">{account.bio}</p>
        {usageSections.map((section) => <UsageNotice key={section.id} section={section} />)}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {currentLocation && <span key={`location:${currentLocation}`} className="component-refresh flex items-center gap-1"><MapPin size={16} />{currentLocation}</span>}
          {data.profile.joinedAt && <span className="flex items-center gap-1"><CalendarDays size={16} />{data.profile.joinedAt}</span>}
        </div>
        <div className="mt-3 flex gap-5 text-sm"><span key={`followers:${data.profile.followerCount}`} className="component-refresh"><strong>{compactNumber(data.profile.followerCount)}</strong> <span className="text-muted">关注者</span></span></div>
      </div>
    </section>
    <nav role="tablist" aria-label="个人主页内容" className="sticky top-[53px] z-10 grid h-[53px] grid-cols-2 border-y border-line bg-white/95 text-sm font-medium backdrop-blur">
      {profileTabs.map((tab) => <button key={tab.value} role="tab" aria-selected={activePage === tab.value} onClick={() => setActivePage(tab.value)} className={`relative outline-none transition hover:bg-slate-50 focus-visible:bg-sky-50 ${activePage === tab.value ? "font-extrabold text-ink" : "text-muted"}`}>{tab.label}{activePage === tab.value && <span className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-accent" />}</button>)}
    </nav>
    {activePage === "records" ? <section key={activePage} role="tabpanel" className="min-h-[360px] border-b border-line bg-[#f7f9f9] px-4 py-5">
      {recordSections.length > 0 ? <div className="grid grid-cols-2 gap-3">{recordSections.map((section) => <div key={`${section.id}:${section.items.map((item) => item.value).join("|")}`} className={`component-refresh ${recordSections.length <= 2 || section.kind === "facts" ? "col-span-2" : ""}`}><ProfileSectionCard section={section} /></div>)}</div> : <div className="flex min-h-72 flex-col items-center justify-center text-center"><div className="grid h-12 w-12 place-items-center rounded-full bg-white text-accent shadow-sm"><Sparkles size={22} /></div><h2 className="mt-4 text-lg font-extrabold">记录页还没有内容</h2><p className="mt-1 text-sm text-muted">长期档案、统计与里程碑会集中显示在这里。</p></div>}
    </section> : <div key={activePage} role="tabpanel" className="reveal-item">
      {posts.length > 0 ? posts.map((post) => <PostCard key={post.id} post={post} snapshot={data} />) : <div className="flex min-h-[360px] flex-col items-center justify-center border-b border-line px-10 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-sky-50 text-accent"><Sparkles size={22} /></div><h2 className="mt-4 text-lg font-extrabold">{emptyCopy.title}</h2><p className="mt-1 max-w-sm text-sm leading-6 text-muted">{emptyCopy.detail}</p><Link to="/messages/dm-player-heroine" className="x-primary mt-4">去私信开启剧情</Link>
      </div>}
    </div>}
    <AvatarEditor account={account} branchId={data.session.activeBranchId} open={avatarEditorOpen} onOpenChange={setAvatarEditorOpen} />
    <AccountProfileEditor account={account} branchId={data.session.activeBranchId} open={profileEditorOpen} onOpenChange={setProfileEditorOpen} />
    <BannerEditor branchId={data.session.activeBranchId} currentTone={data.profile.bannerTone} currentUrl={data.profile.bannerUrl} open={bannerEditorOpen} onOpenChange={setBannerEditorOpen} />
  </div>;
}
