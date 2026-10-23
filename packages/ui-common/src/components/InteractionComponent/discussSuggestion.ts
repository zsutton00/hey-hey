import type { DiscussSuggestionView } from "../GuidedWalkthrough/DiscussModalSessionStore";

/**
 * Suggestion lifecycle for one DiscussModal instance. `baselinePrompt` is the
 * prompt when a suggestion first became available; any different prompt means
 * the user has edited since, and their text is protected.
 */
export type DiscussSuggestionState =
  | { status: "none" }
  | { status: "offered"; text: string; baselinePrompt: string }
  | { status: "accepted"; text: string };

export const NO_SUGGESTION: DiscussSuggestionState = { status: "none" };

/** Later offers update the text but never move the edit baseline. */
export function offerSuggestion(
  state: DiscussSuggestionState,
  text: string,
  currentPrompt: string
): DiscussSuggestionState {
  switch (state.status) {
    case "none":
      return { status: "offered", text, baselinePrompt: currentPrompt };
    case "offered":
      return state.text === text ? state : { ...state, text };
    case "accepted":
      return state;
  }
}

/** The accepted state, or null when the user's text is protected. */
export function acceptSuggestion(
  state: DiscussSuggestionState,
  currentPrompt: string
): Extract<DiscussSuggestionState, { status: "accepted" }> | null {
  return state.status === "offered" && state.baselinePrompt === currentPrompt
    ? { status: "accepted", text: state.text }
    : null;
}

export function viewSuggestion(
  state: DiscussSuggestionState,
  currentPrompt: string
): DiscussSuggestionView {
  switch (state.status) {
    case "none":
      return state;
    case "accepted":
      return state;
    case "offered":
      return state.baselinePrompt === currentPrompt
        ? { status: "available", text: state.text }
        : { status: "protected", text: state.text };
  }
}

export function isPromptReady(
  state: DiscussSuggestionState,
  currentPrompt: string
): boolean {
  return state.status === "accepted" || currentPrompt.trim().length > 0;
}
