import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { PathService } from "../services/webPathService";
import { getPathService } from "../services/webPathService";

const PathServiceContext = createContext<PathService | null>(null);

export interface PathServiceProviderProps {
  children: ReactNode;
  pathService: PathService;
}

export const PathServiceProvider: React.FC<PathServiceProviderProps> = ({
  children,
  pathService,
}) => {
  const contextValue = useMemo(() => pathService, [pathService]);
  return (
    <PathServiceContext.Provider value={contextValue}>
      {children}
    </PathServiceContext.Provider>
  );
};

export const usePathService = (): PathService => {
  const pathService = useContext(PathServiceContext);
  return pathService ?? getPathService();
};

export const useOptionalPathService = (): PathService | null => {
  return useContext(PathServiceContext);
};
