import { useCallback, useEffect, useReducer, useRef } from "react";
import isEqual from "lodash/isEqual.js";

interface LockedEditorSyncState<
  TDocument extends object,
  TFieldKey extends keyof TDocument,
> {
  documentKey: string;
  base: TDocument;
  draft: TDocument;
  dirtyKeys: ReadonlySet<TFieldKey>;
  hasPendingServerUpdate: boolean;
  pendingServer?: TDocument;
}

type LockedEditorSyncAction<
  TDocument extends object,
  TFieldKey extends keyof TDocument,
> =
  | {
      type: "reset_document";
      documentKey: string;
      document: TDocument;
    }
  | {
      type: "apply_user_patch";
      patch: Partial<Pick<TDocument, TFieldKey>>;
      fields: readonly TFieldKey[];
    }
  | {
      type: "apply_accepted_suggestion";
      patch: Partial<Pick<TDocument, TFieldKey>>;
      fields: readonly TFieldKey[];
    }
  | {
      type: "apply_server_refresh";
      document: TDocument;
    }
  | {
      type: "replace_draft";
      draft: TDocument;
      fields: readonly TFieldKey[];
    }
  | {
      type: "discard_draft";
    }
  | {
      type: "commit_draft_as_base";
    };

export interface UseLockedEditorSyncParams<
  TDocument extends object,
  TFieldKey extends keyof TDocument,
> {
  documentKey: string;
  initialDocument: TDocument;
  fields: readonly TFieldKey[];
}

export interface UseLockedEditorSyncReturn<
  TDocument extends object,
  TFieldKey extends keyof TDocument,
> {
  state: LockedEditorSyncState<TDocument, TFieldKey>;
  hasUnsavedChanges: boolean;
  applyUserPatch: (patch: Partial<Pick<TDocument, TFieldKey>>) => void;
  applyAcceptedSuggestion: (patch: Partial<Pick<TDocument, TFieldKey>>) => void;
  applyServerRefresh: (document: TDocument) => void;
  replaceDraft: (draft: TDocument) => void;
  discardDraft: () => void;
  commitDraftAsBase: () => void;
}

const mergeDocumentPatch = <
  TDocument extends object,
  TFieldKey extends keyof TDocument,
>(
  document: TDocument,
  patch: Partial<Pick<TDocument, TFieldKey>>,
): TDocument => ({
  ...document,
  ...patch,
});

const collectDirtyKeys = <
  TDocument extends object,
  TFieldKey extends keyof TDocument,
>(
  base: TDocument,
  draft: TDocument,
  fields: readonly TFieldKey[],
): ReadonlySet<TFieldKey> => {
  const dirtyKeys = new Set<TFieldKey>();

  for (const key of fields) {
    if (!isEqual(draft[key], base[key])) {
      dirtyKeys.add(key);
    }
  }

  return dirtyKeys;
};

const createInitialState = <
  TDocument extends object,
  TFieldKey extends keyof TDocument,
>(
  documentKey: string,
  document: TDocument,
): LockedEditorSyncState<TDocument, TFieldKey> => ({
  documentKey,
  base: document,
  draft: document,
  dirtyKeys: new Set<TFieldKey>(),
  hasPendingServerUpdate: false,
});

const reduceLockedEditorSyncState = <
  TDocument extends object,
  TFieldKey extends keyof TDocument,
>(
  state: LockedEditorSyncState<TDocument, TFieldKey>,
  action: LockedEditorSyncAction<TDocument, TFieldKey>,
): LockedEditorSyncState<TDocument, TFieldKey> => {
  switch (action.type) {
    case "reset_document":
      return createInitialState<TDocument, TFieldKey>(
        action.documentKey,
        action.document,
      );
    case "apply_user_patch": {
      const draft = mergeDocumentPatch(state.draft, action.patch);
      const dirtyKeys = collectDirtyKeys(state.base, draft, action.fields);
      return {
        ...state,
        draft,
        dirtyKeys,
      };
    }
    case "apply_accepted_suggestion": {
      const base = mergeDocumentPatch(state.base, action.patch);
      const draft = mergeDocumentPatch(state.draft, action.patch);
      const dirtyKeys = collectDirtyKeys(base, draft, action.fields);
      return {
        ...state,
        base,
        draft,
        dirtyKeys,
        hasPendingServerUpdate: false,
        pendingServer: undefined,
      };
    }
    case "apply_server_refresh": {
      const draftMatchesServer = isEqual(state.draft, action.document);

      if (state.dirtyKeys.size === 0 || draftMatchesServer) {
        return {
          ...state,
          base: action.document,
          draft: action.document,
          dirtyKeys: new Set<TFieldKey>(),
          hasPendingServerUpdate: false,
          pendingServer: undefined,
        };
      }

      return {
        ...state,
        hasPendingServerUpdate: true,
        pendingServer: action.document,
      };
    }
    case "replace_draft": {
      const dirtyKeys = collectDirtyKeys(
        state.base,
        action.draft,
        action.fields,
      );
      return {
        ...state,
        draft: action.draft,
        dirtyKeys,
      };
    }
    case "discard_draft": {
      if (state.pendingServer) {
        return {
          ...state,
          base: state.pendingServer,
          draft: state.pendingServer,
          dirtyKeys: new Set<TFieldKey>(),
          hasPendingServerUpdate: false,
          pendingServer: undefined,
        };
      }

      return {
        ...state,
        draft: state.base,
        dirtyKeys: new Set<TFieldKey>(),
      };
    }
    case "commit_draft_as_base":
      return {
        ...state,
        base: state.draft,
        dirtyKeys: new Set<TFieldKey>(),
        hasPendingServerUpdate: false,
        pendingServer: undefined,
      };
    default:
      return state;
  }
};

export const useLockedEditorSync = <
  TDocument extends object,
  TFieldKey extends keyof TDocument,
>({
  documentKey,
  initialDocument,
  fields,
}: UseLockedEditorSyncParams<TDocument, TFieldKey>): UseLockedEditorSyncReturn<
  TDocument,
  TFieldKey
> => {
  const [state, dispatch] = useReducer(
    reduceLockedEditorSyncState<TDocument, TFieldKey>,
    createInitialState<TDocument, TFieldKey>(documentKey, initialDocument),
  );

  const previousDocumentKeyRef = useRef(documentKey);

  useEffect(() => {
    if (previousDocumentKeyRef.current === documentKey) {
      return;
    }

    previousDocumentKeyRef.current = documentKey;
    dispatch({
      type: "reset_document",
      documentKey,
      document: initialDocument,
    });
  }, [documentKey, initialDocument]);

  const applyUserPatch = useCallback(
    (patch: Partial<Pick<TDocument, TFieldKey>>): void => {
      dispatch({ type: "apply_user_patch", patch, fields });
    },
    [fields],
  );

  const applyAcceptedSuggestion = useCallback(
    (patch: Partial<Pick<TDocument, TFieldKey>>): void => {
      dispatch({ type: "apply_accepted_suggestion", patch, fields });
    },
    [fields],
  );

  const applyServerRefresh = useCallback((document: TDocument): void => {
    dispatch({ type: "apply_server_refresh", document });
  }, []);

  const replaceDraft = useCallback(
    (draft: TDocument): void => {
      dispatch({ type: "replace_draft", draft, fields });
    },
    [fields],
  );

  const discardDraft = useCallback((): void => {
    dispatch({ type: "discard_draft" });
  }, []);

  const commitDraftAsBase = useCallback((): void => {
    dispatch({ type: "commit_draft_as_base" });
  }, []);

  return {
    state,
    hasUnsavedChanges: state.dirtyKeys.size > 0,
    applyUserPatch,
    applyAcceptedSuggestion,
    applyServerRefresh,
    replaceDraft,
    discardDraft,
    commitDraftAsBase,
  };
};
