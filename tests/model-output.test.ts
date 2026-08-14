import { describe, expect, it } from "vitest";
import { parseModelJsonObject } from "../apps/server/src/services/model-output";

describe("model JSON extraction", () => {
  it("preserves an already valid JSON object", () => {
    expect(parseModelJsonObject('{"text":"literal <think> tag is data"}')).toEqual({ text: "literal <think> tag is data" });
  });

  it("discards visible thinking and Markdown fences", () => {
    const raw = '<think>Plan first. A distracting object: {"draft":true}</think>\n```json\n{"ok":true,"value":"final"}\n```';
    expect(parseModelJsonObject(raw)).toEqual({ ok: true, value: "final" });
  });

  it("does not alter literal think tags inside the final JSON", () => {
    const raw = '<think>private reasoning</think>\n{"text":"keep <think>this literal value</think>"}';
    expect(parseModelJsonObject(raw)).toEqual({ text: "keep <think>this literal value</think>" });
    expect(parseModelJsonObject('<think>private reasoning</think>\n{"text":"keep a lone <think> value"}')).toEqual({ text: "keep a lone <think> value" });
  });

  it("accepts multiple complete reasoning blocks before one nested object", () => {
    const raw = '<think>first pass {"draft":true}</think>\n<think>second pass</think>\n{"ok":true,"nested":{"value":"a } and \\\" inside a string"}}';
    expect(parseModelJsonObject(raw)).toEqual({ ok: true, nested: { value: 'a } and " inside a string' } });
  });

  it("rejects output without a complete root object", () => {
    expect(() => parseModelJsonObject("<think>only reasoning</think>")).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('<think>{"draft":true}</think>\n{"ok":')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('<think>unfinished\n{"ok":true}')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('{"one":1}{"two":2}')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('{"ok":true} trailing prose')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('[{"ok":true}]')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('<think>reasoning</think>\nnull')).toThrow(SyntaxError);
    expect(() => parseModelJsonObject('<think>reasoning</think>\n42')).toThrow(SyntaxError);
  });

  it("accepts a BOM and a fenced JSON object", () => {
    expect(parseModelJsonObject('\uFEFF  ```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });
});
