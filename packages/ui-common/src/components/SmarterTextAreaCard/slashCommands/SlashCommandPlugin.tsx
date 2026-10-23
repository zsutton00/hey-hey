import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Box, useTheme } from "@mui/material";
import { EntityType, type EntityType as EntityTypeValue } from "../../../api";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $isDecoratorNode,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  type PasteCommandType,
} from "lexical";
import { $dfs } from "@lexical/utils";
import {
  SlashCommandPopup,
  SLASH_COMMAND_POPUP_WIDTH,
} from "./SlashCommandPopup";
import { SlashEntitySearchPopup } from "./SlashEntitySearchPopup";
import { useSlashCommandRegistry } from "./useSlashCommandRegistry";
import { computeSlashCompletion } from "./slashCompletion";
import { resolveSearchEntityMentionType } from "./searchEntityMentionType";
import { computeNextMentionIndex } from "../mentionNavigation";
import {
  isCommandDisabled,
  type AttachedAgentComposerContext,
  type Command,
  type EntitySelectionTarget,
  type PickerEmit,
  type PickerReplacementRange,
  type SurfaceContext,
} from "./types";
import type { EntitySearchScope, SearchEntity } from "../types";
import { DEFAULT_MENTIONABLE_ENTITY_TYPES } from "../defaultMentionableEntityTypes";
import {
  canSelectInlineSearchResults,
  INLINE_SEARCH_RESULTS_FRESHNESS,
  type InlineSearchResultsFreshness,
} from "../inlineSearchResults";
import { setExplicitCommandInteractionActive } from "../explicitCommandActivity";
import {
  $createSubagentCommandNode,
  $isSubagentCommandNode,
} from "./SubagentCommandNode";
import { $selectSubagentControl } from "./SubagentCommandPlugin";
import type { LexicalNode } from "lexical";

const POPUP_SPACING = 4;
const DEFAULT_MAX_HEIGHT = 500;
const SLASH_POPUP_WIDTH = SLASH_COMMAND_POPUP_WIDTH;

const ENTITY_TYPE_VALUES: readonly string[] = Object.values(EntityType);
const isEntityType = (value: string): value is EntityTypeValue =>
  ENTITY_TYPE_VALUES.includes(value);

type PickerMode = "command-pick" | "arg-entry";

interface SlashCommandPluginProps {
  organizationId: string | null;
  projectId: string | null;
  surfaceContext: SurfaceContext;
  agentContext?: Pick<AttachedAgentComposerContext, "provider"> | null;
  onPickerEmit: (emit: PickerEmit) => void;
  onSearchEntities?: (
    query: string,
    searchScope: EntitySearchScope,
  ) => Promise<SearchEntity[]>;
  onInlineSearch?: (query: string) => void;
}

interface SlashTriggerState {
  queryText: string;
  sliceStart: number;
  firstToken: boolean;
}

interface PopupPosition {
  top?: number;
  bottom?: number;
  left: number;
}

interface FloatingCuePosition {
  top: number;
  left: number;
}

interface InlineSearchState {
  query: string;
  replacementRange: PickerReplacementRange;
}

function $getSlashOffsetNodeText(node: LexicalNode): string | null {
  return $isTextNode(node) || $isDecoratorNode(node)
    ? node.getTextContent()
    : null;
}

function $selectionMatchesReplacementRange(
  range: PickerReplacementRange,
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return false;

  return (
    anchorNode.getKey() === range.nodeKey &&
    Math.min(anchor.offset, anchorNode.getTextContent().length) ===
      range.cursorOffset
  );
}

function $getReplacementRangeFromAbsoluteSliceStart(
  sliceStart: number,
): PickerReplacementRange | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;

  let acc = 0;
  for (const { node } of $dfs($getRoot())) {
    if (node === anchorNode) {
      const len = anchorNode.getTextContent().length;
      if (sliceStart < acc || sliceStart > acc + len) return null;

      const localSliceStart = sliceStart - acc;
      const cursorOffset = Math.min(anchor.offset, len);
      if (cursorOffset < localSliceStart) return null;

      return {
        nodeKey: anchorNode.getKey(),
        sliceStart: localSliceStart,
        cursorOffset,
      };
    }

    acc += $getSlashOffsetNodeText(node)?.length ?? 0;
  }

  return null;
}

function $getCollapsedReplacementRangeAtSelection(): PickerReplacementRange | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;

  const offset = Math.min(anchor.offset, anchorNode.getTextContent().length);
  return {
    nodeKey: anchorNode.getKey(),
    sliceStart: offset,
    cursorOffset: offset,
  };
}

function $detectSlashTrigger(
  commandSurface: SurfaceContext["commandSurface"],
): SlashTriggerState | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;

  // Build the cursor's logical text prefix in document order. Decorator text
  // contributes to slash offsets even though replacements can only target
  // editable text nodes.
  let textBefore = "";
  let reachedAnchor = false;
  for (const { node } of $dfs($getRoot())) {
    if (node === anchorNode) {
      textBefore += anchorNode.getTextContent().substring(0, anchor.offset);
      reachedAnchor = true;
      break;
    }
    textBefore += $getSlashOffsetNodeText(node) ?? "";
  }
  if (!reachedAnchor) return null;

  const lastSlash = textBefore.lastIndexOf("/");
  if (lastSlash < 0) return null;

  const isAtStart = lastSlash === 0;
  const charBefore = isAtStart ? null : textBefore[lastSlash - 1];
  const isAfterWhitespace = charBefore !== null && /\s/.test(charBefore);
  const canTriggerAfterAnyCharacter =
    commandSurface === "entity-insertion-only";
  if (!canTriggerAfterAnyCharacter && !isAtStart && !isAfterWhitespace) {
    return null;
  }

  const queryText = textBefore.substring(lastSlash + 1);
  if (/\s/.test(queryText)) return null;

  return {
    queryText,
    sliceStart: lastSlash,
    firstToken: textBefore.slice(0, lastSlash).trim().length === 0,
  };
}

const commandHasTypeRef = (
  command: Command | null,
): command is Command & {
  typeRef: string;
  typeRefKind: "entity-type" | "work-item-type";
} =>
  command?.kind === "inline-entity-search" &&
  typeof command.typeRef === "string" &&
  command.typeRef.length > 0 &&
  command.typeRefKind !== undefined;

// Returns the concatenated logical text in document order from `start` up to
// the current collapsed caret. Used to derive the arg-entry query (everything
// typed after the chosen command literal).
function $readTextFromOffsetToCaret(start: number): string | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;
  let full = "";
  for (const { node } of $dfs($getRoot())) {
    if (node === anchorNode) {
      full += anchorNode.getTextContent().substring(0, anchor.offset);
      return full.length >= start ? full.substring(start) : null;
    }
    full += $getSlashOffsetNodeText(node) ?? "";
  }
  return null;
}

function $computeAbsoluteCaretOffset(): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  const anchorNode = anchor.getNode();
  if (!$isTextNode(anchorNode)) return null;
  let acc = 0;
  for (const { node } of $dfs($getRoot())) {
    if (node === anchorNode) {
      return acc + anchor.offset;
    }
    acc += $getSlashOffsetNodeText(node)?.length ?? 0;
  }
  return null;
}

function computePopupPosition(): PopupPosition | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const spaceBelow = viewportHeight - rect.bottom - POPUP_SPACING;
  const spaceAbove = rect.top - POPUP_SPACING;
  const clampedLeft = Math.max(
    POPUP_SPACING,
    Math.min(rect.left, viewportWidth - SLASH_POPUP_WIDTH - POPUP_SPACING),
  );

  if (spaceBelow >= DEFAULT_MAX_HEIGHT || spaceBelow > spaceAbove) {
    return { top: rect.bottom + POPUP_SPACING, left: clampedLeft };
  }
  return {
    bottom: viewportHeight - rect.top + POPUP_SPACING,
    left: clampedLeft,
  };
}

function computeFloatingCuePosition(rect: DOMRect): FloatingCuePosition {
  return {
    top: rect.top,
    left: rect.right + 4,
  };
}

function computeSelectionRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0).getBoundingClientRect();
}

function findExactCompletionCommand(
  commands: ReadonlyArray<Command>,
  queryText: string,
): Command | null {
  return (
    commands.find(
      (command) => command.name === queryText && command.argShape !== "none",
    ) ?? null
  );
}

// Replaces the editor text from the absolute DFS offset `sliceStart` to the
// current collapsed caret with `newText`. The detector measures `sliceStart`
// against concatenated text and decorator contents in document order, so we
// walk the same DFS here to resolve it back to an editable (node, offset) pair
// before extending the selection and inserting.
function $replaceSliceWithText(
  sliceStart: number,
  newText: string | LexicalNode,
): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const anchorNode = selection.anchor.getNode();

  let acc = 0;
  for (const { node } of $dfs($getRoot())) {
    if ($isTextNode(node)) {
      const len = node.getTextContent().length;
      const nodeEnd = acc + len;
      const sliceIsInsideNode = sliceStart < nodeEnd;
      const sliceIsAtAnchorBoundary =
        node === anchorNode && sliceStart <= nodeEnd;
      if (sliceIsInsideNode || sliceIsAtAnchorBoundary) {
        selection.anchor.set(node.getKey(), sliceStart - acc, "text");
        if (typeof newText === "string") selection.insertText(newText);
        else {
          selection.insertNodes([newText]);
          if ($isSubagentCommandNode(newText)) $selectSubagentControl(newText);
        }
        return;
      }
    }
    acc += $getSlashOffsetNodeText(node)?.length ?? 0;
  }
}

function computeCommandSliceStart(
  command: Command,
  argSliceStart: number,
): number {
  return argSliceStart - `/${command.name} `.length;
}

function $getClipboardText(event: ClipboardEvent): string | null {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return null;

  return clipboardData.getData("text/plain");
}

const isClipboardEvent = (
  event: PasteCommandType | null,
): event is ClipboardEvent =>
  event !== null && typeof event === "object" && "clipboardData" in event;

export const SlashCommandPlugin: React.FC<SlashCommandPluginProps> = ({
  organizationId,
  projectId,
  surfaceContext,
  agentContext,
  onPickerEmit,
  onSearchEntities,
  onInlineSearch,
}) => {
  const [editor] = useLexicalComposerContext();
  const theme = useTheme();
  const [trigger, setTrigger] = useState<SlashTriggerState | null>(null);
  const [popupPos, setPopupPos] = useState<PopupPosition>({ top: 0, left: 0 });
  const [floatingCuePos, setFloatingCuePos] =
    useState<FloatingCuePosition | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [pickerMode, setPickerMode] = useState<PickerMode>("command-pick");
  const [dismissedAtSliceStart, setDismissedAtSliceStart] = useState<
    number | null
  >(null);
  const [argSliceStart, setArgSliceStart] = useState<number | null>(null);
  const [activeCommand, setActiveCommand] = useState<Command | null>(null);
  const [argQuery, setArgQuery] = useState<string>("");
  const [inlineSearchState, setInlineSearchState] =
    useState<InlineSearchState | null>(null);
  const commandSurface = surfaceContext.commandSurface;

  const { heyHey } = useSlashCommandRegistry({
    organizationId,
    projectId,
    surfaceContext,
    agentContext,
    query: trigger?.queryText ?? "",
  });

  const flatOrder = useMemo(
    () =>
      heyHey.filter(
        (command) =>
          (command.kind !== "executable-subagent" &&
            command.kind !== "executable-message-agent") ||
          trigger?.firstToken === true,
      ),
    [heyHey, trigger?.firstToken],
  );

  const open =
    inlineSearchState !== null ||
    pickerMode === "arg-entry" ||
    (trigger !== null &&
      (dismissedAtSliceStart === null ||
        dismissedAtSliceStart !== trigger.sliceStart));

  // Reset highlight whenever the visible command list, typed query, or slash
  // position changes. Command-pick mode starts on the first visible row so Tab
  // can immediately complete it; entity/result modes keep their own selection
  // reset paths.
  useEffect(() => {
    const hasVisibleCommands =
      pickerMode === "command-pick" && trigger !== null && flatOrder.length > 0;
    setSelectedIndex(hasVisibleCommands ? 0 : -1);
  }, [trigger?.queryText, trigger?.sliceStart, flatOrder.length, pickerMode]);

  // Clear sticky dismissal when the user moves to a different slash position
  // or the slash goes away entirely.
  useEffect(() => {
    if (!trigger) {
      setDismissedAtSliceStart(null);
      return;
    }
    if (
      dismissedAtSliceStart !== null &&
      dismissedAtSliceStart !== trigger.sliceStart
    ) {
      setDismissedAtSliceStart(null);
    }
  }, [trigger, dismissedAtSliceStart]);

  // Reset pickerMode to 'command-pick' when a new slash trigger appears at a
  // different position (e.g. user typed a second slash elsewhere).
  const lastSliceStartRef = useRef<number | null>(null);
  useEffect(() => {
    const curr = trigger?.sliceStart ?? null;
    if (curr !== null && curr !== lastSliceStartRef.current) {
      setPickerMode("command-pick");
    }
    lastSliceStartRef.current = curr;
  }, [trigger?.sliceStart]);

  const handleEditorUpdate = useCallback(() => {
    editor.getEditorState().read(() => {
      const detected = $detectSlashTrigger(commandSurface);
      setExplicitCommandInteractionActive(
        editor,
        "slash-command",
        (detected !== null &&
          (dismissedAtSliceStartRef.current === null ||
            dismissedAtSliceStartRef.current !== detected.sliceStart)) ||
          pickerModeRef.current === "arg-entry" ||
          inlineSearchStateRef.current !== null,
      );
      setTrigger(detected);
      if (detected) {
        if (inlineSearchStateRef.current !== null) {
          inlineSearchStateRef.current = null;
          entityResultsRef.current = [];
          entityResultsFreshnessRef.current =
            INLINE_SEARCH_RESULTS_FRESHNESS.settled;
          setInlineSearchState(null);
        }
        const positioned = computePopupPosition();
        if (positioned) setPopupPos(positioned);
        if (pickerModeRef.current === "command-pick") {
          const cueRect = computeSelectionRect();
          const cueCommand = findExactCompletionCommand(
            flatOrderRef.current,
            detected.queryText,
          );
          setFloatingCuePos(
            cueRect && cueCommand ? computeFloatingCuePosition(cueRect) : null,
          );
        } else {
          setFloatingCuePos(null);
        }
        return;
      }
      if (
        inlineSearchStateRef.current !== null &&
        !$selectionMatchesReplacementRange(
          inlineSearchStateRef.current.replacementRange,
        )
      ) {
        inlineSearchStateRef.current = null;
        entityResultsRef.current = [];
        entityResultsFreshnessRef.current =
          INLINE_SEARCH_RESULTS_FRESHNESS.settled;
        setInlineSearchState(null);
        setSelectedIndex(-1);
        setFloatingCuePos(null);
        return;
      }
      setFloatingCuePos(null);
      if (
        pickerModeRef.current === "arg-entry" &&
        argSliceStartRef.current !== null
      ) {
        const text = $readTextFromOffsetToCaret(argSliceStartRef.current);
        const nextArgQuery = text ?? "";
        argQueryRef.current = nextArgQuery;
        setArgQuery(nextArgQuery);
        const positioned = computePopupPosition();
        if (positioned) setPopupPos(positioned);
      }
    });
  }, [commandSurface, editor]);

  useEffect(() => {
    const unregister = editor.registerUpdateListener(() =>
      handleEditorUpdate(),
    );
    return () => {
      unregister();
      setExplicitCommandInteractionActive(editor, "slash-command", false);
    };
  }, [editor, handleEditorUpdate]);

  useEffect(() => {
    setExplicitCommandInteractionActive(editor, "slash-command", open);
    return () =>
      setExplicitCommandInteractionActive(editor, "slash-command", false);
  }, [editor, open]);

  // Refs let the keydown listener read the latest state without re-binding on
  // every keystroke — same pattern MentionPlugin uses to avoid an Enter race
  // where the popup commits a stale row.
  const flatOrderRef = useRef(flatOrder);
  const selectedIndexRef = useRef(selectedIndex);
  const triggerRef = useRef(trigger);
  const pickerModeRef = useRef(pickerMode);
  const onPickerEmitRef = useRef(onPickerEmit);
  const argSliceStartRef = useRef<number | null>(null);
  const activeCommandRef = useRef<Command | null>(null);
  const argQueryRef = useRef(argQuery);
  const handlePickCommandRef = useRef<(command: Command) => void>(() => {});
  const handleSelectInlineSearchEntityRef = useRef<
    (entity: SearchEntity) => void
  >(() => {});
  const entityResultsRef = useRef<SearchEntity[]>([]);
  const viewAllAvailableRef = useRef(false);
  const entityResultsFreshnessRef = useRef<InlineSearchResultsFreshness>(
    INLINE_SEARCH_RESULTS_FRESHNESS.settled,
  );
  const inlineSearchStateRef = useRef<InlineSearchState | null>(null);
  const dismissedAtSliceStartRef = useRef<number | null>(dismissedAtSliceStart);

  useEffect(() => {
    flatOrderRef.current = flatOrder;
  }, [flatOrder]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);
  useEffect(() => {
    triggerRef.current = trigger;
  }, [trigger]);
  useEffect(() => {
    dismissedAtSliceStartRef.current = dismissedAtSliceStart;
  }, [dismissedAtSliceStart]);
  useEffect(() => {
    pickerModeRef.current = pickerMode;
  }, [pickerMode]);
  useEffect(() => {
    onPickerEmitRef.current = onPickerEmit;
  }, [onPickerEmit]);
  useEffect(() => {
    argSliceStartRef.current = argSliceStart;
  }, [argSliceStart]);
  useEffect(() => {
    activeCommandRef.current = activeCommand;
  }, [activeCommand]);
  useEffect(() => {
    argQueryRef.current = argQuery;
  }, [argQuery]);
  useEffect(() => {
    inlineSearchStateRef.current = inlineSearchState;
  }, [inlineSearchState]);

  const handlePickCommand = useCallback(
    (command: Command) => {
      if (isCommandDisabled(command)) return;
      const trig = triggerRef.current;
      if (!trig) return;

      if (
        command.kind === "executable-subagent" ||
        command.kind === "executable-message-agent"
      ) {
        if (!trig.firstToken) return;
        editor.update(() => {
          $replaceSliceWithText(
            trig.sliceStart,
            command.kind === "executable-subagent"
              ? $createSubagentCommandNode({
                  mode: "foreground",
                  capability: command.supportedCapabilities[0],
                })
              : `/${command.name} `,
          );
        });
        pickerModeRef.current = "command-pick";
        setPickerMode("command-pick");
        setDismissedAtSliceStart(trig.sliceStart);
        setFloatingCuePos(null);
        return;
      }

      if (
        command.kind === "open-picker" ||
        command.kind === "open-skill-picker"
      ) {
        let replacementRange: PickerReplacementRange | null = null;
        editor.getEditorState().read(() => {
          replacementRange = $getReplacementRangeFromAbsoluteSliceStart(
            trig.sliceStart,
          );
        });
        if (replacementRange === null) return;

        if (command.kind === "open-picker") {
          const anchorPosition = computePopupPosition();
          if (anchorPosition === null) return;

          onPickerEmitRef.current({
            type: "openPicker",
            picker: command.picker,
            replacementRange,
            anchorPosition,
          });
        } else {
          onPickerEmitRef.current({
            type: "openSkillPicker",
            picker: command.picker,
            replacementRange,
          });
        }
        pickerModeRef.current = "command-pick";
        setPickerMode("command-pick");
        setDismissedAtSliceStart(trig.sliceStart);
        setFloatingCuePos(null);
      } else {
        const insertedText = `/${command.name} `;
        editor.update(() => {
          $replaceSliceWithText(trig.sliceStart, insertedText);
        });
        const newArgSliceStart = trig.sliceStart + insertedText.length;
        // Set ref directly to avoid stale-ref lag in the Backspace gate.
        argSliceStartRef.current = newArgSliceStart;
        activeCommandRef.current = command;
        argQueryRef.current = "";
        pickerModeRef.current = "arg-entry";
        setArgSliceStart(newArgSliceStart);
        setActiveCommand(command);
        setArgQuery("");
        entityResultsRef.current = [];
        viewAllAvailableRef.current = false;
        entityResultsFreshnessRef.current =
          INLINE_SEARCH_RESULTS_FRESHNESS.settled;
        setSelectedIndex(-1);
        setPickerMode("arg-entry");
        setFloatingCuePos(null);
      }
    },
    [editor],
  );

  const resetArgEntry = useCallback(() => {
    pickerModeRef.current = "command-pick";
    setPickerMode("command-pick");
    activeCommandRef.current = null;
    setActiveCommand(null);
    setArgSliceStart(null);
    argSliceStartRef.current = null;
    argQueryRef.current = "";
    setArgQuery("");
    entityResultsRef.current = [];
    viewAllAvailableRef.current = false;
    entityResultsFreshnessRef.current = INLINE_SEARCH_RESULTS_FRESHNESS.settled;
    setSelectedIndex(-1);
    setFloatingCuePos(null);
  }, []);

  const resetInlineSearch = useCallback(() => {
    inlineSearchStateRef.current = null;
    setInlineSearchState(null);
    entityResultsRef.current = [];
    viewAllAvailableRef.current = false;
    entityResultsFreshnessRef.current = INLINE_SEARCH_RESULTS_FRESHNESS.settled;
    setSelectedIndex(-1);
  }, []);

  const handleCommitOpenModalQuery = useCallback((): boolean => {
    const command = activeCommandRef.current;
    const argSliceStartValue = argSliceStartRef.current;
    if (command?.kind !== "open-modal" || argSliceStartValue === null) {
      return false;
    }

    let query = argQueryRef.current;
    editor.getEditorState().read(() => {
      const currentQuery = $readTextFromOffsetToCaret(argSliceStartValue);
      if (currentQuery !== null) query = currentQuery;
    });

    const commandSliceStart = computeCommandSliceStart(
      command,
      argSliceStartValue,
    );
    let replacementRange: PickerReplacementRange | null = null;
    editor.update(() => {
      $replaceSliceWithText(commandSliceStart, "");
      if (onInlineSearch && onSearchEntities && command.modal === "search") {
        replacementRange = $getCollapsedReplacementRangeAtSelection();
      }
    });
    resetArgEntry();
    if (
      onInlineSearch &&
      onSearchEntities &&
      command.modal === "search" &&
      replacementRange !== null
    ) {
      onInlineSearch(query);
      inlineSearchStateRef.current = { query, replacementRange };
      setInlineSearchState({ query, replacementRange });
      return true;
    }
    onPickerEmitRef.current({
      type: "openModal",
      modal: "search",
      prefill: query,
    });
    return true;
  }, [editor, onInlineSearch, onSearchEntities, resetArgEntry]);

  const handleSelectEntity = useCallback(
    (entity: SearchEntity) => {
      const command = activeCommandRef.current;
      const argSliceStartValue = argSliceStartRef.current;
      if (
        command?.kind !== "inline-entity-search" ||
        argSliceStartValue === null
      ) {
        return;
      }

      const commandSliceStart = computeCommandSliceStart(
        command,
        argSliceStartValue,
      );
      let replacementRange: PickerReplacementRange | null = null;
      editor.getEditorState().read(() => {
        replacementRange =
          $getReplacementRangeFromAbsoluteSliceStart(commandSliceStart);
      });
      if (replacementRange === null) return;

      onPickerEmitRef.current({
        type: "insertMention",
        entityRef: {
          entityType: resolveSearchEntityMentionType(entity),
          entityId: entity.id,
          entityName: entity.name,
        },
        replacementRange,
      });
      resetArgEntry();
    },
    [editor, resetArgEntry],
  );

  const handleSelectEntityRef = useRef(handleSelectEntity);
  useEffect(() => {
    handleSelectEntityRef.current = handleSelectEntity;
  }, [handleSelectEntity]);

  const handleViewAll = useCallback(() => {
    const command = activeCommandRef.current;
    const argSliceStartValue = argSliceStartRef.current;
    if (!commandHasTypeRef(command) || argSliceStartValue === null) return;

    const commandSliceStart = computeCommandSliceStart(
      command,
      argSliceStartValue,
    );
    let replacementRange: PickerReplacementRange | null = null;
    editor.getEditorState().read(() => {
      replacementRange =
        $getReplacementRangeFromAbsoluteSliceStart(commandSliceStart);
    });
    if (replacementRange === null) return;

    const target: EntitySelectionTarget | null =
      command.typeRefKind === "work-item-type"
        ? { kind: "work-item-type", workItemTypeKey: command.typeRef }
        : isEntityType(command.typeRef)
          ? { kind: "entity-type", entityType: command.typeRef }
          : null;
    if (target === null) return;
    onPickerEmitRef.current({
      type: "openEntitySelection",
      target,
      replacementRange,
    });
    resetArgEntry();
  }, [editor, resetArgEntry]);

  const handleSelectInlineSearchEntity = useCallback(
    (entity: SearchEntity) => {
      const searchState = inlineSearchStateRef.current;
      if (!searchState) return;

      onPickerEmitRef.current({
        type: "insertMention",
        entityRef: {
          entityType: resolveSearchEntityMentionType(entity),
          entityId: entity.id,
          entityName: entity.name,
        },
        replacementRange: searchState.replacementRange,
      });
      resetInlineSearch();
    },
    [resetInlineSearch],
  );

  useEffect(() => {
    handleSelectInlineSearchEntityRef.current = handleSelectInlineSearchEntity;
  }, [handleSelectInlineSearchEntity]);

  const handleResultsChange = useCallback(
    (results: SearchEntity[], freshness: InlineSearchResultsFreshness) => {
      entityResultsRef.current = results;
      entityResultsFreshnessRef.current = freshness;
      setSelectedIndex((prev) => {
        if (results.length === 0) return -1;
        if (prev < 0) return 0;
        return Math.min(prev, results.length - 1);
      });
    },
    [],
  );

  const handleViewAllAvailabilityChange = useCallback((available: boolean) => {
    viewAllAvailableRef.current = available;
    if (!available && entityResultsRef.current.length === 0) {
      setSelectedIndex(-1);
    }
  }, []);

  const entitySearchScope = useMemo<EntitySearchScope>(() => {
    if (inlineSearchState !== null) {
      return {
        kind: "entity-types",
        entityTypes: [...DEFAULT_MENTIONABLE_ENTITY_TYPES],
      };
    }
    if (!commandHasTypeRef(activeCommand)) {
      return { kind: "entity-types", entityTypes: [] };
    }
    return activeCommand.typeRefKind === "work-item-type"
      ? {
          kind: "work-item-types",
          taskTypes: [activeCommand.typeRef],
        }
      : {
          kind: "entity-types",
          entityTypes: [activeCommand.typeRef],
        };
  }, [activeCommand, inlineSearchState]);

  useEffect(() => {
    handlePickCommandRef.current = handlePickCommand;
  }, [handlePickCommand]);

  const handleTabCompletion = useCallback(
    (event: KeyboardEvent | null): boolean => {
      const trig = triggerRef.current;
      if (!trig) return false;

      const commandOrder = flatOrderRef.current;
      const idx = selectedIndexRef.current;
      const highlighted =
        idx >= 0 &&
        idx < commandOrder.length &&
        !isCommandDisabled(commandOrder[idx])
          ? commandOrder[idx]
          : undefined;
      const result = computeSlashCompletion({
        query: trig.queryText,
        candidates: commandOrder
          .filter((c) => !isCommandDisabled(c))
          .map((c) => ({
            name: c.name,
            completesOnExactMatch: c.argShape !== "none",
          })),
        highlightedName: highlighted?.name,
      });
      if (result.completed) {
        const command =
          highlighted ??
          commandOrder.find(
            (candidate) =>
              !isCommandDisabled(candidate) && candidate.name === result.text,
          );
        if (command) {
          handlePickCommandRef.current(command);
        }
      } else {
        editor.update(() => {
          $replaceSliceWithText(trig.sliceStart, `/${result.text}`);
        });
      }

      event?.preventDefault();
      event?.stopPropagation();
      return true;
    },
    [editor],
  );

  useEffect(() => {
    if (!open) return undefined;
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      handleTabCompletion,
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, handleTabCompletion, open]);

  useEffect(() => {
    if (!open) return undefined;
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        const shouldTrimPaste =
          pickerModeRef.current === "arg-entry" ||
          inlineSearchStateRef.current !== null;
        if (!shouldTrimPaste) return false;
        if (!isClipboardEvent(event)) return false;

        const clipboardText = $getClipboardText(event);
        if (clipboardText === null) return false;

        let hasSelection = false;
        editor.getEditorState().read(() => {
          hasSelection = $isRangeSelection($getSelection());
        });
        if (!hasSelection) return false;

        event.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(clipboardText.trim());
          }
        });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, open]);

  useEffect(() => {
    if (!open) return;
    const root = editor.getRootElement();
    if (!root) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.keyCode === 229) return;

      if (event.key === "Backspace") {
        if (pickerModeRef.current === "arg-entry") {
          let caretOffset: number | null = null;
          editor.getEditorState().read(() => {
            caretOffset = $computeAbsoluteCaretOffset();
          });
          if (
            caretOffset !== null &&
            caretOffset === argSliceStartRef.current
          ) {
            resetArgEntry();
            // No preventDefault — Backspace must delete the trailing space so
            // $detectSlashTrigger naturally re-detects /<name> and reopens the list.
          }
        }
        return;
      }

      if (event.key === "Escape") {
        if (inlineSearchStateRef.current !== null) {
          resetInlineSearch();
        } else if (pickerModeRef.current === "arg-entry") {
          resetArgEntry();
        } else {
          const trig = triggerRef.current;
          setDismissedAtSliceStart(trig?.sliceStart ?? null);
          setFloatingCuePos(null);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const inInlineSearch = inlineSearchStateRef.current !== null;
      const inEntityArgEntry =
        pickerModeRef.current === "arg-entry" &&
        activeCommandRef.current?.kind === "inline-entity-search";
      const inOpenModalArgEntry =
        pickerModeRef.current === "arg-entry" &&
        activeCommandRef.current?.kind === "open-modal";
      const order: ReadonlyArray<Command | SearchEntity> =
        inInlineSearch || inEntityArgEntry
          ? entityResultsRef.current
          : inOpenModalArgEntry
            ? []
            : flatOrderRef.current;
      const selectableCount =
        inEntityArgEntry && viewAllAvailableRef.current ? 1 : order.length;

      if (event.key === "ArrowDown") {
        if (selectableCount > 0) {
          setSelectedIndex((prev) =>
            computeNextMentionIndex("down", prev, selectableCount),
          );
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === "ArrowUp") {
        if (selectableCount > 0) {
          setSelectedIndex((prev) =>
            computeNextMentionIndex("up", prev, selectableCount),
          );
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === "Enter") {
        if (inOpenModalArgEntry) {
          const committed = handleCommitOpenModalQuery();
          if (committed) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }

        const idx = selectedIndexRef.current;
        if (inEntityArgEntry && idx < 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (inEntityArgEntry && viewAllAvailableRef.current && idx === 0) {
          handleViewAll();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (idx < 0 || idx >= order.length) return;
        if (inInlineSearch) {
          if (
            !canSelectInlineSearchResults(entityResultsFreshnessRef.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          handleSelectInlineSearchEntityRef.current(
            entityResultsRef.current[idx],
          );
        } else if (inEntityArgEntry) {
          if (
            !canSelectInlineSearchResults(entityResultsFreshnessRef.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          handleSelectEntityRef.current(entityResultsRef.current[idx]);
        } else {
          handlePickCommandRef.current(flatOrderRef.current[idx]);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Tab") return;
    };

    root.addEventListener("keydown", handleKeyDown, true);
    return () => root.removeEventListener("keydown", handleKeyDown, true);
  }, [
    open,
    editor,
    resetArgEntry,
    handleCommitOpenModalQuery,
    handleViewAll,
    resetInlineSearch,
  ]);

  if (!open) return null;

  const showEntitySearch =
    !!onSearchEntities &&
    (inlineSearchState !== null ||
      (pickerMode === "arg-entry" &&
        activeCommand?.kind === "inline-entity-search"));
  const showQueryEntry =
    pickerMode === "arg-entry" && activeCommand?.kind === "open-modal";
  const popupQuery =
    inlineSearchState?.query ??
    (showQueryEntry ? argQuery : (trigger?.queryText ?? argQuery));

  return (
    <div
      style={{
        position: "fixed",
        ...(popupPos.top !== undefined ? { top: `${popupPos.top}px` } : {}),
        ...(popupPos.bottom !== undefined
          ? { bottom: `${popupPos.bottom}px` }
          : {}),
        left: `${popupPos.left}px`,
        zIndex: 1000,
      }}
    >
      {floatingCuePos && pickerMode === "command-pick" && (
        <Box
          data-testid="slash-command-tab-cue"
          sx={{
            position: "fixed",
            top: `${floatingCuePos.top}px`,
            left: `${floatingCuePos.left}px`,
            display: "inline-flex",
            alignItems: "center",
            height: 18,
            px: 0.75,
            borderRadius: 999,
            border: `1px solid ${theme.palette.divider}`,
            bgcolor: "background.paper",
            color: "text.secondary",
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1,
            pointerEvents: "none",
            zIndex: 1001,
          }}
        >
          [Tab]
        </Box>
      )}
      {showEntitySearch ? (
        <SlashEntitySearchPopup
          query={popupQuery}
          onSearchEntities={onSearchEntities}
          searchScope={entitySearchScope}
          organizationId={organizationId}
          projectId={projectId}
          focalEntity={surfaceContext.focalEntity}
          cachedConversationMentionOptions={
            surfaceContext.cachedConversationMentionOptions
          }
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          onSelectEntity={
            inlineSearchState === null
              ? handleSelectEntity
              : handleSelectInlineSearchEntity
          }
          onViewAll={
            inlineSearchState === null && commandHasTypeRef(activeCommand)
              ? handleViewAll
              : undefined
          }
          isViewAllSelected={viewAllAvailableRef.current && selectedIndex === 0}
          onViewAllAvailabilityChange={handleViewAllAvailabilityChange}
          onResultsChange={handleResultsChange}
          maxHeight={DEFAULT_MAX_HEIGHT}
        />
      ) : (
        <SlashCommandPopup
          heyHey={flatOrder}
          mode={showQueryEntry ? "arg-entry-query" : "command-pick"}
          query={popupQuery}
          maxHeight={DEFAULT_MAX_HEIGHT}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          onPickCommand={handlePickCommand}
        />
      )}
    </div>
  );
};
