import type { SearchEntity } from "../../components/AdvancedSearch/types";
import type { RelatedEntityDto } from "../../types/secondaryActions";
import type {
  ConversationResponseDto,
  CreateDesignDocLinkDto,
  CreateSuggestedDesignDocResponseDto,
  DesignDocResponseDto,
  DesignDocParentEntityType,
  EntityType,
  ImplementationHintDto,
  InitiativeResponseDto,
  MessageResponseDto,
  ServiceDto,
  SuggestedActionNextAction,
  TaskPriority,
  TaskResponseDto,
} from "../../api";

export enum ModalType {
  ADVANCED_SEARCH = "advanced_search",
  SUGGESTED_ACTION_TASK = "suggested_action_task",
  CREATE_DOCUMENT = "create_document",
  CREATE_SERVICE = "create_service",
  CREATE_IMPLEMENTATION_HINT = "create_implementation_hint",
  ENTITY_LIST = "entity_list",
  ENTITY_DETAIL = "entity_detail",
  CONFIRMATION = "confirmation",
  FORM = "form",
}

export interface SuggestedActionTaskData {
  name: string;
  description?: string;
  priority: TaskPriority;
  initiativeId: string;
  parentTaskId?: string;
  nextAction: SuggestedActionNextAction;
}

export interface AdvancedSearchModalConfig {
  type: ModalType.ADVANCED_SEARCH;
  organizationId: string;
  projectId?: string;
  defaultQuery?: string;
  defaultEntityTypes?: string[];
  defaultStatuses?: string[];
  allowMultiSelect?: boolean;
  maxResults?: number;
  onSelect: (entities: SearchEntity[]) => void;
  onClose?: () => void;
}

export interface SuggestedActionTaskModalConfig {
  type: ModalType.SUGGESTED_ACTION_TASK;
  organizationId: string;
  projectId: string;
  conversationId?: string;
  actionLabel: string;
  nextAction: SuggestedActionNextAction;
  onSubmit: (data: SuggestedActionTaskData) => void;
}

interface CreateDocumentModalBaseConfig {
  type: ModalType.CREATE_DOCUMENT;
  organizationId: string;
  projectId: string;
  initialTitle?: string;
  initialSummary?: string;
  parentEntityId?: string | null;
  parentEntityType?: DesignDocParentEntityType | null;
  linkedEntity?: CreateDesignDocLinkDto;
  onError?: (error: string) => void;
}

export interface CreateDocumentBlankModalConfig
  extends CreateDocumentModalBaseConfig {
  mode: "blank_doc";
  onSuccess?: (doc: DesignDocResponseDto) => void;
}

export interface CreateDocumentSuggestedModalConfig
  extends CreateDocumentModalBaseConfig {
  mode: "suggested_doc";
  sourceConversationId: string;
  sourceMessageId: string;
  suggestionId: string;
  trigger?: string;
  onSuccess?: (response: CreateSuggestedDesignDocResponseDto) => void;
}

export type CreateDocumentModalConfig =
  | CreateDocumentBlankModalConfig
  | CreateDocumentSuggestedModalConfig;

export interface CreateImplementationHintModalConfig {
  type: ModalType.CREATE_IMPLEMENTATION_HINT;
  organizationId: string;
  serviceId: string;
  onSuccess?: (hint: ImplementationHintDto) => void;
  onError?: (error: string) => void;
}

export interface CreateServiceModalConfig {
  type: ModalType.CREATE_SERVICE;
  organizationId: string;
  projectId: string;
  onSuccess?: (service: ServiceDto) => void;
  onClose?: () => void;
}

export interface EntityListModalConfig {
  type: ModalType.ENTITY_LIST;
  title: string;
  entities: RelatedEntityDto[] | SearchEntity[];
  onSelect?: (entity: RelatedEntityDto | SearchEntity) => void;
  onClose?: () => void;
  showPreview?: boolean;
}

export interface EntityDetailsModalConfig {
  type: ModalType.ENTITY_DETAIL;
  title: string;
  entity:
    | DesignDocResponseDto
    | ConversationResponseDto
    | TaskResponseDto
    | InitiativeResponseDto;
  onClose?: () => void;
}

export interface ConfirmationModalConfig {
  type: ModalType.CONFIRMATION;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "info" | "warning" | "error";
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface FormModalConfig<T = unknown> {
  type: ModalType.FORM;
  title: string;
  formComponent: React.ComponentType<{
    onSubmit: (data: T) => void;
    onCancel: () => void;
  }>;
  onSubmit: (data: T) => void | Promise<void>;
  onClose?: () => void;
}

interface EntityDetailModalBase {
  type: ModalType.ENTITY_DETAIL;
  entityType: EntityType;
  organizationId: string;
  projectId?: string;
  onClose?: () => void;
  onEdit?: () => void;
}

export type EntityDetailModalConfig =
  | (EntityDetailModalBase & {
      source: "entity";
      entity:
        | DesignDocResponseDto
        | ConversationResponseDto
        | TaskResponseDto
        | InitiativeResponseDto
        | MessageResponseDto
        | ServiceDto;
    })
  | (EntityDetailModalBase & {
      source: "lookup";
      entityId: string;
    });

export type ModalConfig =
  | AdvancedSearchModalConfig
  | SuggestedActionTaskModalConfig
  | CreateDocumentModalConfig
  | CreateServiceModalConfig
  | CreateImplementationHintModalConfig
  | EntityListModalConfig
  | ConfirmationModalConfig
  | FormModalConfig
  | EntityDetailModalConfig;
