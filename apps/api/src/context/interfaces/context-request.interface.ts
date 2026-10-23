import { ContextAuthContext } from 'src/auth/types';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
} from '../../types';

export enum ContextType {
  CONVERSATION = 'CONVERSATION',
  PROJECT = 'PROJECT',
  RELATED = 'RELATED',
  SEMANTIC = 'SEMANTIC',
  INITIATIVE = 'INITIATIVE',
}

export enum ContextScope {
  ORGANIZATION = 'ORGANIZATION',
  PROJECT = 'PROJECT',
  CONVERSATION = 'CONVERSATION',
}

export interface ContextRequest {
  type: ContextType;
  scope: ContextScope;
  organizationId: OrganizationId;
  projectId: ProjectId;
  conversationId?: ConversationId;
  initiativeId?: InitiativeId;
  searchQuery?: string;
  maxTokens?: number;
  maxResults?: number;
  priority?: number;
  correlationId?: string;
  artifactTypes?: string[];
  authContext?: ContextAuthContext;
}

export interface ContextFilters {
  tags?: string[];
  categories?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  excludeArtifactIds?: string[];
}
