import { describe, expect, it } from "vitest";
import { createBlankStorySnapshot } from "../apps/server/src/db/defaults.js";
import { BackupValidationError, parseBackupPayload } from "../apps/server/src/services/backup-service.js";

const timestamp = "2026-08-14T12:00:00.000Z";

function validBackup() {
  const snapshotJson = JSON.stringify(createBlankStorySnapshot());
  return {
    format: "airp-x-backup",
    version: 1,
    exportedAt: timestamp,
    data: {
      settings: [{ key: "runtime", value: "{}", updatedAt: timestamp }],
      roleCards: [
        { id: "player-card", role: "player", name: "玩家", version: "1", rawText: "player", active: true, createdAt: timestamp, updatedAt: timestamp },
        { id: "heroine-card", role: "heroine", name: "女主", version: "1", rawText: "heroine", active: true, createdAt: timestamp, updatedAt: timestamp }
      ],
      promptBlocks: [],
      worldbooks: [],
      worldbookEntries: [],
      rulePresets: [{ id: "rule", name: "规则", rawText: "schema_version: 1", minProfileChanges: 0, minPanels: 1, maxPanels: 8, representativeComments: 0, active: true, createdAt: timestamp, updatedAt: timestamp }],
      sessions: [{ id: "session", name: "会话", activeBranchId: "branch", createdAt: timestamp, updatedAt: timestamp }],
      branches: [{ id: "branch", sessionId: "session", name: "主线", parentBranchId: null, forkedFromTurnId: null, currentSnapshotJson: snapshotJson, rollingSummary: "", pendingActionsJson: "[]", createdAt: timestamp, updatedAt: timestamp }],
      turns: [],
      turnCandidates: [],
      checkpoints: [{ id: "checkpoint", branchId: "branch", turnId: null, sequence: 0, snapshotJson, summaryText: "", createdAt: timestamp }],
      localActions: [],
      userMacros: [],
      regexRules: []
    }
  };
}

describe("backup validation", () => {
  it("accepts a complete, internally consistent backup", () => {
    expect(parseBackupPayload(validBackup()).data.branches[0]?.id).toBe("branch");
  });

  it("rejects dangling active branches before restore can delete data", () => {
    const backup = validBackup();
    backup.data.sessions[0]!.activeBranchId = "missing";
    expect(() => parseBackupPayload(backup)).toThrow(BackupValidationError);
  });

  it("rejects unsafe regex rules during backup validation", () => {
    const backup = validBackup();
    backup.data.regexRules.push({ id: "regex", name: "unsafe", pattern: "(a+)+$", replacement: "", flags: "g", field: "post_text", enabled: true, sortOrder: 1, createdAt: timestamp, updatedAt: timestamp });
    expect(() => parseBackupPayload(backup)).toThrow(/灾难性回溯/);
  });
});
