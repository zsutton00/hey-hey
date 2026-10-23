import React, { createContext, useContext, useMemo } from "react";

/**
 * How visual mentions (Mockups, Diagrams, workflow graphs) present:
 * - card: the shared Visual Artifact Preview card, opening in Preview (default)
 * - inline: the full inline visual with its section switcher
 * - badge: the plain badge, with no preview reads
 * Badge interactions are available in every mode.
 */
export type MentionPresentation = "card" | "inline" | "badge";

export interface MentionExpansionSettings {
  presentation: MentionPresentation;
}

const MentionExpansionContext = createContext<MentionExpansionSettings>({
  presentation: "card",
});

export const MentionExpansionProvider: React.FC<
  MentionExpansionSettings & { children: React.ReactNode }
> = ({ presentation, children }) => {
  const value = useMemo(() => ({ presentation }), [presentation]);
  return (
    <MentionExpansionContext.Provider value={value}>
      {children}
    </MentionExpansionContext.Provider>
  );
};

export const useMentionExpansion = (): MentionExpansionSettings =>
  useContext(MentionExpansionContext);
