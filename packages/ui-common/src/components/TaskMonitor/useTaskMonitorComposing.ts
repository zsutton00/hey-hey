import {
  useCallback,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";

function isEditable(element: EventTarget | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.matches("input, textarea, select, [contenteditable=true]")
  );
}

function fieldValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) {
    return element.type === "checkbox" || element.type === "radio"
      ? String(element.checked)
      : element.value;
  }
  if (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.value;
  }
  return element.textContent ?? "";
}

/** Composer drafts and structured-form edits block only automatic presentation changes. */
export function useTaskMonitorComposing(
  root: RefObject<HTMLDivElement | null>,
) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [ime, setIme] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const initialValues = useRef(new Map<HTMLElement, string>());
  const dirtyFields = useRef(new Set<HTMLElement>());

  const handleEdit = useCallback((event: SyntheticEvent<HTMLDivElement>) => {
    const field = event.target;
    if (
      !isEditable(field) ||
      !field.closest("form") ||
      field.closest('[data-testid="run-stream-external-reply-composer"]')
    ) {
      return;
    }
    if (fieldValue(field) === (initialValues.current.get(field) ?? "")) {
      dirtyFields.current.delete(field);
    } else {
      dirtyFields.current.add(field);
    }
    setFormDirty(dirtyFields.current.size > 0);
  }, []);

  const clearFormDrafts = useCallback(() => {
    dirtyFields.current.clear();
    initialValues.current.clear();
    setFormDirty(false);
    setFocused(false);
  }, []);

  return {
    composing: Boolean(draft) || focused || ime || formDirty,
    onDraftChange: setDraft,
    clearFormDrafts,
    handlers: {
      onFocusCapture: (event: SyntheticEvent<HTMLDivElement>) => {
        if (isEditable(event.target)) {
          setFocused(true);
          if (!initialValues.current.has(event.target)) {
            initialValues.current.set(event.target, fieldValue(event.target));
          }
        }
      },
      onBlurCapture: () =>
        queueMicrotask(() =>
          setFocused(
            Boolean(
              root.current?.contains(document.activeElement) &&
              isEditable(document.activeElement),
            ),
          ),
        ),
      onChangeCapture: handleEdit,
      onInputCapture: handleEdit,
      onCompositionStartCapture: () => setIme(true),
      onCompositionEndCapture: () => setIme(false),
    },
  };
}
