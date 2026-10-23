import { useEffect, useState } from "react";
import type { EntityPromptTemplateDraftValidationRequestDto } from "../../api";
import { entityPromptTemplatesClient } from "../../clients/serviceClients";
import type { TemplateDraftValidation } from "../../components/EntityPromptTemplateEditor/types";

export interface TemplateDraftValidationIdentity {
  readonly organizationId: string;
  readonly projectId: string;
  readonly templateKey: string;
}
interface ValidationSnapshot {
  readonly key: string;
  readonly validation: TemplateDraftValidation;
}

/** Results are usable only for the exact identity, selector, version and source checked. */
export function useEntityPromptTemplateDraftValidation(
  identity: TemplateDraftValidationIdentity,
  draft: EntityPromptTemplateDraftValidationRequestDto | null
): TemplateDraftValidation {
  const key = JSON.stringify([
    identity.organizationId,
    identity.projectId,
    identity.templateKey,
    draft?.selector.entityType,
    draft?.selector.entityType === "WORK_ITEM"
      ? draft.selector.workItemTypeKey
      : null,
    draft?.syntaxVersion,
    draft?.content,
  ]);
  const [snapshot, setSnapshot] = useState<ValidationSnapshot | null>(null);
  useEffect(() => {
    if (!draft) return;
    let active = true;
    const source = {
      syntaxVersion: draft.syntaxVersion,
      content: draft.content,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void entityPromptTemplatesClient
        .validateEntityPromptTemplateDraft(
          {
            ...identity,
            entityPromptTemplateDraftValidationRequestDto: draft,
          },
          { signal: controller.signal }
        )
        .then((response) => {
          if (!active) return;
          const result = response.data.data;
          if (!result)
            throw new Error("The validation service returned no result.");
          setSnapshot({
            key,
            validation:
              result.status === "VALID"
                ? { status: "valid", source }
                : { status: "invalid", source, issues: result.issues },
          });
        })
        .catch((error: unknown) => {
          if (active)
            setSnapshot({
              key,
              validation: {
                status: "error",
                source,
                message:
                  error instanceof Error
                    ? error.message
                    : "Unable to check the template. Edit the draft to retry.",
              },
            });
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
    // The key includes every request field; object identity must not restart validation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!draft) return { status: "idle" };
  if (snapshot?.key === key) return snapshot.validation;
  return {
    status: "pending",
    source: { content: draft.content, syntaxVersion: draft.syntaxVersion },
  };
}
