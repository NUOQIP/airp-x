export interface WorldbookScanSources {
  posts: string[];
  comments: string[];
  messages: string[];
  history: string[];
  currentInput: string;
}

export function buildWorldbookScanText(depth: number, sources: WorldbookScanSources, recursiveContent: string[] = []) {
  const take = Math.max(0, Math.floor(depth));
  const recent = take === 0
    ? []
    : [
        ...sources.posts.slice(-take),
        ...sources.comments.slice(-take),
        ...sources.messages.slice(-take),
        ...sources.history.slice(-take)
      ];
  return [...recent, sources.currentInput, ...recursiveContent].filter(Boolean).join("\n");
}

export function worldbookScopeEnabled(
  scope: "global" | "player" | "heroine" | "session",
  markers: { playerCard: boolean; heroineCard: boolean }
) {
  if (scope === "player") return markers.playerCard;
  if (scope === "heroine") return markers.heroineCard;
  return true;
}

export interface BudgetCandidate {
  id: string;
  bookId: string;
  tokenCost: number;
  ignoreBookBudget: boolean;
  bookBudgetPercent: number;
}

export function selectWorldbookBudget(candidates: BudgetCandidate[], availableTokens: number, initialUsedTokens: number) {
  const usedByBook = new Map<string, number>();
  const selectedIds: string[] = [];
  let usedTokens = initialUsedTokens;
  let mandatoryOverflowId: string | undefined;
  for (const candidate of candidates) {
    const bookUsed = usedByBook.get(candidate.bookId) ?? 0;
    const bookBudget = Math.floor(availableTokens * candidate.bookBudgetPercent / 100);
    if (!candidate.ignoreBookBudget && bookUsed + candidate.tokenCost > bookBudget) continue;
    if (usedTokens + candidate.tokenCost > availableTokens) {
      if (candidate.ignoreBookBudget) mandatoryOverflowId = candidate.id;
      continue;
    }
    selectedIds.push(candidate.id);
    usedTokens += candidate.tokenCost;
    usedByBook.set(candidate.bookId, bookUsed + candidate.tokenCost);
  }
  return { selectedIds, usedTokens, mandatoryOverflowId };
}
