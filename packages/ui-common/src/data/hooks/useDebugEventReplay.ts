import { useQueryClient } from "@tanstack/react-query";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import { useCallback, useState } from "react";
import type {
  DebugEventReplayMode,
  DebugEventReplayRequestDto,
  DebugEventReplayResponseDto,
} from "../../api";
import { eventsClient } from "../../clients/serviceClients";
import { outboxEventKeys } from "../collections/outboxEvents";
import {
  useMutation,
  type MutationOptions,
  type MutationResult,
} from "../core/useMutation";

export interface DebugEventReplayVariables
  extends Pick<DebugEventReplayRequestDto, "mode"> {
  eventId: string;
  projectId: string;
}

export interface UseDebugEventReplayParams {
  entityId: string;
  entityType: string;
}

export type UseDebugEventReplayOptions =
  MutationOptions<DebugEventReplayResponseDto>;

export interface UseDebugEventReplayReturn
  extends Omit<
    MutationResult<DebugEventReplayVariables, DebugEventReplayResponseDto>,
    "mutate"
  > {
  data: DebugEventReplayResponseDto | null;
  replay: (
    variables: DebugEventReplayVariables
  ) => Promise<DebugEventReplayResponseDto>;
}

const mutatingModes: ReadonlySet<DebugEventReplayMode> = new Set([
  "REEMIT_ORIGINAL",
  "ATTEMPT_FIX_AND_REEMIT",
]);

export function useDebugEventReplay(
  { entityId, entityType }: UseDebugEventReplayParams,
  options: UseDebugEventReplayOptions = {}
): UseDebugEventReplayReturn {
  const queryClient = useQueryClient();
  const [data, setData] = useState<DebugEventReplayResponseDto | null>(null);

  const mutationFn = useCallback(
    async (
      variables: DebugEventReplayVariables
    ): Promise<DebugEventReplayResponseDto> => {
      setData(null);
      const response = await eventsClient.replayDebugEvents({
        debugEventReplayRequestDto: variables,
      });
      const result = response.data?.data;

      if (!result) {
        throw new Error(
          response.data?.message || "Event replay returned no results"
        );
      }

      setData(result);

      if (mutatingModes.has(variables.mode)) {
        try {
          await invalidateWithFollowUpRead(queryClient, {
            queryKey: outboxEventKeys.entity(entityType, entityId),
            exact: true,
          });
        } catch {
          // The collection owns its refresh error state. The replay itself
          // already succeeded, so do not report a failed mutation that could
          // encourage the operator to queue a duplicate replay.
        }
      }

      return result;
    },
    [queryClient, entityId, entityType]
  );

  const mutation = useMutation(mutationFn, options);

  return {
    data,
    error: mutation.error,
    isError: mutation.isError,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    replay: mutation.mutate,
  };
}
