import { ContextAuthContext } from 'src/auth/types';
import {
  ArtifactWithMetadata,
  ContextFilters,
  ContextRequest,
  ContextScope,
  ContextType,
} from '../../../../context/interfaces';
import { OrganizationRole } from '../../../../generated';
import { errorToLoggable } from '../../../../utils/logging.util';
import { PlaceholderContextUtils } from '../base/placeholder-context';
import type { PlaceholderContext } from '../base/placeholder-types';
import { contextSearchLogger } from './context-search-formatting.utils';

export { formatContextSearchResults } from './context-search-formatting.utils';

export interface ContextSearchOptions {
  query?: string;
  maxResults?: number;
  artifactTypes?: string | string[];
  tags?: string[];
  categories?: string[];
  fallbackQuery?: string;
}

export interface ContextSearchResult {
  status: 'success' | 'unavailable' | 'error';
  query: string;
  artifacts: ArtifactWithMetadata[];
  message?: string;
}

export async function getContextSearchResults(
  ctx: PlaceholderContext,
  options: ContextSearchOptions = {},
): Promise<ContextSearchResult> {
  const contextService = ctx.services.contextResolutionService;

  if (!contextService?.resolveContext) {
    return {
      status: 'unavailable',
      query: '',
      artifacts: [],
      message: '[Context search unavailable]',
    };
  }

  const query = sanitizeSearchQuery(ctx, options.query, options.fallbackQuery);
  const maxResults = resolveMaxResults(options.maxResults);
  const artifactTypes = normalizeArtifactTypes(options.artifactTypes);

  const authContext = buildAuthContext(ctx);

  const request: ContextRequest = {
    type: ContextType.SEMANTIC,
    scope: ctx.flowContext.core.projectId
      ? ContextScope.PROJECT
      : ContextScope.ORGANIZATION,
    organizationId: ctx.flowContext.core.organizationId,
    projectId: ctx.flowContext.core.projectId,
    conversationId: ctx.flowContext.core.conversationId,
    maxResults,
    searchQuery: query,
    artifactTypes,
    correlationId: ctx.flowContext.core.workflowId,
    ...(authContext && { authContext }),
  };

  if (PlaceholderContextUtils.hasInitiativeContext(ctx)) {
    request.initiativeId = PlaceholderContextUtils.requireInitiativeId(ctx);
  }

  const filters: ContextFilters = {};

  if (Array.isArray(options.tags) && options.tags.length > 0) {
    filters.tags = options.tags;
  }

  if (Array.isArray(options.categories) && options.categories.length > 0) {
    filters.categories = options.categories;
  }

  try {
    const result = await contextService.resolveContext(request, filters);
    const artifacts = result?.artifacts ?? [];

    return {
      status: 'success',
      query,
      artifacts,
    };
  } catch (error) {
    contextSearchLogger.error(
      'Failed to resolve context search results placeholder',
      errorToLoggable(error),
    );

    return {
      status: 'error',
      query,
      artifacts: [],
      message: '[Context search failed]',
    };
  }
}

function buildAuthContext(
  ctx: PlaceholderContext,
): ContextAuthContext | undefined {
  const userId = ctx.flowContext.core.user?.id;
  const organizationId = ctx.flowContext.core.organizationId;

  if (!userId || !organizationId) {
    return undefined;
  }

  const role = normalizeRole(ctx.flowContext.core.user?.role);
  const projectId = ctx.flowContext.core.projectId;

  const authContext: ContextAuthContext = {
    sub: userId,
    orgMemberships: [
      {
        orgId: organizationId,
        role,
      },
    ],
    currentOrgId: organizationId,
  };

  if (projectId) {
    authContext.projectIds = [projectId];
  }

  return authContext;
}

function normalizeRole(role?: string): OrganizationRole {
  switch ((role || '').toUpperCase()) {
    case 'OWNER':
      return 'OWNER';
    case 'ADMIN':
      return 'ADMIN';
    case 'VIEWER':
      return 'VIEWER';
    default:
      return 'MEMBER';
  }
}

function sanitizeSearchQuery(
  ctx: PlaceholderContext,
  query?: string,
  fallbackQuery?: string,
): string {
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  if (trimmedQuery.length > 0) {
    return trimmedQuery;
  }

  const trimmedFallback =
    typeof fallbackQuery === 'string' ? fallbackQuery.trim() : '';
  if (trimmedFallback.length > 0) {
    return trimmedFallback;
  }

  return (
    PlaceholderContextUtils.getUserMessageContent(ctx) ||
    'latest initiative updates'
  );
}

function resolveMaxResults(maxResults?: number): number {
  if (typeof maxResults !== 'number' || !Number.isFinite(maxResults)) {
    return 5;
  }

  const normalized = Math.trunc(maxResults);
  return Math.min(Math.max(normalized, 1), 20);
}

function normalizeArtifactTypes(
  artifactTypes?: string | string[],
): string[] | undefined {
  if (Array.isArray(artifactTypes)) {
    return artifactTypes;
  }

  if (typeof artifactTypes === 'string' && artifactTypes.trim().length > 0) {
    return [artifactTypes];
  }

  return undefined;
}
