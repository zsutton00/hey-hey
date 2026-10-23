import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFileReferenceCandidates } from "../../../data/hooks/useFileReferenceCandidates";
import type { FileTouchReferenceCandidateDto } from "../../../api";
import {
  FileReferencePopup,
  FILE_REFERENCE_POPUP_WIDTH,
} from "./FileReferencePopup";
import { $replaceRangeWithFileReference } from "./fileReferenceInsertion";
import { rankFileReferenceCandidates } from "./fileReferenceRanking";
import { matchFileReferenceTrigger } from "./fileReferenceTrigger";
import type {
  FileReferenceConfig,
  FileReferencePopupPosition,
  FileReferenceTriggerMatch,
} from "./types";
import {
  candidateToFileReferenceValue,
  fileReferenceCandidateKey,
} from "./types";
import { computeNextMentionIndex } from "../mentionNavigation";

const POPUP_SPACING = 4;

const getCaretPosition = (): FileReferencePopupPosition | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (typeof range.getBoundingClientRect !== "function") return null;
  const rect = range.getBoundingClientRect();
  return {
    top: rect.bottom + POPUP_SPACING,
    left: Math.max(
      POPUP_SPACING,
      Math.min(
        rect.left,
        window.innerWidth - FILE_REFERENCE_POPUP_WIDTH - POPUP_SPACING
      )
    ),
  };
};

const readTriggerAtSelection = (): FileReferenceTriggerMatch | null => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;

  return matchFileReferenceTrigger(
    anchorNode.getTextContent(),
    Math.min(anchor.offset, anchorNode.getTextContentSize()),
    anchorNode.getKey()
  );
};

export const FileReferencePlugin = ({
  config,
}: {
  config: FileReferenceConfig;
}) => {
  const [editor] = useLexicalComposerContext();
  const [trigger, setTrigger] = useState<FileReferenceTriggerMatch | null>(
    null
  );
  const [position, setPosition] = useState<FileReferencePopupPosition>({
    top: 0,
    left: 0,
  });
  const popupRef = useRef<HTMLDivElement | null>(null);

  const dismissPicker = useCallback(() => {
    setTrigger(null);
  }, []);

  const updateTrigger = useCallback(() => {
    editor.getEditorState().read(() => {
      const nextTrigger = readTriggerAtSelection();
      setTrigger(nextTrigger);
      if (nextTrigger) {
        const nextPosition = getCaretPosition();
        if (nextPosition) setPosition(nextPosition);
      }
    });
  }, [editor]);

  useEffect(
    () => editor.registerUpdateListener(() => updateTrigger()),
    [editor, updateTrigger]
  );

  useEffect(() => {
    if (!trigger) return undefined;

    const root = editor.getRootElement();
    if (!root) return undefined;

    const isInside = (target: EventTarget | null, element: Node): boolean =>
      target instanceof Node && element.contains(target);

    const handleBlur = (event: FocusEvent): void => {
      const popupElement = popupRef.current;
      if (popupElement && isInside(event.relatedTarget, popupElement)) return;
      dismissPicker();
    };

    const handleOutsideInteraction = (event: Event): void => {
      if (isInside(event.target, root)) return;

      const popupElement = popupRef.current;
      if (popupElement && isInside(event.target, popupElement)) return;

      dismissPicker();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Escape") return;

      dismissPicker();
      event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener("blur", handleBlur);
    root.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handleOutsideInteraction, true);
    document.addEventListener("focusin", handleOutsideInteraction, true);

    return () => {
      root.removeEventListener("blur", handleBlur);
      root.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener(
        "mousedown",
        handleOutsideInteraction,
        true
      );
      document.removeEventListener("focusin", handleOutsideInteraction, true);
    };
  }, [dismissPicker, editor, trigger]);

  if (!trigger) return null;

  return (
    <ActiveFileReferencePopup
      config={config}
      position={position}
      trigger={trigger}
      popupRef={popupRef}
    />
  );
};

const ActiveFileReferencePopup = ({
  config,
  position,
  trigger,
  popupRef,
}: {
  config: FileReferenceConfig;
  position: FileReferencePopupPosition;
  trigger: FileReferenceTriggerMatch;
  popupRef: RefObject<HTMLDivElement | null>;
}) => {
  const [editor] = useLexicalComposerContext();
  const candidatesState = useFileReferenceCandidates({
    organizationId: config.organizationId,
    projectId: config.projectId,
    scope: config.scope,
    active: true,
  });
  const orderedCandidates = useMemo(
    () =>
      rankFileReferenceCandidates(candidatesState.candidates, trigger.query),
    [candidatesState.candidates, trigger.query]
  );
  const [highlightedCandidateKey, setHighlightedCandidateKey] = useState<
    string | null
  >(null);
  const orderedCandidatesRef = useRef(orderedCandidates);
  const highlightedCandidateKeyRef = useRef(highlightedCandidateKey);
  const selectable = candidatesState.status === "ready";

  orderedCandidatesRef.current = orderedCandidates;
  highlightedCandidateKeyRef.current = highlightedCandidateKey;

  useEffect(() => {
    setHighlightedCandidateKey((currentKey) => {
      if (
        currentKey &&
        orderedCandidates.some(
          (candidate) => fileReferenceCandidateKey(candidate) === currentKey
        )
      ) {
        return currentKey;
      }
      const firstCandidate = orderedCandidates[0];
      return firstCandidate ? fileReferenceCandidateKey(firstCandidate) : null;
    });
  }, [orderedCandidates]);

  const selectCandidate = useCallback(
    (candidate: FileTouchReferenceCandidateDto): boolean => {
      if (!selectable) return false;
      const candidateKey = fileReferenceCandidateKey(candidate);
      const currentCandidate = orderedCandidatesRef.current.find(
        (visibleCandidate) =>
          fileReferenceCandidateKey(visibleCandidate) === candidateKey
      );
      if (!currentCandidate) return false;

      let inserted = false;
      editor.update(() => {
        inserted = $replaceRangeWithFileReference(
          trigger.range,
          trigger.query,
          candidateToFileReferenceValue(currentCandidate)
        );
      });
      return inserted;
    },
    [editor, selectable, trigger]
  );

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return;
      const candidates = orderedCandidatesRef.current;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (candidates.length === 0) return;
        const currentIndex = candidates.findIndex(
          (candidate) =>
            fileReferenceCandidateKey(candidate) ===
            highlightedCandidateKeyRef.current
        );
        const nextIndex = computeNextMentionIndex(
          event.key === "ArrowDown" ? "down" : "up",
          currentIndex,
          candidates.length
        );
        const nextCandidate = candidates[nextIndex];
        setHighlightedCandidateKey(
          nextCandidate ? fileReferenceCandidateKey(nextCandidate) : null
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key !== "Enter" || candidates.length === 0) return;
      const candidate =
        candidates.find(
          (visibleCandidate) =>
            fileReferenceCandidateKey(visibleCandidate) ===
            highlightedCandidateKeyRef.current
        ) ?? candidates[0];
      if (candidate) selectCandidate(candidate);
      event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener("keydown", handleKeyDown, true);
    return () => root.removeEventListener("keydown", handleKeyDown, true);
  }, [editor, selectCandidate]);

  return (
    <FileReferencePopup
      state={candidatesState}
      position={position}
      popupRef={popupRef}
      candidates={orderedCandidates}
      highlightedCandidateKey={highlightedCandidateKey}
      onSelect={(candidate) => selectCandidate(candidate)}
      selectable={selectable}
    />
  );
};
