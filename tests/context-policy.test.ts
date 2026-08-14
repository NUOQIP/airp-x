import { describe, expect, it } from "vitest";
import { buildWorldbookScanText, selectWorldbookBudget, worldbookScopeEnabled } from "../apps/server/src/services/context-policy";

describe("context policies", () => {
  it("respects worldbook scan depth for every source and always includes current input", () => {
    const text = buildWorldbookScanText(2, {
      posts: ["post-1", "post-2", "post-3"],
      comments: ["comment-1", "comment-2", "comment-3"],
      messages: ["message-1", "message-2", "message-3"],
      history: ["history-1", "history-2", "history-3"],
      currentInput: "current"
    });
    expect(text).not.toContain("post-1");
    expect(text).toContain("post-2");
    expect(text).toContain("history-3");
    expect(text).toContain("current");
  });

  it("uses role-card markers for scoped worldbooks", () => {
    expect(worldbookScopeEnabled("global", { playerCard: false, heroineCard: false })).toBe(true);
    expect(worldbookScopeEnabled("session", { playerCard: false, heroineCard: false })).toBe(true);
    expect(worldbookScopeEnabled("player", { playerCard: true, heroineCard: false })).toBe(true);
    expect(worldbookScopeEnabled("heroine", { playerCard: true, heroineCard: false })).toBe(false);
  });

  it("tracks each book budget independently while enforcing the total window", () => {
    const result = selectWorldbookBudget([
      { id: "a", bookId: "book-a", tokenCost: 20, ignoreBookBudget: false, bookBudgetPercent: 25 },
      { id: "b", bookId: "book-b", tokenCost: 20, ignoreBookBudget: false, bookBudgetPercent: 25 },
      { id: "overflow", bookId: "book-c", tokenCost: 80, ignoreBookBudget: true, bookBudgetPercent: 1 }
    ], 100, 10);
    expect(result.selectedIds).toEqual(["a", "b"]);
    expect(result.mandatoryOverflowId).toBe("overflow");
  });
});
