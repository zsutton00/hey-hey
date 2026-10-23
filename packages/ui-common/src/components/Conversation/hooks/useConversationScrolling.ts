import {
  navigateToConversationTarget,
  revealLatestConversationContent,
  waitForConversationTarget,
} from "./conversationScrollController";
import type { RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useDataStateLoading } from "../../shared/dataStateLoadingContext";
import type { MessageResponseDto } from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import { useSubmittedConversationScroll } from "./useSubmittedConversationScroll";

export type ConversationScrollPolicy =
  | { mode: "owned"; ownerRef: RefObject<HTMLElement | null> }
  | { mode: "disabled" };

export const ConversationScrollPolicyContext =
  createContext<ConversationScrollPolicy | null>(null);
export const useOptionalConversationScrollPolicy =
  (): ConversationScrollPolicy | null =>
    useContext(ConversationScrollPolicyContext);
export const DISABLED_CONVERSATION_SCROLL_POLICY = {
  mode: "disabled",
} as const satisfies ConversationScrollPolicy;

interface UseConversationScrollingProps {
  scrollPolicy: ConversationScrollPolicy;
  conversationTimeline: ConversationMessage[];
  conversationId: string | null;
}
interface UseConversationScrollingReturn {
  handleStepClick: (stepIndex: number, message: MessageResponseDto) => void;
  loadOlderMessages: (loadOlder: () => Promise<void>) => Promise<void>;
  initialScrollReady: boolean;
}

const INITIAL_REVEAL_FALLBACK_MS = 2200;
const findOwnedMessage = (
  owner: HTMLElement,
  messageId: string
): HTMLElement | null =>
  Array.from(owner.querySelectorAll<HTMLElement>("[data-message-id]")).find(
    (element) => element.dataset.messageId === messageId
  ) ?? null;
const findOwnedStep = (
  owner: HTMLElement,
  stepIndex: number
): HTMLElement | null =>
  Array.from(owner.querySelectorAll<HTMLElement>("[data-step-index]")).find(
    (element) => element.dataset.stepIndex === String(stepIndex)
  ) ?? null;

/** Native anchoring owns layout changes; this hook performs explicit moves only. */
export const useConversationScrolling = ({
  scrollPolicy,
  conversationTimeline,
  conversationId,
}: UseConversationScrollingProps): UseConversationScrollingReturn => {
  const ownerRef = scrollPolicy.mode === "owned" ? scrollPolicy.ownerRef : null;
  const [revealedConversation, setRevealedConversation] = useState<
    string | null
  >(null);
  const latestMessageId = conversationTimeline.at(-1)?.message.id;
  const latestMessageIdRef = useRef(latestMessageId);
  latestMessageIdRef.current = latestMessageId;
  const ready =
    !conversationId ||
    !ownerRef ||
    !latestMessageId ||
    revealedConversation === conversationId;
  useDataStateLoading(!ready);
  useSubmittedConversationScroll(ownerRef, conversationId);

  useLayoutEffect(() => {
    if (
      !conversationId ||
      !ownerRef ||
      !latestMessageId ||
      revealedConversation === conversationId
    )
      return;
    let stopWaiting: (() => void) | undefined;
    let frame = 0;
    const waitForOwner = () => {
      const owner = ownerRef.current;
      if (!owner) {
        frame = requestAnimationFrame(waitForOwner);
        return;
      }
      stopWaiting = waitForConversationTarget(
        owner,
        () =>
          latestMessageIdRef.current
            ? findOwnedMessage(owner, latestMessageIdRef.current)
            : null,
        () => {
          revealLatestConversationContent(owner);
          setRevealedConversation(conversationId);
        }
      );
    };
    frame = requestAnimationFrame(waitForOwner);
    const fallback = setTimeout(() => {
      cancelAnimationFrame(frame);
      stopWaiting?.();
      setRevealedConversation(conversationId);
    }, INITIAL_REVEAL_FALLBACK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
      stopWaiting?.();
    };
  }, [ownerRef, latestMessageId, revealedConversation, conversationId]);

  const loadOlderMessages = useCallback(
    (loadOlder: () => Promise<void>) => loadOlder(),
    []
  );
  const handleStepClick = useCallback(
    (stepIndex: number, message: MessageResponseDto) => {
      const owner = ownerRef?.current;
      if (!owner) return;
      const target =
        findOwnedMessage(owner, message.id) ?? findOwnedStep(owner, stepIndex);
      if (target) navigateToConversationTarget(owner, target);
    },
    [ownerRef]
  );
  return { handleStepClick, loadOlderMessages, initialScrollReady: ready };
};
