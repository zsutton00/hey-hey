import { z } from 'zod';

import type { ServiceDto } from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';

const serviceNameSchema: z.ZodType<Pick<ServiceDto, 'id' | 'name'>> = z
  .object({ id: z.string().min(1), name: z.string().min(1) })
  .passthrough();
const serviceListResponseSchema = z
  .object({ data: z.array(serviceNameSchema).optional() })
  .passthrough();

interface ProjectServiceNameResolverOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

interface ResolveProjectServiceNamesInput {
  runId: string;
  organizationId: string;
  projectId: string;
  serviceIds: readonly string[];
}

export class ProjectServiceNameResolver {
  public constructor(private readonly options: ProjectServiceNameResolverOptions) {}

  public async resolve(input: ResolveProjectServiceNamesInput): Promise<string[]> {
    this.options.logger.debug('local.service_scope.service_names.resolve_started', {
      runId: input.runId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      serviceIds: input.serviceIds,
    });
    const accessToken = await this.options.auth.getAccessToken();
    const baseUrl = this.options.apiBaseUrl.replace(/\/$/u, '');
    const url = `${baseUrl}/organizations/${encodeURIComponent(input.organizationId)}/services?projectId=${encodeURIComponent(input.projectId)}`;
    const response = await this.options.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      this.options.logger.warn('local.service_scope.service_names.request_failed', {
        runId: input.runId,
        status: response.status,
        serviceIds: input.serviceIds,
      });
      throw new Error(`Project Service lookup failed with status ${String(response.status)}.`);
    }
    const parsed = serviceListResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      this.options.logger.warn('local.service_scope.service_names.response_invalid', {
        runId: input.runId,
        serviceIds: input.serviceIds,
        issues: parsed.error.issues,
      });
      throw new Error('Project Service lookup returned an invalid response.');
    }
    const servicesById = new Map((parsed.data.data ?? []).map((service) => [service.id, service]));
    const missingServiceIds = input.serviceIds.filter((serviceId) => !servicesById.has(serviceId));
    if (missingServiceIds.length > 0) {
      this.options.logger.warn('local.service_scope.service_names.missing', {
        runId: input.runId,
        serviceIds: input.serviceIds,
        missingServiceIds,
      });
      throw new Error(
        `Project Service lookup did not return requested Service${missingServiceIds.length === 1 ? '' : 's'}: ${missingServiceIds.join(', ')}.`,
      );
    }
    const names = input.serviceIds.map((serviceId) => {
      const service = servicesById.get(serviceId);
      if (!service) throw new Error(`Project Service ${serviceId} was not resolved.`);
      return service.name;
    });
    this.options.logger.debug('local.service_scope.service_names.resolved', {
      runId: input.runId,
      serviceIds: input.serviceIds,
      serviceNames: names,
    });
    return names;
  }
}
