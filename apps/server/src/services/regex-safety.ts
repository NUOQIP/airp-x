import safeRegex from "safe-regex2";

export function compileSafeRegex(pattern: string, flags: string) {
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!safeRegex(expression)) throw new Error("正则表达式可能发生灾难性回溯，请改写后再保存");
  return expression;
}
