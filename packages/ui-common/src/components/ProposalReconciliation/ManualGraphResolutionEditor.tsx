import { useEffect, useState } from "react";
import type {
  ProjectedWorkItemChangeSetResponse,
  WorkItemTypeDefinitionDto,
} from "../../api";
import { useWorkItemGraphDraft } from "../../data/hooks/useWorkItemGraphDraft";
import { WorkItemGraphEditor } from "../shared/WorkItemGraphEditor";

/** The shared graph editor owns typed node, section and relationship editing. */
export function ManualGraphResolutionEditor({
  graph,
  definition,
  childDefinition,
  organizationId,
  projectId,
  disabled,
  onChange,
}: {
  graph: ProjectedWorkItemChangeSetResponse;
  definition: WorkItemTypeDefinitionDto;
  childDefinition: WorkItemTypeDefinitionDto;
  organizationId: string;
  projectId: string;
  disabled: boolean;
  onChange: (graph: ProjectedWorkItemChangeSetResponse) => void;
}) {
  const [input] = useState(() => ({ ...graph, typeDefinition: definition }));
  const draft = useWorkItemGraphDraft(input);
  useEffect(() => {
    if (draft.isDirty) onChange(draft.projectedGraph);
  }, [draft.isDirty, draft.projectedGraph, onChange]);
  return (
    <WorkItemGraphEditor
      draft={draft}
      childTypeDefinition={childDefinition}
      organizationId={organizationId}
      projectId={projectId}
      participation={null}
      disabled={disabled}
    />
  );
}
