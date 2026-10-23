import type { SupportedDesignDocTemplate } from "../../types/designDocStatus";

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  content?: string;
  icon: React.ReactNode;
  type: SupportedDesignDocTemplate;
}

export type LinkedItemMode =
  | "none"
  | "workItem"
  | "initiative"
  | "task"
  | "design-doc";
