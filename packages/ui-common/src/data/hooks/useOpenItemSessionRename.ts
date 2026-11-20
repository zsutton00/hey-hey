import { useEffect, useRef, useState } from "react";
import { useApolloClient } from "@apollo/client/react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { EntityType, type ConversationResponseDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { conversationRead } from "../collections/conversations";
import { refreshConversation } from "../graphql/conversationCache";
import { getProjectGraphQLClient } from "../graphql/client";
import { getOpenItemsAdapter } from "../collections/openItems";
import type { OpenItemsScope } from "../openItemsAdapter";
import logger from "../../utils/logger";

const failureReason = (cause: unknown) =>
  isAxiosError(cause)
    ? { code: cause.code ?? "HTTP_ERROR", status: cause.response?.status }
    : { code: cause instanceof Error ? cause.name : "UNKNOWN_ERROR" };

type RenameError = "read" | "save" | "conflict" | "refresh" | null;

/** Mounted only by the explicitly opened editor; base rows never read details. */
export function useOpenItemSessionRename(
  scope: OpenItemsScope,
  sessionId: string,
  conversationId: string,
  onSaved: () => void,
) {
  const queryClient = useQueryClient();
  const apollo = useApolloClient();
  const [conversation, setConversation] =
    useState<ConversationResponseDto | null>(null);
  const [latest, setLatest] = useState<ConversationResponseDto | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RenameError>(null);
  const title = draft.trim();
  const isValid = title.length >= 3 && title.length <= 80;
  const pending = useRef(false);
  const titleSaved = useRef(false);
  const refreshKey = useRef(crypto.randomUUID());
  const alive = useRef(true);
  const read = async (): Promise<ConversationResponseDto> => {
    const spec = conversationRead(scope, conversationId, false);
    const { data } = await getProjectGraphQLClient(apollo, scope).query({
      query: spec.document,
      variables: spec.variables,
      context: scope,
      fetchPolicy: "network-only",
    });
    const conversation = data ? spec.select(data) : null;
    if (!conversation) {
      throw new Error("Conversation read returned no conversation");
    }

    return conversation;
  };

  const load = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = await read();
      if (!alive.current) {
        return;
      }
      setConversation(current);
      setDraft(current.title ?? "");
    } catch (cause) {
      logger.error("data_core", "Session rename conversation read failed", {
        sessionId,
        conversationId,
        ...failureReason(cause),
      });
      if (alive.current) {
        setError("read");
      }
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [scope.organizationId, scope.projectId, sessionId, conversationId]);

  const save = async () => {
    if (
      pending.current ||
      (!titleSaved.current &&
        (!conversation || error === "conflict" || !isValid))
    ) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (!titleSaved.current && conversation) {
        try {
          await platformClient.updateConversation({
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            conversationId,
            updateConversationDto: {
              expectedVersion: conversation.version,
              title,
            },
          });
          await refreshConversation(apollo, conversationId);
          titleSaved.current = true;
        } catch (cause) {
          logger.error("data_core", "Session rename title write failed", {
            sessionId,
            conversationId,
            ...failureReason(cause),
          });
          if (isAxiosError(cause) && cause.response?.status === 409) {
            setError("conflict");
            try {
              setLatest(await read());
            } catch (readCause) {
              logger.error(
                "data_core",
                "Session rename latest title read failed",
                { sessionId, conversationId, ...failureReason(readCause) },
              );
            }
          } else {
            setError("save");
          }
          return;
        }
      }
      try {
        await getOpenItemsAdapter(queryClient, scope).mutateWithResult({
          kind: "refreshOpenItemPresentation",
          parameters: {
            entityType: EntityType.AgentSession,
            entityId: sessionId,
            refreshOpenItemPresentationRequest: {
              idempotencyKey: refreshKey.current,
            },
          },
        });
        if (alive.current) {
          onSaved();
        }
      } catch (cause) {
        logger.error(
          "data_core",
          "Session renamed but Open Item presentation refresh failed",
          { sessionId, conversationId, ...failureReason(cause) },
        );
        setError("refresh");
      }
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const reviewLatest = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const current = latest ?? (await read());
      setConversation(current);
      setLatest(current);
      setError(null);
      // Keep the user's draft visible for deliberate review before the next Save.
    } catch (cause) {
      logger.error("data_core", "Session rename conflict review failed", {
        sessionId,
        conversationId,
        ...failureReason(cause),
      });
      setError("conflict");
    } finally {
      setBusy(false);
    }
  };

  return {
    draft,
    isValid,
    setDraft,
    busy,
    error,
    latestTitle: latest?.title,
    loaded: conversation !== null,
    titleSaved: titleSaved.current,
    load,
    save,
    reviewLatest,
  };
}
