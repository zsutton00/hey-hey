import { useCallback, useRef, useState, type PropsWithChildren } from "react";
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
  const resolvers = useRef(
    new Map<string, { promise: Promise<void>; resolve: () => void }>(),
  );
  const checkTask = useCallback((taskId: string) => {
    // Coalesce simultaneous callers, without suppressing later completion actions.
    const queued = resolvers.current.get(taskId);
    if (queued) {
      return queued.promise;
    }
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    resolvers.current.set(taskId, { promise, resolve });
    setTasks((current) =>
      current.includes(taskId) ? current : [...current, taskId],
    );
    return promise;
  }, []);
  const closeTask = useCallback((taskId: string) => {
    resolvers.current.get(taskId)?.resolve();
    resolvers.current.delete(taskId);
    setTasks((current) => current.filter((id) => id !== taskId));
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
          onClose={() => closeTask(tasks[0])}
        />
      )}
    </FutureOfferContext.Provider>
  );
}
