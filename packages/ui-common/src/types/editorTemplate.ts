import type { WorkItemTypeSectionDefinition } from "../api";

// Simple skeleton types without external dependency
type SkeletonType = "text" | "button" | "mixed";

export interface EditorTemplate {
  id: string;
  name: string;
  description?: string;
  sections: EditorSection[];
}

export interface EditorSection {
  id: string;
  materializedProposalId?: string;
  kind?: "markdown" | "json" | "html/css" | "structured-mockup";
  definition?: WorkItemTypeSectionDefinition;
  header: {
    text: string;
    level: 1 | 2 | 3;
    editable: boolean; // Headers should typically be false (uneditable)
  };
  // Optional spec/helper text rendered under the section header to explain its scope.
  helperText?: string;
  content: {
    initialText: string;
    placeholder?: string;
    showAsSkeleton?: boolean; // Transform this content into skeleton initially
    skeletonConfig?: SkeletonConfig;
  };
  editable: boolean; // Whether the content area is editable
  required?: boolean; // Whether this section must have content
}

interface SkeletonConfig {
  lines: number;
  type: SkeletonType;
  width: "full" | "partial";
  animated: boolean;
  // Button-specific configuration
  buttonText?: string;
  onReveal?: () => Promise<void>;
  isLoading?: boolean;
  disabled?: boolean;
}
