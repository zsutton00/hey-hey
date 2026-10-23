import { createContext } from "react";

export interface MentionEditorContextValue {
  projectId: string;
  organizationId: string;
  navigate: (url: string) => void;
}

export const MentionEditorContext =
  createContext<MentionEditorContextValue | null>(null);
