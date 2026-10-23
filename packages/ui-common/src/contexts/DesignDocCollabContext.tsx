import React, {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";
import type { LexicalComposerContextWithEditor } from "@lexical/react/LexicalComposerContext";
import type { AdrContentApplyPayloadAllOfSections } from "../api";

type ComposerEditor = LexicalComposerContextWithEditor[0];

export interface DesignDocCollabBridge {
  /**
   * Whether live collaboration is available for the current design doc.
   */
  hasCollab: boolean;
  /**
   * Applies suggested sections by routing them through the active
   * collaboration clients. Returns true if every section was applied.
   */
  applySections: (
    sections: AdrContentApplyPayloadAllOfSections[]
  ) => Promise<boolean> | boolean;
  /**
   * Register/unregister a Lexical editor instance for a section so other
   * features (suggestions, diffs) can coordinate with it.
   */
  registerEditor?: (sectionKey: string, editor: ComposerEditor) => void;
  unregisterEditor?: (sectionKey: string, editor: ComposerEditor) => void;
  /**
   * Optional helper to expose the latest markdown for a section.
   */
  getCurrentContent?: (sectionKey: string) => string;
}

const DesignDocCollabContext = createContext<DesignDocCollabBridge | null>(
  null
);

export interface DesignDocCollabProviderProps extends PropsWithChildren {
  value: DesignDocCollabBridge;
}

export const DesignDocCollabProvider: React.FC<
  DesignDocCollabProviderProps
> = ({ value, children }) => (
  <DesignDocCollabContext.Provider value={value}>
    {children}
  </DesignDocCollabContext.Provider>
);

export const useDesignDocCollabBridge = (): DesignDocCollabBridge | null => {
  return useContext(DesignDocCollabContext);
};
