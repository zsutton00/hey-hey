import {
  useDebugContext as useDebugContextBase,
  useDebugActions as useDebugActionsBase,
  useDebugData as useDebugDataBase,
} from "../contexts/DebugContext";

export const useDebugContext = useDebugContextBase;
export const useDebugActions = useDebugActionsBase;
export const useDebugData = useDebugDataBase;

// Convenience hooks for specific functionality
export const useDebugWorkflowId = () => {
  const { setWorkflowId } = useDebugActions();
  const { workflowId } = useDebugData();
  return { workflowId, setWorkflowId };
};

export const useDebugOrganization = () => {
  const { setOrganizationId } = useDebugActions();
  const { organizationId } = useDebugData();
  return { organizationId, setOrganizationId };
};

export const useDebugMessages = () => {
  const { setConversationMessages } = useDebugActions();
  const { conversationMessages } = useDebugData();
  return { conversationMessages, setConversationMessages };
};

export const useDebugPanel = () => {
  const { toggleDebugPanel, showDebugPanel, hideDebugPanel } =
    useDebugActions();
  const { debugPanelVisible } = useDebugData();
  return {
    debugPanelVisible,
    toggleDebugPanel,
    showDebugPanel,
    hideDebugPanel,
  };
};
