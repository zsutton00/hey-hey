/**
 * Reproduces the "phantom unsaved changes" bug: a freshly-created task whose
 * sections come pre-populated from an agent proposal (description +
 * acceptance criteria with bullet-list items) should NOT mark the editor
 * draft dirty after the initial server hydration.
 *
 * The harness wires `useLockedEditorSync` + `MarkdownLexicalEditor` together
 * the same way `WorkItemEditor` does — including the diff-then-patch step in
 * `onContentChange` — and uses real Lexical (no module mocks) so the markdown
 * roundtrip behavior is the production behavior.
 */

import React, { useEffect, useRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it } from "vitest";

import { MarkdownLexicalEditor } from "../../LexicalEditor/MarkdownLexicalEditor";
import { useLockedEditorSync } from "../../../hooks/useLockedEditorSync";

const theme = createTheme();

interface WorkItemContent {
  description: string;
  acceptanceCriteria: string;
  requirements: string;
}

const FIELDS = ["description", "acceptanceCriteria", "requirements"] as const;

const EMPTY_CONTENT: WorkItemContent = {
  description: "",
  acceptanceCriteria: "",
  requirements: "",
};

interface SyncSnapshot {
  hasUnsavedChanges: boolean;
  dirtyKeys: ReadonlyArray<keyof WorkItemContent>;
  draft: WorkItemContent;
  base: WorkItemContent;
}

interface HarnessProps {
  serverContent: WorkItemContent | null;
  syncRef: { current: SyncSnapshot | null };
}

const Harness: React.FC<HarnessProps> = ({ serverContent, syncRef }) => {
  const sync = useLockedEditorSync<WorkItemContent, keyof WorkItemContent>({
    documentKey: "task-1",
    initialDocument: EMPTY_CONTENT,
    fields: FIELDS,
  });

  // Mirrors WorkItemEditor.onContentChange: only patch keys that actually
  // changed against the current draft.
  const draft = sync.state.draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const onSectionChange = (
    key: keyof WorkItemContent,
    nextValue: string
  ): void => {
    if (draftRef.current[key] === nextValue) {
      return;
    }
    sync.applyUserPatch({ [key]: nextValue } as Partial<
      Pick<WorkItemContent, keyof WorkItemContent>
    >);
  };

  // Hydrate from "server" once after mount.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (serverContent && !hydratedRef.current) {
      hydratedRef.current = true;
      sync.applyServerRefresh(serverContent);
    }
  }, [serverContent, sync]);

  // Expose the current sync state for assertions.
  syncRef.current = {
    hasUnsavedChanges: sync.hasUnsavedChanges,
    dirtyKeys: Array.from(sync.state.dirtyKeys),
    draft: sync.state.draft,
    base: sync.state.base,
  };

  return (
    <>
      <MarkdownLexicalEditor
        value={draft.description}
        onTextChange={(text) => onSectionChange("description", text)}
        isLoading={false}
      />
      <MarkdownLexicalEditor
        value={draft.acceptanceCriteria}
        onTextChange={(text) => onSectionChange("acceptanceCriteria", text)}
        isLoading={false}
      />
    </>
  );
};

const renderHarness = (
  serverContent: WorkItemContent | null
): { syncRef: { current: SyncSnapshot | null } } => {
  const syncRef: { current: SyncSnapshot | null } = { current: null };
  render(
    <ThemeProvider theme={theme}>
      <Harness serverContent={serverContent} syncRef={syncRef} />
    </ThemeProvider>
  );
  return { syncRef };
};

// MarkdownLexicalEditor's OnChangeTextPlugin debounces emissions by 300ms.
// Wait long enough for any post-mount lexical reconciliation + debounce to
// flush before asserting.
const flushLexicalDebounce = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 500));
};

describe("WorkItemEditor phantom dirty state", () => {
  it("does not mark draft dirty after server hydrates with bullet-list content", async () => {
    // Mirrors typical agent-proposed content for a freshly-created task:
    // a multi-paragraph description plus an acceptance-criteria list with
    // leading bullet items. Includes a trailing newline as agents commonly
    // emit, since `\n` at the end is a frequent roundtrip-normalization
    // trigger.
    const serverContent: WorkItemContent = {
      description:
        "Implement the Save button so unsaved edits can be persisted.\n\nThe button must be visible only when there are pending changes and disable itself while a save is in flight.\n",
      acceptanceCriteria:
        "* Save button is visible when there are unsaved changes\n* Save button persists changes to the server\n* Save button is disabled while a save is in progress\n",
      requirements: "",
    };

    const { syncRef } = renderHarness(serverContent);

    // Wait for the locked-editor-sync state to flip to the server content.
    await waitFor(() => {
      expect(syncRef.current?.base.description).toBe(serverContent.description);
    });

    await flushLexicalDebounce();

    const snapshot = syncRef.current;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.dirtyKeys).toEqual([]);
    expect(snapshot?.hasUnsavedChanges).toBe(false);
  }, 10_000);
});
