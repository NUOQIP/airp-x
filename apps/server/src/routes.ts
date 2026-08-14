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
        z.string().max(750_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "头像必须是本地 PNG、JPEG 或 WebP 图片")
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
        z.string().max(750_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "封面必须是本地 PNG、JPEG 或 WebP 图片")
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
    if (id.endsWith("-default")) throw new Error("原始角色卡只读；请先复制为新卡再编辑");
    const body = cardBody.parse(request.body);
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
    if (!existing) throw new Error("提示词块不存在");
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
    await db.update(worldbooks).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(worldbooks.id, idParams.parse(request.params).id));
    return getConfigSnapshot();
  });
  app.post("/api/config/worldbook-entries", async (request, reply) => {
    const body = WorldbookEntrySchema.omit({ id: true }).parse(request.body);
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
    await db.update(worldbookEntries).set({
      bookId: body.bookId, title: body.title, content: body.content, enabled: body.enabled, constant: body.constant,
      primaryKeysJson: JSON.stringify(body.primaryKeys), secondaryKeysJson: JSON.stringify(body.secondaryKeys), secondaryLogic: body.secondaryLogic,
      scanDepth: body.scanDepth, recursive: body.recursive, probability: body.probability, ignoreBudget: body.ignoreBudget, sortOrder: body.order,
      caseSensitive: body.caseSensitive, wholeWord: body.wholeWord, role: body.role, position: body.position, injectionDepth: body.injectionDepth,
      updatedAt: new Date().toISOString()
    }).where(eq(worldbookEntries.id, idParams.parse(request.params).id));
    return getConfigSnapshot();
  });

  app.put("/api/config/rules/:id", async (request) => {
    const body = ruleBody.parse(request.body);
    const parsedRule = assertRuleConfig(body.rawText);
    await db.update(rulePresets).set({
      rawText: body.rawText,
      minProfileChanges: parsedRule.hard_constraints.profile.min_real_changes,
      minPanels: parsedRule.hard_constraints.render_plan.min_panels,
      maxPanels: parsedRule.hard_constraints.render_plan.max_panels,
      representativeComments: parsedRule.hard_constraints.posts.representative_comments,
      updatedAt: new Date().toISOString()
    }).where(eq(rulePresets.id, idParams.parse(request.params).id));
    return getConfigSnapshot();
  });

  app.post("/api/config/macros", async (request, reply) => {
    const body = UserMacroSchema.omit({ id: true }).parse(request.body);
    if (protectedMacroNames.has(body.name)) throw new Error("该名称属于受保护的系统宏");
    const now = new Date().toISOString();
    await db.insert(userMacros).values({ id: nanoid(), ...body, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/macros/:id", async (request) => {
    const body = UserMacroSchema.parse(request.body);
    if (protectedMacroNames.has(body.name)) throw new Error("该名称属于受保护的系统宏");
    await db.update(userMacros).set({ name: body.name, value: body.value, scope: body.scope, enabled: body.enabled, updatedAt: new Date().toISOString() }).where(eq(userMacros.id, idParams.parse(request.params).id));
    return getConfigSnapshot();
  });
  app.post("/api/config/regex", async (request, reply) => {
    const body = RegexRuleSchema.omit({ id: true }).parse(request.body);
    new RegExp(body.pattern, body.flags);
    const now = new Date().toISOString();
    await db.insert(regexRules).values({ id: nanoid(), name: body.name, pattern: body.pattern, replacement: body.replacement, flags: body.flags, field: body.field, enabled: body.enabled, sortOrder: body.order, createdAt: now, updatedAt: now });
    return reply.code(201).send(await getConfigSnapshot());
  });
  app.put("/api/config/regex/:id", async (request) => {
    const body = RegexRuleSchema.parse(request.body);
    new RegExp(body.pattern, body.flags);
    await db.update(regexRules).set({ name: body.name, pattern: body.pattern, replacement: body.replacement, flags: body.flags, field: body.field, enabled: body.enabled, sortOrder: body.order, updatedAt: new Date().toISOString() }).where(eq(regexRules.id, idParams.parse(request.params).id));
    return getConfigSnapshot();
  });

  app.get("/api/backup", async (_request, reply) => {
    const backup = await createBackup();
    reply.header("content-disposition", `attachment; filename=airp-x-backup-${Date.now()}.json`);
    return backup;
  });
  app.post("/api/backup/restore", async (request) => {
    await restoreBackup(request.body);
    return { ok: true, snapshot: await getAppSnapshot() };
  });
}
