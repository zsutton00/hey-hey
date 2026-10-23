import React from "react";
import type { FieldComponentProps } from "./types";

export type AgentHiddenValue = null;

export type AgentHiddenFieldProps = FieldComponentProps<AgentHiddenValue>;

/**
 * `</>` — emitted by EXTERNAL_AGENT workflow nodes (feature-sync
 * analyze/iterate) so the engine receives a well-formed uiElement for
 * promptType dispatch. Renders nothing: the local agent handles the work
 * outside the UI.
 */
export const AgentHiddenField: React.FC<AgentHiddenFieldProps> = () => null;
