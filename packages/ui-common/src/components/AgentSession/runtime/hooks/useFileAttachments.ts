import {
  runAttachmentFormat,
  RUN_ATTACHMENT_FORMAT_HELP,
} from "../../../../utils/run-attachment-format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunAttachmentReference } from "../../../../api";
import {
  createDirectoryBindingApi,
  LocalRunAttachmentUploadError,
  resolveLocalDirectoryRuntimeBaseUrl,
  type DirectoryBindingApi,
} from "../directoryBindingApi";
import { useLocalCliForSession } from "./useLocalCliForSession";
import {
  attachmentDropRejection,
  attachmentReferences,
  type RunAttachmentEntry,
  type FileAttachmentDestination,
} from "./runAttachmentDrop";

interface AttachmentScope {
  key: string;
}
interface AttachmentState {
  scope: AttachmentScope;
  entries: RunAttachmentEntry[];
  rejection: string | null;
}

function useScopedAttachments(key: string) {
  const scopeRef = useRef<AttachmentScope>({ key });
  if (scopeRef.current.key !== key) scopeRef.current = { key };
  const scope = scopeRef.current;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, setState] = useState<AttachmentState>({
    scope,
    entries: [],
    rejection: null,
  });
  const update = useCallback(
    (change: (current: AttachmentState) => AttachmentState) => {
      if (!mounted.current || scopeRef.current !== scope) return;
      setState((current) =>
        change(
          current.scope === scope
            ? current
            : { scope, entries: [], rejection: null },
        ),
      );
    },
    [scope],
  );
  return {
    entries: state.scope === scope ? state.entries : [],
    rejection: state.scope === scope ? state.rejection : null,
    update,
  };
}

async function uploadEntry(
  api: DirectoryBindingApi,
  target: FileAttachmentDestination,
  file: File,
  key: string,
): Promise<RunAttachmentEntry> {
  try {
    if (!runAttachmentFormat(file.name))
      throw new Error(RUN_ATTACHMENT_FORMAT_HELP);
    const {
      result: { attachment },
    } = await (target.kind === "run"
      ? api.uploadLocalRunAttachment(target.runId, target.machineId, file)
      : api.uploadLocalStagedRunAttachment(target.machineId, file));
    return {
      key,
      fileName: attachment.fileName,
      status: "ready",
      reference: {
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
      },
    };
  } catch (error) {
    return {
      key,
      fileName: file.name,
      status: "error",
      message: error instanceof Error ? error.message : "File upload failed.",
      code: error instanceof LocalRunAttachmentUploadError ? error.code : null,
    };
  }
}

export function useFileAttachments(
  target: FileAttachmentDestination | null,
  scopeKey: string | null,
  available: boolean | string,
) {
  const local = useLocalCliForSession(target?.machineId ?? null);
  const api = useMemo(
    () => createDirectoryBindingApi(resolveLocalDirectoryRuntimeBaseUrl()),
    [],
  );
  const { entries, rejection, update } = useScopedAttachments(
    JSON.stringify([scopeKey, target]),
  );
  const drop = useCallback(
    (files: readonly File[]) => {
      const rejection = attachmentDropRejection(target, local, available);
      update((current) => ({ ...current, rejection }));
      if (rejection || !target) return;
      for (const file of files) {
        const key = crypto.randomUUID();
        update((current) => ({
          ...current,
          entries: [
            ...current.entries,
            { key, fileName: file.name, status: "uploading" },
          ],
        }));
        void uploadEntry(api, target, file, key).then((result) =>
          update((current) => ({
            ...current,
            entries: current.entries.map((entry) =>
              entry.key === key ? result : entry,
            ),
          })),
        );
      }
    },
    [api, available, local, target, update],
  );
  const remove = useCallback(
    (key: string) =>
      update((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.key !== key),
      })),
    [update],
  );
  const clearSubmitted = useCallback(
    (references: readonly RunAttachmentReference[]) => {
      const ids = new Set(
        references.map((reference) => reference.attachmentId),
      );
      update((current) => ({
        ...current,
        entries: current.entries.filter(
          (entry) =>
            entry.status !== "ready" || !ids.has(entry.reference.attachmentId),
        ),
      }));
    },
    [update],
  );
  return {
    blocked: entries.some((entry) => entry.status !== "ready"),
    canDrop: attachmentDropRejection(target, local, available) === null,
    entries,
    references: attachmentReferences(entries),
    rejection,
    drop,
    remove,
    clearSubmitted,
  };
}
