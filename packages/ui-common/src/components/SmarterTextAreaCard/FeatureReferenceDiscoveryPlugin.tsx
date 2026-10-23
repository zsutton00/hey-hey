import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  ClickAwayListener,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
} from "@mui/material";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  $getNodeByKey,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $createTextNode,
  $getSelection,
  $hasUpdateTag,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  HISTORY_MERGE_TAG,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  SKIP_SELECTION_FOCUS_TAG,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  TextNode,
} from "lexical";
import { FEATURE_TASK_TYPE } from "../../constants/taskTypes";
import {
  buildPassiveReferenceIndex,
  findCompletedFeatureReferenceMatches,
  type FeatureReferenceCandidate,
  type FeatureReferenceIndex,
  type FeatureReferenceTitleMatch,
  type PassiveReferenceCandidateKey,
} from "../../data/featureReferenceIndex";
import { useWorkItemReferences } from "../../data/hooks/useWorkItemReferences";
import { useServices } from "../../data/hooks/useServices";
import {
  $createFeatureReferenceMatchNode,
  $isFeatureReferenceMatchNode,
  FeatureReferenceMatchNode,
} from "./FeatureReferenceMatchNode";
import { isExplicitCommandInteractionActive } from "./explicitCommandActivity";
import {
  insertCanonicalMention,
  restoreEditorFocus,
} from "./canonicalMentionInsertion";
import {
  didInsertFeatureReferenceCompletionBoundary,
  FEATURE_REFERENCE_DISCOVERY_TAG,
} from "./featureReferenceDiscovery";
import { useRecentMentionSelections } from "./recentMentionSelections";

const MAX_PASSIVE_DISCOVERY_PASTE_LENGTH = 2_000;

type ForcedScanReason = "enter" | "paste" | "skip-paste";
const EMPTY_SERVICES: never[] = [];

function getPasteScanReason(
  event: ClipboardEvent | InputEvent | KeyboardEvent | null
): ForcedScanReason {
  const pastedText =
    event instanceof ClipboardEvent
      ? event.clipboardData?.getData("text/plain") ?? ""
      : "";
  return pastedText.length > MAX_PASSIVE_DISCOVERY_PASTE_LENGTH
    ? "skip-paste"
    : "paste";
}

function getPassiveReferenceSourceFingerprint(input: {
  featureReferences: readonly {
    id: string;
    name: string;
    parentTaskId: string | null;
    type: string;
  }[];
  services: readonly { id: string; name: string }[];
}): string {
  return JSON.stringify({
    features: input.featureReferences.map((reference) => [
      reference.id,
      reference.name,
      reference.parentTaskId,
      reference.type,
    ]),
    services: input.services.map((service) => [service.id, service.name]),
  });
}

function copyTextPresentation(source: TextNode, target: TextNode): void {
  target.setFormat(source.getFormat());
  target.setDetail(source.getDetail());
  target.setMode(source.getMode());
  target.setStyle(source.getStyle());
}

function $guardPlainTextSibling(node: LexicalNode | null): void {
  if ($isTextNode(node) && node.isSimpleText() && !node.isUnmergeable()) {
    node.toggleUnmergeable();
  }
}

interface TextSelectionSnapshot {
  anchorOffset: number | null;
  focusOffset: number | null;
}

function $getSelectionPointOffset(
  point: PointType,
  node: TextNode
): number | null {
  return point.type === "text" && point.key === node.getKey()
    ? point.offset
    : null;
}

function $captureTextSelection(node: TextNode): TextSelectionSnapshot {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return { anchorOffset: null, focusOffset: null };
  }

  return {
    anchorOffset: $getSelectionPointOffset(selection.anchor, node),
    focusOffset: $getSelectionPointOffset(selection.focus, node),
  };
}

interface MappedTextSelectionPoint {
  node: TextNode;
  offset: number;
}

function $mapSelectionPointToMatchReplacement(
  offset: number,
  sourceLength: number,
  match: FeatureReferenceTitleMatch,
  prefixNode: TextNode | null,
  matchNode: TextNode,
  suffixNode: TextNode | null
): MappedTextSelectionPoint {
  const sourceOffset = Math.max(0, Math.min(offset, sourceLength));

  if (prefixNode && sourceOffset <= match.start) {
    return { node: prefixNode, offset: sourceOffset };
  }

  if (sourceOffset < match.end) {
    return {
      node: matchNode,
      offset: sourceOffset - match.start,
    };
  }

  if (suffixNode) {
    return {
      node: suffixNode,
      offset: sourceOffset - match.end,
    };
  }

  return {
    node: matchNode,
    offset: sourceOffset - match.start,
  };
}

function $restoreTextSelection(
  snapshot: TextSelectionSnapshot,
  mapPoint: (offset: number) => MappedTextSelectionPoint
): void {
  if (snapshot.anchorOffset === null && snapshot.focusOffset === null) {
    return;
  }

  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  if (snapshot.anchorOffset !== null) {
    const anchor = mapPoint(snapshot.anchorOffset);
    selection.anchor.set(anchor.node.getKey(), anchor.offset, "text");
  }
  if (snapshot.focusOffset !== null) {
    const focus = mapPoint(snapshot.focusOffset);
    selection.focus.set(focus.node.getKey(), focus.offset, "text");
  }
}

function $replaceMatch(
  sourceNode: TextNode,
  match: FeatureReferenceTitleMatch
): TextNode | null {
  const sourceLength = sourceNode.getTextContentSize();
  const selectionSnapshot = $captureTextSelection(sourceNode);
  let matchedNode = sourceNode;
  let prefixNode: TextNode | null = sourceNode;
  let suffixNode: TextNode | null = null;

  if (match.end < sourceLength) {
    const splitNodes = sourceNode.splitText(match.end);
    matchedNode = splitNodes[0] ?? sourceNode;
    suffixNode = splitNodes[1] ?? null;
    $guardPlainTextSibling(suffixNode);
  }

  if (match.start > 0) {
    const splitNodes = matchedNode.splitText(match.start);
    prefixNode = splitNodes[0] ?? null;
    matchedNode = splitNodes[1] ?? matchedNode;
    $guardPlainTextSibling(prefixNode);
  } else {
    prefixNode = null;
  }

  const transientNode = $createFeatureReferenceMatchNode(
    matchedNode.getTextContent(),
    match.candidates.map((candidate) => ({
      entityType: candidate.entityType,
      entityId: candidate.id,
    })),
    match.matchKind,
    match.matchRank,
    matchedNode.getStyle()
  );
  transientNode.setFormat(matchedNode.getFormat());
  transientNode.setDetail(matchedNode.getDetail());
  $guardPlainTextSibling(matchedNode.getPreviousSibling());
  $guardPlainTextSibling(matchedNode.getNextSibling());
  const replacementNode = matchedNode.replace(transientNode);

  $restoreTextSelection(selectionSnapshot, (offset) =>
    $mapSelectionPointToMatchReplacement(
      offset,
      sourceLength,
      match,
      prefixNode,
      replacementNode,
      suffixNode
    )
  );

  return prefixNode;
}

function $applyMatchesToTextNode(
  node: TextNode,
  index: FeatureReferenceIndex
): void {
  if (
    $isFeatureReferenceMatchNode(node) ||
    !node.isAttached() ||
    !node.isSimpleText()
  ) {
    return;
  }

  const matches = findCompletedFeatureReferenceMatches(
    node.getTextContent(),
    index
  );
  let remainingPrefix: TextNode | null = node;

  for (const match of [...matches].reverse()) {
    if (!remainingPrefix) break;
    remainingPrefix = $replaceMatch(remainingPrefix, match);
  }
}

function $mergePreviousMatchForRescan(node: TextNode): TextNode {
  const previousSibling = node.getPreviousSibling();
  if (!$isFeatureReferenceMatchNode(previousSibling)) return node;

  const selectionSnapshot = $captureTextSelection(node);
  const previousTextLength = previousSibling.getTextContentSize();
  const combinedNode = $createTextNode(
    `${previousSibling.getTextContent()}${node.getTextContent()}`
  );
  copyTextPresentation(previousSibling, combinedNode);
  combinedNode.setStyle(previousSibling.getSourceStyle());
  previousSibling.replace(combinedNode);
  node.remove();
  $restoreTextSelection(selectionSnapshot, (offset) => ({
    node: combinedNode,
    offset: previousTextLength + offset,
  }));
  return combinedNode;
}

function $unwrapFeatureReferenceMatch(
  node: FeatureReferenceMatchNode
): TextNode {
  const previousSibling = node.getPreviousSibling();
  const nextSibling = node.getNextSibling();
  const textNode = $createTextNode(node.getTextContent());
  copyTextPresentation(node, textNode);
  textNode.setStyle(node.getSourceStyle());
  node.replace(textNode);
  for (const sibling of [previousSibling, nextSibling]) {
    if ($isTextNode(sibling) && sibling.isUnmergeable()) {
      sibling.toggleUnmergeable();
    }
  }
  return textNode;
}

function $getTextNodesForDirtyElements(
  dirtyElementKeys: ReadonlySet<string>
): TextNode[] {
  const nodes = new Map<string, TextNode>();

  for (const key of dirtyElementKeys) {
    const element = $getNodeByKey(key);
    if (!$isElementNode(element) || $isRootNode(element)) continue;

    for (const textNode of element.getAllTextNodes()) {
      nodes.set(textNode.getKey(), textNode);
    }
  }

  return [...nodes.values()];
}

function updateWithDetectorTag(
  editor: LexicalEditor,
  update: () => void
): void {
  editor.update(update, {
    tag: [
      FEATURE_REFERENCE_DISCOVERY_TAG,
      HISTORY_MERGE_TAG,
      SKIP_SELECTION_FOCUS_TAG,
    ],
  });
}

interface FeatureReferenceDiscoveryPluginProps {
  organizationId: string;
  projectId: string;
}

interface ActiveFeatureReferenceMatch {
  anchorElement: HTMLElement;
  candidateKeys: readonly PassiveReferenceCandidateKey[];
  matchKind: FeatureReferenceTitleMatch["matchKind"];
  matchRank: FeatureReferenceTitleMatch["matchRank"];
  normalizedTitle: string;
  nodeKey: string;
  sourceText: string;
}

// From the caret, Tab targets the first phrase starting at or after it and
// Shift+Tab the last phrase ending at or before it.
function getMatchElementBesideCaret(
  rootElement: HTMLElement,
  matchElements: readonly HTMLElement[],
  direction: "before" | "after"
): HTMLElement | undefined {
  const selection = rootElement.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const caretRange = selection.getRangeAt(0);
  if (!rootElement.contains(caretRange.startContainer)) return undefined;

  if (direction === "after") {
    return matchElements.find(
      (element) => caretRange.comparePoint(element, 0) >= 0
    );
  }
  return [...matchElements]
    .reverse()
    .find(
      (element) =>
        caretRange.comparePoint(element, element.childNodes.length) <= 0
    );
}

function sortCandidates(
  candidates: readonly FeatureReferenceCandidate[]
): FeatureReferenceCandidate[] {
  return [...candidates].sort((first, second) => {
    const titleOrder = first.name.localeCompare(second.name);
    if (titleOrder !== 0) return titleOrder;

    const pathOrder = first.ancestorPath
      .join("\u0000")
      .localeCompare(second.ancestorPath.join("\u0000"));
    return pathOrder !== 0 ? pathOrder : first.id.localeCompare(second.id);
  });
}

function getCurrentMatchCandidates(
  activeMatch: ActiveFeatureReferenceMatch | null,
  index: FeatureReferenceIndex | null
): FeatureReferenceCandidate[] {
  if (!activeMatch || !index) return [];

  const currentMatch = findCompletedFeatureReferenceMatches(
    activeMatch.sourceText,
    index
  ).find(
    (match) =>
      match.start === 0 &&
      match.end === activeMatch.sourceText.length &&
      match.normalizedTitle === activeMatch.normalizedTitle &&
      match.matchKind === activeMatch.matchKind &&
      match.matchRank === activeMatch.matchRank
  );
  if (!currentMatch) return [];

  const candidateKeys = new Set(
    activeMatch.candidateKeys.map(
      (candidate) => `${candidate.entityType}:${candidate.entityId}`
    )
  );
  return sortCandidates(
    currentMatch.candidates.filter((candidate) =>
      candidateKeys.has(`${candidate.entityType}:${candidate.id}`)
    )
  );
}

function getDuplicateContext(candidate: FeatureReferenceCandidate): string {
  if (candidate.entityType === "service") return "Service";
  return candidate.ancestorPath.length > 0
    ? candidate.ancestorPath.join(" › ")
    : "Top-level feature";
}

export function FeatureReferenceDiscoveryPlugin({
  organizationId,
  projectId,
}: FeatureReferenceDiscoveryPluginProps) {
  const [editor] = useLexicalComposerContext();
  const forcedScanReasonRef = useRef<ForcedScanReason | null>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listboxId = useId();
  const [activeMatch, setActiveMatch] =
    useState<ActiveFeatureReferenceMatch | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { record: recordRecentSelection } = useRecentMentionSelections();
  const referencesState = useWorkItemReferences({
    organizationId,
    projectId,
    workItemType: FEATURE_TASK_TYPE,
  });
  const servicesState = useServices(organizationId, {
    projectId,
    status: "ACTIVE",
  });
  const availableServices =
    servicesState.isReady && servicesState.services.length > 0
      ? servicesState.services
      : EMPTY_SERVICES;
  const availableFeatureReferences =
    referencesState.status === "ready" ? referencesState.references : [];
  const sourceFingerprint = getPassiveReferenceSourceFingerprint({
    featureReferences: availableFeatureReferences,
    services: availableServices,
  });
  const referenceIndexCache = useRef<{
    fingerprint: string;
    index: FeatureReferenceIndex;
  } | null>(null);
  if (referenceIndexCache.current?.fingerprint !== sourceFingerprint) {
    referenceIndexCache.current = {
      fingerprint: sourceFingerprint,
      index: buildPassiveReferenceIndex({
        featureReferences: availableFeatureReferences,
        services: availableServices,
      }),
    };
  }
  const referenceIndex = referenceIndexCache.current.index;
  const currentCandidates = useMemo(
    () => getCurrentMatchCandidates(activeMatch, referenceIndex),
    [activeMatch, referenceIndex]
  );

  const dismissCandidateList = useCallback(() => {
    setActiveMatch(null);
    restoreEditorFocus(editor);
  }, [editor]);

  const openCandidateList = useCallback(
    (anchorElement: HTMLElement) => {
      let nextActiveMatch: ActiveFeatureReferenceMatch | null = null;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(anchorElement);
        if (!$isFeatureReferenceMatchNode(node)) return;
        if (!referenceIndex) return;

        const sourceText = node.getSourceText();
        const currentMatch = findCompletedFeatureReferenceMatches(
          sourceText,
          referenceIndex
        ).find(
          (match) =>
            match.start === 0 &&
            match.end === sourceText.length &&
            match.matchKind === node.getMatchKind() &&
            match.matchRank === node.getMatchRank() &&
            match.candidates.some((candidate) =>
              node
                .getCandidateKeys()
                .some(
                  (key) =>
                    key.entityType === candidate.entityType &&
                    key.entityId === candidate.id
                )
            )
        );
        if (!currentMatch) return;

        nextActiveMatch = {
          anchorElement,
          candidateKeys: [...node.getCandidateKeys()],
          matchKind: node.getMatchKind(),
          matchRank: node.getMatchRank(),
          normalizedTitle: currentMatch.normalizedTitle,
          nodeKey: node.getKey(),
          sourceText,
        };
      });

      if (
        getCurrentMatchCandidates(nextActiveMatch, referenceIndex).length === 0
      ) {
        return;
      }

      setSelectedIndex(0);
      setActiveMatch(nextActiveMatch);
    },
    [editor, referenceIndex]
  );

  const commitCandidate = useCallback(
    (
      candidate: FeatureReferenceCandidate,
      targetMatch = activeMatch,
      preserveMatchTraversal = false
    ) => {
      if (!targetMatch || !referenceIndex) return;

      const matchElements = preserveMatchTraversal
        ? Array.from(
            editor
              .getRootElement()
              ?.querySelectorAll<HTMLElement>(
                ".feature-reference-match-node"
              ) ?? []
          )
        : [];
      const activeElementIndex = matchElements.indexOf(
        targetMatch.anchorElement
      );
      const nextMatchElement =
        activeElementIndex >= 0 ? matchElements[activeElementIndex + 1] : null;

      const inserted = insertCanonicalMention({
        editor,
        mention: {
          entityType: candidate.entityType,
          entityId: candidate.id,
          entityName: candidate.name,
        },
        recordRecentSelection,
        target: {
          kind: "exact-text-node",
          nodeKey: targetMatch.nodeKey,
          expectedText: targetMatch.sourceText,
          surroundingTextPolicy: "preserve",
          validateCurrentNode: (node) => {
            if (!$isFeatureReferenceMatchNode(node)) return false;

            const currentText = node.getTextContent();
            const currentMatch = findCompletedFeatureReferenceMatches(
              currentText,
              referenceIndex
            ).find(
              (match) =>
                match.start === 0 &&
                match.end === currentText.length &&
                match.normalizedTitle === targetMatch.normalizedTitle &&
                match.matchKind === targetMatch.matchKind &&
                match.matchRank === targetMatch.matchRank
            );
            if (!currentMatch) return false;

            return (
              node.getSourceText() === targetMatch.sourceText &&
              node
                .getCandidateKeys()
                .some(
                  (key) =>
                    key.entityType === candidate.entityType &&
                    key.entityId === candidate.id
                ) &&
              node.getMatchKind() === targetMatch.matchKind &&
              node.getMatchRank() === targetMatch.matchRank &&
              currentMatch.candidates.some(
                (currentCandidate) =>
                  currentCandidate.entityType === candidate.entityType &&
                  currentCandidate.id === candidate.id
              )
            );
          },
        },
      });

      setActiveMatch(null);
      if (!inserted) restoreEditorFocus(editor);
      if (inserted && nextMatchElement) {
        queueMicrotask(() => {
          if (nextMatchElement.isConnected) nextMatchElement.focus();
        });
      }
    },
    [activeMatch, editor, recordRecentSelection, referenceIndex]
  );

  const activateMatchFromKeyboard = useCallback(
    (anchorElement: HTMLElement) => {
      let nextActiveMatch: ActiveFeatureReferenceMatch | null = null;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(anchorElement);
        if (!$isFeatureReferenceMatchNode(node) || !referenceIndex) return;

        const sourceText = node.getSourceText();
        const currentMatch = findCompletedFeatureReferenceMatches(
          sourceText,
          referenceIndex
        ).find(
          (match) =>
            match.start === 0 &&
            match.end === sourceText.length &&
            match.matchKind === node.getMatchKind() &&
            match.matchRank === node.getMatchRank()
        );
        if (!currentMatch) return;

        nextActiveMatch = {
          anchorElement,
          candidateKeys: [...node.getCandidateKeys()],
          matchKind: node.getMatchKind(),
          matchRank: node.getMatchRank(),
          normalizedTitle: currentMatch.normalizedTitle,
          nodeKey: node.getKey(),
          sourceText,
        };
      });

      const candidates = getCurrentMatchCandidates(
        nextActiveMatch,
        referenceIndex
      );
      if (candidates.length === 1 && nextActiveMatch) {
        commitCandidate(candidates[0]!, nextActiveMatch, true);
        return;
      }
      openCandidateList(anchorElement);
    },
    [commitCandidate, editor, openCandidateList, referenceIndex]
  );

  const handleListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (currentCandidates.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedIndex(
          (currentIndex) =>
            (currentIndex + direction + currentCandidates.length) %
            currentCandidates.length
        );
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        const candidate = currentCandidates[selectedIndex];
        if (candidate) commitCandidate(candidate, activeMatch, true);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissCandidateList();
      }
    },
    [
      activeMatch,
      commitCandidate,
      currentCandidates,
      dismissCandidateList,
      selectedIndex,
    ]
  );

  useEffect(() => {
    const getMatchElement = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element
        ? (target.closest(
            ".feature-reference-match-node"
          ) as HTMLElement | null)
        : null;
    const handleClick = (event: MouseEvent): void => {
      const matchElement = getMatchElement(event.target);
      if (matchElement) openCandidateList(matchElement);
    };
    // Tab walks forward from the caret through detected phrases in document
    // order; Shift+Tab walks back. With no phrase in that direction, focus
    // leaves natively.
    const handleTabKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isExplicitCommandInteractionActive(editor)) return;
      const rootElement = editor.getRootElement();
      if (!rootElement) return;

      const matchElements = Array.from(
        rootElement.querySelectorAll<HTMLElement>(
          ".feature-reference-match-node"
        )
      );
      const currentMatchElement = getMatchElement(event.target);
      const currentIndex = currentMatchElement
        ? matchElements.indexOf(currentMatchElement)
        : -1;
      const nextMatchElement = currentMatchElement
        ? matchElements[currentIndex + (event.shiftKey ? -1 : 1)]
        : getMatchElementBesideCaret(
            rootElement,
            matchElements,
            event.shiftKey ? "before" : "after"
          );
      if (!nextMatchElement) return;

      event.preventDefault();
      event.stopPropagation();
      nextMatchElement.focus();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Tab") {
        handleTabKeyDown(event);
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const matchElement = getMatchElement(event.target);
      if (!matchElement) return;
      event.preventDefault();
      event.stopPropagation();
      activateMatchFromKeyboard(matchElement);
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("click", handleClick);
      previousRootElement?.removeEventListener("keydown", handleKeyDown, true);
      rootElement?.addEventListener("click", handleClick);
      rootElement?.addEventListener("keydown", handleKeyDown, true);
    });
  }, [activateMatchFromKeyboard, editor, openCandidateList]);

  useEffect(() => {
    if (!activeMatch) return;
    activeMatch.anchorElement.setAttribute("aria-expanded", "true");
    activeMatch.anchorElement.setAttribute("aria-controls", listboxId);
    return () => {
      activeMatch.anchorElement.removeAttribute("aria-expanded");
      activeMatch.anchorElement.removeAttribute("aria-controls");
    };
  }, [activeMatch, listboxId]);

  useEffect(() => {
    if (activeMatch && currentCandidates.length === 0) {
      dismissCandidateList();
    }
  }, [activeMatch, currentCandidates.length, dismissCandidateList]);

  useEffect(() => {
    updateWithDetectorTag(editor, () => {
      const plainTextNodes = $getRoot()
        .getAllTextNodes()
        .map((node) =>
          $isFeatureReferenceMatchNode(node)
            ? $unwrapFeatureReferenceMatch(node)
            : node
        );

      if (
        !referenceIndex ||
        editor.isComposing() ||
        isExplicitCommandInteractionActive(editor)
      ) {
        return;
      }

      for (const textNode of plainTextNodes) {
        $applyMatchesToTextNode(textNode, referenceIndex);
      }
    });
  }, [editor, referenceIndex]);

  useEffect(() => {
    return editor.registerNodeTransform(FeatureReferenceMatchNode, (node) => {
      const sourceText = node.getSourceText();
      const currentText = node.getTextContent();
      if (currentText === sourceText) return;

      if (
        $hasUpdateTag(FEATURE_REFERENCE_DISCOVERY_TAG) &&
        currentText.startsWith(sourceText)
      ) {
        const suffix = currentText.slice(sourceText.length);
        node.setTextContent(sourceText);
        if (suffix) {
          const suffixNode = $createTextNode(suffix);
          copyTextPresentation(node, suffixNode);
          suffixNode.setStyle(node.getSourceStyle());
          suffixNode.toggleUnmergeable();
          node.insertAfter(suffixNode);
        }
        return;
      }

      $unwrapFeatureReferenceMatch(node);
    });
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        forcedScanReasonRef.current = getPasteScanReason(event);
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        forcedScanReasonRef.current = "enter";
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(
      ({ editorState, prevEditorState, dirtyElements, dirtyLeaves, tags }) => {
        if (tags.has(FEATURE_REFERENCE_DISCOVERY_TAG)) return;

        const forcedScanReason = forcedScanReasonRef.current;
        forcedScanReasonRef.current = null;
        if (forcedScanReason === "skip-paste") return;
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        if (
          !referenceIndex ||
          editor.isComposing() ||
          isExplicitCommandInteractionActive(editor)
        ) {
          return;
        }

        const previousTextByKey = new Map<string, string>();
        prevEditorState.read(() => {
          for (const key of dirtyLeaves) {
            const node = $getNodeByKey(key);
            if ($isTextNode(node)) {
              previousTextByKey.set(key, node.getTextContent());
            }
          }
        });

        const dirtyTextNodeKeys: string[] = [];
        const editedTransientNodeKeys: string[] = [];
        editorState.read(() => {
          for (const key of dirtyLeaves) {
            const node = $getNodeByKey(key);
            if (!$isTextNode(node)) continue;

            if ($isFeatureReferenceMatchNode(node)) {
              editedTransientNodeKeys.push(key);
              continue;
            }

            const previousText = previousTextByKey.get(key) ?? "";
            if (
              forcedScanReason ||
              didInsertFeatureReferenceCompletionBoundary(
                previousText,
                node.getTextContent()
              )
            ) {
              dirtyTextNodeKeys.push(key);
            }
          }
        });

        updateWithDetectorTag(editor, () => {
          if (editedTransientNodeKeys.length > 0) {
            for (const key of editedTransientNodeKeys) {
              const node = $getNodeByKey(key);
              if ($isFeatureReferenceMatchNode(node)) {
                $unwrapFeatureReferenceMatch(node);
              }
            }
            return;
          }

          const nodesToScan = new Map<string, TextNode>();
          for (const key of dirtyTextNodeKeys) {
            const node = $getNodeByKey(key);
            if ($isTextNode(node)) {
              nodesToScan.set(key, node);
            }
          }
          if (forcedScanReason === "enter") {
            for (const node of $getTextNodesForDirtyElements(
              new Set(dirtyElements.keys())
            )) {
              nodesToScan.set(node.getKey(), node);
            }
          }

          for (const node of nodesToScan.values()) {
            $applyMatchesToTextNode(
              $mergePreviousMatchForRescan(node),
              referenceIndex
            );
          }
        });
      }
    );
  }, [editor, referenceIndex]);

  if (!activeMatch || currentCandidates.length === 0) return null;

  const hasDuplicateTitle = currentCandidates.length > 1;
  return (
    <ClickAwayListener onClickAway={dismissCandidateList}>
      <Popper
        open
        anchorEl={activeMatch.anchorElement}
        placement="bottom-start"
        modifiers={[
          { name: "flip", enabled: true },
          { name: "preventOverflow", enabled: true, options: { padding: 8 } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
      >
        <Paper
          elevation={8}
          data-testid="feature-reference-candidate-popup"
          sx={{
            maxHeight: 320,
            overflowY: "auto",
            width: "min(360px, calc(100vw - 16px))",
          }}
        >
          <List
            id={listboxId}
            dense
            disablePadding
            role="listbox"
            aria-label={`References matching ${activeMatch.sourceText}`}
            aria-activedescendant={
              currentCandidates[selectedIndex]
                ? `${listboxId}-${selectedIndex}`
                : undefined
            }
            onKeyDownCapture={handleListKeyDown}
          >
            {currentCandidates.map((candidate, index) => (
              <ListItemButton
                id={`${listboxId}-${index}`}
                key={`${candidate.entityType}:${candidate.id}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                  if (element && index === selectedIndex) {
                    element.focus();
                  }
                }}
                role="option"
                aria-selected={index === selectedIndex}
                selected={index === selectedIndex}
                data-testid="feature-reference-candidate"
                data-entity-type={candidate.entityType}
                data-entity-id={candidate.id}
                onFocus={() => setSelectedIndex(index)}
                onClick={() => commitCandidate(candidate)}
              >
                <ListItemText
                  primary={candidate.name}
                  secondary={
                    hasDuplicateTitle
                      ? getDuplicateContext(candidate)
                      : undefined
                  }
                  primaryTypographyProps={{ variant: "body2" }}
                  secondaryTypographyProps={{ variant: "caption" }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      </Popper>
    </ClickAwayListener>
  );
}
