import { useState, useMemo } from "react";
import type { ProjectResponseDto } from "../api";

export const useProjectFilter = (projects: ProjectResponseDto[]) => {
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [showAll, setShowAll] = useState<boolean>(false);

  const filteredProjects = useMemo(() => {
    if (!searchFilter.trim()) {
      return projects;
    }

    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (project.description &&
          project.description
            .toLowerCase()
            .includes(searchFilter.toLowerCase()))
    );
  }, [projects, searchFilter]);

  const displayedProjects = useMemo(() => {
    return showAll ? filteredProjects : filteredProjects.slice(0, 10);
  }, [filteredProjects, showAll]);

  const hasMoreProjects = filteredProjects.length > 10;
  const remainingCount = filteredProjects.length - 10;

  return {
    searchFilter,
    setSearchFilter,
    showAll,
    setShowAll,
    filteredProjects,
    displayedProjects,
    hasMoreProjects,
    remainingCount,
  };
};
