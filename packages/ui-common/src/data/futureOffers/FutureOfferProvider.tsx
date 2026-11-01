import { useCallback, useState, type PropsWithChildren } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { FutureApplicationOfferDialog } from "../../components/ProposalDetail/FutureApplicationOfferDialog";
import { FutureOfferContext } from "./FutureOfferContext";

export function FutureOfferProvider({ children }: PropsWithChildren) {
  const scope = useProjectContext();
  const organizationId = scope?.organizationId;
  const projectId = scope?.projectId;
  // Key the host by scope so outstanding dialogs cannot follow a project change.
  return (
    <ScopedFutureOffers
      key={`${organizationId}:${projectId}`}
      organizationId={organizationId}
      projectId={projectId}
    >
      {children}
    </ScopedFutureOffers>
  );
}

function ScopedFutureOffers({
  children,
  organizationId,
  projectId,
}: PropsWithChildren<{ organizationId?: string; projectId?: string }>) {
  const [tasks, setTasks] = useState<string[]>([]);
  const checkTask = useCallback((taskId: string) => {
    // Coalesce simultaneous callers, without suppressing later completion actions.
    setTasks((current) =>
      current.includes(taskId) ? current : [...current, taskId],
    );
  }, []);
  return (
    <FutureOfferContext.Provider value={{ checkTask }}>
      {children}
      {organizationId && projectId && tasks[0] && (
        <FutureApplicationOfferDialog
          key={tasks[0]}
          organizationId={organizationId}
          projectId={projectId}
          taskId={tasks[0]}
          open
          onClose={() => setTasks((current) => current.slice(1))}
        />
      )}
    </FutureOfferContext.Provider>
  );
}
