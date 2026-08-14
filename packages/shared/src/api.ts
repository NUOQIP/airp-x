import type {
  Account,
  AiTurnOutput,
  Comment,
  HeroineProfile,
  LiveSession,
  Message,
  MvuState,
  Post,
  PromptBlock,
  PromptPresetState,
  RuntimeSettings,
  Thread,
  UserMacro,
  RegexRule,
  WorldbookEntry
} from "./schemas.js";

export interface BranchSummary {
  id: string;
  sessionId: string;
  name: string;
  parentBranchId?: string;
  forkedFromTurnId?: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface SessionSummary {
  id: string;
  name: string;
  activeBranchId: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface TurnSummary {
  id: string;
  branchId: string;
  sequence: number;
  status: "pending" | "complete" | "failed";
  inputKind: "comment" | "dm" | "group" | "seed";
  inputText: string;
  createdAt: string;
  error?: string;
  candidates: Array<{ id: string; active: boolean; createdAt: string }>;
}

export interface StorySnapshot {
  accounts: Account[];
  profile: HeroineProfile;
  posts: Post[];
  comments: Comment[];
  threads: Thread[];
  messages: Message[];
  lives: LiveSession[];
  mvu: MvuState;
  trends: Array<{ label: string; volumeLabel: string; rank: number }>;
  notices: Array<{ id: string; level: string; text: string; createdAt: string }>;
  pendingRenderPlan?: AiTurnOutput["renderPlan"];
}

export interface AppSnapshot extends StorySnapshot {
  session: { id: string; name: string; activeBranchId: string };
  sessions: SessionSummary[];
  branches: BranchSummary[];
  turns: TurnSummary[];
}

export interface ConfigSnapshot {
  roleCards: Array<{ id: string; role: "player" | "heroine"; name: string; version: string; rawText: string; active: boolean; updatedAt: string }>;
  promptBlocks: PromptBlock[];
  promptPresetState: PromptPresetState;
  worldbooks: Array<{ id: string; name: string; scope: "global" | "player" | "heroine" | "session"; enabled: boolean; tokenBudgetPercent: number; entries: WorldbookEntry[] }>;
  rulePreset: {
    id: string;
    name: string;
    rawText: string;
    minProfileChanges: number;
    minPanels: number;
    maxPanels: number;
    representativeComments: number;
  };
  settings: Omit<RuntimeSettings, "apiKey"> & { hasApiKey: boolean; apiKeyPreview: string };
  userMacros: UserMacro[];
  regexRules: RegexRule[];
}

export interface TurnAccepted {
  turnId: string;
  snapshot: AppSnapshot;
  renderPlan: AiTurnOutput["renderPlan"];
}

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}
