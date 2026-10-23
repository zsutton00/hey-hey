/**
 * TypeScript type definitions for the enhanced i18n composition system
 */

import type { CompositionData } from "./compose";

export type EntityName =
  | "initiative"
  | "task"
  | "project"
  | "artifact"
  | "integration";
export type ActionName = "create" | "edit" | "delete" | "view" | "manage";

export interface ComposeFunction {
  (template: string, data?: CompositionData): string;
}
