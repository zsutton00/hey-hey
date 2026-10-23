import type { ReactNode } from "react";
import { HelpProvider } from "@hey-hey/ui-common/components";
import { useRepositoryImportEntry } from "../../Services/useRepositoryImportEntry";
import { RepositoryImportEntryDialog } from "../../Services/RepositoryImportEntryDialog";
import { useHelpCapabilities } from "./useHelpCapabilities";

export function ProjectHelpProvider({
  organizationId,
  projectId,
  children,
}: {
  organizationId: string;
  projectId: string;
  children: ReactNode;
}) {
  const entry = useRepositoryImportEntry(organizationId, projectId);
  const capabilities = useHelpCapabilities(
    organizationId,
    projectId,
    entry.action,
  );
  return (
    <HelpProvider capabilities={capabilities}>
      {children}
      <RepositoryImportEntryDialog entry={entry} />
    </HelpProvider>
  );
}
