import type { AiTurnOutput } from "@airp/shared";
import { create } from "zustand";

let revealTimer: number | undefined;

interface UiState {
  selectedThreadId?: string;
  revealPlan: AiTurnOutput["renderPlan"] | undefined;
  revealNonce: number;
  configOpen: boolean;
  setSelectedThread: (id: string) => void;
  stageReveal: (plan: AiTurnOutput["renderPlan"]) => void;
  clearReveal: () => void;
  setConfigOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  revealNonce: 0,
  configOpen: false,
  revealPlan: undefined,
  setSelectedThread: (selectedThreadId) => set({ selectedThreadId }),
  stageReveal: (revealPlan) => {
    if (revealTimer) window.clearTimeout(revealTimer);
    set((state) => ({ revealPlan, revealNonce: state.revealNonce + 1 }));
    const duration = Math.max(...revealPlan.panels.map((panel) => panel.delayMs), 0) + 1_200;
    revealTimer = window.setTimeout(() => set({ revealPlan: undefined }), duration);
  },
  clearReveal: () => set({ revealPlan: undefined }),
  setConfigOpen: (configOpen) => set({ configOpen })
}));
