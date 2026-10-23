import React, { createContext, useContext, type ReactNode } from "react";

const PreviewPresentationContext = createContext(false);

export const PreviewPresentationProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => (
  <PreviewPresentationContext.Provider value>
    {children}
  </PreviewPresentationContext.Provider>
);

// eslint-disable-next-line react-refresh/only-export-components
export const usePreviewPresentation = (): boolean =>
  useContext(PreviewPresentationContext);
