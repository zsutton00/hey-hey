import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGuidedWalkthroughRuntime } from "../GuidedWalkthrough/guidedWalkthroughRuntime";
import { useGuidableTarget } from "../GuidedWalkthrough/useGuidableTarget";
import {
  createDiscussModalInstanceId,
  type DiscussModalInstanceId,
  type GuidableEntity,
  type GuidableTargetAddress,
} from "../GuidedWalkthrough/types";
import {
  acceptSuggestion,
  isPromptReady,
  NO_SUGGESTION,
  offerSuggestion,
  viewSuggestion,
  type DiscussSuggestionState,
} from "./discussSuggestion";

export interface UseDiscussWalkthroughInput {
  open: boolean;
  /** Entity the modal discusses; null when it has no guidable identity. */
  entity: GuidableEntity | null;
  prompt: string;
  /** Loads text into the mounted editor and submission state. */
  fillPrompt: (text: string) => void;
}

export interface DiscussWalkthroughBindings {
  editorTargetRef: React.RefObject<HTMLDivElement | null>;
  startTargetRef: React.RefObject<HTMLButtonElement | null>;
  guidanceContainerRef: (node: HTMLDivElement | null) => void;
  /** Call once the contextual Start Conversation launcher resolves. */
  reportStartConversationOutcome: (launched: boolean) => void;
}

/**
 * Walkthrough collaborator for one DiscussModal: owns the per-open instance
 * identity, prompt-editor and start targets, suggestion state, and the
 * modal-opened / conversation-launched events. Inert without a provider.
 */
export function useDiscussWalkthrough({
  open,
  entity,
  prompt,
  fillPrompt,
}: UseDiscussWalkthroughInput): DiscussWalkthroughBindings {
  const runtime = useGuidedWalkthroughRuntime();
  // A fresh instance (and fresh suggestion state) for every open.
  const modalInstanceId = useMemo<DiscussModalInstanceId | null>(
    () => (open ? createDiscussModalInstanceId() : null),
    [open]
  );
  const [suggestion, setSuggestion] =
    useState<DiscussSuggestionState>(NO_SUGGESTION);
  const [guidanceContainer, setGuidanceContainer] =
    useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setSuggestion(NO_SUGGESTION);
  }, [modalInstanceId]);

  const editorTargetRef = useRef<HTMLDivElement>(null);
  const startTargetRef = useRef<HTMLButtonElement>(null);
  useGuidableTarget(
    modalTargetAddress("discuss-prompt-editor", entity, modalInstanceId),
    () => editorTargetRef.current
  );
  useGuidableTarget(
    modalTargetAddress("discuss-start-conversation", entity, modalInstanceId),
    () => startTargetRef.current
  );

  const events = runtime?.events ?? null;
  const entityId = entity?.id ?? null;
  const entityRef = useRef(entity);
  entityRef.current = entity;
  useEffect(() => {
    const current = entityRef.current;
    if (events === null || current === null || modalInstanceId === null) return;
    events.emit({
      type: "discuss-modal-opened",
      entity: current,
      modalInstanceId,
    });
  }, [events, entityId, modalInstanceId]);

  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const suggestionRef = useRef(suggestion);
  suggestionRef.current = suggestion;

  const handleOffer = useCallback((text: string) => {
    setSuggestion((prev) => offerSuggestion(prev, text, promptRef.current));
  }, []);

  const handleAccept = useCallback((): boolean => {
    const accepted = acceptSuggestion(suggestionRef.current, promptRef.current);
    if (accepted === null) return false;
    // Repeated acceptance in the same tick must not fill twice.
    suggestionRef.current = accepted;
    setSuggestion(accepted);
    fillPrompt(accepted.text);
    return true;
  }, [fillPrompt]);

  const sessions = runtime?.discussSessions ?? null;
  const [sessionToken] = useState(() => Symbol("discuss-modal-session"));
  const promptReady = isPromptReady(suggestion, prompt);
  const suggestionView = useMemo(
    () => viewSuggestion(suggestion, prompt),
    [suggestion, prompt]
  );
  useEffect(() => {
    const current = entityRef.current;
    if (sessions === null || current === null || modalInstanceId === null) {
      return;
    }
    return sessions.publish(sessionToken, {
      entity: current,
      modalInstanceId,
      promptReady,
      suggestion: suggestionView,
      guidanceContainer,
      offerSuggestion: handleOffer,
      acceptSuggestion: handleAccept,
    });
  }, [
    sessions,
    sessionToken,
    entityId,
    modalInstanceId,
    promptReady,
    suggestionView,
    guidanceContainer,
    handleOffer,
    handleAccept,
  ]);

  const reportStartConversationOutcome = useCallback(
    (launched: boolean) => {
      const current = entityRef.current;
      if (!launched || events === null || current === null) return;
      if (modalInstanceId === null) return;
      events.emit({
        type: "discuss-conversation-launched",
        entity: current,
        modalInstanceId,
      });
    },
    [events, modalInstanceId]
  );

  return {
    editorTargetRef,
    startTargetRef,
    guidanceContainerRef: setGuidanceContainer,
    reportStartConversationOutcome,
  };
}

function modalTargetAddress(
  name: "discuss-prompt-editor" | "discuss-start-conversation",
  entity: GuidableEntity | null,
  modalInstanceId: DiscussModalInstanceId | null
): GuidableTargetAddress | null {
  return entity === null || modalInstanceId === null
    ? null
    : { name, entity, modalInstanceId };
}
