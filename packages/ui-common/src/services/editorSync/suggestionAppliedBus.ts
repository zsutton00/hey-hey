interface InitiativeSuggestionAppliedSection {
  key: "description" | "details" | "acceptanceCriteria";
  content: string;
}

interface TaskSuggestionAppliedSection {
  key: string;
  content: string;
}

interface InitiativeSuggestionAppliedEvent {
  target: "work-item";
  entityType: "initiative";
  workItemId: string;
  sections: InitiativeSuggestionAppliedSection[];
}

interface TaskSuggestionAppliedEvent {
  target: "work-item";
  entityType: "task";
  workItemId: string;
  sections: TaskSuggestionAppliedSection[];
}

interface DesignDocSuggestionAppliedSection {
  key: string;
  content: string;
}

interface DesignDocSuggestionAppliedEvent {
  target: "design-doc";
  designDocId: string;
  sections: DesignDocSuggestionAppliedSection[];
}

export type EditorSuggestionAppliedEvent =
  | InitiativeSuggestionAppliedEvent
  | TaskSuggestionAppliedEvent
  | DesignDocSuggestionAppliedEvent;

type SuggestionAppliedListener = (event: EditorSuggestionAppliedEvent) => void;

const suggestionAppliedListeners = new Set<SuggestionAppliedListener>();

export const publishSuggestionAppliedEvent = (
  event: EditorSuggestionAppliedEvent,
): void => {
  for (const listener of suggestionAppliedListeners) {
    listener(event);
  }
};

export const subscribeSuggestionAppliedEvent = (
  listener: SuggestionAppliedListener,
): (() => void) => {
  suggestionAppliedListeners.add(listener);

  return () => {
    suggestionAppliedListeners.delete(listener);
  };
};
