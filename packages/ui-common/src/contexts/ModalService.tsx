import { useModal } from "./ModalContext";
import { useOrganization } from "./OrganizationContext";
import { ModalType } from "./types/modalTypes";
import type {
  AdvancedSearchModalConfig,
  CreateDocumentBlankModalConfig,
  CreateDocumentSuggestedModalConfig,
  CreateImplementationHintModalConfig,
  CreateServiceModalConfig,
  EntityDetailModalConfig,
  EntityListModalConfig,
  SuggestedActionTaskModalConfig,
} from "./types/modalTypes";

type CreateDocumentModalServiceOptions =
  | Omit<CreateDocumentBlankModalConfig, "type" | "organizationId">
  | Omit<CreateDocumentSuggestedModalConfig, "type" | "organizationId">;

type CreateImplementationHintModalServiceOptions = Omit<
  CreateImplementationHintModalConfig,
  "type" | "organizationId"
>;

type CreateServiceModalServiceOptions = Omit<
  CreateServiceModalConfig,
  "type" | "organizationId"
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface ModalService {
  /**
   * Show advanced search modal with auto-injected organizationId
   */
  showAdvancedSearch: (
    options: Omit<AdvancedSearchModalConfig, "type" | "organizationId">
  ) => void;
  /**
   * Show suggested action task modal with auto-injected organizationId
   */
  showSuggestedActionTask: (
    options: Omit<SuggestedActionTaskModalConfig, "type" | "organizationId">
  ) => void;
  /**
   * Show create document modal with auto-injected organizationId
   */
  showCreateDocument: (options: CreateDocumentModalServiceOptions) => void;
  /**
   * Show create service modal with auto-injected organizationId
   */
  showCreateService: (options: CreateServiceModalServiceOptions) => void;
  /**
   * Show create implementation hint modal with auto-injected organizationId
   */
  createImplementationHint: (
    options: CreateImplementationHintModalServiceOptions
  ) => void;
  /**
   * Show entity list modal
   */
  showEntityDetails: (
    options: DistributiveOmit<EntityDetailModalConfig, "type">
  ) => void;
  /**
   * Show entity list modal
   */
  showEntityList: (options: Omit<EntityListModalConfig, "type">) => void;
  /**
   * Close the currently open modal
   */
  close: () => void;
}

/**
 * Hook providing convenient modal service methods
 *
 * Automatically injects organizationId from OrganizationContext
 * Provides strongly-typed methods for each modal type
 */
export function useModalService(): ModalService | null {
  const modalContext = useModal();
  const { currentOrganization } = useOrganization();

  if (!modalContext) {
    return null;
  }

  return {
    showAdvancedSearch: (
      options: Omit<AdvancedSearchModalConfig, "type" | "organizationId">
    ) => {
      if (!currentOrganization) {
        console.warn("Cannot open advanced search: no current organization");
        return;
      }

      modalContext.openModal({
        type: ModalType.ADVANCED_SEARCH,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    showSuggestedActionTask: (
      options: Omit<SuggestedActionTaskModalConfig, "type" | "organizationId">
    ) => {
      if (!currentOrganization) {
        console.warn("Cannot open modal: no current organization");
        return;
      }

      modalContext.openModal({
        type: ModalType.SUGGESTED_ACTION_TASK,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    showCreateDocument: (options: CreateDocumentModalServiceOptions) => {
      if (!currentOrganization) {
        console.warn("Cannot open modal: no current organization");
        return;
      }

      if (options.mode === "suggested_doc") {
        modalContext.openModal({
          type: ModalType.CREATE_DOCUMENT,
          organizationId: currentOrganization.id,
          ...options,
        });
        return;
      }

      modalContext.openModal({
        type: ModalType.CREATE_DOCUMENT,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    showCreateService: (options: CreateServiceModalServiceOptions) => {
      if (!currentOrganization) {
        console.warn("Cannot open modal: no current organization");
        return;
      }

      modalContext.openModal({
        type: ModalType.CREATE_SERVICE,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    createImplementationHint: (
      options: CreateImplementationHintModalServiceOptions
    ) => {
      if (!currentOrganization) {
        console.warn("Cannot open modal: no current organization");
        return;
      }

      modalContext.openModal({
        type: ModalType.CREATE_IMPLEMENTATION_HINT,
        organizationId: currentOrganization.id,
        ...options,
      });
    },
    showEntityDetails: (
      options: DistributiveOmit<EntityDetailModalConfig, "type">
    ) => {
      modalContext.openModal({
        type: ModalType.ENTITY_DETAIL,
        ...options,
      });
    },
    showEntityList: (options: Omit<EntityListModalConfig, "type">) => {
      modalContext.openModal({
        type: ModalType.ENTITY_LIST,
        ...options,
      });
    },
    close: () => modalContext.closeModal(),
  };
}
