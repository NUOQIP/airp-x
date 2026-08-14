import { describe, expect, it } from "vitest";
import { trimRollingSummary } from "../apps/server/src/services/memory-service";

describe("rolling memory", () => {
  it("keeps a short summary unchanged", () => {
    expect(trimRollingSummary("第一轮：相遇", 50)).toBe("第一轮：相遇");
  });

  it("keeps the newest bounded tail for a long summary", () => {
    const summary = Array.from({ length: 100 }, (_, index) => `第${index}轮：${"内容".repeat(10)}`).join("\n");
    const trimmed = trimRollingSummary(summary, 50);
    expect(trimmed.startsWith("…\n")).toBe(true);
    expect(trimmed).toContain("第99轮");
    expect(trimmed.length).toBeLessThanOrEqual(202);
  });
});
