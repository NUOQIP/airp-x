import { db } from "../db/client.js";
import {
  branches,
  checkpoints,
  localActions,
  promptBlocks,
  regexRules,
  roleCards,
  rulePresets,
  sessions,
  settings,
  turnCandidates,
  turns,
  userMacros,
  worldbookEntries,
  worldbooks
} from "../db/schema.js";

export async function createBackup() {
  const [settingRows, cardRows, promptRows, bookRows, entryRows, ruleRows, sessionRows, branchRows, turnRows, candidateRows, checkpointRows, actionRows, macroRows, regexRows] = await Promise.all([
    db.select().from(settings),
    db.select().from(roleCards),
    db.select().from(promptBlocks),
    db.select().from(worldbooks),
    db.select().from(worldbookEntries),
    db.select().from(rulePresets),
    db.select().from(sessions),
    db.select().from(branches),
    db.select().from(turns),
    db.select().from(turnCandidates),
    db.select().from(checkpoints),
    db.select().from(localActions),
    db.select().from(userMacros),
    db.select().from(regexRules)
  ]);
  return {
    format: "airp-x-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "API Key is stored in the local .env file and is intentionally excluded.",
    data: {
      settings: settingRows,
      roleCards: cardRows,
      promptBlocks: promptRows,
      worldbooks: bookRows,
      worldbookEntries: entryRows,
      rulePresets: ruleRows,
      sessions: sessionRows,
      branches: branchRows,
      turns: turnRows,
      turnCandidates: candidateRows,
      checkpoints: checkpointRows,
      localActions: actionRows,
      userMacros: macroRows,
      regexRules: regexRows
    }
  };
}

export async function restoreBackup(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("备份文件格式无效");
  const backup = value as { format?: string; version?: number; data?: Record<string, unknown> };
  if (backup.format !== "airp-x-backup" || backup.version !== 1 || !backup.data) throw new Error("不支持的备份格式或版本");
  const data = backup.data as Record<string, unknown[]>;
  const required = ["settings", "roleCards", "promptBlocks", "worldbooks", "worldbookEntries", "rulePresets", "sessions", "branches", "turns", "turnCandidates", "checkpoints", "localActions", "userMacros", "regexRules"];
  if (required.some((key) => !Array.isArray(data[key]))) throw new Error("备份数据不完整");
  db.transaction((tx) => {
    tx.delete(localActions).run();
    tx.delete(checkpoints).run();
    tx.delete(turnCandidates).run();
    tx.delete(turns).run();
    tx.delete(branches).run();
    tx.delete(sessions).run();
    tx.delete(worldbookEntries).run();
    tx.delete(worldbooks).run();
    tx.delete(promptBlocks).run();
    tx.delete(roleCards).run();
    tx.delete(rulePresets).run();
    tx.delete(settings).run();
    tx.delete(userMacros).run();
    tx.delete(regexRules).run();
    if (data.settings!.length) tx.insert(settings).values(data.settings as typeof settings.$inferInsert[]).run();
    if (data.roleCards!.length) tx.insert(roleCards).values(data.roleCards as typeof roleCards.$inferInsert[]).run();
    if (data.promptBlocks!.length) tx.insert(promptBlocks).values(data.promptBlocks as typeof promptBlocks.$inferInsert[]).run();
    if (data.worldbooks!.length) tx.insert(worldbooks).values(data.worldbooks as typeof worldbooks.$inferInsert[]).run();
    if (data.worldbookEntries!.length) tx.insert(worldbookEntries).values(data.worldbookEntries as typeof worldbookEntries.$inferInsert[]).run();
    if (data.rulePresets!.length) tx.insert(rulePresets).values(data.rulePresets as typeof rulePresets.$inferInsert[]).run();
    if (data.sessions!.length) tx.insert(sessions).values(data.sessions as typeof sessions.$inferInsert[]).run();
    if (data.branches!.length) tx.insert(branches).values(data.branches as typeof branches.$inferInsert[]).run();
    if (data.turns!.length) tx.insert(turns).values(data.turns as typeof turns.$inferInsert[]).run();
    if (data.turnCandidates!.length) tx.insert(turnCandidates).values(data.turnCandidates as typeof turnCandidates.$inferInsert[]).run();
    if (data.checkpoints!.length) tx.insert(checkpoints).values(data.checkpoints as typeof checkpoints.$inferInsert[]).run();
    if (data.localActions!.length) tx.insert(localActions).values(data.localActions as typeof localActions.$inferInsert[]).run();
    if (data.userMacros!.length) tx.insert(userMacros).values(data.userMacros as typeof userMacros.$inferInsert[]).run();
    if (data.regexRules!.length) tx.insert(regexRules).values(data.regexRules as typeof regexRules.$inferInsert[]).run();
  });
}
