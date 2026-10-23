import {
  DesignDocParentEntityType,
  type DesignDocResponseDto,
} from "@hey-hey/ui-common/api";
import { useDesignDoc, useWorkItem } from "@hey-hey/ui-common/data";
import { compose } from "@hey-hey/ui-common/i18n";
import { WebPathService } from "@hey-hey/ui-common/services";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import React from "react";
import { useTranslation } from "react-i18next";

import { PageBreadcrumbs } from "../../components/Layout";
import { getTaskBreadcrumbType } from "../../components/TaskBreadcrumbs";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

interface DesignDocBreadcrumbsProps {
  organizationId: string;
  projectId: string;
  projectName?: string;
  designDoc: DesignDocResponseDto;
}

interface BaseTrailParams {
  projectId: string;
  projectName?: string;
}

const buildBaseTrail = ({
  projectId,
  projectName,
}: BaseTrailParams): BreadcrumbItem[] => [
  { label: "Projects", to: "/projects" },
  {
    label: projectName ?? compose("{{term.Project}}"),
    to: `/projects/${projectId}`,
    type: projectName ? "project" : undefined,
  },
];

interface TaskAncestorItemProps {
  organizationId: string;
  projectId: string;
  taskId: string;
  trailingItems: BreadcrumbItem[];
  baseItems: BreadcrumbItem[];
}

const TaskAncestorRenderer: React.FC<TaskAncestorItemProps> = ({
  organizationId,
  projectId,
  taskId,
  trailingItems,
  baseItems,
}) => {
  const { workItem } = useWorkItem(organizationId, "task", taskId, {
    projectId,
    preferStale: true,
  });

  const items: BreadcrumbItem[] = [
    ...baseItems,
    {
      label: workItem?.name ?? taskId,
      to: WebPathService.task({ projectId, taskId }),
      type: workItem ? getTaskBreadcrumbType(workItem) : "task",
      kind:
        workItem?.type === WORK_ITEM_TYPE_KEYS.Feature ? "feature" : "entity",
      entityId: taskId,
    },
    ...trailingItems,
  ];

  return <PageBreadcrumbs items={items} />;
};

interface DocumentsListAncestorRendererProps {
  projectId: string;
  trailingItems: BreadcrumbItem[];
  baseItems: BreadcrumbItem[];
}

const DocumentsListAncestorRenderer: React.FC<
  DocumentsListAncestorRendererProps
> = ({ projectId, trailingItems, baseItems }) => {
  const { t } = useTranslation();

  const items: BreadcrumbItem[] = [
    ...baseItems,
    {
      label: t("documents.title", "Documents"),
      to: `/projects/${projectId}/design-docs`,
      type: "design-doc",
    },
    ...trailingItems,
  ];

  return <PageBreadcrumbs items={items} />;
};

interface DesignDocChainWalkerProps {
  organizationId: string;
  projectId: string;
  projectName?: string;
  designDocId: string;
  descendants: BreadcrumbItem[];
}

const DesignDocChainWalker: React.FC<DesignDocChainWalkerProps> = ({
  organizationId,
  projectId,
  projectName,
  designDocId,
  descendants,
}) => {
  const { data } = useDesignDoc(organizationId, designDocId, {
    preferStale: true,
  });

  const ownItem: BreadcrumbItem = {
    label: data?.name ?? designDocId,
    to: WebPathService.designDoc({ projectId, designDocId }),
    type: "design-doc",
    entityId: designDocId,
  };

  const accumulatedChain = [ownItem, ...descendants];

  if (
    data?.parentEntityType === DesignDocParentEntityType.DesignDoc &&
    data.parentEntityId
  ) {
    return (
      <DesignDocChainWalker
        organizationId={organizationId}
        projectId={projectId}
        projectName={projectName}
        designDocId={data.parentEntityId}
        descendants={accumulatedChain}
      />
    );
  }

  const baseItems = buildBaseTrail({ projectId, projectName });

  if (
    data?.parentEntityType === DesignDocParentEntityType.Task &&
    data.parentEntityId
  ) {
    return (
      <TaskAncestorRenderer
        organizationId={organizationId}
        projectId={projectId}
        taskId={data.parentEntityId}
        trailingItems={accumulatedChain}
        baseItems={baseItems}
      />
    );
  }

  return (
    <DocumentsListAncestorRenderer
      projectId={projectId}
      trailingItems={accumulatedChain}
      baseItems={baseItems}
    />
  );
};

export const DesignDocBreadcrumbs: React.FC<DesignDocBreadcrumbsProps> = ({
  organizationId,
  projectId,
  projectName,
  designDoc,
}) => {
  const currentItem: BreadcrumbItem = {
    label: designDoc.name || "Document",
    isCurrent: true,
    type: "design-doc",
    entityId: designDoc.id,
  };

  if (
    designDoc.parentEntityType === DesignDocParentEntityType.DesignDoc &&
    designDoc.parentEntityId
  ) {
    return (
      <DesignDocChainWalker
        organizationId={organizationId}
        projectId={projectId}
        projectName={projectName}
        designDocId={designDoc.parentEntityId}
        descendants={[currentItem]}
      />
    );
  }

  const baseItems = buildBaseTrail({ projectId, projectName });

  if (
    designDoc.parentEntityType === DesignDocParentEntityType.Task &&
    designDoc.parentEntityId
  ) {
    return (
      <TaskAncestorRenderer
        organizationId={organizationId}
        projectId={projectId}
        taskId={designDoc.parentEntityId}
        trailingItems={[currentItem]}
        baseItems={baseItems}
      />
    );
  }

  return (
    <DocumentsListAncestorRenderer
      projectId={projectId}
      trailingItems={[currentItem]}
      baseItems={baseItems}
    />
  );
};

DesignDocBreadcrumbs.displayName = "DesignDocBreadcrumbs";
