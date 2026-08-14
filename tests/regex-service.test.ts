import { describe, expect, it } from "vitest";
import { compileSafeRegex } from "../apps/server/src/services/regex-safety.js";

describe("compileSafeRegex", () => {
  it("accepts ordinary replacement expressions", () => {
    const expression = compileSafeRegex("foo\\s+bar", "gi");
    expect("Foo   Bar".replace(expression, "ok")).toBe("ok");
  });

  it("rejects expressions with catastrophic backtracking risk", () => {
    expect(() => compileSafeRegex("(a+)+$", "g")).toThrow(/灾难性回溯/);
  });

  it("reports invalid flags and syntax", () => {
    expect(() => compileSafeRegex("[", "g")).toThrow(/无效/);
    expect(() => compileSafeRegex("ok", "gg")).toThrow(/无效/);
  });
});
