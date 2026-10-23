import type { SecondaryActionConfigPresentationEnum } from "../../api";
import type {
  SecondaryActionAvailability,
  SecondaryActionHandlerKey,
  SecondaryActionSubmitOptions,
} from "./Registry/types";

export interface SecondAction {
  type: "skip" | "field_action" | "custom";
  label: string;
  onExecute: (
    formValues: Record<string, FormValue>,
    options?: SecondaryActionSubmitOptions,
  ) => void;
  submitsForm: boolean;
  disabled?: boolean;
  /**
   * Optional predicate evaluated against the live form values to decide
   * whether the action button should be disabled. Lets registry behaviors
   * gate actions (e.g. "Continue revising" until feedback is non-empty).
   */
  getAvailability?: (
    formValues: Record<string, FormValue>,
  ) => SecondaryActionAvailability;
  /** Registry-owned rendering for domain-specific secondary-action UX. */
  render?: (
    formValues: Record<string, FormValue>,
    renderState: SecondActionRenderState,
  ) => React.ReactNode;
  /** Internal metadata used to route field keyboard submits to the typed action. */
  handler?: SecondaryActionHandlerKey;
  fieldId?: string | null;
  variant?: "text" | "outlined" | "contained";
  icon?: React.ReactNode;
  testId?: string;
  presentation: SecondaryActionConfigPresentationEnum;
}

/** Form-owned state a registry-rendered action needs to match default buttons. */
type SecondActionRenderState = {
  /** True while the form's answer or another secondary action is in flight. */
  isSubmissionLocked: boolean;
};

export type FormValue = string | number | object | undefined;
