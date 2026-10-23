import { useDesignDocCollabBridgeValue } from "../DesignDoc/useDesignDocCollabBridgeValue";

export function useCollabBridgeValue(adrId: string, organizationId: string) {
  return useDesignDocCollabBridgeValue(adrId, organizationId);
}
