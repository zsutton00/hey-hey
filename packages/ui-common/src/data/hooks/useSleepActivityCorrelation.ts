import { useQueryClient } from "@tanstack/react-query";
import type {
  ActivitySleepDto,
  ActivitySleepDuration,
  EntityType,
} from "../../api";
import { activityCorrelationClient } from "../../clients/serviceClients";
import { invalidateActivityQueries } from "../collections/activityCorrelations";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface SleepActivityCorrelationVariables {
  organizationId: string;
  entityId: string;
  entityType: EntityType;
  duration: ActivitySleepDuration;
}

export type UseSleepActivityCorrelationOptions =
  MutationOptions<ActivitySleepDto>;

export function useSleepActivityCorrelation(
  options: UseSleepActivityCorrelationOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    entityId,
    entityType,
    duration,
  }: SleepActivityCorrelationVariables): Promise<ActivitySleepDto> => {
    const response = await activityCorrelationClient.sleepActivityCorrelation({
      organizationId: organizationId,
      createActivitySleepDto: {
        entityId,
        entityType,
        duration,
      },
    });
    const activitySleep = response.data?.data;

    if (!activitySleep) {
      throw new Error("No activity sleep returned from sleep endpoint");
    }

    await invalidateActivityQueries(queryClient, organizationId);

    return activitySleep;
  };

  return useMutation(mutationFn, options);
}
