import SearchIcon from "@mui/icons-material/Search";
import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { usePathService } from "../../contexts";
import { useModalService } from "../../contexts/ModalService";
import type { SearchEntity } from "../SmarterTextAreaCard/types";
import type { CapsuleActionRegistration } from "./types";

/**
 * Search button that registers and triggers the search action.
 * Integrates with ActionsCapsule system as a proper action.
 *
 * When clicked, opens the advanced search modal.
 */
export const useSearchAction = (): CapsuleActionRegistration => {
  const location = useLocation();
  const modalService = useModalService();
  const pathService = usePathService();

  const projectId = pathService.extractProjectId(location.pathname);
  const isDisabled = !modalService;

  const handleSelect = useCallback((_: SearchEntity[]): void => {}, []);

  const handleOpenSearch = useCallback((): void => {
    if (!modalService) {
      return;
    }

    modalService.showAdvancedSearch({
      ...(projectId ? { projectId } : {}),
      onSelect: handleSelect,
    });
  }, [handleSelect, modalService, projectId]);

  return {
    id: "search",
    label: "Search",
    icon: SearchIcon,
    behavior: "click",
    actionGroup: "conceptual",
    tier: "site",
    order: 20,
    disabled: isDisabled,
    title: "Search",
    inProgress: false,
    onClick: handleOpenSearch,
  };
};
