import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  HomepageDraftSchema,
  AvatarTextSchema,
  LocalActionSchema,
  PlayerTurnInputSchema,
  PromptBlockSchema,
  PromptPresetStateSchema,
  RuntimeSettingsSchema,
  RegexRuleSchema,
  UserMacroSchema,
  WorldbookEntrySchema
} from "@airp/shared";
import { db } from "./db/client.js";
import { promptBlocks, regexRules, roleCards, rulePresets, userMacros, worldbookEntries, worldbooks } from "./db/schema.js";
import { testStrictSchemaCapability } from "./services/ai-client.js";
import { createBackup, restoreBackup } from "./services/backup-service.js";
import { getConfigSnapshot, getPromptPresetState, getRuntimeSettings, savePromptPresetState, saveRuntimeSettings } from "./services/config-service.js";
import { applyHomepageDraft, previewHomepage } from "./services/homepage-service.js";
import { assertRuleConfig } from "./services/rule-config.js";
import { compileSafeRegex } from "./services/regex-safety.js";
import { badRequest, conflict, notFound } from "./services/http-error.js";
import { inspectImageDataUrl } from "./services/image-data-url.js";
import {
  activateBranch,
  activateSession,
  applyLocalAction,
  createSession,
  forkFromTurn,
  getAppSnapshot,
  regenerateTurn,
  retryTurn,
  selectCandidate,
  submitTurn,
  updateAvatar,
  updateProfileBanner
} from "./services/turn-service.js";

const idParams = z.object({ id: z.string().min(1) });
const cardBody = z.object({
  role: z.enum(["player", "heroine"]),
  name: z.string().min(1).max(160),
  version: z.string().max(40).default("1"),
  rawText: z.string().min(1).max(500_000),
  activate: z.boolean().default(true)
}).strict();
const bookBody = z.object({ name: z.string().min(1).max(160), scope: z.enum(["global", "player", "heroine", "session"]), enabled: z.boolean(), tokenBudgetPercent: z.number().int().min(1).max(100) }).strict();
const ruleBody = z.object({ rawText: z.string().min(1).max(500_000), minProfileChanges: z.number().int().min(0).max(100), minPanels: z.number().int().min(1).max(8), maxPanels: z.number().int().min(1).max(8), representativeComments: z.number().int().min(0).max(100) }).strict();
const protectedMacroNames = new Set(["player", "char", "story_time", "input", "mvu_revision", "mvu"]);
const imageDataUrlSchema = (label: string) => z.string().max(750_000).superRefine((value, context) => {
  try { inspectImageDataUrl(value); }
  catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: `${label}：${error instanceof Error ? error.message : String(error)}` }); }
});

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true, name: "Airp X", time: new Date().toISOString() }));
  app.get("/api/snapshot", async (request) => {
    const query = z.object({ branchId: z.string().optional() }).parse(request.query);
    return getAppSnapshot(query.branchId);
  });
  app.get("/api/config", async () => getConfigSnapshot());

  app.put("/api/settings", async (request) => {
    const body = RuntimeSettingsSchema.partial({ apiKey: true }).parse(request.body);
    const current = await getRuntimeSettings();
    return saveRuntimeSettings(RuntimeSettingsSchema.parse({ ...current, ...body, apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey }));
  });
  app.post("/api/settings/test", async (request) => {
    const body = RuntimeSettingsSchema.partial().parse(request.body ?? {});
    const current = await getRuntimeSettings();
    return testStrictSchemaCapability(RuntimeSettingsSchema.parse({ ...current, ...body }));
  });

  app.post("/api/turns", async (request, reply) => {
    const body = PlayerTurnInputSchema.parse(request.body);
    const result = await submitTurn(body);
    return reply.code(201).send(result);
  });
  app.post("/api/turns/:id/retry", async (request) => retryTurn(idParams.parse(request.params).id));
  app.post("/api/turns/:id/regenerate", async (request) => regenerateTurn(idParams.parse(request.params).id));
  app.post("/api/candidates/:id/select", async (request) => selectCandidate(idParams.parse(request.params).id));
  app.post("/api/actions", async (request) => applyLocalAction(LocalActionSchema.parse(request.body)));
  app.put("/api/accounts/:id/avatar", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({
      branchId: z.string().min(1),
      avatarText: z.union([z.literal(""), AvatarTextSchema]),
      avatarUrl: z.union([
        z.literal(""),
        imageDataUrlSchema("头像无效")
      ])
    }).strict().parse(request.body);
    return updateAvatar(body.branchId, id, body.avatarText, body.avatarUrl);
  });
  app.put("/api/profile/banner", async (request) => {
    const body = z.object({
      branchId: z.string().min(1),
      bannerTone: z.union([z.literal(""), z.enum(["sky", "rose", "violet", "amber", "night"])]),
      bannerUrl: z.union([
        z.literal(""),
        imageDataUrlSchema("封面无效")
      ])
    }).strict().parse(request.body);
    return updateProfileBanner(body.branchId, body.bannerTone, body.bannerUrl);
  });
  app.post("/api/sessions", async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(request.body);
    return reply.code(201).send(await createSession(body.name));
  });
  app.post("/api/sessions/:id/activate", async (request) => activateSession(idParams.parse(request.params).id));
  app.post("/api/branches/:id/activate", async (request) => activateBranch(idParams.parse(request.params).id));
  app.post("/api/branches/from-turn/:id", async (request) => {
    const text = z.object({ text: z.string().min(1).max(12_000) }).parse(request.body).text;
    return forkFromTurn(idParams.parse(request.params).id, text);
  });
  app.post("/api/homepage/preview", async (request) => {
    const body = z.object({ sourceText: z.string().trim().min(1).max(500_000) }).strict().parse(request.body);
    return { draft: await previewHomepage(body.sourceText) };
  });
  app.post("/api/homepage/apply", async (request) => {
    const body = z.object({
      branchId: z.string().min(1),
      sourceText: z.string().min(1).max(500_000),
      draft: HomepageDraftSchema
    }).strict().parse(request.body);
    return applyHomepageDraft(body.branchId, body.sourceText, body.draft);
  });

  app.post("/api/config/role-cards", async (request, reply) => {
    const body = cardBody.parse(request.body);
    const now = new Date().toISOString();
    const id = nanoid();
    db.transaction((tx) => {
      if (body.activate) tx.update(roleCards).set({ active: false, updatedAt: now }).where(eq(roleCards.role, body.role)).run();
      tx.insert(roleCards).values({ id, role: body.role, name: body.name, version: body.version, rawText: body.rawText, active: body.activate, createdAt: now, updatedAt: now }).run();
    });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/role-cards/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    if (id.endsWith("-default")) throw conflict("原始角色卡只读；请先复制为新卡再编辑", "ROLE_CARD_READ_ONLY");
    const body = cardBody.parse(request.body);
    const existing = (await db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1))[0];
    if (!existing) throw notFound("角色卡不存在", "ROLE_CARD_NOT_FOUND");
    if (existing.role !== body.role) throw conflict("角色卡不能在玩家与女主角色之间转换，请新建对应角色的卡片", "ROLE_CARD_ROLE_CHANGE");
    const now = new Date().toISOString();
    db.transaction((tx) => {
      if (body.activate) tx.update(roleCards).set({ active: false, updatedAt: now }).where(eq(roleCards.role, body.role)).run();
      tx.update(roleCards).set({ role: body.role, name: body.name, version: body.version, rawText: body.rawText, active: body.activate, updatedAt: now }).where(eq(roleCards.id, id)).run();
    });
    return getConfigSnapshot();
  });

  app.put("/api/config/prompts/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = PromptBlockSchema.parse(request.body);
    const existing = (await db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).limit(1))[0];
    if (!existing) throw notFound("提示词块不存在", "PROMPT_NOT_FOUND");
    await db.update(promptBlocks).set({ name: body.name, role: body.role, content: body.content, enabled: body.enabled, sortOrder: body.order, injectionPosition: body.injectionPosition, injectionDepth: body.injectionDepth, protected: false, updatedAt: new Date().toISOString() }).where(eq(promptBlocks.id, id));
    return getConfigSnapshot();
  });
  app.post("/api/config/prompts", async (request, reply) => {
    const body = PromptBlockSchema.omit({ id: true, protected: true }).parse(request.body);
    const now = new Date().toISOString();
    await db.insert(promptBlocks).values({ id: nanoid(), ...body, sortOrder: body.order, protected: false, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.delete("/api/config/prompts/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const existing = (await db.select().from(promptBlocks).where(eq(promptBlocks.id, id)).limit(1))[0];
    if (!existing) return reply.code(404).send({ error: "提示词块不存在", code: "PROMPT_NOT_FOUND" });
    await db.delete(promptBlocks).where(eq(promptBlocks.id, id));
    const remainingPrompts = await db.select().from(promptBlocks);
    await savePromptPresetState(await getPromptPresetState(remainingPrompts));
    return getConfigSnapshot();
  });
  app.put("/api/config/prompt-presets", async (request) => {
    await savePromptPresetState(PromptPresetStateSchema.parse(request.body));
    return getConfigSnapshot();
  });

  app.post("/api/config/worldbooks", async (request, reply) => {
    const body = bookBody.parse(request.body);
    const now = new Date().toISOString();
    await db.insert(worldbooks).values({ id: nanoid(), ...body, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/worldbooks/:id", async (request) => {
    const body = bookBody.parse(request.body);
    const { id } = idParams.parse(request.params);
    if (!(await db.select({ id: worldbooks.id }).from(worldbooks).where(eq(worldbooks.id, id)).limit(1))[0]) throw notFound("世界书不存在", "WORLDBOOK_NOT_FOUND");
    await db.update(worldbooks).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(worldbooks.id, id));
    return getConfigSnapshot();
  });
  app.post("/api/config/worldbook-entries", async (request, reply) => {
    const body = WorldbookEntrySchema.omit({ id: true }).parse(request.body);
    if (!(await db.select({ id: worldbooks.id }).from(worldbooks).where(eq(worldbooks.id, body.bookId)).limit(1))[0]) throw notFound("世界书不存在", "WORLDBOOK_NOT_FOUND");
    const now = new Date().toISOString();
    await db.insert(worldbookEntries).values({
      id: nanoid(), bookId: body.bookId, title: body.title, content: body.content, enabled: body.enabled, constant: body.constant,
      primaryKeysJson: JSON.stringify(body.primaryKeys), secondaryKeysJson: JSON.stringify(body.secondaryKeys), secondaryLogic: body.secondaryLogic,
      scanDepth: body.scanDepth, recursive: body.recursive, probability: body.probability, ignoreBudget: body.ignoreBudget, sortOrder: body.order,
      caseSensitive: body.caseSensitive, wholeWord: body.wholeWord, role: body.role, position: body.position, injectionDepth: body.injectionDepth,
      createdAt: now, updatedAt: now
    });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/worldbook-entries/:id", async (request) => {
    const body = WorldbookEntrySchema.parse(request.body);
    const { id } = idParams.parse(request.params);
    if (body.id !== id) throw conflict("请求路径与世界书条目 ID 不一致", "ID_MISMATCH");
    if (!(await db.select({ id: worldbookEntries.id }).from(worldbookEntries).where(eq(worldbookEntries.id, id)).limit(1))[0]) throw notFound("世界书条目不存在", "WORLDBOOK_ENTRY_NOT_FOUND");
    if (!(await db.select({ id: worldbooks.id }).from(worldbooks).where(eq(worldbooks.id, body.bookId)).limit(1))[0]) throw notFound("世界书不存在", "WORLDBOOK_NOT_FOUND");
    await db.update(worldbookEntries).set({
      bookId: body.bookId, title: body.title, content: body.content, enabled: body.enabled, constant: body.constant,
      primaryKeysJson: JSON.stringify(body.primaryKeys), secondaryKeysJson: JSON.stringify(body.secondaryKeys), secondaryLogic: body.secondaryLogic,
      scanDepth: body.scanDepth, recursive: body.recursive, probability: body.probability, ignoreBudget: body.ignoreBudget, sortOrder: body.order,
      caseSensitive: body.caseSensitive, wholeWord: body.wholeWord, role: body.role, position: body.position, injectionDepth: body.injectionDepth,
      updatedAt: new Date().toISOString()
    }).where(eq(worldbookEntries.id, id));
    return getConfigSnapshot();
  });

  app.put("/api/config/rules/:id", async (request) => {
    const body = ruleBody.parse(request.body);
    const { id } = idParams.parse(request.params);
    if (!(await db.select({ id: rulePresets.id }).from(rulePresets).where(eq(rulePresets.id, id)).limit(1))[0]) throw notFound("规则预设不存在", "RULE_PRESET_NOT_FOUND");
    const parsedRule = assertRuleConfig(body.rawText);
    await db.update(rulePresets).set({
      rawText: body.rawText,
      minProfileChanges: parsedRule.hard_constraints.profile.min_real_changes,
      minPanels: parsedRule.hard_constraints.render_plan.min_panels,
      maxPanels: parsedRule.hard_constraints.render_plan.max_panels,
      representativeComments: parsedRule.hard_constraints.posts.representative_comments,
      updatedAt: new Date().toISOString()
    }).where(eq(rulePresets.id, id));
    return getConfigSnapshot();
  });

  app.post("/api/config/macros", async (request, reply) => {
    const body = UserMacroSchema.omit({ id: true }).parse(request.body);
    if (protectedMacroNames.has(body.name)) throw conflict("该名称属于受保护的系统宏", "PROTECTED_MACRO_NAME");
    const now = new Date().toISOString();
    await db.insert(userMacros).values({ id: nanoid(), ...body, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/macros/:id", async (request) => {
    const body = UserMacroSchema.parse(request.body);
    const { id } = idParams.parse(request.params);
    if (body.id !== id) throw conflict("请求路径与宏 ID 不一致", "ID_MISMATCH");
    if (!(await db.select({ id: userMacros.id }).from(userMacros).where(eq(userMacros.id, id)).limit(1))[0]) throw notFound("用户宏不存在", "MACRO_NOT_FOUND");
    if (protectedMacroNames.has(body.name)) throw conflict("该名称属于受保护的系统宏", "PROTECTED_MACRO_NAME");
    await db.update(userMacros).set({ name: body.name, value: body.value, scope: body.scope, enabled: body.enabled, updatedAt: new Date().toISOString() }).where(eq(userMacros.id, id));
    return getConfigSnapshot();
  });
  app.post("/api/config/regex", async (request, reply) => {
    const body = RegexRuleSchema.omit({ id: true }).parse(request.body);
    try { compileSafeRegex(body.pattern, body.flags); }
    catch (error) { throw badRequest(error instanceof Error ? error.message : String(error), "UNSAFE_REGEX"); }
    const now = new Date().toISOString();
    await db.insert(regexRules).values({ id: nanoid(), name: body.name, pattern: body.pattern, replacement: body.replacement, flags: body.flags, field: body.field, enabled: body.enabled, sortOrder: body.order, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/regex/:id", async (request) => {
    const body = RegexRuleSchema.parse(request.body);
    const { id } = idParams.parse(request.params);
    if (body.id !== id) throw conflict("请求路径与正则规则 ID 不一致", "ID_MISMATCH");
    if (!(await db.select({ id: regexRules.id }).from(regexRules).where(eq(regexRules.id, id)).limit(1))[0]) throw notFound("正则规则不存在", "REGEX_NOT_FOUND");
    try { compileSafeRegex(body.pattern, body.flags); }
    catch (error) { throw badRequest(error instanceof Error ? error.message : String(error), "UNSAFE_REGEX"); }
    await db.update(regexRules).set({ name: body.name, pattern: body.pattern, replacement: body.replacement, flags: body.flags, field: body.field, enabled: body.enabled, sortOrder: body.order, updatedAt: new Date().toISOString() }).where(eq(regexRules.id, id));
    return getConfigSnapshot();
  });

  app.get("/api/backup", async (_request, reply) => {
    const backup = await createBackup();
    reply.header("content-disposition", `attachment; filename=airp-x-backup-${Date.now()}.json`);
    return backup;
  });
  app.post("/api/backup/restore", { bodyLimit: 64 * 1024 * 1024 }, async (request) => {
    await restoreBackup(request.body);
    return { ok: true, snapshot: await getAppSnapshot() };
  });
}
