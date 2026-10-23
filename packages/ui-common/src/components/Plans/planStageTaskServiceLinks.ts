import {
  RemoveServiceLinkEntityTypeEnum,
  ServiceLinkDtoEntityTypeEnum,
  type ServicesApi,
} from "../../api";

type TaskServiceLinkClient = Pick<
  ServicesApi,
  "removeServiceLink" | "createServiceLink"
>;

export interface SyncTaskServiceLinksInput {
  client: TaskServiceLinkClient;
  organizationId: string;
  taskId: string;
  currentServiceIds: readonly string[];
  nextServiceIds: readonly string[];
}

export const syncTaskServiceLinks = async ({
  client,
  organizationId,
  taskId,
  currentServiceIds,
  nextServiceIds,
}: SyncTaskServiceLinksInput): Promise<void> => {
  const currentServiceIdSet = new Set(currentServiceIds);
  const nextServiceIdSet = new Set(nextServiceIds);
  const removedServiceIds = currentServiceIds.filter(
    (serviceId) => !nextServiceIdSet.has(serviceId)
  );
  const addedServiceIds = nextServiceIds.filter(
    (serviceId) => !currentServiceIdSet.has(serviceId)
  );

  for (const serviceId of removedServiceIds) {
    await client.removeServiceLink({
      organizationId: organizationId,
      serviceId: serviceId,
      entityType:
        RemoveServiceLinkEntityTypeEnum.Task,
      entityId: taskId,
    });
  }
  for (const serviceId of addedServiceIds) {
    await client.createServiceLink({
      organizationId: organizationId,
      serviceId: serviceId,
      serviceLinkDto: {
        entityType: ServiceLinkDtoEntityTypeEnum.Task,
        entityId: taskId,
      },
    });
  }
};
