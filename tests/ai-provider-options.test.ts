import { describe, expect, it } from "vitest";
import type { RuntimeSettings } from "@airp/shared";
import { finalContentText, providerRequestOptions } from "../apps/server/src/services/ai-client";

describe("provider thinking options", () => {
  it("enables native thinking for DeepSeek", () => {
    const settings = { apiBaseUrl: "https://api.deepseek.com", thinkingMode: "enabled", reasoningEffort: "high" } as RuntimeSettings;
    expect(providerRequestOptions(settings)).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "high" });
    expect(providerRequestOptions({ apiBaseUrl: "https://gateway.deepseek.com/v1", thinkingMode: "enabled", reasoningEffort: "max" } as RuntimeSettings)).toEqual({ thinking: { type: "enabled" }, reasoning_effort: "max" });
  });

  it("can disable native thinking for DeepSeek", () => {
    const settings = { apiBaseUrl: "https://api.deepseek.com", thinkingMode: "disabled", reasoningEffort: "max" } as RuntimeSettings;
    expect(providerRequestOptions(settings)).toEqual({ thinking: { type: "disabled" } });
  });

  it("does not send a DeepSeek-only option to other providers", () => {
    const settings = { apiBaseUrl: "https://api.openai.com/v1" } as RuntimeSettings;
    expect(providerRequestOptions(settings)).toEqual({});
    expect(providerRequestOptions({ apiBaseUrl: "https://notdeepseek.com/v1" } as RuntimeSettings)).toEqual({});
  });

  it("keeps final content parts while discarding reasoning parts", () => {
    expect(finalContentText([
      { type: "reasoning", text: "private reasoning" },
      { type: "text", text: '{"ok":' },
      { type: "output_text", text: "true}" }
    ])).toBe('{"ok":true}');
  });
});
