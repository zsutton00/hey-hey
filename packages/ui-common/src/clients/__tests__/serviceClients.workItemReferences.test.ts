import axios from "axios";
import { describe, expect, it, vi } from "vitest";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  WorkStatus,
  type OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGet200Response,
} from "../../api";
import { createApiRuntime, type ApiTransport } from "../createApiRuntime";
import { UnifiedApiClient } from "../serviceClients";

const createTransport = (): ApiTransport => ({
  axios: axios.create(),
  request: vi.fn(),
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(() => () => undefined),
});

describe("UnifiedApiClient work-item reference reads", () => {
  it("delegates the generated reference operation without recreating its request", async () => {
    const runtime = createApiRuntime({
      baseUrl: "/api/v1",
      transport: createTransport(),
    });
    const client = new UnifiedApiClient(runtime.clients);
    const response: OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGet200Response =
      {
        success: true,
        message: "References retrieved",
        timestamp: "2026-08-29T00:00:00.000Z",
        statusCode: 200,
        data: {
          items: [],
          pagination: {
            page: 1,
            limit: 500,
            total: 0,
            totalPages: 0,
            hasNext: false,
            hasPrevious: false,
          },
        },
      };
    const listReferences = vi
      .spyOn(
        runtime.clients.tasks,
        "organizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGet",
      )
      .mockResolvedValue({
        data: response,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      });

    const request = {
      organizationId: "org-1",
      projectId: "project-1",
      type: "FEATURE",
      page: 1,
      limit: 500,
      filter: "roadmap",
      statuses: [WorkStatus.Active, WorkStatus.Completed],
      sortBy:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.CreatedAt,
      sortOrder:
        OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Desc,
    };
    await client.listWorkItemReferences(request);

    expect(listReferences).toHaveBeenCalledWith(request);
  });
});
