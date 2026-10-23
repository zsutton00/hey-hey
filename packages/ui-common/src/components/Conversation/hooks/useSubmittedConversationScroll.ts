import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import {
  getOptimisticInputs,
  subscribeOptimisticInputs,
} from "../../../data/collections/optimisticConversationInputs";
import { navigateToConversationTarget } from "./conversationScrollController";

function findSubmittedMessage(
  owner: HTMLElement,
  operationId: string,
  messageId: string | undefined
): HTMLElement | null {
  return (
    Array.from(
      owner.querySelectorAll<HTMLElement>(
        "[data-operation-id], [data-preview-key], [data-message-id]"
      )
    ).find(
      (element) =>
        element.dataset.operationId === operationId ||
        (element.dataset.previewKey === operationId &&
          element.dataset.deliveryState !== "queued" &&
          element.dataset.deliveryState !== "failed") ||
        (!!messageId && element.dataset.messageId === messageId)
    ) ?? null
  );
}

function trackSubmissions(
  conversationId: string,
  known: Set<string>,
  pending: Map<string, string | undefined>
): void {
  for (const row of getOptimisticInputs()) {
    if (row.input.conversationId !== conversationId) continue;
    if (!known.has(row.operationId)) {
      known.add(row.operationId);
      pending.set(row.operationId, row.confirmed?.id);
    }
    if (
      row.failure ||
      row.confirmed?.executionAdmissionDisposition === "QUEUED" ||
      row.confirmed?.executionQueueConfirmed
    ) {
      pending.delete(row.operationId);
    } else if (pending.has(row.operationId)) {
      pending.set(row.operationId, row.confirmed?.id);
    }
  }
}

/** Local submission evidence authorizes one move, never a realtime arrival. */
export function useSubmittedConversationScroll(
  ownerRef: RefObject<HTMLElement | null> | null,
  conversationId: string | null
): void {
  useLayoutEffect(() => {
    if (!ownerRef || !conversationId) return;
    const known = new Set(
      getOptimisticInputs().map((input) => input.operationId)
    );
    const pending = new Map<string, string | undefined>();
    let observer: MutationObserver | undefined;
    let ownerFrame = 0;
    const stopWaiting = () => {
      observer?.disconnect();
      observer = undefined;
      cancelAnimationFrame(ownerFrame);
      ownerFrame = 0;
    };
    const revealMounted = () => {
      const owner = ownerRef.current;
      if (!owner) return;
      for (const [operationId, messageId] of pending) {
        const target = findSubmittedMessage(owner, operationId, messageId);
        if (!target) continue;
        pending.delete(operationId);
        navigateToConversationTarget(owner, target, "instant");
      }
      if (!pending.size) stopWaiting();
    };
    const waitForMount = () => {
      ownerFrame = 0;
      revealMounted();
      const owner = ownerRef.current;
      if (!pending.size || observer) return;
      if (!owner) {
        ownerFrame = requestAnimationFrame(waitForMount);
        return;
      }
      // Wait only for a requested target to mount; never restore resize offsets.
      observer = new MutationObserver(revealMounted);
      observer.observe(owner, { childList: true, subtree: true });
    };
    const onSubmissionChange = () => {
      trackSubmissions(conversationId, known, pending);
      cancelAnimationFrame(ownerFrame);
      waitForMount();
    };
    const unsubscribe = subscribeOptimisticInputs(onSubmissionChange);
    return () => {
      unsubscribe();
      stopWaiting();
    };
  }, [ownerRef, conversationId]);
}
