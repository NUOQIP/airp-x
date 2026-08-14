export function trimRollingSummary(summary: string, targetWords: number) {
  const normalized = summary.trim();
  const targetCharacters = Math.max(200, Math.floor(targetWords) * 4);
  if (normalized.length <= targetCharacters) return normalized;
  const tail = normalized.slice(-targetCharacters);
  const firstLineBreak = tail.indexOf("\n");
  return `…\n${firstLineBreak >= 0 ? tail.slice(firstLineBreak + 1) : tail}`;
}
