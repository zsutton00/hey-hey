import type {
  EntityPromptTemplateSyntaxVersion,
  EntityPromptTemplateValidationIssueDto,
} from "../../api";

export interface TemplateSource {
  readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;
  readonly content: string;
}
export type TemplateDraftValidation =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly source: TemplateSource }
  | { readonly status: "valid"; readonly source: TemplateSource }
  | {
      readonly status: "invalid";
      readonly source: TemplateSource;
      readonly issues: readonly EntityPromptTemplateValidationIssueDto[];
    }
  | {
      readonly status: "error";
      readonly source: TemplateSource;
      readonly message: string;
    };
export interface EntityPromptTemplateEditorProps {
  readonly source: TemplateSource;
  readonly readOnly: boolean;
  readonly validation: TemplateDraftValidation;
  readonly onChange: (content: string) => void;
}
