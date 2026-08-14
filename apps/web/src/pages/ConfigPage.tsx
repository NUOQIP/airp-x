import { useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ConfigSnapshot, HomepageDraft, PromptBlock, PromptPresetItem, PromptStackMarker, RegexRule, UserMacro, WorldbookEntry } from "@airp/shared";
import { BookOpen, Bot, Braces, CheckCircle2, ChevronDown, ChevronUp, Copy, Database, Download, FileText, GitBranch, GripVertical, KeyRound, Layers3, Library, Plus, Save, TestTube2, Trash2, Upload, UserRoundCog, WandSparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Empty, Spinner } from "../components/ui";
import { useConfig } from "../hooks/use-airp";
import { useSnapshot } from "../hooks/use-airp";
import { api, apiClient } from "../lib/api";

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="mb-5"><h2 className="text-xl font-extrabold">{title}</h2><p className="mt-1 text-sm text-muted">{detail}</p></div>;
}

function Toggle({ checked, onCheckedChange, disabled = false }: { checked: boolean; onCheckedChange: (value: boolean) => void; disabled?: boolean }) {
  return <Switch.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="relative h-6 w-11 rounded-full bg-slate-300 data-[state=checked]:bg-accent disabled:opacity-50"><Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition data-[state=checked]:translate-x-[22px]" /></Switch.Root>;
}

function ModelSettings({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ ...config.settings, apiKey: "" });
  const save = useMutation({
    mutationFn: () => apiClient.saveSettings({
      apiBaseUrl: form.apiBaseUrl, model: form.model, thinkingMode: form.thinkingMode, reasoningEffort: form.reasoningEffort, temperature: Number(form.temperature), maxOutputTokens: Number(form.maxOutputTokens), topP: Number(form.topP),
      frequencyPenalty: Number(form.frequencyPenalty), presencePenalty: Number(form.presencePenalty), contextWindow: Number(form.contextWindow), recentHistoryMessages: Number(form.recentHistoryMessages), summaryTargetWords: Number(form.summaryTargetWords),
      ...(form.apiKey ? { apiKey: form.apiKey } : {})
    }),
    onSuccess: () => { setForm((value) => ({ ...value, apiKey: "" })); client.invalidateQueries({ queryKey: ["config"] }); }
  });
  const test = useMutation({
    mutationFn: () => apiClient.testSettings({ apiBaseUrl: form.apiBaseUrl, model: form.model, thinkingMode: form.thinkingMode, reasoningEffort: form.reasoningEffort, ...(form.apiKey ? { apiKey: form.apiKey } : {}) })
  });
  return <div>
    <SectionTitle title="模型与连接" detail="支持 OpenAI 严格 JSON Schema；DeepSeek 官方接口会自动使用 JSON Output，再由本地 Zod 严格校验。API Key 仅写入本机 .env。" />
    <div className="grid grid-cols-2 gap-4">
      <label className="col-span-2 text-sm font-bold">Base URL<input className="x-input mt-1 font-mono text-sm" value={form.apiBaseUrl} onChange={(event) => setForm({ ...form, apiBaseUrl: event.target.value })} /></label>
      <label className="text-sm font-bold">API Key<input type="password" className="x-input mt-1" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={config.settings.hasApiKey ? `已保存：${config.settings.apiKeyPreview}` : "尚未配置"} /></label>
      <label className="text-sm font-bold">模型名称<input className="x-input mt-1 font-mono text-sm" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型 ID" /></label>
      <div className="col-span-2 grid grid-cols-2 gap-4 rounded-2xl border border-line bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-4">
          <div><div className="text-sm font-bold">思考模式</div><p className="mt-1 text-xs text-muted">开启后先推理，再仅解析最终 JSON；当前用于 DeepSeek 官方接口。</p></div>
          <Toggle checked={form.thinkingMode === "enabled"} onCheckedChange={(checked) => setForm({ ...form, thinkingMode: checked ? "enabled" : "disabled" })} />
        </div>
        <label className={`text-sm font-bold ${form.thinkingMode === "disabled" ? "opacity-50" : ""}`}>思考强度
          <select className="x-input mt-1" disabled={form.thinkingMode === "disabled"} value={form.reasoningEffort} onChange={(event) => setForm({ ...form, reasoningEffort: event.target.value as "high" | "max" })}>
            <option value="high">高（默认）</option>
            <option value="max">最高</option>
          </select>
        </label>
      </div>
      <label className="text-sm font-bold">Temperature<input type="number" min="0" max="2" step="0.05" className="x-input mt-1" value={form.temperature} onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">Top P<input type="number" min="0" max="1" step="0.05" className="x-input mt-1" value={form.topP} onChange={(event) => setForm({ ...form, topP: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">最大输出 Token<input type="number" className="x-input mt-1" value={form.maxOutputTokens} onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">模型上下文窗口<input type="number" className="x-input mt-1" value={form.contextWindow} onChange={(event) => setForm({ ...form, contextWindow: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">Frequency penalty<input type="number" min="-2" max="2" step="0.1" className="x-input mt-1" value={form.frequencyPenalty} onChange={(event) => setForm({ ...form, frequencyPenalty: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">Presence penalty<input type="number" min="-2" max="2" step="0.1" className="x-input mt-1" value={form.presencePenalty} onChange={(event) => setForm({ ...form, presencePenalty: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">保留最近回合<input type="number" className="x-input mt-1" value={form.recentHistoryMessages} onChange={(event) => setForm({ ...form, recentHistoryMessages: Number(event.target.value) })} /></label>
      <label className="text-sm font-bold">滚动记忆目标词数<input type="number" className="x-input mt-1" value={form.summaryTargetWords} onChange={(event) => setForm({ ...form, summaryTargetWords: Number(event.target.value) })} /></label>
    </div>
    <div className="mt-5 flex items-center gap-3"><button className="x-primary flex items-center gap-2" disabled={save.isPending} onClick={() => save.mutate()}><Save size={17} />保存设置</button><button className="x-secondary flex items-center gap-2" disabled={test.isPending} onClick={() => test.mutate()}><TestTube2 size={17} />结构化输出测试</button></div>
    {save.error && <p className="mt-3 text-sm text-rose-600">{save.error.message}</p>}
    {test.error && <p className="mt-3 text-sm text-rose-600">{test.error.message}</p>}
    {test.data && <p className="mt-3 flex items-center gap-2 text-sm font-bold text-emerald-600"><CheckCircle2 size={17} />{test.data.mode === "json_schema" ? "连接与服务端严格 Schema 均可用" : "连接与 DeepSeek JSON Output 均可用；本地严格校验已启用"}：{test.data.model}</p>}
  </div>;
}

function RoleCards({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState(config.roleCards.find((card) => card.active)?.id ?? config.roleCards[0]?.id);
  const selected = config.roleCards.find((card) => card.id === selectedId) ?? config.roleCards[0];
  const [draft, setDraft] = useState(selected);
  useEffect(() => setDraft(selected), [selected]);
  const save = useMutation({
    mutationFn: async ({ copy = false, importedText }: { copy?: boolean; importedText?: string }) => {
      if (!draft) throw new Error("没有选中的角色卡");
      const body = { role: draft.role, name: copy ? `${draft.name} · 副本` : draft.name, version: draft.version, rawText: importedText ?? draft.rawText, activate: true };
      if (copy || selected?.id.endsWith("-default") || importedText) return api<ConfigSnapshot>("/api/config/role-cards", { method: "POST", body: JSON.stringify(body) });
      return api<ConfigSnapshot>(`/api/config/role-cards/${draft.id}`, { method: "PUT", body: JSON.stringify(body) });
    },
    onSuccess: (value) => {
      client.setQueryData(["config"], value);
      const saved = value.roleCards.find((card) => card.role === draft?.role && card.active);
      if (saved) { setSelectedId(saved.id); setDraft(saved); }
    }
  });
  if (!draft) return <Empty title="没有角色卡" detail="导入玩家或女主角色卡后才能生成剧情。" />;
  const readonly = draft.id.endsWith("-default");
  return <div>
    <SectionTitle title="角色卡库" detail="原始卡整段保存且永久只读；需要修改时先复制。MVU 与滚动记忆记录剧情变化。" />
    <div className="mb-4 flex flex-wrap gap-2">{config.roleCards.map((card) => <button key={card.id} onClick={() => setSelectedId(card.id)} className={`rounded-full border px-3 py-1.5 text-sm ${card.id === draft.id ? "border-ink bg-ink text-white" : "border-slate-300"}`}>{card.role === "player" ? "玩家" : "女主"} · {card.name}{card.active ? " ✓" : ""}</button>)}</div>
    <div className="grid grid-cols-[1fr_130px] gap-3"><label className="text-sm font-bold">名称<input disabled={readonly} className="x-input mt-1" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="text-sm font-bold">版本<input disabled={readonly} className="x-input mt-1" value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} /></label></div>
    <label className="mt-3 block text-sm font-bold">角色卡原文<textarea disabled={readonly} className="x-input mt-1 min-h-[420px] resize-y font-mono text-xs leading-5 disabled:bg-slate-50" value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} /></label>
    <div className="mt-4 flex gap-2"><button className="x-primary flex items-center gap-2" onClick={() => save.mutate({ copy: readonly })}><Library size={17} />{readonly ? "复制为可编辑卡" : "保存角色卡"}</button><button className="x-secondary flex items-center gap-2" onClick={() => fileRef.current?.click()}><Upload size={17} />导入文本/JSON</button><input ref={fileRef} type="file" accept=".txt,.md,.json" className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; if (file) save.mutate({ importedText: await file.text() }); }} /></div>
    {save.error && <p className="mt-2 text-sm text-rose-600">{save.error.message}</p>}
  </div>;
}

const promptMarkerMeta: Record<PromptStackMarker, { name: string; source: string; mode: "动态注入" | "聊天深度" }> = {
  worldbook_before_cards: { name: "世界书 · 角色卡之前", source: "运行时扫描已启用世界书，将命中的 before_cards 条目放在这里。", mode: "动态注入" },
  rules: { name: "当前规则预设", source: "读取当前启用的玩法规则全文。", mode: "动态注入" },
  player_card: { name: "玩家角色卡", source: "读取当前启用的玩家卡，并展开玩家作用域宏。", mode: "动态注入" },
  heroine_card: { name: "女主角色卡", source: "读取当前启用的女主卡，并展开女主作用域宏。", mode: "动态注入" },
  worldbook_after_cards: { name: "世界书 · 角色卡之后", source: "运行时注入命中的 after_cards 世界书条目。", mode: "动态注入" },
  mvu_state: { name: "MVU 当前状态", source: "每轮读取当前分支的最新 MVU JSON，不包含主页原始输入。", mode: "动态注入" },
  profile_state: { name: "主页结构化状态", source: "每轮读取主页数字、栏目和当前故事时间。", mode: "动态注入" },
  worldbook_before_history: { name: "世界书 · 历史之前", source: "运行时注入命中的 before_history 世界书条目。", mode: "动态注入" },
  rolling_memory: { name: "滚动记忆", source: "有滚动总结时注入；为空时此位置不会产生消息。", mode: "动态注入" },
  recent_history: { name: "最近回合", source: "按模型设置中的保留回合数读取当前分支历史。", mode: "动态注入" },
  worldbook_author_note_top: { name: "世界书 · 作者注释顶部", source: "兼容酒馆 AN Top（位置 2）：将命中条目注入作者注释区域顶部。", mode: "动态注入" },
  worldbook_author_note_bottom: { name: "世界书 · 作者注释底部", source: "兼容酒馆 AN Bottom（位置 3）：将命中条目注入作者注释区域底部。", mode: "动态注入" },
  worldbook_at_depth: { name: "世界书 · 聊天深度", source: "命中的 at_depth 条目按各自深度插入当前输入之前。", mode: "聊天深度" },
  recent_platform: { name: "最近平台事件", source: "读取最近贴文、评论、私信和本地平台通知。", mode: "动态注入" },
  worldbook_after_history: { name: "世界书 · 历史之后", source: "运行时注入命中的 after_history 世界书条目。", mode: "动态注入" },
  current_input: { name: "当前玩家输入", source: "本轮评论或私信原文与目标 ID；这是必需块，不能关闭。", mode: "动态注入" }
};

const promptItemKey = (item: PromptPresetItem) => item.kind === "prompt" ? `prompt:${item.promptId}` : `marker:${item.marker}`;

function Prompts({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const [presetState, setPresetState] = useState(config.promptPresetState);
  const [selectedKey, setSelectedKey] = useState(() => {
    const first = config.promptPresetState.presets.find((preset) => preset.id === config.promptPresetState.activePresetId)?.items[0];
    return first ? promptItemKey(first) : "";
  });
  const [dragIndex, setDragIndex] = useState<number>();
  const activePreset = presetState.presets.find((preset) => preset.id === presetState.activePresetId) ?? presetState.presets[0]!;
  const selectedIndex = activePreset.items.findIndex((item) => promptItemKey(item) === selectedKey);
  const selectedItem = activePreset.items[selectedIndex];
  const selectedPrompt = selectedItem?.kind === "prompt" ? config.promptBlocks.find((prompt) => prompt.id === selectedItem.promptId) : undefined;
  const selectedMarker = selectedItem?.kind === "marker" ? selectedItem.marker : undefined;
  const [draft, setDraft] = useState<PromptBlock | undefined>(selectedPrompt);

  useEffect(() => setPresetState(config.promptPresetState), [config.promptPresetState]);
  useEffect(() => {
    if (selectedPrompt) setDraft(selectedPrompt);
    else if (selectedKey !== "prompt:new") setDraft(undefined);
  }, [selectedKey, selectedPrompt]);

  const updateActivePreset = (update: (items: PromptPresetItem[]) => PromptPresetItem[]) => setPresetState((current) => ({
    ...current,
    presets: current.presets.map((preset) => preset.id === current.activePresetId ? { ...preset, items: update(preset.items) } : preset)
  }));
  const moveItem = (from: number, to: number) => {
    if (from < 0 || to < 0 || from === to || to >= activePreset.items.length) return;
    updateActivePreset((items) => {
      const next = [...items];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };
  const savePreset = useMutation({
    mutationFn: (value: typeof presetState) => api<ConfigSnapshot>("/api/config/prompt-presets", { method: "PUT", body: JSON.stringify(value) }),
    onSuccess: (value) => {
      client.setQueryData(["config"], value);
      setPresetState(value.promptPresetState);
    }
  });
  const savePrompt = useMutation({
    mutationFn: (value: PromptBlock) => value.id === "new"
      ? api<ConfigSnapshot>("/api/config/prompts", { method: "POST", body: JSON.stringify({ name: value.name, role: value.role, content: value.content, enabled: true, order: value.order, injectionPosition: value.injectionPosition, injectionDepth: value.injectionDepth }) })
      : api<ConfigSnapshot>(`/api/config/prompts/${value.id}`, { method: "PUT", body: JSON.stringify(value) }),
    onSuccess: (value) => {
      const created = value.promptBlocks.find((prompt) => !config.promptBlocks.some((existing) => existing.id === prompt.id));
      client.setQueryData(["config"], value);
      setPresetState(value.promptPresetState);
      if (created) setSelectedKey(`prompt:${created.id}`);
    }
  });
  const deletePrompt = useMutation({
    mutationFn: (value: PromptBlock) => api<ConfigSnapshot>(`/api/config/prompts/${value.id}`, { method: "DELETE" }),
    onSuccess: (value) => {
      client.setQueryData(["config"], value);
      setPresetState(value.promptPresetState);
      const nextPreset = value.promptPresetState.presets.find((preset) => preset.id === value.promptPresetState.activePresetId) ?? value.promptPresetState.presets[0];
      const nextItem = nextPreset?.items[0];
      setSelectedKey(nextItem ? promptItemKey(nextItem) : "");
      setDraft(undefined);
    }
  });
  const itemName = (item: PromptPresetItem | undefined) => !item ? "边界" : item.kind === "marker" ? promptMarkerMeta[item.marker].name : config.promptBlocks.find((prompt) => prompt.id === item.promptId)?.name ?? "缺失提示词";
  const previousName = selectedIndex > 0 ? itemName(activePreset.items[selectedIndex - 1]) : "预设开头";
  const nextName = selectedIndex >= 0 && selectedIndex < activePreset.items.length - 1 ? itemName(activePreset.items[selectedIndex + 1]) : "预设结尾";

  return <div>
    <SectionTitle title="提示词预设与注入栈" detail="与酒馆的 Prompt Manager 类似：静态提示词和运行时动态标记共用一条顺序栈；聊天深度提示词按深度插入。保存预设后，实际发给模型的顺序会同步改变。" />
    <div className="mb-4 rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-end gap-3">
        <label className="min-w-44 text-sm font-bold">当前预设<select className="x-input mt-1" value={presetState.activePresetId} onChange={(event) => setPresetState({ ...presetState, activePresetId: event.target.value })}>{presetState.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
        <label className="min-w-0 flex-1 text-sm font-bold">预设名称<input className="x-input mt-1" value={activePreset.name} onChange={(event) => setPresetState({ ...presetState, presets: presetState.presets.map((preset) => preset.id === activePreset.id ? { ...preset, name: event.target.value } : preset) })} /></label>
        <button type="button" className="x-secondary flex shrink-0 items-center gap-2" onClick={() => {
          const copyId = `prompt-preset-${Date.now()}`;
          setPresetState({ ...presetState, activePresetId: copyId, presets: [...presetState.presets, { id: copyId, name: `${activePreset.name} · 副本`, items: activePreset.items.map((item) => ({ ...item })) }] });
        }}><Copy size={16} />复制预设</button>
        <button type="button" className="x-primary flex shrink-0 items-center gap-2" disabled={!activePreset.name.trim() || savePreset.isPending} onClick={() => savePreset.mutate(presetState)}><Save size={16} />{savePreset.isPending ? "保存中…" : "保存并启用"}</button>
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" />运行时动态注入</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500" />静态可编辑提示词</span><span>拖动条目或使用箭头调整顺序；“保存并启用”后生效。</span></div>
    </div>
    <div className="grid grid-cols-[380px_1fr] items-start gap-4">
      <section className="rounded-2xl border border-line bg-[#f7f9f9] p-3">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="font-extrabold">实际注入顺序</h3><p className="mt-0.5 text-xs text-muted">从上到下发送；深度块除外</p></div><button type="button" className="x-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => { setSelectedKey("prompt:new"); setDraft({ id: "new", name: "新提示词", role: "system", content: "", enabled: true, order: Math.max(0, ...config.promptBlocks.map((prompt) => prompt.order)) + 10, injectionPosition: "relative", injectionDepth: 0, protected: false }); }}><Plus size={14} />新提示词</button></div>
        <div className="max-h-[670px] space-y-2 overflow-y-auto pr-1">{activePreset.items.map((item, index) => {
          const prompt = item.kind === "prompt" ? config.promptBlocks.find((candidate) => candidate.id === item.promptId) : undefined;
          const marker = item.kind === "marker" ? promptMarkerMeta[item.marker] : undefined;
          const selected = promptItemKey(item) === selectedKey;
          const required = item.kind === "marker" && item.marker === "current_input";
          return <div key={promptItemKey(item)} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(undefined)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== undefined) moveItem(dragIndex, index); setDragIndex(undefined); }} className={`group flex items-center gap-2 rounded-xl border p-2 transition ${selected ? "border-accent bg-sky-50" : item.kind === "marker" ? "border-dashed border-violet-200 bg-white" : "border-line bg-white"} ${dragIndex === index ? "opacity-45" : ""}`}>
            <GripVertical size={16} className="shrink-0 cursor-grab text-slate-400" />
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedKey(promptItemKey(item))}><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.kind === "marker" ? "bg-violet-500" : "bg-sky-500"}`} /><span className="truncate text-sm font-extrabold">{marker?.name ?? prompt?.name ?? "缺失提示词"}</span></div><div className="ml-[18px] mt-0.5 truncate text-[11px] text-muted">{marker ? marker.mode : prompt?.injectionPosition === "in_chat" ? `聊天深度 @${prompt.injectionDepth}` : `${prompt?.role ?? "system"} · 按预设顺序`}{prompt?.protected ? " · 内容受保护" : ""}</div></button>
            <Toggle checked={item.enabled} disabled={required} onCheckedChange={(enabled) => updateActivePreset((items) => items.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, enabled } : candidate))} />
            <div className="flex flex-col"><button type="button" aria-label="上移" disabled={index === 0} className="text-slate-400 hover:text-ink disabled:opacity-20" onClick={() => moveItem(index, index - 1)}><ChevronUp size={15} /></button><button type="button" aria-label="下移" disabled={index === activePreset.items.length - 1} className="text-slate-400 hover:text-ink disabled:opacity-20" onClick={() => moveItem(index, index + 1)}><ChevronDown size={15} /></button></div>
          </div>;
        })}</div>
      </section>
      <section className="sticky top-[70px] min-h-[520px] rounded-2xl border border-line bg-white p-4">
        {draft ? <>
          <div className="flex items-center justify-between"><div><div className="flex items-center gap-2"><Layers3 size={18} className="text-sky-500" /><h3 className="font-extrabold">{draft.id === "new" ? "新建静态提示词" : "编辑静态提示词"}</h3></div><p className="mt-1 text-xs text-muted">{draft.injectionPosition === "in_chat" ? "按聊天深度插入，不受列表中的相对位置影响；列表顺序用于同深度排序。" : `位于「${previousName}」之后、「${nextName}」之前。`}</p></div>{draft.protected && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">内容受保护</span>}</div>
          <label className="mt-4 block text-sm font-bold">名称<input className="x-input mt-1" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-bold">消息角色<select className="x-input mt-1" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as PromptBlock["role"] })}><option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option></select></label><label className="text-sm font-bold">注入方式<select className="x-input mt-1" value={draft.injectionPosition} onChange={(event) => setDraft({ ...draft, injectionPosition: event.target.value as PromptBlock["injectionPosition"] })}><option value="relative">按预设相对顺序</option><option value="in_chat">聊天内按深度</option></select></label></div>
          {draft.injectionPosition === "in_chat" && <label className="mt-3 block text-sm font-bold">注入深度<input type="number" min="0" max="100" className="x-input mt-1" value={draft.injectionDepth} onChange={(event) => setDraft({ ...draft, injectionDepth: Number(event.target.value) })} /><span className="mt-1 block text-xs font-normal leading-5 text-muted">0 = 当前玩家输入之前；数值越大，插入得越靠前。</span></label>}
          <label className="mt-3 block text-sm font-bold">内容<textarea disabled={draft.protected} className="x-input mt-1 min-h-[330px] resize-y font-mono text-xs leading-5 disabled:bg-slate-50" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label>
          <div className="mt-4 flex items-center gap-2"><button type="button" className="x-primary flex items-center gap-2" disabled={!draft.name.trim() || !draft.content.trim() || savePrompt.isPending || deletePrompt.isPending} onClick={() => savePrompt.mutate(draft)}><Save size={17} />{savePrompt.isPending ? "保存中…" : draft.id === "new" ? "创建并加入所有预设" : "保存提示词"}</button>{draft.id !== "new" && !draft.protected && <button type="button" className="flex items-center gap-2 rounded-full border border-rose-300 px-4 py-2 font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50" disabled={savePrompt.isPending || deletePrompt.isPending} onClick={() => { if (window.confirm(`确定删除提示词块「${draft.name}」？它会同时从所有预设中移除。`)) deletePrompt.mutate(draft); }}><Trash2 size={17} />{deletePrompt.isPending ? "删除中…" : "删除提示词"}</button>}</div>
          {savePrompt.error && <p className="mt-3 text-sm text-rose-600">{savePrompt.error.message}</p>}
          {deletePrompt.error && <p className="mt-3 text-sm text-rose-600">{deletePrompt.error.message}</p>}
        </> : selectedMarker ? <>
          <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Layers3 size={18} className="text-violet-500" /><h3 className="font-extrabold">{promptMarkerMeta[selectedMarker].name}</h3></div><p className="mt-1 text-xs text-muted">位于「{previousName}」之后、「{nextName}」之前。</p></div><span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700">{promptMarkerMeta[selectedMarker].mode}</span></div>
          <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/60 p-4"><div className="text-xs font-extrabold uppercase tracking-wider text-violet-700">运行时来源</div><p className="mt-2 text-sm leading-6 text-slate-700">{promptMarkerMeta[selectedMarker].source}</p></div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-line p-3"><div><div className="text-sm font-bold">在当前预设中启用</div><p className="mt-0.5 text-xs text-muted">关闭后，这类动态内容不会发送给模型。</p></div><Toggle checked={selectedItem?.enabled ?? false} disabled={selectedMarker === "current_input"} onCheckedChange={(enabled) => updateActivePreset((items) => items.map((item, index) => index === selectedIndex ? { ...item, enabled } : item))} /></div>
          {selectedMarker === "worldbook_at_depth" && <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">具体深度由每个世界书条目的“注入深度”决定；这里控制这类条目是否整体参与。</p>}
        </> : <div className="flex min-h-[480px] items-center justify-center text-center text-sm text-muted">从左侧选择一个提示词或动态注入标记。</div>}
      </section>
    </div>
    {savePreset.error && <p className="mt-3 text-sm text-rose-600">{savePreset.error.message}</p>}
    {savePreset.isSuccess && <p className="mt-3 text-sm font-bold text-emerald-600">提示词预设已保存，下一回合将按新顺序组装上下文。</p>}
  </div>;
}

const emptyEntry = (bookId: string, order: number): WorldbookEntry => ({ id: "new", bookId, title: "新条目", content: "", enabled: true, constant: false, primaryKeys: [], secondaryKeys: [], secondaryLogic: "and_any", scanDepth: 2, recursive: false, probability: 100, ignoreBudget: false, order, caseSensitive: false, wholeWord: false, role: "system", position: "after_cards", injectionDepth: 0 });

function Worldbooks({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const [bookId, setBookId] = useState(config.worldbooks[0]?.id ?? "");
  const book = config.worldbooks.find((item) => item.id === bookId) ?? config.worldbooks[0];
  const [draft, setDraft] = useState<WorldbookEntry | undefined>(book?.entries[0]);
  useEffect(() => setDraft(book?.entries[0]), [book?.id]);
  const save = useMutation({
    mutationFn: (entry: WorldbookEntry) => api<ConfigSnapshot>(entry.id === "new" ? "/api/config/worldbook-entries" : `/api/config/worldbook-entries/${entry.id}`, { method: entry.id === "new" ? "POST" : "PUT", body: JSON.stringify(entry.id === "new" ? { ...entry, id: undefined } : entry) }),
    onSuccess: (value, entry) => {
      client.setQueryData(["config"], value);
      const previousIds = new Set(config.worldbooks.flatMap((item) => item.entries.map((candidate) => candidate.id)));
      const saved = value.worldbooks.find((item) => item.id === entry.bookId)?.entries.find((item) =>
        item.id === entry.id || (entry.id === "new" && !previousIds.has(item.id))
      );
      if (saved) setDraft(saved);
    }
  });
  if (!book) return <Empty title="没有世界书" detail="创建世界书后即可添加蓝灯或绿灯条目。" />;
  return <div>
    <SectionTitle title="世界书与蓝绿灯" detail="蓝灯始终注入，绿灯按关键词激活；支持主/次关键词逻辑、递归、概率、预算、顺序、角色和深度。" />
    <div className="mb-4 flex gap-2">{config.worldbooks.map((item) => <button key={item.id} onClick={() => setBookId(item.id)} className={`rounded-full px-3 py-1.5 text-sm ${item.id === book.id ? "bg-ink text-white" : "bg-slate-100"}`}>{item.name} · {item.scope}</button>)}</div>
    <div className="grid grid-cols-[220px_1fr] gap-4"><div className="space-y-2"><button onClick={() => setDraft(emptyEntry(book.id, (book.entries.at(-1)?.order ?? 0) + 10))} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 p-3 text-sm font-bold text-muted"><Plus size={16} />新建条目</button>{book.entries.map((entry) => <button key={entry.id} onClick={() => setDraft(entry)} className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left ${draft?.id === entry.id ? "border-accent bg-sky-50" : "border-line"}`}><span title={entry.constant ? "蓝灯：始终注入" : "绿灯：关键词激活"} className={`h-3 w-3 shrink-0 rounded-full ${!entry.enabled ? "bg-slate-300" : entry.constant ? "bg-blue-500" : "bg-emerald-500"}`} /><span className="truncate text-sm font-bold">{entry.title}</span></button>)}</div>
      {draft ? <div><div className="flex items-center justify-between"><div className="flex items-center gap-4"><label className="flex items-center gap-2 text-sm font-bold"><Toggle checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />启用</label><label className="flex items-center gap-2 text-sm font-bold"><Toggle checked={draft.constant} onCheckedChange={(constant) => setDraft({ ...draft, constant })} />蓝灯常驻</label></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${draft.constant ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>{draft.constant ? "🔵 常驻" : "🟢 关键词"}</span></div><label className="mt-3 block text-sm font-bold">标题<input className="x-input mt-1" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><div className="mt-3 grid grid-cols-2 gap-3"><label className="text-sm font-bold">主关键词（逗号分隔）<input className="x-input mt-1" value={draft.primaryKeys.join(", ")} onChange={(event) => setDraft({ ...draft, primaryKeys: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label><label className="text-sm font-bold">次关键词（逗号分隔）<input className="x-input mt-1" value={draft.secondaryKeys.join(", ")} onChange={(event) => setDraft({ ...draft, secondaryKeys: event.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} /></label></div><label className="mt-3 block text-sm font-bold">内容<textarea className="x-input mt-1 min-h-56 font-mono text-xs leading-5" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /></label><div className="mt-3 grid grid-cols-5 gap-3"><label className="text-xs font-bold">概率 %<input type="number" className="x-input mt-1" value={draft.probability} onChange={(event) => setDraft({ ...draft, probability: Number(event.target.value) })} /></label><label className="text-xs font-bold">扫描深度<input type="number" className="x-input mt-1" value={draft.scanDepth} onChange={(event) => setDraft({ ...draft, scanDepth: Number(event.target.value) })} /></label><label className="text-xs font-bold">顺序<input type="number" className="x-input mt-1" value={draft.order} onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) })} /></label><label className="text-xs font-bold">注入位置<select className="x-input mt-1" value={draft.position} onChange={(event) => setDraft({ ...draft, position: event.target.value as WorldbookEntry["position"] })}><option value="before_cards">角色卡之前（↑Char）</option><option value="after_cards">角色卡之后（↓Char）</option><option value="author_note_top">作者注释顶部（AN Top）</option><option value="author_note_bottom">作者注释底部（AN Bottom）</option><option value="before_history">历史之前</option><option value="after_history">历史之后</option><option value="at_depth">聊天深度</option></select></label><label className="text-xs font-bold">注入深度<input type="number" disabled={draft.position !== "at_depth"} className="x-input mt-1 disabled:bg-slate-50" value={draft.injectionDepth} onChange={(event) => setDraft({ ...draft, injectionDepth: Number(event.target.value) })} /></label></div><div className="mt-3 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.recursive} onChange={(e) => setDraft({ ...draft, recursive: e.target.checked })} />递归</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.ignoreBudget} onChange={(e) => setDraft({ ...draft, ignoreBudget: e.target.checked })} />忽略预算</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.caseSensitive} onChange={(e) => setDraft({ ...draft, caseSensitive: e.target.checked })} />区分大小写</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.wholeWord} onChange={(e) => setDraft({ ...draft, wholeWord: e.target.checked })} />全词匹配</label></div><button className="x-primary mt-4 flex items-center gap-2" onClick={() => save.mutate(draft)}><Save size={17} />保存世界书条目</button></div> : <Empty title="选择一个条目" detail="或新建蓝灯/绿灯条目。" />}
    </div>
  </div>;
}

function RulePreset({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(config.rulePreset);
  const save = useMutation({
    mutationFn: () => api<ConfigSnapshot>(`/api/config/rules/${draft.id}`, {
      method: "PUT",
      body: JSON.stringify({
        rawText: draft.rawText,
        minProfileChanges: draft.minProfileChanges,
        minPanels: draft.minPanels,
        maxPanels: draft.maxPanels,
        representativeComments: draft.representativeComments
      })
    }),
    onSuccess: (value) => { client.setQueryData(["config"], value); setDraft(value.rulePreset); }
  });
  return <div><SectionTitle title="玩法规则预设（YAML）" detail="这是始终生效的全局规则。保存时会解析 YAML；下方硬约束由 hard_constraints 自动同步并在 AI Schema 通过后继续验证。" /><label className="block text-sm font-bold">YAML 规则<textarea className="x-input mt-1 min-h-[520px] font-mono text-xs leading-5" value={draft.rawText} onChange={(event) => setDraft({ ...draft, rawText: event.target.value })} /></label><div className="mt-4 grid grid-cols-4 gap-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-muted">主页最少真实变化</div><div className="mt-1 text-xl font-extrabold">{draft.minProfileChanges}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-muted">最少面板</div><div className="mt-1 text-xl font-extrabold">{draft.minPanels}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-muted">最多面板</div><div className="mt-1 text-xl font-extrabold">{draft.maxPanels}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-muted">每条新帖代表评论</div><div className="mt-1 text-xl font-extrabold">{draft.representativeComments}</div></div></div><p className="mt-2 text-xs leading-5 text-muted">需要修改数值时，请编辑 YAML 中对应的 hard_constraints；保存成功后这里会自动同步。</p><button className="x-primary mt-4 flex items-center gap-2" onClick={() => save.mutate()}><Save size={17} />校验并保存 YAML</button>{save.error && <p className="mt-2 text-sm text-rose-600">{save.error.message}</p>}</div>;
}

function MacroRegex({ config }: { config: ConfigSnapshot }) {
  const client = useQueryClient();
  const [macro, setMacro] = useState<UserMacro>(config.userMacros[0] ?? { id: "new", name: "custom_value", value: "", scope: "global", enabled: true });
  const [regex, setRegex] = useState<RegexRule>(config.regexRules[0] ?? { id: "new", name: "字段替换", pattern: "", replacement: "", flags: "g", field: "post_text", enabled: true, order: 10 });
  const saveMacro = useMutation({ mutationFn: (value: UserMacro) => api<ConfigSnapshot>(value.id === "new" ? "/api/config/macros" : `/api/config/macros/${value.id}`, { method: value.id === "new" ? "POST" : "PUT", body: JSON.stringify(value.id === "new" ? { name: value.name, value: value.value, scope: value.scope, enabled: value.enabled } : value) }), onSuccess: (value, submitted) => { client.setQueryData(["config"], value); const saved = value.userMacros.find((item) => item.id === submitted.id || (submitted.id === "new" && item.name === submitted.name && item.scope === submitted.scope)); if (saved) setMacro(saved); } });
  const saveRegex = useMutation({ mutationFn: (value: RegexRule) => api<ConfigSnapshot>(value.id === "new" ? "/api/config/regex" : `/api/config/regex/${value.id}`, { method: value.id === "new" ? "POST" : "PUT", body: JSON.stringify(value.id === "new" ? { name: value.name, pattern: value.pattern, replacement: value.replacement, flags: value.flags, field: value.field, enabled: value.enabled, order: value.order } : value) }), onSuccess: (value, submitted) => { client.setQueryData(["config"], value); const previousIds = new Set(config.regexRules.map((item) => item.id)); const saved = value.regexRules.find((item) => item.id === submitted.id || (submitted.id === "new" && !previousIds.has(item.id))); if (saved) setRegex(saved); } });
  return <div><SectionTitle title="受控宏与字段正则" detail="自定义宏不能覆盖系统宏；正则只处理获准的文字字段，永远不能修改事件 ID、结构或故事时间。" /><div className="grid grid-cols-2 gap-6"><section><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">用户宏</h3><button className="x-secondary py-1 text-sm" onClick={() => setMacro({ id: "new", name: "custom_value", value: "", scope: "global", enabled: true })}>新建</button></div><div className="mb-3 flex flex-wrap gap-1.5">{config.userMacros.map((item) => <button key={item.id} onClick={() => setMacro(item)} className={`rounded-full px-2.5 py-1 text-xs ${macro.id === item.id ? "bg-ink text-white" : "bg-slate-100"}`}>{`{{${item.name}}}`}</button>)}</div><label className="text-sm font-bold">宏名称<input className="x-input mt-1 font-mono" value={macro.name} onChange={(e) => setMacro({ ...macro, name: e.target.value })} /></label><label className="mt-3 block text-sm font-bold">作用域<select className="x-input mt-1" value={macro.scope} onChange={(e) => setMacro({ ...macro, scope: e.target.value as UserMacro["scope"] })}><option value="global">全局</option><option value="player">玩家卡</option><option value="heroine">女主卡</option><option value="session">当前会话</option></select></label><label className="mt-3 block text-sm font-bold">替换值<textarea className="x-input mt-1 min-h-36" value={macro.value} onChange={(e) => setMacro({ ...macro, value: e.target.value })} /></label><div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-bold"><Toggle checked={macro.enabled} onCheckedChange={(enabled) => setMacro({ ...macro, enabled })} />启用</label><button className="x-primary flex items-center gap-2" onClick={() => saveMacro.mutate(macro)}><Save size={16} />保存宏</button></div>{saveMacro.error && <p className="mt-2 text-xs text-rose-600">{saveMacro.error.message}</p>}</section><section><div className="mb-3 flex items-center justify-between"><h3 className="font-extrabold">字段正则</h3><button className="x-secondary py-1 text-sm" onClick={() => setRegex({ id: "new", name: "字段替换", pattern: "", replacement: "", flags: "g", field: "post_text", enabled: true, order: (config.regexRules.at(-1)?.order ?? 0) + 10 })}>新建</button></div><div className="mb-3 flex flex-wrap gap-1.5">{config.regexRules.map((item) => <button key={item.id} onClick={() => setRegex(item)} className={`rounded-full px-2.5 py-1 text-xs ${regex.id === item.id ? "bg-ink text-white" : "bg-slate-100"}`}>{item.name}</button>)}</div><label className="text-sm font-bold">规则名称<input className="x-input mt-1" value={regex.name} onChange={(e) => setRegex({ ...regex, name: e.target.value })} /></label><div className="mt-3 grid grid-cols-[1fr_80px] gap-2"><label className="text-sm font-bold">匹配表达式<input className="x-input mt-1 font-mono" value={regex.pattern} onChange={(e) => setRegex({ ...regex, pattern: e.target.value })} /></label><label className="text-sm font-bold">Flags<input className="x-input mt-1 font-mono" value={regex.flags} onChange={(e) => setRegex({ ...regex, flags: e.target.value })} /></label></div><label className="mt-3 block text-sm font-bold">替换内容<textarea className="x-input mt-1 min-h-20 font-mono" value={regex.replacement} onChange={(e) => setRegex({ ...regex, replacement: e.target.value })} /></label><div className="mt-3 grid grid-cols-[1fr_100px] gap-2"><label className="text-sm font-bold">字段<select className="x-input mt-1" value={regex.field} onChange={(e) => setRegex({ ...regex, field: e.target.value as RegexRule["field"] })}><option value="account_text">账户文字</option><option value="post_text">帖文文字</option><option value="comment_text">评论文字</option><option value="message_text">消息文字</option><option value="profile_text">主页文字</option><option value="media_text">媒体文字</option><option value="live_text">直播文字</option><option value="notice_text">平台通知</option></select></label><label className="text-sm font-bold">顺序<input type="number" className="x-input mt-1" value={regex.order} onChange={(e) => setRegex({ ...regex, order: Number(e.target.value) })} /></label></div><div className="mt-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-bold"><Toggle checked={regex.enabled} onCheckedChange={(enabled) => setRegex({ ...regex, enabled })} />启用</label><button className="x-primary flex items-center gap-2" onClick={() => saveRegex.mutate(regex)}><Save size={16} />保存正则</button></div>{saveRegex.error && <p className="mt-2 text-xs text-rose-600">{saveRegex.error.message}</p>}</section></div></div>;
}

function DataTools() {
  const client = useQueryClient();
  const restoreRef = useRef<HTMLInputElement>(null);
  const restore = useMutation({ mutationFn: async (file: File) => api<{ ok: boolean }>("/api/backup/restore", { method: "POST", body: await file.text() }), onSuccess: () => { client.invalidateQueries(); } });
  return <div><SectionTitle title="手动备份与恢复" detail="SAFE1：导出完整项目 JSON；API Key 不进入备份，仍由本机 .env 单独保存。恢复会替换当前项目数据。" /><div className="grid grid-cols-2 gap-4"><a href="/api/backup" download className="rounded-2xl border border-line p-5 hover:border-accent hover:bg-sky-50"><Download size={24} /><div className="mt-4 font-extrabold">导出完整备份</div><p className="mt-1 text-sm text-muted">包含角色卡、提示词、世界书、规则、会话、分支、候选和 MVU 状态。</p></a><button onClick={() => restoreRef.current?.click()} className="rounded-2xl border border-line p-5 text-left hover:border-amber-500 hover:bg-amber-50"><Upload size={24} /><div className="mt-4 font-extrabold">恢复备份</div><p className="mt-1 text-sm text-muted">从 Airp X JSON 备份替换本机当前数据。</p></button><input ref={restoreRef} type="file" accept=".json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file && window.confirm("恢复会替换当前数据，确定继续？")) restore.mutate(file); }} /></div>{restore.error && <p className="mt-3 text-sm text-rose-600">{restore.error.message}</p>}{restore.isSuccess && <p className="mt-3 text-sm font-bold text-emerald-600">备份已恢复。</p>}</div>;
}

function HomepageBuilder() {
  const { data, isLoading } = useSnapshot();
  const client = useQueryClient();
  const [sourceText, setSourceText] = useState(() => typeof data?.mvu.extensions.homepageSource === "string" ? data.mvu.extensions.homepageSource : "");
  const [draft, setDraft] = useState<HomepageDraft>();
  const [sessionName, setSessionName] = useState("新故事");
  useEffect(() => {
    if (sourceText) return;
    const savedSource = data?.mvu.extensions.homepageSource;
    if (typeof savedSource === "string" && savedSource) setSourceText(savedSource);
  }, [data?.session.id, data?.mvu.extensions.homepageSource, sourceText]);
  const preview = useMutation({
    mutationFn: () => apiClient.previewHomepage(sourceText),
    onSuccess: (value) => setDraft(value.draft)
  });
  const apply = useMutation({
    mutationFn: () => {
      if (!data || !draft) throw new Error("请先生成预览");
      return apiClient.applyHomepage(data.session.activeBranchId, sourceText, draft);
    },
    onSuccess: (snapshot) => client.setQueryData(["snapshot"], snapshot)
  });
  const create = useMutation({
    mutationFn: () => apiClient.createSession(sessionName.trim()),
    onSuccess: (snapshot) => {
      client.setQueryData(["snapshot"], snapshot);
      setDraft(undefined);
    }
  });
  if (isLoading || !data) return <Spinner label="载入主页建设流程" />;
  const configured = data.mvu.extensions.homepageConfigured !== false;
  const hasTurns = data.turns.length > 0;
  return <div>
    <SectionTitle title="主页建设" detail="把自然语言主页交给 AI 结构化。先预览、后确认；这个流程不会生成剧情、帖文、评论或私信。" />
    <div className="mb-5 rounded-2xl border border-line bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-4"><div><div className="font-extrabold">当前会话：{data.session.name}</div><p className="mt-1 text-sm text-muted">{configured ? "已有主页" : "空白主页"} · {hasTurns ? `已有 ${data.turns.length} 个剧情回合` : "尚未开始剧情"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${!configured ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{!configured ? "等待建设" : "已建设"}</span></div>
      {hasTurns && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">为防止主页重建与现有时间线冲突，已有剧情回合的分支不能覆盖主页。请先新建空白会话。</p>}
      <div className="mt-3 flex gap-2"><input className="x-input" value={sessionName} maxLength={120} onChange={(event) => setSessionName(event.target.value)} placeholder="新会话名称" /><button className="x-secondary flex shrink-0 items-center gap-2" disabled={!sessionName.trim() || create.isPending} onClick={() => create.mutate()}><Plus size={16} />{create.isPending ? "创建中…" : "新建空白会话"}</button></div>
      {create.error && <p className="mt-2 text-xs text-rose-600">{create.error.message}</p>}
    </div>
    <div className="grid grid-cols-2 gap-5">
      <section>
        <h3 className="font-extrabold">1. 粘贴自然语言主页</h3>
        <p className="mt-1 text-xs leading-5 text-muted">可以包含用户名、简介、关注数、分区标题、进度、里程碑和当前状态。原文会随当前会话本地保存。</p>
        <textarea className="x-input mt-3 min-h-[510px] resize-y font-mono text-xs leading-5" value={sourceText} onChange={(event) => { setSourceText(event.target.value); setDraft(undefined); }} placeholder="在这里粘贴完整的自然语言主页……" />
        <button className="x-primary mt-3 flex items-center gap-2" disabled={!sourceText.trim() || preview.isPending} onClick={() => preview.mutate()}><WandSparkles size={17} />{preview.isPending ? "AI 正在整理…" : "生成结构化预览"}</button>
        {preview.error && <p className="mt-3 text-sm text-rose-600">{preview.error.message}</p>}
      </section>
      <section>
        <h3 className="font-extrabold">2. 检查并应用</h3>
        <p className="mt-1 text-xs leading-5 text-muted">这只是草稿。确认应用前，不会改变主页。</p>
        {!draft ? <div className="mt-3 flex min-h-[510px] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-8 text-center text-sm leading-6 text-muted">生成后，这里会显示账号资料、数字、主页栏目和 MVU 初始状态。</div> : <div className="mt-3 min-h-[510px] overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          <div className={`h-24 bg-gradient-to-br ${draft.profile.bannerTone === "night" ? "from-slate-950 to-violet-800" : draft.profile.bannerTone === "rose" ? "from-rose-300 to-orange-100" : draft.profile.bannerTone === "violet" ? "from-violet-400 to-sky-200" : draft.profile.bannerTone === "amber" ? "from-amber-300 to-rose-200" : "from-sky-300 to-blue-100"}`} />
          <div className="p-4"><div className="text-lg font-extrabold">{draft.account.displayName}{draft.account.verified ? " ✓" : ""}</div><div className="text-sm text-muted">@{draft.account.handle}{draft.account.isPrivate ? " · 私密账号" : ""}</div><p className="plain-content mt-2 text-sm leading-5">{draft.account.bio}</p><div className="mt-3 flex flex-wrap gap-3 text-xs"><span><b>{draft.profile.followingCount.toLocaleString()}</b> 正在关注</span><span><b>{draft.profile.followerCount.toLocaleString()}</b> 关注者</span><span><b>{draft.profile.postCount.toLocaleString()}</b> 帖文</span></div>
            <div className="mt-4 max-h-[325px] space-y-2 overflow-y-auto pr-1">{draft.profile.sections.map((section) => <div key={section.id} className="rounded-xl bg-slate-50 p-3"><div className="text-sm font-extrabold">{section.title}</div>{section.items.map((item) => <div key={item.id} className="plain-content mt-1 text-xs leading-5">{item.label && <b>{item.label}：</b>}{item.value}</div>)}</div>)}</div>
            {draft.notes.length > 0 && <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><b>需要留意：</b>{draft.notes.join("；")}</div>}
          </div>
        </div>}
        <button className="x-primary mt-3 flex items-center gap-2" disabled={!draft || hasTurns || apply.isPending} onClick={() => apply.mutate()}><CheckCircle2 size={17} />{apply.isPending ? "正在写入…" : "确认并应用到当前会话"}</button>
        {apply.error && <p className="mt-3 text-sm text-rose-600">{apply.error.message}</p>}
        {apply.isSuccess && <p className="mt-3 text-sm font-bold text-emerald-600">主页已经写入。<Link to="/" className="ml-1 underline">查看主页</Link></p>}
      </section>
    </div>
  </div>;
}

function SessionManager() {
  const { data } = useSnapshot();
  const client = useQueryClient();
  const [selectedTurnId, setSelectedTurnId] = useState<string>();
  const selectedTurn = data?.turns.find((turn) => turn.id === selectedTurnId) ?? data?.turns.at(-1);
  const [text, setText] = useState(selectedTurn?.inputText ?? "");
  useEffect(() => setText(selectedTurn?.inputText ?? ""), [selectedTurn?.id, selectedTurn?.inputText]);
  const activate = useMutation({ mutationFn: apiClient.activateBranch, onSuccess: (snapshot) => client.setQueryData(["snapshot"], snapshot) });
  const activateSession = useMutation({ mutationFn: apiClient.activateSession, onSuccess: (snapshot) => { client.setQueryData(["snapshot"], snapshot); setSelectedTurnId(undefined); } });
  const fork = useMutation({ mutationFn: () => { if (!selectedTurn) throw new Error("请选择一个回合"); return apiClient.forkFromTurn(selectedTurn.id, text); }, onSuccess: (result) => client.setQueryData(["snapshot"], result.snapshot), onSettled: () => client.invalidateQueries({ queryKey: ["snapshot"] }) });
  if (!data) return <Spinner label="载入会话" />;
  return <div>
    <SectionTitle title="会话、分支与候选" detail="每个会话拥有独立主页、MVU、记忆和分支；编辑旧玩家输入始终创建安全分支。" />
    <section className="mb-5"><h3 className="mb-2 text-sm font-extrabold text-muted">故事会话</h3><div className="flex flex-wrap gap-2">{data.sessions.map((session) => <button key={session.id} onClick={() => activateSession.mutate(session.id)} className={`rounded-xl border px-4 py-3 text-left ${session.active ? "border-accent bg-sky-50" : "border-line"}`}><div className="text-sm font-bold">{session.name}</div><div className="mt-1 text-xs text-muted">{session.active ? "当前会话" : "切换到此会话"}</div></button>)}</div></section>
    <div className="grid grid-cols-[240px_1fr] gap-5"><section><h3 className="mb-2 text-sm font-extrabold text-muted">当前会话分支</h3><div className="space-y-2">{data.branches.map((branch) => <button key={branch.id} onClick={() => activate.mutate(branch.id)} className={`w-full rounded-xl border p-3 text-left ${branch.active ? "border-accent bg-sky-50" : "border-line"}`}><div className="font-bold">{branch.name}</div><div className="mt-1 text-xs text-muted">{branch.parentBranchId ? "从旧回合分出" : "根时间线"} · {branch.active ? "当前" : "可切换"}</div></button>)}</div></section><section><h3 className="mb-2 text-sm font-extrabold text-muted">当前分支回合</h3>{data.turns.length === 0 ? <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">还没有剧情回合。</div> : <div className="max-h-72 space-y-2 overflow-y-auto pr-1">{data.turns.map((turn) => <button key={turn.id} onClick={() => setSelectedTurnId(turn.id)} className={`w-full rounded-xl border p-3 text-left ${selectedTurn?.id === turn.id ? "border-ink" : "border-line"}`}><div className="flex items-center justify-between"><span className="text-sm font-bold">回合 {turn.sequence} · {turn.inputKind}</span><span className={`text-xs ${turn.status === "failed" ? "text-rose-600" : turn.status === "complete" ? "text-emerald-600" : "text-amber-600"}`}>{turn.status}</span></div><p className="mt-1 line-clamp-2 text-sm text-muted">{turn.inputText}</p><div className="mt-2 flex gap-1">{turn.candidates.map((candidate) => <span key={candidate.id} className={`h-2 w-2 rounded-full ${candidate.active ? "bg-accent" : "bg-slate-300"}`} />)}</div></button>)}</div>}{selectedTurn && <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="mb-2 text-sm font-extrabold">从回合 {selectedTurn.sequence} 编辑并创建新分支</div><textarea className="x-input min-h-28" value={text} onChange={(event) => setText(event.target.value)} /><button className="x-primary mt-3 flex items-center gap-2" disabled={!text.trim() || fork.isPending} onClick={() => fork.mutate()}><GitBranch size={16} />{fork.isPending ? "生成分支中…" : "创建分支并生成"}</button>{fork.error && <p className="mt-2 text-xs text-rose-600">{fork.error.message}。新分支与玩家输入仍已保存，可从主页右侧重试。</p>}</div>}</section></div>
  </div>;
}

const tabItems = [
  { value: "model", label: "模型", icon: Bot },
  { value: "homepage", label: "主页建设", icon: WandSparkles },
  { value: "cards", label: "角色卡", icon: UserRoundCog },
  { value: "prompts", label: "提示词", icon: FileText },
  { value: "worldbook", label: "世界书", icon: BookOpen },
  { value: "rules", label: "规则", icon: KeyRound },
  { value: "transform", label: "宏/正则", icon: Braces },
  { value: "session", label: "会话", icon: GitBranch },
  { value: "data", label: "数据", icon: Database }
];

export function ConfigPage() {
  const { data, isLoading, error } = useConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") ?? "model";
  const defaultTab = tabItems.some((item) => item.value === requestedTab) ? requestedTab : "model";
  if (isLoading) return <div className="p-8"><Spinner label="载入配置" /></div>;
  if (!data || error) return <Empty title="配置无法载入" detail={error instanceof Error ? error.message : "未知错误"} />;
  return <div><header className="sticky top-0 z-20 flex h-[53px] items-center border-b border-line bg-white/90 px-4 backdrop-blur-md"><h1 className="panel-title">配置中心</h1></header><Tabs.Root value={defaultTab} onValueChange={(value) => setSearchParams(value === "model" ? {} : { tab: value }, { replace: true })} orientation="vertical" className="grid min-h-[calc(100vh-53px)] grid-cols-[145px_1fr]"><Tabs.List className="border-r border-line p-2">{tabItems.map(({ value, label, icon: Icon }) => <Tabs.Trigger key={value} value={value} className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold text-muted hover:bg-slate-50 data-[state=active]:bg-sky-50 data-[state=active]:text-accent"><Icon size={17} />{label}</Tabs.Trigger>)}</Tabs.List><div className="min-w-0 p-5"><Tabs.Content value="model"><ModelSettings config={data} /></Tabs.Content><Tabs.Content value="homepage"><HomepageBuilder /></Tabs.Content><Tabs.Content value="cards"><RoleCards config={data} /></Tabs.Content><Tabs.Content value="prompts"><Prompts config={data} /></Tabs.Content><Tabs.Content value="worldbook"><Worldbooks config={data} /></Tabs.Content><Tabs.Content value="rules"><RulePreset config={data} /></Tabs.Content><Tabs.Content value="transform"><MacroRegex config={data} /></Tabs.Content><Tabs.Content value="session"><SessionManager /></Tabs.Content><Tabs.Content value="data"><DataTools /></Tabs.Content></div></Tabs.Root></div>;
}
