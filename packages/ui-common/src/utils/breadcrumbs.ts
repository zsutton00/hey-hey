import { ProjectStatus } from "../api";
import { getPathService, type PathService } from "../services";

export enum AppEntityType {
  Project = "project",
  Initiative = "initiative",
  Task = "task",
  Document = "document",
}

export enum PageKind {
  Detail = "detail",
  Edit = "edit",
  List = "list",
  Planning = "planning",
  Documents = "documents",
  Tasks = "tasks",
  Create = "create",
  Custom = "custom",
}

export interface BreadcrumbItem {
  /** Structural role; unclassified items remain visible. */
  kind?: "project" | "feature" | "entity";
  label: string;
  to?: string;
  isCurrent?: boolean;
  type?: string;
  typeLabel?: string;
  entityId?: string;
}

export interface BreadcrumbContext {
  projectId?: string;
  projectName?: string;
  initiativeId?: string;
  initiativeName?: string;
  taskId?: string;
  taskName?: string;
  projectStatus?: ProjectStatus;
  onboardingComplete?: boolean;
  useWorkstreamsTrail?: boolean;
  initiativesLabel?: string;
  pageLabelOverride?: string;
  t?: (key: string, defaultValue?: string) => string;
  compose?: (key: string) => string;
  pathService?: PathService;
}

export interface BreadcrumbOptions {
  extra?: BreadcrumbItem[];
}

type BreadcrumbBuilder = (
  page: PageKind,
  ctx: BreadcrumbContext,
  options?: BreadcrumbOptions
) => BreadcrumbItem[];

const resolveLabel = (
  value: string | undefined,
  ctx: BreadcrumbContext,
  fallback: string
): string =>
  value || ctx.compose?.(fallback) || ctx.t?.(fallback, fallback) || fallback;

const getPageLabel = (page: PageKind, ctx: BreadcrumbContext): string => {
  if (ctx.pageLabelOverride) return ctx.pageLabelOverride;

  const labels: Record<PageKind, string> = {
    [PageKind.Detail]: "Detail",
    [PageKind.Edit]: "Edit",
    [PageKind.List]: "List",
    [PageKind.Planning]: "Planning",
    [PageKind.Documents]: "Design Documents",
    [PageKind.Tasks]: "Tasks",
    [PageKind.Create]: "Create",
    [PageKind.Custom]: "Page",
  };

  return labels[page] ?? "Detail";
};

const isOnboardingFlow = (ctx: BreadcrumbContext): boolean => {
  if (ctx.onboardingComplete === false) return true;
  return ctx.projectStatus === ProjectStatus.Onboarding;
};

const resolvePathService = (ctx: BreadcrumbContext): PathService =>
  ctx.pathService ?? getPathService();

const getProjectTrail = (ctx: BreadcrumbContext): BreadcrumbItem[] => {
  const pathService = resolvePathService(ctx);
  const onOnboarding = isOnboardingFlow(ctx);
  const projectsLabel = resolveLabel(undefined, ctx, "Projects");
  const projectLabel = resolveLabel(ctx.projectName, ctx, "{{term.Project}}");
  const onboardingLabel = resolveLabel(undefined, ctx, "Onboarding");
  const type = ctx.projectName ? "project" : undefined;

  if (!ctx.projectId) {
    return [
      {
        label: projectsLabel,
        isCurrent: true,
      },
      {
        label: onOnboarding ? onboardingLabel : projectLabel,
        isCurrent: true,
        type,
      },
    ];
  }

  const basePath = onOnboarding
    ? pathService.returnToOnboarding(ctx.projectId)
    : pathService.returnToProject(ctx.projectId);

  return [
    {
      label: projectsLabel,
      to: pathService.projects(),
    },
    {
      label: onOnboarding ? onboardingLabel : projectLabel,
      to: basePath,
      type,
      // Only the project entity crumb (type === "project") carries a ref, so
      // the drag source has a payload; the "Projects" list crumb stays plain.
      entityId: type === "project" ? ctx.projectId : undefined,
    },
  ];
};

const buildInitiativeBase = (
  ctx: BreadcrumbContext
): {
  crumbs: BreadcrumbItem[];
  initiativeLabel: string;
  detailPath?: string;
} => {
  const pathService = resolvePathService(ctx);
  const crumbs: BreadcrumbItem[] = [...getProjectTrail(ctx)];

  const initiativesLabel = resolveLabel(
    ctx.initiativesLabel,
    ctx,
    "Initiatives"
  );

  const initiativesPath = ctx.projectId
    ? pathService.projectInitiatives({ projectId: ctx.projectId })
    : undefined;

  if (ctx.useWorkstreamsTrail !== false) {
    crumbs.push({
      label: initiativesLabel,
      to: initiativesPath,
      type: "initiative",
    });
  }

  const initiativeLabel = resolveLabel(
    ctx.initiativeName,
    ctx,
    "{{term.Initiative}}"
  );

  const detailPath =
    ctx.projectId && ctx.initiativeId
      ? pathService.initiativeDetail({
          projectId: ctx.projectId,
          initiativeId: ctx.initiativeId,
        })
      : undefined;

  return { crumbs, initiativeLabel, detailPath };
};

const buildInitiativeCrumbs: BreadcrumbBuilder = (
  page,
  ctx,
  options = {}
): BreadcrumbItem[] => {
  const { crumbs, initiativeLabel, detailPath } = buildInitiativeBase(ctx);

  if (page === PageKind.Detail || page === PageKind.List) {
    crumbs.push({
      label: initiativeLabel,
      isCurrent: true,
      type: page === PageKind.Detail ? "initiative" : undefined,
      // The Detail crumb resolves to a specific initiative entity, so it
      // carries a ref for the drag source; the List crumb does not.
      entityId: page === PageKind.Detail ? ctx.initiativeId : undefined,
    });
  } else {
    crumbs.push({
      label: initiativeLabel,
      to: detailPath,
    });
  }

  if (page !== PageKind.Detail && page !== PageKind.List) {
    crumbs.push({
      label: getPageLabel(page, ctx),
      isCurrent: true,
    });
  }

  if (options.extra?.length) {
    crumbs.push(...options.extra);
  }

  return crumbs;
};

const buildTaskCrumbs: BreadcrumbBuilder = (
  page,
  ctx,
  options = {}
): BreadcrumbItem[] => {
  const { crumbs, initiativeLabel, detailPath } = buildInitiativeBase(ctx);

  crumbs.push({
    label: initiativeLabel,
    to: detailPath,
  });

  const taskLabel = resolveLabel(ctx.taskName, ctx, "Task");
  const isTaskDetail = page === PageKind.Detail;

  crumbs.push({
    label: taskLabel,
    isCurrent: isTaskDetail,
  });

  if (!isTaskDetail) {
    crumbs.push({
      label: getPageLabel(page, ctx),
      isCurrent: true,
    });
  }

  if (options.extra?.length) {
    crumbs.push(...options.extra);
  }

  return crumbs;
};

const builders: Record<AppEntityType, BreadcrumbBuilder> = {
  [AppEntityType.Project]: (page, ctx, options) => {
    const base = getProjectTrail(ctx);
    const pageLabel = getPageLabel(page, ctx);

    if (page !== PageKind.Detail && page !== PageKind.List) {
      base.push({ label: pageLabel, isCurrent: true });
    }

    if (options?.extra?.length) {
      base.push(...options.extra);
    }

    return base;
  },
  [AppEntityType.Initiative]: buildInitiativeCrumbs,
  [AppEntityType.Task]: buildTaskCrumbs,
  [AppEntityType.Document]: buildTaskCrumbs,
};

export const getBreadcrumbs = (
  entity: AppEntityType,
  page: PageKind,
  ctx: BreadcrumbContext,
  options?: BreadcrumbOptions
): BreadcrumbItem[] => {
  const builder = builders[entity];
  if (!builder) {
    return [];
  }

  return builder(page, ctx, options);
};
