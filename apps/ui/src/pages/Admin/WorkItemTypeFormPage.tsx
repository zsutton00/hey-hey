import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import {
  extractProposalApprovalFailureDiagnostic,
  ProposalFailureDiagnostic,
} from "@hey-hey/ui-common/components/ProposalDispatchers/ProposalFailureDiagnostic";
import {
  analyzeWorkItemTypeEdit,
  getCascadeImpactConflict,
  resolveWorkItemTypeKey,
  useArchiveWorkItemType,
  useCreateWorkItemType,
  useEditWorkItemType,
  useHardDeleteWorkItemType,
  useProject,
  useResetWorkItemType,
  useWorkItemTypeCascadeImpact,
  useWorkItemTypeSectionContentImpact,
  useWorkItemTypeTrackingLinkRevocationImpact,
  useWorkItemTypeByKey,
  useWorkItemTypeRelationshipIndex,
  useWorkItemTypes,
} from "@hey-hey/ui-common/data";
import {
  projectCapabilitiesForRole,
  useUserIdentity,
} from "@hey-hey/ui-common/hooks";
import {
  AgentEdgeType,
  SessionRole,
  EntityType,
  ReportType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeScalarField,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  WorkStatus,
} from "@hey-hey/ui-common/api";
import type {
  ProposalApprovalFailureDiagnostic,
  ProposalResponseDto,
  WorkItemIconKey,
  WorkItemColorKey,
  WorkItemTypeDefinitionDto,
  WorkItemTypeCascadeImpactDto,
  WorkItemTypeEdgeTarget,
  WorkItemTypeSectionDefinition,
  WorkItemTypeSummaryDto,
  WorkItemTypeTracking,
  WorkItemTypeWritingStandards,
  WorkItemTypeSessionRoleGuidance,
} from "@hey-hey/ui-common/api";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import {
  getErrorMessage,
  resolveWorkItemIcon,
  resolveWorkItemIconPresentation,
} from "@hey-hey/ui-common/utils";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { PageBreadcrumbs } from "../../components/Layout";
import { proposalReviewPath } from "../Proposals/proposalReviewPath";
import {
  ALL_EDGE_TARGET_TYPES,
  WORK_ITEM_TYPE_FIELD_PRESENTATION,
  formatCapabilityKey,
  hydrateEdgeTargetSelection,
  reduceEdgeTargetSelection,
  serializeEdgeTargetSelection,
} from "./workItemTypeFormPresentation";
import type { EdgeTargetSelectionValue } from "./workItemTypeFormPresentation";

interface SectionRow {
  key: string;
  label: string;
  writingStandard: string;
  sourceDefinition: WorkItemTypeSectionDefinition | null;
  writingStandardEdited: boolean;
}

/**
 * Per-field membership over the closed scalar set: an item of this type must
 * carry the field (required), may not carry it (forbidden), or may optionally
 * carry it (optional). The required/forbidden lists submitted in the definition
 * are derived from this.
 */
type ScalarMembership = "optional" | "required" | "forbidden";

interface EdgeTargetRow {
  edgeType: AgentEdgeType;
  targetTypeKeys: EdgeTargetSelectionValue[];
}

interface CapabilityRow {
  key: string;
  value: boolean;
}

const FORM_TABS = [
  "Overview",
  "Content",
  "Lifecycle",
  "Relationships",
  "Capabilities",
  "Agent guidance",
] as const;
type FormTab = (typeof FORM_TABS)[number];

const WORK_STATUS_VALUES = Object.values(WorkStatus);
const EDGE_TYPE_VALUES = Object.values(AgentEdgeType);
const SCALAR_FIELDS = Object.values(WorkItemTypeScalarField);
const ENTITY_TYPE_VALUES = Object.values(EntityType);
const REPORT_TYPE_VALUES = Object.values(ReportType);

const WORK_ITEM_ICON_LABELS: Record<WorkItemIconKey, string> = {
  task: "Task",
  bug: "Bug",
  feature: "Feature",
  goal: "Goal",
  contract: "Contract",
  design: "Design doc",
  decision: "Decision",
  workflow: "Diagram",
  plan: "Plan",
  "plan-stage": "Plan stage",
  star: "Star",
  flag: "Flag",
  folder: "Folder",
  book: "Book",
  lightbulb: "Lightbulb",
  science: "Science",
  code: "Code",
  database: "Database",
  link: "Link",
  people: "People",
  chat: "Chat",
  calendar: "Calendar",
  timer: "Timer",
  chart: "Chart",
  shield: "Shield",
};
const WORK_ITEM_COLOR_LABELS: Record<WorkItemColorKey, string> = {
  primary: "Blue",
  secondary: "Purple",
  success: "Green",
  warning: "Amber",
  error: "Red",
  info: "Gray",
};
const WORK_ITEM_COLOR_KEYS = Object.keys(
  WORK_ITEM_COLOR_LABELS,
) as WorkItemColorKey[];

const WORK_ITEM_ICON_KEYS = Object.keys(
  WORK_ITEM_ICON_LABELS,
) as WorkItemIconKey[];

const isWorkItemIconKey = (value: string): value is WorkItemIconKey =>
  Object.prototype.hasOwnProperty.call(WORK_ITEM_ICON_LABELS, value);

const resolveWorkItemIconPreview = (iconKey: WorkItemIconKey) =>
  resolveWorkItemIcon("ICON_PREVIEW", {
    key: "ICON_PREVIEW",
    name: "Icon preview",
    role: WorkItemTypeRole.WorkItem,
    sections: [],
    allowedStatuses: [],
    iconKey,
  });

const hasCanonicalOverride = (
  summary: WorkItemTypeSummaryDto | undefined,
): boolean =>
  summary?.effectiveSource === WorkItemTypeEffectiveSource.CanonicalOverride;

interface WorkItemTypeTemplateMetadata {
  canonicalTemplateKey: string | null;
  acceptedTemplateRevision: number | null;
  latestAvailableTemplateRevision: number | null;
}

/**
 * The work-item-type endpoints document template provenance in their response
 * shape, but older generated clients do not expose those properties on
 * WorkItemTypeSummaryDto. Read the documented projection defensively and fail
 * closed when a response does not carry the complete metadata set.
 */
const getWorkItemTypeTemplateMetadata = (
  summary: WorkItemTypeSummaryDto | undefined,
): WorkItemTypeTemplateMetadata | null => {
  if (
    !summary ||
    !("canonicalTemplateKey" in summary) ||
    !("acceptedTemplateRevision" in summary) ||
    !("latestAvailableTemplateRevision" in summary)
  ) {
    return null;
  }

  const {
    canonicalTemplateKey,
    acceptedTemplateRevision,
    latestAvailableTemplateRevision,
  } = summary;

  if (
    (typeof canonicalTemplateKey !== "string" &&
      canonicalTemplateKey !== null) ||
    (typeof acceptedTemplateRevision !== "number" &&
      acceptedTemplateRevision !== null) ||
    (typeof latestAvailableTemplateRevision !== "number" &&
      latestAvailableTemplateRevision !== null)
  ) {
    return null;
  }

  return {
    canonicalTemplateKey,
    acceptedTemplateRevision,
    latestAvailableTemplateRevision,
  };
};

const hasNewerCanonicalRevision = (
  metadata: WorkItemTypeTemplateMetadata | null,
): boolean =>
  typeof metadata?.canonicalTemplateKey === "string" &&
  metadata.canonicalTemplateKey.trim().length > 0 &&
  typeof metadata.acceptedTemplateRevision === "number" &&
  typeof metadata.latestAvailableTemplateRevision === "number" &&
  metadata.latestAvailableTemplateRevision > metadata.acceptedTemplateRevision;

const hasOwnDefinitionField = (
  definition: WorkItemTypeDefinitionDto,
  field: keyof WorkItemTypeDefinitionDto,
): boolean => Object.prototype.hasOwnProperty.call(definition, field);

const withRequiredTaskParentEntityType = (
  parentTypeKeys: readonly string[],
  parentEntityTypes: readonly EntityType[],
): EntityType[] =>
  parentTypeKeys.length > 0 && !parentEntityTypes.includes(EntityType.Task)
    ? [...parentEntityTypes, EntityType.Task]
    : [...parentEntityTypes];

function emptySection(): SectionRow {
  return {
    key: "",
    label: "",
    writingStandard: "",
    sourceDefinition: null,
    writingStandardEdited: false,
  };
}

function emptyEdgeTarget(): EdgeTargetRow {
  return {
    edgeType: AgentEdgeType.RelatedTo,
    targetTypeKeys: hydrateEdgeTargetSelection([]),
  };
}

export const WorkItemTypeFormPage: React.FC = () => {
  const { projectId, typeKey } = useParams<{
    projectId: string;
    typeKey: string;
  }>();
  const { currentOrgId } = useUserIdentity() || {};
  const navigate = useNavigate();
  const isEditMode = Boolean(typeKey);
  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: Boolean(currentOrgId && projectId),
    preferStale: true,
  });

  const allTypesQuery = useWorkItemTypeRelationshipIndex(
    currentOrgId,
    projectId,
  );
  const activeTypesQuery = useWorkItemTypes(currentOrgId, {
    projectId,
    status: WorkItemTypeLifecycleStatus.Active,
  });
  const { workItemTypes, isLoading: allTypesLoading } = allTypesQuery;
  const { workItemTypes: activeWorkItemTypes, isLoading: activeTypesLoading } =
    activeTypesQuery;
  const typesLoading = allTypesLoading || activeTypesLoading;
  const trackingSourceOptionsLoading =
    allTypesQuery.isLoading || allTypesQuery.isFetching;
  const trackingSourceOptionsUnavailable =
    !trackingSourceOptionsLoading && !allTypesQuery.isReady;
  const trackingSourceTypeOptions = useMemo(
    () => allTypesQuery.relationshipIndex?.getTrackingSourceTypes() ?? [],
    [allTypesQuery.relationshipIndex],
  );
  const summaryQuery = useWorkItemTypeByKey(currentOrgId, projectId, typeKey);
  const {
    workItemTypeSummary,
    isLoading: summaryLoading,
    error: summaryError,
  } = summaryQuery;

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkItemTypeRole>(WorkItemTypeRole.WorkItem);
  const [description, setDescription] = useState("");
  const [colorKey, setColorKey] = useState<WorkItemColorKey | "">("");
  const canEditColor =
    !isEditMode ||
    workItemTypeSummary?.effectiveSource ===
      WorkItemTypeEffectiveSource.ProjectCustom;
  const [iconKey, setIconKey] = useState<WorkItemIconKey | "">("");
  const [sections, setSections] = useState<SectionRow[]>([emptySection()]);
  const [scalarMembership, setScalarMembership] = useState<
    Record<string, ScalarMembership>
  >({});
  const [allowedStatuses, setAllowedStatuses] = useState<WorkStatus[]>([]);
  const [allowedParentTypes, setAllowedParentTypes] = useState<string[]>([]);
  const [edgeTargets, setEdgeTargets] = useState<EdgeTargetRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([]);
  const [newCapabilityKey, setNewCapabilityKey] = useState("");
  const [allowedParentEntityTypes, setAllowedParentEntityTypes] = useState<
    EntityType[]
  >([]);
  const [agentSettableStatuses, setAgentSettableStatuses] = useState<
    WorkStatus[]
  >([]);
  const [anchorableReportTypes, setAnchorableReportTypes] = useState<
    ReportType[]
  >([]);
  const [trackingSourceTaskTypes, setTrackingSourceTaskTypes] = useState<
    string[]
  >([]);
  const [writingStandardCreate, setWritingStandardCreate] = useState("");
  const [writingStandardEdit, setWritingStandardEdit] = useState("");
  const [maintenanceGuidance, setMaintenanceGuidance] = useState("");
  const [sessionRoleGuidance, setSessionRoleGuidance] = useState<
    WorkItemTypeSessionRoleGuidance | undefined
  >();

  const [failureDiagnostic, setFailureDiagnostic] =
    useState<ProposalApprovalFailureDiagnostic>();
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FormTab>("Overview");
  const [errorTarget, setErrorTarget] = useState<{
    tab: FormTab;
    selector: string;
  } | null>(null);
  const [createdProposal, setCreatedProposal] =
    useState<ProposalResponseDto | null>(null);
  const [impactConfirmed, setImpactConfirmed] = useState(false);
  const [pendingCanonicalDefinition, setPendingCanonicalDefinition] =
    useState<WorkItemTypeDefinitionDto | null>(null);
  const [hardDeleteOpen, setHardDeleteOpen, hardDeleteOpenOwnerKey] =
    useModalState(false);
  const [hardDeleteConfirmation, setHardDeleteConfirmation] = useState("");
  const [cascadeImpactOverride, setCascadeImpactOverride] =
    useState<WorkItemTypeCascadeImpactDto | null>(null);

  useEffect(() => {
    if (errorTarget?.tab === activeTab) {
      document.querySelector<HTMLElement>(errorTarget.selector)?.focus();
    }
  }, [activeTab, errorTarget]);

  const showFieldError = (
    message: string,
    tab: FormTab,
    selector: string,
  ): void => {
    setError(message);
    setErrorTarget({ tab, selector });
    setActiveTab(tab);
  };

  useEffect(() => {
    if (!workItemTypeSummary) return;

    const definition = workItemTypeSummary.definition;
    setKey(definition.key);
    setName(definition.name);
    setRole(definition.role);
    setDescription(definition.description ?? "");
    setIconKey(definition.iconKey ?? "");
    setColorKey(definition.colorKey ?? "");
    setSections(
      definition.sections.map((section) => ({
        key: section.key,
        label: section.label,
        writingStandard: section.writingStandard ?? "",
        sourceDefinition: section,
        writingStandardEdited: false,
      })),
    );
    setScalarMembership(() => {
      const membership: Record<string, ScalarMembership> = {};
      for (const field of definition.requiredScalars ?? []) {
        membership[field] = "required";
      }
      for (const field of definition.forbiddenScalars ?? []) {
        membership[field] = "forbidden";
      }
      return membership;
    });
    setAllowedStatuses(definition.allowedStatuses);
    const sourceAllowedParentTypes = definition.allowedParentTypes ?? [];
    setAllowedParentTypes(sourceAllowedParentTypes);
    setEdgeTargets(
      (definition.edgeTargets ?? []).map((target) => ({
        edgeType: target.edgeType,
        targetTypeKeys: hydrateEdgeTargetSelection(target.targetTypeKeys),
      })),
    );
    setAllowedParentEntityTypes(
      withRequiredTaskParentEntityType(
        sourceAllowedParentTypes,
        definition.allowedParentEntityTypes ?? [],
      ),
    );
    setAgentSettableStatuses(definition.agentSettableStatuses ?? []);
    setAnchorableReportTypes(definition.anchorableReportTypes ?? []);
    setTrackingSourceTaskTypes(
      definition.tracking?.allowedSourceTaskTypes ?? [],
    );
    setWritingStandardCreate(definition.writingStandards?.create ?? "");
    setWritingStandardEdit(definition.writingStandards?.edit ?? "");
    setMaintenanceGuidance(definition.maintenanceGuidance ?? "");
    setSessionRoleGuidance(definition.sessionRoleGuidance);
    setCapabilities(
      Object.entries(definition.capabilities ?? {}).flatMap(
        ([capabilityKey, value]) =>
          typeof value === "boolean" ? [{ key: capabilityKey, value }] : [],
      ),
    );
  }, [workItemTypeSummary]);

  const normalizedKey = key.trim().toUpperCase();
  const resolvedKey = resolveWorkItemTypeKey(
    isEditMode ? workItemTypeSummary : undefined,
    key,
  );

  // All type keys still drive collision checks because archived definitions
  // retain their identity. Selectable relationships come only from active types.
  const existingKeys = useMemo(
    () => workItemTypes.map((t) => t.definition.key),
    [workItemTypes],
  );
  const typeKeyOptions = useMemo(() => {
    const set = new Set(activeWorkItemTypes.map((type) => type.definition.key));
    if (resolvedKey) set.add(resolvedKey);
    return Array.from(set).sort();
  }, [activeWorkItemTypes, resolvedKey]);

  // Seed the capability toggles from whatever capabilities existing types
  // declare, so the form mirrors the switches in use without hardcoding them.
  const discoveredCapabilityKeys = useMemo(() => {
    const set = new Set<string>();
    for (const t of workItemTypes) {
      for (const [capKey, value] of Object.entries(
        t.definition.capabilities ?? {},
      )) {
        if (typeof value === "boolean") set.add(capKey);
      }
    }
    return Array.from(set).sort();
  }, [workItemTypes]);

  // Merge discovered capability keys with any the admin added manually.
  const capabilityRows = useMemo<CapabilityRow[]>(() => {
    const byKey = new Map(capabilities.map((c) => [c.key, c.value]));
    const merged: CapabilityRow[] = discoveredCapabilityKeys.map((capKey) => ({
      key: capKey,
      value: byKey.get(capKey) ?? false,
    }));
    for (const c of capabilities) {
      if (!discoveredCapabilityKeys.includes(c.key)) merged.push(c);
    }
    return merged;
  }, [capabilities, discoveredCapabilityKeys]);

  const keyCollision =
    !isEditMode &&
    normalizedKey.length > 0 &&
    existingKeys.includes(normalizedKey);

  const hasProjectOwnership = Boolean(
    isEditMode &&
    projectId?.trim() &&
    workItemTypeSummary?.projectId === projectId,
  );
  const isArchived = Boolean(
    hasProjectOwnership &&
    workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Archived,
  );
  const canEditDefinition = Boolean(
    hasProjectOwnership &&
    workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Active,
  );
  const canResetToCanonical = Boolean(
    hasProjectOwnership &&
    (workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Active ||
      workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Archived) &&
    hasCanonicalOverride(workItemTypeSummary),
  );
  const templateMetadata = getWorkItemTypeTemplateMetadata(workItemTypeSummary);
  const canReviewTemplateUpdate = Boolean(
    hasProjectOwnership &&
    (workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Active ||
      workItemTypeSummary?.status === WorkItemTypeLifecycleStatus.Archived) &&
    hasNewerCanonicalRevision(templateMetadata),
  );
  const { manageWorkItemTypes } = projectCapabilitiesForRole(
    project?.currentUserRole ?? null,
  );
  const isReadOnly = !manageWorkItemTypes || (isEditMode && !canEditDefinition);
  const handleDefinitionMutationSuccess = (proposal: ProposalResponseDto) => {
    setCreatedProposal(proposal);

    const refreshes: Promise<unknown>[] = [];
    if (allTypesQuery.refetch) refreshes.push(allTypesQuery.refetch());
    if (activeTypesQuery.refetch) refreshes.push(activeTypesQuery.refetch());
    if (typeKey && summaryQuery.refetch) {
      refreshes.push(summaryQuery.refetch());
    }
    void Promise.all(refreshes).catch(() => {
      setError(
        "The proposal was created, but the latest definition could not be refreshed.",
      );
    });
  };
  const handleReviewMutationSuccess = (proposal: ProposalResponseDto) => {
    navigate(proposalReviewPath(proposal.projectId, proposal));
  };
  const handleMutationError = (err: Error) => {
    setCreatedProposal(null);
    setError(getErrorMessage(err, "Failed to submit the type definition."));
    const diagnostic = extractProposalApprovalFailureDiagnostic(err);
    setFailureDiagnostic(diagnostic);
    if (
      diagnostic?.issues.some((issue) =>
        issue.field.includes("sessionRoleGuidance"),
      )
    ) {
      setActiveTab("Agent guidance");
    }
  };

  const createMutation = useCreateWorkItemType({
    onSuccess: handleDefinitionMutationSuccess,
    onError: handleMutationError,
  });
  const editMutation = useEditWorkItemType({
    onSuccess: handleDefinitionMutationSuccess,
    onError: handleMutationError,
  });
  const archiveMutation = useArchiveWorkItemType({
    onSuccess: handleReviewMutationSuccess,
    onError: handleMutationError,
  });
  const resetMutation = useResetWorkItemType({
    onSuccess: handleReviewMutationSuccess,
    onError: handleMutationError,
  });
  const hardDeleteMutation = useHardDeleteWorkItemType({
    onSuccess: handleReviewMutationSuccess,
    onError: (err) => {
      const currentImpact = getCascadeImpactConflict(err);
      if (currentImpact) {
        setCascadeImpactOverride(currentImpact);
        setHardDeleteConfirmation("");
        setError(
          "The removal impact changed. Confirm the updated counts before trying again.",
        );
        return;
      }
      handleMutationError(err);
    },
  });
  const isPending =
    createMutation.isPending ||
    editMutation.isPending ||
    archiveMutation.isPending ||
    resetMutation.isPending ||
    hardDeleteMutation.isPending;

  const cascadeImpact = useWorkItemTypeCascadeImpact(
    currentOrgId,
    projectId,
    resolvedKey || undefined,
    hardDeleteOpen,
  );
  const displayedCascadeImpact = cascadeImpactOverride ?? cascadeImpact.data;
  const hardDeleteConfirmationText = displayedCascadeImpact
    ? `DELETE ${displayedCascadeImpact.itemCount} ITEMS AND ${displayedCascadeImpact.edgeCount} EDGES`
    : "";
  const hardDeleteHasContext = Boolean(
    currentOrgId && projectId && resolvedKey,
  );
  const canHardDelete = Boolean(
    isArchived &&
    (workItemTypeSummary?.effectiveSource ===
      WorkItemTypeEffectiveSource.ProjectCustom ||
      templateMetadata?.canonicalTemplateKey === null),
  );
  const hardDeleteUnavailable =
    !hardDeleteHasContext || !canHardDelete || isPending;
  const hardDeleteImpactUnavailable =
    (!cascadeImpactOverride &&
      (cascadeImpact.isLoading ||
        cascadeImpact.isFetching ||
        Boolean(cascadeImpact.error) ||
        cascadeImpact.isStale)) ||
    !displayedCascadeImpact;
  const hardDeleteConfirmationMatches =
    Boolean(hardDeleteConfirmationText) &&
    hardDeleteConfirmation === hardDeleteConfirmationText;

  const setCapabilityValue = (capKey: string, value: boolean): void => {
    setCapabilities((prev) => {
      const next = prev.filter((c) => c.key !== capKey);
      next.push({ key: capKey, value });
      return next;
    });
  };

  const handleAddCapability = (): void => {
    const capKey = newCapabilityKey.trim();
    if (!capKey) return;
    setCapabilityValue(capKey, true);
    setNewCapabilityKey("");
  };

  const buildDefinition = useCallback((): WorkItemTypeDefinitionDto => {
    const sectionDtos: WorkItemTypeSectionDefinition[] = sections
      .filter((s) => s.key.trim() || s.label.trim())
      .map((s) => {
        const sourceWritingStandard = s.sourceDefinition?.writingStandard ?? "";
        const authoredWritingStandard =
          !s.sourceDefinition ||
          (s.writingStandardEdited &&
            s.writingStandard !== sourceWritingStandard)
            ? { writingStandard: s.writingStandard.trim() || null }
            : {};

        return {
          ...s.sourceDefinition,
          key:
            s.sourceDefinition && s.key === s.sourceDefinition.key
              ? s.sourceDefinition.key
              : s.key.trim(),
          label:
            s.sourceDefinition && s.label === s.sourceDefinition.label
              ? s.sourceDefinition.label
              : s.label.trim(),
          ...authoredWritingStandard,
        };
      });

    const requiredScalars = SCALAR_FIELDS.filter(
      (field) => scalarMembership[field] === "required",
    );
    const forbiddenScalars = SCALAR_FIELDS.filter(
      (field) => scalarMembership[field] === "forbidden",
    );
    const normalizedAllowedParentEntityTypes = withRequiredTaskParentEntityType(
      allowedParentTypes,
      allowedParentEntityTypes,
    );

    const edgeTargetDtos: WorkItemTypeEdgeTarget[] = edgeTargets.map((e) => ({
      edgeType: e.edgeType,
      targetTypeKeys: serializeEdgeTargetSelection(e.targetTypeKeys),
    }));

    const authoredCapabilities = capabilities.reduce<{ [k: string]: boolean }>(
      (acc, c) => {
        acc[c.key] = c.value;
        return acc;
      },
      {},
    );

    const tracking: WorkItemTypeTracking = {
      allowedSourceEntityTypes:
        trackingSourceTaskTypes.length > 0 ? [EntityType.Task] : [],
      allowedSourceTaskTypes: trackingSourceTaskTypes,
    };

    const trimmedCreateStandard = writingStandardCreate.trim();
    const trimmedEditStandard = writingStandardEdit.trim();
    const writingStandards: WorkItemTypeWritingStandards | null =
      trimmedCreateStandard || trimmedEditStandard
        ? { create: trimmedCreateStandard, edit: trimmedEditStandard }
        : null;

    const authoredDefinition: WorkItemTypeDefinitionDto = {
      key: resolvedKey,
      name: name.trim(),
      role,
      ...(iconKey ? { iconKey } : {}),
      ...(canEditColor && colorKey ? { colorKey } : {}),
      description: description.trim() || null,
      sections: sectionDtos,
      requiredScalars,
      forbiddenScalars,
      allowedStatuses,
      allowedParentTypes,
      edgeTargets: edgeTargetDtos,
      allowedParentEntityTypes: normalizedAllowedParentEntityTypes,
      tracking,
      agentSettableStatuses,
      anchorableReportTypes,
      writingStandards,
      ...(maintenanceGuidance.trim()
        ? { maintenanceGuidance: maintenanceGuidance.trim() }
        : {}),
      ...(sessionRoleGuidance === undefined ? {} : { sessionRoleGuidance }),
      capabilities: authoredCapabilities,
    };

    if (!isEditMode || !workItemTypeSummary) {
      return authoredDefinition;
    }

    const source = workItemTypeSummary.definition;
    const sourceWithoutIconKey = { ...source };
    delete sourceWithoutIconKey.iconKey;
    delete sourceWithoutIconKey.colorKey;
    delete sourceWithoutIconKey.sessionRoleGuidance;
    const sourceDescription = source.description ?? "";
    const sourceCreateStandard = source.writingStandards?.create ?? "";
    const sourceEditStandard = source.writingStandards?.edit ?? "";
    const editedWritingStandards =
      writingStandardCreate === sourceCreateStandard &&
      writingStandardEdit === sourceEditStandard
        ? source.writingStandards
        : writingStandards;
    const capabilitiesMap = {
      ...(source.capabilities ?? {}),
      ...authoredCapabilities,
    };
    return {
      ...sourceWithoutIconKey,
      ...(sessionRoleGuidance === undefined ? {} : { sessionRoleGuidance }),
      key: resolvedKey,
      name: name === source.name ? source.name : name.trim(),
      role,
      ...(iconKey ? { iconKey } : {}),
      ...(canEditColor && colorKey ? { colorKey } : {}),
      sections: sectionDtos,
      allowedStatuses,
      ...(hasOwnDefinitionField(source, "description") ||
      description !== sourceDescription
        ? {
            description:
              description === sourceDescription
                ? source.description
                : description.trim() || null,
          }
        : {}),
      ...(hasOwnDefinitionField(source, "requiredScalars") ||
      requiredScalars.length > 0
        ? { requiredScalars }
        : {}),
      ...(hasOwnDefinitionField(source, "forbiddenScalars") ||
      forbiddenScalars.length > 0
        ? { forbiddenScalars }
        : {}),
      ...(hasOwnDefinitionField(source, "allowedParentTypes") ||
      allowedParentTypes.length > 0
        ? { allowedParentTypes }
        : {}),
      ...(hasOwnDefinitionField(source, "edgeTargets") ||
      edgeTargetDtos.length > 0
        ? { edgeTargets: edgeTargetDtos }
        : {}),
      ...(hasOwnDefinitionField(source, "allowedParentEntityTypes") ||
      normalizedAllowedParentEntityTypes.length > 0
        ? { allowedParentEntityTypes: normalizedAllowedParentEntityTypes }
        : {}),
      ...(hasOwnDefinitionField(source, "tracking") ||
      trackingSourceTaskTypes.length > 0
        ? { tracking }
        : {}),
      ...(hasOwnDefinitionField(source, "agentSettableStatuses") ||
      agentSettableStatuses.length > 0
        ? { agentSettableStatuses }
        : {}),
      ...(hasOwnDefinitionField(source, "anchorableReportTypes") ||
      anchorableReportTypes.length > 0
        ? { anchorableReportTypes }
        : {}),
      ...(hasOwnDefinitionField(source, "writingStandards") ||
      editedWritingStandards
        ? { writingStandards: editedWritingStandards }
        : {}),
      ...(maintenanceGuidance === (source.maintenanceGuidance ?? "")
        ? {}
        : { maintenanceGuidance: maintenanceGuidance.trim() || undefined }),
      ...(hasOwnDefinitionField(source, "capabilities") ||
      Object.keys(capabilitiesMap).length > 0
        ? { capabilities: capabilitiesMap }
        : {}),
    };
  }, [
    allowedParentEntityTypes,
    allowedParentTypes,
    allowedStatuses,
    agentSettableStatuses,
    anchorableReportTypes,
    capabilities,
    description,
    edgeTargets,
    iconKey,
    colorKey,
    canEditColor,
    isEditMode,
    name,
    maintenanceGuidance,
    sessionRoleGuidance,
    resolvedKey,
    role,
    scalarMembership,
    sections,
    trackingSourceTaskTypes,
    workItemTypeSummary,
    writingStandardCreate,
    writingStandardEdit,
  ]);

  // Live impact concerns structural edits. Guidance stays local to its editor
  // and is merged into the complete definition when the form is submitted.
  const draftDefinition = useMemo(() => buildDefinition(), [buildDefinition]);

  const editImpact = useMemo(
    () =>
      analyzeWorkItemTypeEdit(
        isEditMode ? workItemTypeSummary : undefined,
        draftDefinition,
      ),
    [draftDefinition, isEditMode, workItemTypeSummary],
  );

  const hasUnsupportedDefinition = editImpact.kind === "unsupported";
  const explorerSidebarCapabilityConflictReason =
    editImpact.unsupportedReasonCodes.flatMap((code, index) =>
      code === "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR"
        ? [editImpact.unsupportedReasons[index]]
        : [],
    )[0] ?? null;
  const globalUnsupportedReasons = editImpact.unsupportedReasons.filter(
    (_reason, index) =>
      editImpact.unsupportedReasonCodes[index] !==
      "REQUIRES_PARENT_CANNOT_SHOW_IN_EXPLORER_SIDEBAR",
  );
  const hasSupportedDestructiveEdit =
    isEditMode && editImpact.requiresConfirmation;

  const sectionImpact = useWorkItemTypeSectionContentImpact(
    currentOrgId,
    projectId,
    resolvedKey || undefined,
    editImpact.removedSectionKeys,
    {
      enabled:
        hasSupportedDestructiveEdit && editImpact.removedSectionKeys.length > 0,
    },
  );
  const trackingImpact = useWorkItemTypeTrackingLinkRevocationImpact(
    currentOrgId,
    projectId,
    resolvedKey || undefined,
    editImpact.revokedTrackingSourceTypeKeys,
    {
      enabled:
        hasSupportedDestructiveEdit &&
        editImpact.revokedTrackingSourceTypeKeys.length > 0,
    },
  );

  const impactRequestSignature = [
    editImpact.removedSectionKeys.join(","),
    editImpact.revokedTrackingSourceTypeKeys.join(","),
    editImpact.unsupportedReasons.join("|"),
  ].join("::");

  useEffect(() => {
    setImpactConfirmed(false);
  }, [impactRequestSignature]);

  const isImpactLoading =
    (editImpact.removedSectionKeys.length > 0 &&
      (sectionImpact.isLoading || sectionImpact.isFetching)) ||
    (editImpact.revokedTrackingSourceTypeKeys.length > 0 &&
      (trackingImpact.isLoading || trackingImpact.isFetching));
  const hasImpactError = Boolean(sectionImpact.error || trackingImpact.error);
  const blocksSubmitForImpact =
    hasUnsupportedDefinition ||
    hasImpactError ||
    isImpactLoading ||
    (hasSupportedDestructiveEdit && !impactConfirmed);

  const submitEdit = (
    definition: WorkItemTypeDefinitionDto,
    acknowledgeCanonicalCustomization?: boolean,
  ): void => {
    if (!currentOrgId || !projectId || !resolvedKey) return;
    editMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        typeKey: resolvedKey,
        definition,
        ...(acknowledgeCanonicalCustomization === undefined
          ? {}
          : { acknowledgeCanonicalCustomization }),
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const handleCancelCanonicalCustomization = (): void => {
    setPendingCanonicalDefinition(null);
  };

  const handleConfirmCanonicalCustomization = (): void => {
    if (!pendingCanonicalDefinition) return;
    const definition = pendingCanonicalDefinition;
    setPendingCanonicalDefinition(null);
    submitEdit(definition, true);
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setError(null);
    setFailureDiagnostic(undefined);
    setErrorTarget(null);
    setCreatedProposal(null);

    if (!currentOrgId || !projectId) {
      setError("Missing organization or project context.");
      return;
    }
    if (!resolvedKey) {
      showFieldError(
        "A type key is required.",
        "Overview",
        '[data-testid="wit-form-key"] input',
      );
      return;
    }
    if (isReadOnly) {
      setError(
        "This work-item type is not editable in its current lifecycle state.",
      );
      return;
    }
    if (keyCollision) {
      showFieldError(
        `A type with key "${normalizedKey}" already exists.`,
        "Overview",
        '[data-testid="wit-form-key"] input',
      );
      return;
    }
    if (!name.trim()) {
      showFieldError(
        "A display name is required.",
        "Overview",
        '[data-testid="wit-form-name"] input',
      );
      return;
    }
    if (trackingSourceOptionsLoading || trackingSourceOptionsUnavailable) {
      setError(
        "Eligible tracking source types are unavailable. Wait for the project work-item type registry before submitting.",
      );
      return;
    }

    const definition = draftDefinition;
    const submissionImpact = analyzeWorkItemTypeEdit(
      isEditMode ? workItemTypeSummary : undefined,
      definition,
    );
    if (submissionImpact.kind === "unsupported") {
      const reason = submissionImpact.unsupportedReasons.join(" ");
      if (explorerSidebarCapabilityConflictReason) {
        showFieldError(
          reason,
          "Capabilities",
          '[data-testid="wit-form-capabilities"] input',
        );
      } else {
        setError(reason);
      }
      return;
    }
    if (isEditMode && hasImpactError) {
      setError(
        "Could not load edit impact counts. Try again before submitting.",
      );
      return;
    }
    if (isEditMode && isImpactLoading) {
      setError("Edit impact counts are still loading.");
      return;
    }
    if (
      isEditMode &&
      submissionImpact.requiresConfirmation &&
      !impactConfirmed
    ) {
      setError("Confirm the edit impact before submitting.");
      return;
    }

    if (
      isEditMode &&
      workItemTypeSummary?.effectiveSource ===
        WorkItemTypeEffectiveSource.Canonical
    ) {
      setPendingCanonicalDefinition(definition);
      return;
    }

    if (isEditMode) {
      submitEdit(definition);
      return;
    }

    createMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        definition,
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const handleArchive = (): void => {
    setError(null);
    setFailureDiagnostic(undefined);
    if (!currentOrgId || !projectId || !resolvedKey || !canEditDefinition) {
      return;
    }
    archiveMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        typeKey: resolvedKey,
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const handleRestore = (): void => {
    setError(null);
    setFailureDiagnostic(undefined);
    setCreatedProposal(null);
    if (!currentOrgId || !projectId || !isArchived || !workItemTypeSummary) {
      return;
    }

    createMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        // Restoration uses the generated retained definition verbatim rather
        // than rebuilding it from the disabled form controls.
        definition: workItemTypeSummary.definition,
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const handleResetToCanonical = (): void => {
    setError(null);
    setFailureDiagnostic(undefined);
    if (!currentOrgId || !projectId || !resolvedKey || !canResetToCanonical) {
      return;
    }

    resetMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        typeKey: resolvedKey,
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const handleOpenHardDelete = (): void => {
    if (hardDeleteUnavailable) return;
    setError(null);
    setFailureDiagnostic(undefined);
    setHardDeleteConfirmation("");
    setCascadeImpactOverride(null);
    setHardDeleteOpen(true);
  };

  const handleCloseHardDelete = (): void => {
    if (hardDeleteMutation.isPending) return;
    setHardDeleteOpen(false);
    setHardDeleteConfirmation("");
  };

  const handleHardDelete = (): void => {
    setError(null);
    setFailureDiagnostic(undefined);
    if (
      hardDeleteUnavailable ||
      hardDeleteImpactUnavailable ||
      !hardDeleteConfirmationMatches ||
      !displayedCascadeImpact ||
      !currentOrgId ||
      !projectId
    ) {
      return;
    }

    hardDeleteMutation
      .mutate({
        organizationId: currentOrgId,
        projectId,
        typeKey: resolvedKey,
        confirmedItemCount: displayedCascadeImpact.itemCount,
        confirmedEdgeCount: displayedCascadeImpact.edgeCount,
      })
      .catch(() => {
        // onError already records the failure for inline display.
      });
  };

  const renderTypeKeyMultiSelect = (
    label: string,
    options: readonly string[],
    value: string[],
    onChange: (next: string[]) => void,
    testId: string,
    helperText: string,
    disabled = false,
    emptyText = "No existing types",
  ): React.ReactNode => (
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select<string[]>
        multiple
        value={value}
        label={label}
        data-testid={testId}
        disabled={disabled}
        onChange={(e: SelectChangeEvent<string[]>) =>
          onChange(
            typeof e.target.value === "string"
              ? e.target.value.split(",")
              : e.target.value,
          )
        }
        input={<OutlinedInput label={label} />}
        renderValue={(selected: string[]) => (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selected.map((v) => (
              <Chip key={v} label={v} size="small" />
            ))}
          </Box>
        )}
      >
        {options.length === 0 ? (
          <MenuItem disabled value="">
            {emptyText}
          </MenuItem>
        ) : (
          options.map((opt) => (
            <MenuItem key={opt} value={opt}>
              <Checkbox checked={value.includes(opt)} size="small" />
              {opt}
            </MenuItem>
          ))
        )}
      </Select>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
        {helperText}
      </Typography>
    </FormControl>
  );

  const renderEdgeTargetTypeMultiSelect = (
    value: EdgeTargetSelectionValue[],
    onChange: (next: EdgeTargetSelectionValue[]) => void,
    testId: string,
  ): React.ReactNode => {
    const presentation =
      WORK_ITEM_TYPE_FIELD_PRESENTATION["edgeTargets.targetTypeKeys"];

    return (
      <FormControl fullWidth size="small">
        <InputLabel>{presentation.label}</InputLabel>
        <Select<EdgeTargetSelectionValue[]>
          multiple
          value={value}
          label={presentation.label}
          data-testid={testId}
          onChange={(event: SelectChangeEvent<EdgeTargetSelectionValue[]>) => {
            const requested =
              typeof event.target.value === "string"
                ? event.target.value.split(",")
                : event.target.value;
            onChange(reduceEdgeTargetSelection(value, requested));
          }}
          input={<OutlinedInput label={presentation.label} />}
          renderValue={(selected: EdgeTargetSelectionValue[]) => (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {selected.map((selectedValue) => (
                <Chip
                  key={selectedValue}
                  label={
                    selectedValue === ALL_EDGE_TARGET_TYPES
                      ? "All"
                      : selectedValue
                  }
                  size="small"
                />
              ))}
            </Box>
          )}
        >
          <MenuItem value={ALL_EDGE_TARGET_TYPES}>
            <Checkbox
              checked={value.includes(ALL_EDGE_TARGET_TYPES)}
              size="small"
            />
            All
          </MenuItem>
          {typeKeyOptions.map((option) => (
            <MenuItem key={option} value={option}>
              <Checkbox checked={value.includes(option)} size="small" />
              {option}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          {presentation.help}
        </Typography>
      </FormControl>
    );
  };

  const renderEnumMultiSelect = <T extends string>(
    label: string,
    options: T[],
    value: T[],
    onChange: (next: T[]) => void,
    testId: string,
    helperText?: string,
  ): React.ReactNode => (
    <FormControl fullWidth size="small">
      <InputLabel>{label}</InputLabel>
      <Select<T[]>
        multiple
        value={value}
        label={label}
        data-testid={testId}
        onChange={(e: SelectChangeEvent<T[]>) =>
          onChange(
            (typeof e.target.value === "string"
              ? e.target.value.split(",")
              : e.target.value) as T[],
          )
        }
        input={<OutlinedInput label={label} />}
        renderValue={(selected: T[]) => (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selected.map((v) => (
              <Chip key={v} label={v} size="small" />
            ))}
          </Box>
        )}
      >
        {options.length === 0 ? (
          <MenuItem disabled value="">
            No options
          </MenuItem>
        ) : (
          options.map((opt) => (
            <MenuItem key={opt} value={opt}>
              <Checkbox checked={value.includes(opt)} size="small" />
              {opt}
            </MenuItem>
          ))
        )}
      </Select>
      {helperText ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          {helperText}
        </Typography>
      ) : null}
    </FormControl>
  );

  const projectChrome = projectId ? (
    <PageBreadcrumbs
      items={[
        { label: "Projects", to: "/projects" },
        {
          label: project?.name ?? "Project",
          to: `/projects/${projectId}`,
          type: "project",
          entityId: projectId,
        },
        {
          label: "Work Item Types",
          to: `/projects/${projectId}?tab=settings&settingsSubTab=types&typesSubTab=work-item-types`,
        },
        {
          label: isEditMode
            ? name || "Edit work-item type"
            : "Define a work-item type",
          isCurrent: true,
        },
      ]}
    />
  ) : null;

  if (isEditMode && summaryLoading) {
    return (
      <>
        {projectChrome}
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  if (isEditMode && (summaryError || !workItemTypeSummary)) {
    return (
      <>
        {projectChrome}
        <Box sx={{ maxWidth: 880, mx: "auto", p: 3 }}>
          <Alert severity="error" data-testid="wit-form-load-error">
            Failed to load this work-item type.
          </Alert>
        </Box>
      </>
    );
  }

  if (
    isEditMode &&
    (!currentOrgId || !projectId?.trim() || !hasProjectOwnership)
  ) {
    return (
      <>
        {projectChrome}
        <Box sx={{ maxWidth: 880, mx: "auto", p: 3 }}>
          <Alert severity="error" data-testid="wit-form-missing-ownership">
            This work-item type is not owned by the current project, so no
            administration actions are available.
          </Alert>
        </Box>
      </>
    );
  }

  const content = (
    <Box sx={{ maxWidth: 880, mx: "auto", p: 3 }}>
      <Typography variant="h4" gutterBottom>
        {isEditMode ? `Work-item type: ${name}` : "Define a work-item type"}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {isArchived
          ? "This archived type is definition-read-only. Restore it to return it to new-work choices; existing items and history are preserved."
          : isReadOnly
            ? "This work-item type is readable but cannot be edited or archived."
            : "Fill in the type-definition axes and submit. You’ll be taken to the proposal to review and approve it."}
      </Typography>

      {isEditMode &&
      (hasCanonicalOverride(workItemTypeSummary) ||
        Boolean(templateMetadata?.canonicalTemplateKey)) ? (
        <Alert
          severity="info"
          data-testid="wit-form-template-info"
          sx={{ mb: 2 }}
        >
          <AlertTitle>Canonical definition</AlertTitle>
          Canonical changes never overwrite project configuration automatically.
          Review and approval are required before a reset or newer canonical
          revision is applied.
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 1 }}
            useFlexGap
            flexWrap="wrap"
          >
            <Chip
              label={
                templateMetadata?.canonicalTemplateKey
                  ? `Accepted revision: ${
                      templateMetadata.acceptedTemplateRevision ?? "Unknown"
                    }`
                  : "Source: Canonical override"
              }
              size="small"
              variant="outlined"
              data-testid="wit-form-effective-source"
            />
            {templateMetadata?.canonicalTemplateKey ? (
              <Chip
                label={`Latest available revision: ${
                  templateMetadata.latestAvailableTemplateRevision ?? "Unknown"
                }`}
                size="small"
                variant="outlined"
                data-testid="wit-form-latest-template-revision"
              />
            ) : null}
            {canReviewTemplateUpdate ? (
              <Chip
                label="Update available"
                color="warning"
                size="small"
                data-testid="wit-form-template-update-available"
              />
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {isReadOnly ? (
        <Alert severity="info" data-testid="wit-form-read-only" sx={{ mb: 2 }}>
          {isArchived ? "Archived — definition read-only" : "Read-only"}
        </Alert>
      ) : null}

      {error ? (
        <Alert
          severity="error"
          data-testid="wit-form-error"
          sx={{ mb: 2 }}
          onClose={() => setError(null)}
          action={
            errorTarget ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setActiveTab(errorTarget.tab);
                  document
                    .querySelector<HTMLElement>(errorTarget.selector)
                    ?.focus();
                }}
              >
                Go to {errorTarget.tab}
              </Button>
            ) : undefined
          }
        >
          <AlertTitle>Your changes couldn’t be saved</AlertTitle>
          {error}
          <Typography variant="body2" sx={{ mt: 1 }}>
            Your edits are still here across all tabs.
          </Typography>
        </Alert>
      ) : null}

      {error ? (
        <ProposalFailureDiagnostic diagnostic={failureDiagnostic} />
      ) : null}

      {createdProposal ? (
        <Alert
          severity="success"
          data-testid="wit-form-proposal-created"
          sx={{ mb: 2 }}
          action={
            <Button
              component={RouterLink}
              to={proposalReviewPath(
                createdProposal.projectId,
                createdProposal,
              )}
              color="inherit"
              size="small"
              data-testid="wit-form-proposal-link"
            >
              View proposal
            </Button>
          }
        >
          Proposal created. The latest work-item type data is refreshing
          automatically.
        </Alert>
      ) : null}

      {editImpact.guidance ? (
        <Alert
          severity="error"
          data-testid="wit-form-unsupported-impact"
          sx={{ mb: 2 }}
        >
          <AlertTitle>Recreate this type for this edit</AlertTitle>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {editImpact.guidance}
          </Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {globalUnsupportedReasons.map((reason) => (
              <Typography component="li" variant="body2" key={reason}>
                {reason}
              </Typography>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {isEditMode && hasSupportedDestructiveEdit ? (
        <Alert
          severity="warning"
          data-testid="wit-form-edit-impact"
          sx={{ mb: 2 }}
        >
          <AlertTitle>Confirm edit impact</AlertTitle>
          {editImpact.removedSectionKeys.length > 0 ? (
            <Box data-testid="wit-form-section-impact" sx={{ mb: 1 }}>
              <Typography variant="body2">
                Removing sections affects{" "}
                {sectionImpact.data?.totalAffectedItemCount ?? "..."} existing
                items with content in those sections.
              </Typography>
              {sectionImpact.data ? (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                  {sectionImpact.data.sections.map((section) => (
                    <Typography
                      component="li"
                      variant="body2"
                      key={section.sectionKey}
                    >
                      {section.sectionKey}: {section.affectedItemCount} items
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </Box>
          ) : null}
          {editImpact.revokedTrackingSourceTypeKeys.length > 0 ? (
            <Box data-testid="wit-form-tracking-impact" sx={{ mb: 1 }}>
              <Typography variant="body2">
                Revoking tracking sources affects{" "}
                {trackingImpact.data?.totalAffectedLinkCount ?? "..."} existing
                tracking links.
              </Typography>
              {trackingImpact.data ? (
                <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                  {trackingImpact.data.sources.map((source) => (
                    <Typography
                      component="li"
                      variant="body2"
                      key={source.sourceTypeKey}
                    >
                      {source.sourceTypeKey}: {source.affectedLinkCount} links
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </Box>
          ) : null}
          {hasImpactError ? (
            <Typography color="error" variant="body2" sx={{ mb: 1 }}>
              Failed to load edit impact counts.
            </Typography>
          ) : null}
          <FormControlLabel
            control={
              <Checkbox
                checked={impactConfirmed}
                disabled={isImpactLoading || hasImpactError}
                onChange={(event) => setImpactConfirmed(event.target.checked)}
                data-testid="wit-form-impact-confirm"
              />
            }
            label="I understand this edit can orphan existing section content or tracking links."
          />
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} data-testid="wit-form" noValidate>
        <Tabs
          value={activeTab}
          onChange={(_event, value: FormTab) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Work-item type settings"
          sx={{ mb: 2 }}
        >
          {FORM_TABS.map((tab) => (
            <Tab
              key={tab}
              value={tab}
              label={tab}
              id={`wit-tab-${FORM_TABS.indexOf(tab)}`}
              aria-controls={`wit-panel-${FORM_TABS.indexOf(tab)}`}
            />
          ))}
        </Tabs>
        <fieldset
          disabled={isReadOnly || isPending}
          style={{ border: 0, margin: 0, padding: 0 }}
        >
          <Box
            role="tabpanel"
            id="wit-panel-0"
            aria-labelledby="wit-tab-0"
            hidden={activeTab !== "Overview"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                Identity
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label={WORK_ITEM_TYPE_FIELD_PRESENTATION.key.label}
                  required
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  error={keyCollision}
                  helperText={
                    keyCollision
                      ? `A type with key "${normalizedKey}" already exists.`
                      : WORK_ITEM_TYPE_FIELD_PRESENTATION.key.help
                  }
                  size="small"
                  fullWidth
                  data-testid="wit-form-key"
                  disabled={isEditMode}
                />
                <TextField
                  label={WORK_ITEM_TYPE_FIELD_PRESENTATION.name.label}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  size="small"
                  fullWidth
                  data-testid="wit-form-name"
                  helperText={WORK_ITEM_TYPE_FIELD_PRESENTATION.name.help}
                />
                <FormControl required size="small" fullWidth>
                  <InputLabel id="wit-form-role-label">
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.role.label}
                  </InputLabel>
                  <Select<WorkItemTypeRole>
                    labelId="wit-form-role-label"
                    label={WORK_ITEM_TYPE_FIELD_PRESENTATION.role.label}
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    data-testid="wit-form-role"
                  >
                    {Object.values(WorkItemTypeRole).map((value) => (
                      <MenuItem key={value} value={value}>
                        {value}
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5, mx: 1.75 }}
                  >
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.role.help}
                  </Typography>
                </FormControl>
                <TextField
                  label={WORK_ITEM_TYPE_FIELD_PRESENTATION.description.label}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  multiline
                  minRows={2}
                  size="small"
                  fullWidth
                  helperText={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION.description.help
                  }
                  data-testid="wit-form-description"
                />
                <FormControl
                  size="small"
                  fullWidth
                  data-testid="wit-form-icon-field"
                >
                  <InputLabel id="wit-form-icon-label">Icon</InputLabel>
                  <Select<WorkItemIconKey | "">
                    labelId="wit-form-icon-label"
                    label="Icon"
                    value={iconKey}
                    onChange={(
                      event: SelectChangeEvent<WorkItemIconKey | "">,
                    ) => {
                      const selected = event.target.value;
                      if (selected === "" || isWorkItemIconKey(selected)) {
                        setIconKey(selected);
                      }
                    }}
                    renderValue={(selected) => {
                      if (!selected) return <em>No icon</em>;
                      const Icon = resolveWorkItemIconPreview(selected);
                      return (
                        <Stack direction="row" spacing={1} alignItems="center">
                          {Icon ? <Icon fontSize="small" /> : null}
                          <span>{WORK_ITEM_ICON_LABELS[selected]}</span>
                        </Stack>
                      );
                    }}
                    data-testid="wit-form-icon"
                  >
                    <MenuItem value="">
                      <em>No icon</em>
                    </MenuItem>
                    {WORK_ITEM_ICON_KEYS.map((optionKey) => {
                      const Icon = resolveWorkItemIconPreview(optionKey);
                      return (
                        <MenuItem key={optionKey} value={optionKey}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            {Icon ? <Icon fontSize="small" /> : null}
                            <span>{WORK_ITEM_ICON_LABELS[optionKey]}</span>
                          </Stack>
                        </MenuItem>
                      );
                    })}
                  </Select>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5, mx: 1.75 }}
                  >
                    Choose an icon to identify this work-item type. Clear the
                    selection to leave it unset.
                  </Typography>
                </FormControl>
                {canEditColor && (
                  <FormControl
                    size="small"
                    fullWidth
                    data-testid="wit-form-color-field"
                  >
                    <InputLabel id="wit-form-color-label">Color</InputLabel>
                    <Select<WorkItemColorKey | "">
                      labelId="wit-form-color-label"
                      label="Color"
                      value={colorKey}
                      onChange={(event) =>
                        setColorKey(event.target.value as WorkItemColorKey | "")
                      }
                      data-testid="wit-form-color"
                    >
                      <MenuItem value="">
                        <em>Default</em>
                      </MenuItem>
                      {WORK_ITEM_COLOR_KEYS.map((key) => (
                        <MenuItem key={key} value={key}>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <Box
                              sx={{
                                width: 16,
                                height: 16,
                                borderRadius: "50%",
                                bgcolor: `${key}.main`,
                              }}
                            />
                            <span>{WORK_ITEM_COLOR_LABELS[key]}</span>
                          </Stack>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                {(() => {
                  const preview = resolveWorkItemIconPresentation(
                    workItemTypeSummary?.definition.key ?? "ICON_PREVIEW",
                    {
                      key:
                        workItemTypeSummary?.definition.key ?? "ICON_PREVIEW",
                      name: "Presentation preview",
                      role,
                      sections: [],
                      allowedStatuses: [],
                      ...(iconKey ? { iconKey } : {}),
                      ...(colorKey ? { colorKey } : {}),
                    },
                    isEditMode
                      ? workItemTypeSummary?.effectiveSource
                      : WorkItemTypeEffectiveSource.ProjectCustom,
                  );
                  if (!preview) return null;
                  const PreviewIcon = preview.Icon;
                  return (
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      data-testid="wit-form-presentation-preview"
                    >
                      <Box
                        sx={{
                          display: "inline-flex",
                          p: 1,
                          borderRadius: 1,
                          bgcolor: preview.colors.background,
                          color: preview.colors.color,
                        }}
                      >
                        <PreviewIcon fontSize="small" />
                      </Box>
                      <Typography variant="caption">
                        Presentation preview
                      </Typography>
                    </Stack>
                  );
                })()}
              </Stack>
            </Paper>
          </Box>
          <Box
            role="tabpanel"
            id="wit-panel-1"
            aria-labelledby="wit-tab-1"
            hidden={activeTab !== "Content"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Box>
                  <Typography variant="h6">
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.sections.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.sections.help}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setSections((p) => [...p, emptySection()])}
                  data-testid="wit-form-add-section"
                >
                  Add section
                </Button>
              </Box>
              <Stack spacing={2}>
                {sections.map((section, i) => (
                  <Box
                    key={i}
                    sx={{
                      p: 1.5,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                    }}
                    data-testid={`wit-form-section-${i}`}
                  >
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ mb: 1.5 }}
                      alignItems="center"
                    >
                      <TextField
                        label={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION["sections.key"]
                            .label
                        }
                        value={section.key}
                        onChange={(e) =>
                          setSections((p) =>
                            p.map((s, j) =>
                              j === i ? { ...s, key: e.target.value } : s,
                            ),
                          )
                        }
                        size="small"
                        sx={{ flex: 1 }}
                        helperText={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION["sections.key"].help
                        }
                      />
                      <TextField
                        label={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION["sections.label"]
                            .label
                        }
                        value={section.label}
                        onChange={(e) =>
                          setSections((p) =>
                            p.map((s, j) =>
                              j === i ? { ...s, label: e.target.value } : s,
                            ),
                          )
                        }
                        size="small"
                        sx={{ flex: 1 }}
                        helperText={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION["sections.label"]
                            .help
                        }
                      />
                      <IconButton
                        aria-label="Remove section"
                        onClick={() =>
                          setSections((p) => p.filter((_, j) => j !== i))
                        }
                        size="small"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <TextField
                      label={
                        WORK_ITEM_TYPE_FIELD_PRESENTATION[
                          "sections.writingStandard"
                        ].label
                      }
                      value={section.writingStandard}
                      onChange={(e) =>
                        setSections((p) =>
                          p.map((s, j) =>
                            j === i
                              ? {
                                  ...s,
                                  writingStandard: e.target.value,
                                  writingStandardEdited: true,
                                }
                              : s,
                          ),
                        )
                      }
                      multiline
                      minRows={2}
                      size="small"
                      fullWidth
                      helperText={
                        WORK_ITEM_TYPE_FIELD_PRESENTATION[
                          "sections.writingStandard"
                        ].help
                      }
                    />
                  </Box>
                ))}
                {sections.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No sections.
                  </Typography>
                ) : null}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                Field availability
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.scalarMembership.help}
              </Typography>
              <Stack spacing={2}>
                {SCALAR_FIELDS.map((field) => (
                  <Stack
                    key={field}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    data-testid={`wit-form-scalar-${field}`}
                  >
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {field}
                    </Typography>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>
                        {
                          WORK_ITEM_TYPE_FIELD_PRESENTATION.scalarMembership
                            .label
                        }
                      </InputLabel>
                      <Select
                        label={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION.scalarMembership
                            .label
                        }
                        value={scalarMembership[field] ?? "optional"}
                        data-testid={`wit-form-scalar-membership-${field}`}
                        onChange={(e) =>
                          setScalarMembership((p) => ({
                            ...p,
                            [field]: e.target.value as ScalarMembership,
                          }))
                        }
                      >
                        <MenuItem value="optional">Optional</MenuItem>
                        <MenuItem value="required">Required</MenuItem>
                        <MenuItem value="forbidden">Unavailable</MenuItem>
                      </Select>
                    </FormControl>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Box>
          <Box
            role="tabpanel"
            id="wit-panel-2"
            aria-labelledby="wit-tab-2"
            hidden={activeTab !== "Lifecycle"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                Statuses
              </Typography>
              <Stack spacing={2.5}>
                <FormControl fullWidth size="small">
                  <InputLabel>
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedStatuses.label}
                  </InputLabel>
                  <Select<WorkStatus[]>
                    multiple
                    value={allowedStatuses}
                    label={
                      WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedStatuses.label
                    }
                    data-testid="wit-form-statuses"
                    onChange={(e: SelectChangeEvent<WorkStatus[]>) =>
                      setAllowedStatuses(
                        (typeof e.target.value === "string"
                          ? e.target.value.split(",")
                          : e.target.value) as WorkStatus[],
                      )
                    }
                    input={
                      <OutlinedInput
                        label={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedStatuses
                            .label
                        }
                      />
                    }
                    renderValue={(selected: WorkStatus[]) => (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {selected.map((v) => (
                          <Chip key={v} label={v} size="small" />
                        ))}
                      </Box>
                    )}
                  >
                    {WORK_STATUS_VALUES.map((status) => (
                      <MenuItem key={status} value={status}>
                        <Checkbox
                          checked={allowedStatuses.includes(status)}
                          size="small"
                        />
                        {status}
                      </MenuItem>
                    ))}
                  </Select>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedStatuses.help}
                  </Typography>
                </FormControl>
                {renderEnumMultiSelect<WorkStatus>(
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.agentSettableStatuses.label,
                  allowedStatuses,
                  agentSettableStatuses,
                  setAgentSettableStatuses,
                  "wit-form-agent-settable-statuses",
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.agentSettableStatuses.help,
                )}
              </Stack>
            </Paper>
          </Box>
          <Box
            role="tabpanel"
            id="wit-panel-3"
            aria-labelledby="wit-tab-3"
            hidden={activeTab !== "Relationships"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                Parentage
              </Typography>
              <Stack spacing={2.5}>
                {renderTypeKeyMultiSelect(
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedParentTypes.label,
                  typeKeyOptions,
                  allowedParentTypes,
                  (nextParentTypes) => {
                    setAllowedParentTypes(nextParentTypes);
                    setAllowedParentEntityTypes((current) =>
                      withRequiredTaskParentEntityType(
                        nextParentTypes,
                        current,
                      ),
                    );
                  },
                  "wit-form-parent-types",
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedParentTypes.help,
                )}
                {renderEnumMultiSelect<EntityType>(
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedParentEntityTypes
                    .label,
                  ENTITY_TYPE_VALUES,
                  allowedParentEntityTypes,
                  (nextParentEntityTypes) =>
                    setAllowedParentEntityTypes(
                      withRequiredTaskParentEntityType(
                        allowedParentTypes,
                        nextParentEntityTypes,
                      ),
                    ),
                  "wit-form-parent-entity-types",
                  WORK_ITEM_TYPE_FIELD_PRESENTATION.allowedParentEntityTypes
                    .help,
                )}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Box>
                  <Typography variant="h6">
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.edgeTargets.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {WORK_ITEM_TYPE_FIELD_PRESENTATION.edgeTargets.help}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() =>
                    setEdgeTargets((p) => [...p, emptyEdgeTarget()])
                  }
                  data-testid="wit-form-add-edge"
                >
                  Add edge target
                </Button>
              </Box>
              <Stack spacing={2}>
                {edgeTargets.map((edge, i) => (
                  <Stack
                    key={i}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    data-testid={`wit-form-edge-${i}`}
                  >
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>
                        {
                          WORK_ITEM_TYPE_FIELD_PRESENTATION[
                            "edgeTargets.edgeType"
                          ].label
                        }
                      </InputLabel>
                      <Select
                        label={
                          WORK_ITEM_TYPE_FIELD_PRESENTATION[
                            "edgeTargets.edgeType"
                          ].label
                        }
                        value={edge.edgeType}
                        onChange={(e) =>
                          setEdgeTargets((p) =>
                            p.map((ed, j) =>
                              j === i
                                ? {
                                    ...ed,
                                    edgeType: e.target.value as AgentEdgeType,
                                  }
                                : ed,
                            ),
                          )
                        }
                      >
                        {EDGE_TYPE_VALUES.map((et) => (
                          <MenuItem key={et} value={et}>
                            {et}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Box sx={{ flex: 1 }}>
                      {renderEdgeTargetTypeMultiSelect(
                        edge.targetTypeKeys,
                        (next) =>
                          setEdgeTargets((p) =>
                            p.map((ed, j) =>
                              j === i ? { ...ed, targetTypeKeys: next } : ed,
                            ),
                          ),
                        `wit-form-edge-targets-${i}`,
                      )}
                    </Box>
                    <IconButton
                      aria-label="Remove edge target"
                      onClick={() =>
                        setEdgeTargets((p) => p.filter((_, j) => j !== i))
                      }
                      size="small"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                {edgeTargets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No edge targets.
                  </Typography>
                ) : null}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.tracking.label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.tracking.help}
              </Typography>
              <Stack spacing={2.5}>
                {renderTypeKeyMultiSelect(
                  WORK_ITEM_TYPE_FIELD_PRESENTATION[
                    "tracking.allowedSourceTaskTypes"
                  ].label,
                  trackingSourceTypeOptions,
                  trackingSourceTaskTypes,
                  setTrackingSourceTaskTypes,
                  "wit-form-tracking-source-task-types",
                  WORK_ITEM_TYPE_FIELD_PRESENTATION[
                    "tracking.allowedSourceTaskTypes"
                  ].help,
                  trackingSourceOptionsLoading ||
                    trackingSourceOptionsUnavailable,
                  "No eligible tracking source types",
                )}
                {trackingSourceOptionsLoading ? (
                  <Alert
                    severity="info"
                    data-testid="wit-form-tracking-sources-loading"
                  >
                    Loading eligible tracking source types…
                  </Alert>
                ) : trackingSourceOptionsUnavailable ? (
                  <Alert
                    severity="error"
                    data-testid="wit-form-tracking-sources-unavailable"
                  >
                    Eligible tracking source types are unavailable. Tracking
                    changes cannot be submitted until the project work-item type
                    registry is available.
                  </Alert>
                ) : null}
              </Stack>
            </Paper>
          </Box>
          <Box
            role="tabpanel"
            id="wit-panel-4"
            aria-labelledby="wit-tab-4"
            hidden={activeTab !== "Capabilities"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                Report anchoring
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.anchorableReportTypes.help}
              </Typography>
              {renderEnumMultiSelect<ReportType>(
                WORK_ITEM_TYPE_FIELD_PRESENTATION.anchorableReportTypes.label,
                REPORT_TYPE_VALUES,
                anchorableReportTypes,
                setAnchorableReportTypes,
                "wit-form-report-types",
              )}
            </Paper>

            <Paper
              variant="outlined"
              sx={{ p: 2.5, mb: 2.5 }}
              data-testid="wit-form-capabilities"
            >
              <Typography variant="h6" gutterBottom>
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.capabilities.label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.capabilities.help}
              </Typography>
              <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                {capabilityRows.map((cap) => (
                  <FormControlLabel
                    key={cap.key}
                    control={
                      <Switch
                        checked={cap.value}
                        onChange={(e) =>
                          setCapabilityValue(cap.key, e.target.checked)
                        }
                        data-testid={`wit-form-capability-${cap.key}`}
                      />
                    }
                    label={formatCapabilityKey(cap.key)}
                  />
                ))}
                {capabilityRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No capabilities defined yet.
                  </Typography>
                ) : null}
              </Stack>
              {explorerSidebarCapabilityConflictReason ? (
                <Alert
                  severity="error"
                  data-testid="wit-form-capabilities-error"
                  sx={{ mb: 1.5 }}
                >
                  <AlertTitle>Choose compatible capabilities</AlertTitle>
                  {explorerSidebarCapabilityConflictReason}
                </Alert>
              ) : null}
              <Stack direction="row" spacing={1.5} alignItems="center">
                <TextField
                  label={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["capabilities.key"].label
                  }
                  value={newCapabilityKey}
                  onChange={(e) => setNewCapabilityKey(e.target.value)}
                  size="small"
                  data-testid="wit-form-new-capability"
                  helperText={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["capabilities.key"].help
                  }
                />
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleAddCapability}
                  data-testid="wit-form-add-capability"
                >
                  Add
                </Button>
              </Stack>
            </Paper>
          </Box>
          <Box
            role="tabpanel"
            id="wit-panel-5"
            aria-labelledby="wit-tab-5"
            hidden={activeTab !== "Agent guidance"}
          >
            <Paper variant="outlined" sx={{ p: 2.5, mb: 2.5 }}>
              <Typography variant="h6" gutterBottom>
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.writingStandards.label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.writingStandards.help}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.create"]
                      .label
                  }
                  value={writingStandardCreate}
                  onChange={(e) => setWritingStandardCreate(e.target.value)}
                  multiline
                  minRows={2}
                  size="small"
                  fullWidth
                  data-testid="wit-form-writing-standard-create"
                  helperText={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.create"]
                      .help
                  }
                />
                <TextField
                  label={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.edit"]
                      .label
                  }
                  value={writingStandardEdit}
                  onChange={(e) => setWritingStandardEdit(e.target.value)}
                  multiline
                  minRows={2}
                  size="small"
                  fullWidth
                  data-testid="wit-form-writing-standard-edit"
                  helperText={
                    WORK_ITEM_TYPE_FIELD_PRESENTATION["writingStandards.edit"]
                      .help
                  }
                />
              </Stack>
            </Paper>

            <Divider sx={{ my: 2 }} />
            <Paper
              variant="outlined"
              sx={{ p: 2, mb: 2.5 }}
              data-testid="wit-form-session-role-guidance"
            >
              <Typography variant="subtitle2" gutterBottom>
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.sessionRoleGuidance.label}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {WORK_ITEM_TYPE_FIELD_PRESENTATION.sessionRoleGuidance.help}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  gap: 2,
                }}
              >
                {Object.values(SessionRole).map((sessionRole) => (
                  <TextField
                    key={sessionRole}
                    label={`${sessionRole[0].toUpperCase()}${sessionRole.slice(1)} guidance`}
                    value={sessionRoleGuidance?.[sessionRole] ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSessionRoleGuidance((current) => {
                        const next = { ...current };
                        if (value.trim()) next[sessionRole] = value;
                        else delete next[sessionRole];
                        return Object.keys(next).length ? next : undefined;
                      });
                    }}
                    multiline
                    minRows={3}
                    size="small"
                    fullWidth
                    data-testid="wit-form-role-guidance-entry"
                    data-session-role={sessionRole}
                    helperText="Optional. Leave empty to provide no advice for this session role."
                  />
                ))}
              </Box>
            </Paper>
            <TextField
              label={
                WORK_ITEM_TYPE_FIELD_PRESENTATION.maintenanceGuidance.label
              }
              value={maintenanceGuidance}
              onChange={(event) => setMaintenanceGuidance(event.target.value)}
              multiline
              minRows={4}
              size="small"
              fullWidth
              sx={{ mb: 2.5 }}
              data-testid="wit-form-maintenance-guidance"
              helperText={
                WORK_ITEM_TYPE_FIELD_PRESENTATION.maintenanceGuidance.help
              }
            />
          </Box>
        </fieldset>

        <Stack direction="row" spacing={2} alignItems="center">
          {manageWorkItemTypes ? (
            <Button
              type="submit"
              variant="contained"
              disabled={
                isReadOnly ||
                isPending ||
                typesLoading ||
                trackingSourceOptionsLoading ||
                trackingSourceOptionsUnavailable ||
                blocksSubmitForImpact
              }
              data-testid="wit-form-submit"
            >
              {createMutation.isPending || editMutation.isPending ? (
                <CircularProgress size={20} color="inherit" />
              ) : isEditMode ? (
                "Submit edit for review"
              ) : (
                "Submit for review"
              )}
            </Button>
          ) : null}
          {manageWorkItemTypes && isEditMode ? (
            isArchived ? (
              <Button
                color="success"
                variant="outlined"
                disabled={isPending}
                onClick={handleRestore}
                data-testid="wit-form-restore"
              >
                {createMutation.isPending ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  "Restore for review"
                )}
              </Button>
            ) : (
              <Button
                color="warning"
                variant="outlined"
                disabled={!canEditDefinition || isPending}
                onClick={handleArchive}
                data-testid="wit-form-archive"
              >
                {archiveMutation.isPending ? (
                  <CircularProgress size={20} color="inherit" />
                ) : (
                  "Archive for review"
                )}
              </Button>
            )
          ) : null}
          {manageWorkItemTypes && canResetToCanonical ? (
            <Button
              variant="outlined"
              color="primary"
              disabled={isPending}
              onClick={handleResetToCanonical}
              data-testid="wit-form-reset-to-canonical"
            >
              {resetMutation.isPending ? (
                <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />
              ) : null}
              Reset to canonical
            </Button>
          ) : null}
          {manageWorkItemTypes && canHardDelete ? (
            <Button
              color="error"
              variant="contained"
              disabled={hardDeleteUnavailable}
              onClick={handleOpenHardDelete}
              data-testid="wit-form-hard-delete-open"
            >
              Hard delete
            </Button>
          ) : null}
          <Button
            component={RouterLink}
            to={projectId ? `/projects/${projectId}/proposals` : "/"}
            data-testid="wit-form-cancel"
          >
            Cancel
          </Button>
        </Stack>
      </form>

      <Dialog
        open={pendingCanonicalDefinition !== null}
        onClose={handleCancelCanonicalCustomization}
        maxWidth="sm"
        fullWidth
        data-testid="wit-form-canonical-customization-dialog"
      >
        <DialogTitle>Customize this built-in type?</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            <AlertTitle>This creates a project-owned override</AlertTitle>
            Customizing a built-in type may cause instability, inconsistent
            behavior, broken features, or incompatibility with future platform
            updates. The global built-in definition will remain unchanged.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelCanonicalCustomization}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={handleConfirmCanonicalCustomization}
            data-testid="wit-form-canonical-customization-confirm"
          >
            Customize built-in type
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        ownerKey={hardDeleteOpenOwnerKey}
        open={hardDeleteOpen}
        onClose={handleCloseHardDelete}
        maxWidth="sm"
        fullWidth
        data-testid="wit-form-hard-delete-dialog"
      >
        <DialogTitle>Hard delete this work-item type?</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>This removal is irreversible</AlertTitle>
            Hard delete permanently removes this type, every active or archived
            item of this type, and every graph edge connected to those items.
            Archive is the safer retirement action when existing data should
            remain available.
          </Alert>

          {cascadeImpact.isLoading || cascadeImpact.isFetching ? (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              data-testid="wit-form-hard-delete-impact-loading"
            >
              <CircularProgress size={20} />
              <Typography variant="body2">
                Loading current deletion impact…
              </Typography>
            </Stack>
          ) : !cascadeImpactOverride && cascadeImpact.error ? (
            <Alert
              severity="error"
              data-testid="wit-form-hard-delete-impact-error"
            >
              Could not load the current deletion impact. Close this
              confirmation and try again.
            </Alert>
          ) : displayedCascadeImpact ? (
            <Stack spacing={2} data-testid="wit-form-hard-delete-impact">
              <Typography variant="body1">
                This will permanently delete{" "}
                <strong>{displayedCascadeImpact.itemCount} work items</strong>{" "}
                and{" "}
                <strong>{displayedCascadeImpact.edgeCount} graph edges</strong>.
              </Typography>
              {!cascadeImpactOverride && cascadeImpact.isStale ? (
                <Alert
                  severity="warning"
                  data-testid="wit-form-hard-delete-impact-stale"
                >
                  These counts are stale. Close this confirmation and reopen it
                  to load the current impact.
                </Alert>
              ) : null}
              <TextField
                fullWidth
                label="Type the exact confirmation"
                value={hardDeleteConfirmation}
                onChange={(event) =>
                  setHardDeleteConfirmation(event.target.value)
                }
                helperText={
                  <>
                    Enter <strong>{hardDeleteConfirmationText}</strong>
                  </>
                }
                autoComplete="off"
                disabled={hardDeleteImpactUnavailable}
                data-testid="wit-form-hard-delete-confirmation"
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseHardDelete}
            disabled={hardDeleteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleHardDelete}
            disabled={
              hardDeleteUnavailable ||
              hardDeleteImpactUnavailable ||
              !hardDeleteConfirmationMatches
            }
            data-testid="wit-form-hard-delete-confirm"
          >
            {hardDeleteMutation.isPending ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              "Hard delete for review"
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );

  return (
    <>
      {projectChrome}
      {content}
    </>
  );
};

export default WorkItemTypeFormPage;
