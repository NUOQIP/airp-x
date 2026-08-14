import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSnapshot, LocalAction, PlayerTurnInput } from "@airp/shared";
import { apiClient } from "../lib/api";
import { useUiStore } from "../store/ui";

export function useSnapshot() {
  return useQuery({ queryKey: ["snapshot"], queryFn: () => apiClient.snapshot(), staleTime: 15_000 });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: apiClient.config, staleTime: 15_000 });
}

export function useTurnMutation() {
  const client = useQueryClient();
  const stageReveal = useUiStore((state) => state.stageReveal);
  return useMutation({
    mutationFn: (input: PlayerTurnInput) => apiClient.submitTurn(input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: ["snapshot"] });
      const current = client.getQueryData<AppSnapshot>(["snapshot"]);
      if (!current) return;
      const optimistic = structuredClone(current);
      const id = `optimistic-${Date.now()}`;
      if (input.kind === "comment") {
        optimistic.comments.push({ id, postId: input.postId, ...(input.parentCommentId ? { parentId: input.parentCommentId } : {}), authorId: "account-player", createdAt: optimistic.mvu.storyTime, text: input.text, metrics: { replies: 0, reposts: 0, likes: 0, views: 0, bookmarks: 0 }, moderation: "visible" });
        const post = optimistic.posts.find((item) => item.id === input.postId);
        if (post) post.metrics.replies += 1;
      } else {
        const conversation = input as typeof input & { speechSegments?: string[]; text?: string };
        const speechSegments = conversation.speechSegments?.filter((text) => text.trim()) ?? (conversation.text?.trim() ? [conversation.text.trim()] : []);
        for (const [bubbleOrder, text] of speechSegments.entries()) {
          optimistic.messages.push({
            id: `${id}-${bubbleOrder}`,
            threadId: input.threadId,
            senderId: "account-player",
            createdAt: optimistic.mvu.storyTime,
            text,
            status: "sent",
            ...(bubbleOrder === 0 && input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
            isPlayerInput: true,
            turnId: id,
            bubbleOrder
          } as AppSnapshot["messages"][number]);
        }
      }
      client.setQueryData(["snapshot"], optimistic);
    },
    onSuccess: (result) => {
      client.setQueryData(["snapshot"], result.snapshot);
      stageReveal(result.renderPlan);
    },
    onError: async () => {
      const snapshot = await apiClient.snapshot();
      client.setQueryData(["snapshot"], snapshot);
    }
  });
}

export function useLocalActionMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LocalAction) => apiClient.localAction(input),
    onSuccess: (snapshot: AppSnapshot) => client.setQueryData(["snapshot"], snapshot)
  });
}
