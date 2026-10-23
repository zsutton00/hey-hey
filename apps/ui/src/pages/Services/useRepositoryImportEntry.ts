import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useConversationByWorkflow,
  useCreateConversation,
} from "@hey-hey/ui-common/data";
import {
  ConversationStatus,
  InitiationType,
  RepositoryGroundingEntryMode,
  type CreateRepositoryImportConversationDto,
} from "@hey-hey/ui-common/api";
import type { HelpActionCapability } from "@hey-hey/ui-common/components";
const IMPORT_STATUSES: ConversationStatus[] = [
  ConversationStatus.NotStarted,
  ConversationStatus.Started,
  ConversationStatus.InProgress,
  ConversationStatus.GeneratingResponse,
  ConversationStatus.Failed,
  ConversationStatus.Recoverable,
];

export function useRepositoryImportEntry(
  organizationId: string | undefined,
  projectId: string | undefined,
) {
  const navigate = useNavigate();
  const busy = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [failure, setFailure] = useState<{
    kind: "lookup" | "creation";
    message: string;
  } | null>(null);
  const [showImportChoice, setShowImportChoice] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const dedicated = useConversationByWorkflow(
    organizationId,
    projectId,
    "repository-import",
    {
      enabled: !!organizationId && !!projectId,
      requireFirstMessage: false,
      requireUiElements: false,
      workflowAboutId: projectId,
      workflowAboutType: "project",
      statuses: IMPORT_STATUSES,
    },
  );
  const legacy = useConversationByWorkflow(
    organizationId,
    projectId,
    "onboarding",
    {
      enabled: !!organizationId && !!projectId,
      requireFirstMessage: false,
      requireUiElements: false,
      triggerEvent: "services_import",
      workflowAboutId: projectId,
      workflowAboutType: "project",
      statuses: IMPORT_STATUSES,
    },
  );
  const createConversation = useCreateConversation();

  const resumableImportConversation = dedicated.data ?? legacy.data;

  const lookupError = dedicated.error ?? legacy.error;
  const loading =
    retrying ||
    dedicated.isLoading ||
    legacy.isLoading ||
    !organizationId ||
    !projectId;
  const openImport = (conversationId: string) => {
    navigate(
      `/projects/${projectId}/repository-import?conversationId=${encodeURIComponent(
        conversationId,
      )}`,
    );
  };

  const createNewImport = async () => {
    if (!organizationId || !projectId || busy.current || loading || lookupError)
      return;

    busy.current = true;
    setFailure(null);
    setIsImporting(true);

    try {
      const conversation = await createConversation.mutate({
        organizationId,
        projectId,
        conversationDto: buildImportSeed(organizationId, projectId),
      });
      setShowImportChoice(false);
      openImport(conversation.id);
    } catch (error) {
      setFailure({
        kind: "creation",
        message:
          error instanceof Error
            ? error.message
            : "Failed to start existing-work import",
      });
    } finally {
      busy.current = false;
      setIsImporting(false);
    }
  };

  const handleImportExistingWork = () => {
    if (busy.current || loading || lookupError || !organizationId || !projectId)
      return;
    if (resumableImportConversation) setShowImportChoice(true);
    else void createNewImport();
  };

  const retry = async () => {
    if (busy.current) return;
    if (!lookupError && failure?.kind !== "lookup") {
      await createNewImport();
      return;
    }
    busy.current = true;
    setRetrying(true);
    setFailure(null);
    try {
      await Promise.all([dedicated.refetch(), legacy.refetch()]);
    } catch (error) {
      setFailure({
        kind: "lookup",
        message:
          error instanceof Error
            ? error.message
            : "Failed to check existing imports",
      });
    } finally {
      busy.current = false;
      setRetrying(false);
    }
  };
  const error = lookupError?.message ?? failure?.message ?? null;
  const action: HelpActionCapability = {
    status: isImporting
      ? "pending"
      : loading
      ? "loading"
      : error
      ? "error"
      : "ready",
    error,
    execute: handleImportExistingWork,
    retry: () => void retry(),
  };
  return {
    action,
    showImportChoice,
    openImport,
    close: () => {
      if (!busy.current) setShowImportChoice(false);
    },
    resume: () => {
      if (
        !busy.current &&
        !loading &&
        !lookupError &&
        resumableImportConversation
      ) {
        setShowImportChoice(false);
        openImport(resumableImportConversation.id);
      }
    },
    createNew: () => void createNewImport(),
  };
}
export type RepositoryImportEntry = ReturnType<typeof useRepositoryImportEntry>;

function buildImportSeed(
  organizationId: string,
  projectId: string,
): CreateRepositoryImportConversationDto {
  return {
    organizationId,
    projectId,
    initiatedBy: InitiationType.User,
    status: ConversationStatus.Started,
    title: "Import existing work",
    workflowName: "repository-import",
    workflowAboutId: projectId,
    workflowAboutType: "project",
    triggerEvent: "services_import",
    context: {
      repositoryGrounding: {
        entryMode: RepositoryGroundingEntryMode.ExistingProject,
      },
    },
  };
}
