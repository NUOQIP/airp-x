import { describe, expect, it } from "vitest";
import { isLoopbackHost } from "../apps/server/src/config.js";
import { RuntimeSettingsSchema } from "@airp/shared";

describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.12.34.56", "::1", "[::1]"])("accepts %s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "192.168.1.10", "10.0.0.2", "example.test", "128.0.0.1"])("rejects %s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("runtime endpoint validation", () => {
  const settings = {
    apiBaseUrl: "https://provider.example/v1",
    apiKey: "",
    model: "model",
    thinkingMode: "enabled",
    reasoningEffort: "high",
    temperature: 1,
    maxOutputTokens: 8192,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    contextWindow: 128000,
    recentHistoryMessages: 30,
    summaryTargetWords: 500
  } as const;

  it("accepts HTTP-compatible model endpoints", () => {
    expect(RuntimeSettingsSchema.parse(settings).apiBaseUrl).toBe(settings.apiBaseUrl);
    expect(RuntimeSettingsSchema.parse({ ...settings, apiBaseUrl: "http://127.0.0.1:11434/v1" }).apiBaseUrl).toContain("127.0.0.1");
  });

  it("rejects non-HTTP URL schemes", () => {
    expect(() => RuntimeSettingsSchema.parse({ ...settings, apiBaseUrl: "file:///etc/passwd" })).toThrow(/http/);
  });
});
