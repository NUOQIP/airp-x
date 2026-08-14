import { describe, expect, it } from "vitest";
import { MessageSchema, PlayerTurnInputSchema } from "@airp/shared";

describe("v2 direct-message schemas", () => {
  it("accepts multiple visible bubbles and a Master-only director turn", () => {
    expect(PlayerTurnInputSchema.parse({
      kind: "dm", branchId: "branch", threadId: "thread", speechSegments: ["第一段", "第二段"], directorInstruction: "推进剧情"
    })).toMatchObject({ speechSegments: ["第一段", "第二段"] });
    expect(PlayerTurnInputSchema.parse({
      kind: "dm", branchId: "branch", threadId: "thread", speechSegments: [], directorInstruction: "仅导演指令"
    })).toMatchObject({ speechSegments: [], directorInstruction: "仅导演指令" });
  });

  it("rejects empty and overlong combined DM input", () => {
    expect(() => PlayerTurnInputSchema.parse({ kind: "dm", branchId: "branch", threadId: "thread", speechSegments: [] })).toThrow();
    expect(() => PlayerTurnInputSchema.parse({
      kind: "dm", branchId: "branch", threadId: "thread", speechSegments: ["a".repeat(8_000)], directorInstruction: "b".repeat(4_001)
    })).toThrow(/12000/);
  });

  it("stores turn and bubble ordering metadata on messages", () => {
    expect(MessageSchema.parse({
      id: "message", threadId: "thread", senderId: "account", createdAt: "2026-10-25T15:00+08:00", text: "气泡", turnId: "turn", bubbleOrder: 2
    })).toMatchObject({ turnId: "turn", bubbleOrder: 2 });
  });
});
