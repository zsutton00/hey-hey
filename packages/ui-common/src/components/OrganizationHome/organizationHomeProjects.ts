import {
  EntityType,
  ProjectStatus,
  type EntityStarDto,
  type ProjectResponseDto,
} from "../../api";
export const projectMatchesSearch = (
  project: ProjectResponseDto,
  searchTerm: string,
): boolean => {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  if (!normalizedSearchTerm) return true;

  return [project.name, project.description ?? ""].some((value) =>
    value.toLowerCase().includes(normalizedSearchTerm),
  );
};

export const formatProjectUpdatedAt = (updatedAt: string): string =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(updatedAt));

export const formatProjectStatus = (
  status: ProjectResponseDto["status"],
): string => status.charAt(0) + status.slice(1).toLowerCase();

export const projectStatusChipColor = (
  status: ProjectResponseDto["status"],
): "success" | "secondary" | "info" | "error" | "default" => {
  switch (status) {
    case ProjectStatus.Active:
      return "success";
    case ProjectStatus.Onboarding:
      return "secondary";
    case ProjectStatus.Completed:
      return "info";
    case ProjectStatus.Failed:
      return "error";
    default:
      return "default";
  }
};

export const selectCurrentUserProjectStars = (
  stars: EntityStarDto[],
  organizationId: string,
  currentUserId?: string,
): EntityStarDto[] =>
  stars.filter(
    (star) =>
      star.organizationId === organizationId &&
      star.entityType === EntityType.Project &&
      (!currentUserId || star.userId === currentUserId),
  );

const HOME_PROJECT_PAGE_SIZE = 5;
export function paginateHomeProjects<T>(projects: T[], requestedPage: number) {
  const pageCount = Math.max(
    1,
    Math.ceil(projects.length / HOME_PROJECT_PAGE_SIZE),
  );
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  return {
    page,
    pageCount,
    projects: projects.slice(
      (page - 1) * HOME_PROJECT_PAGE_SIZE,
      page * HOME_PROJECT_PAGE_SIZE,
    ),
  };
}
