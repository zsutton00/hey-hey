import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { EntityType, type ConversationResponseDto } from "../../api";
import {
  conversationQueryOptions,
  updateConversation,
} from "../collections/conversations";
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
  const read = () =>
    queryClient.fetchQuery({
      ...conversationQueryOptions(
        scope.organizationId,
        scope.projectId,
        conversationId,
      ),
      staleTime: 0,
      retry: false,
    });

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
          await updateConversation(
            queryClient,
            scope.organizationId,
            scope.projectId,
            conversationId,
            { expectedVersion: conversation.version, title },
          );
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
