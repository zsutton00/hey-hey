import { useCallback, useEffect, useRef, useState } from "react";
import { useGuidedWalkthroughRuntime } from "../GuidedWalkthrough/guidedWalkthroughRuntime";
import { useGuidableTarget } from "../GuidedWalkthrough/useGuidableTarget";
import {
  createCreateServiceFormInstanceId,
  type CreateServiceFormInstanceId,
} from "../GuidedWalkthrough/types";

export interface CreateServiceFormWalkthroughBindings {
  detailsTargetRef: React.RefObject<HTMLDivElement | null>;
  submitTargetRef: React.RefObject<HTMLButtonElement | null>;
  /** Call from the form's completion callback once the Service exists. */
  reportServiceCreated: () => void;
}

/**
 * Walkthrough collaborator for one CreateServiceForm: owns the instance
 * identity, the name/type and submit targets, and the details-ready and
 * service-created events. Inert without a provider.
 */
export function useCreateServiceFormWalkthrough(
  detailsReady: boolean,
): CreateServiceFormWalkthroughBindings {
  const runtime = useGuidedWalkthroughRuntime();
  const [formInstanceId] = useState<CreateServiceFormInstanceId>(
    createCreateServiceFormInstanceId,
  );
  const [sessionToken] = useState(() => Symbol("create-service-form-session"));

  const detailsTargetRef = useRef<HTMLDivElement>(null);
  const submitTargetRef = useRef<HTMLButtonElement>(null);
  useGuidableTarget(
    runtime === null
      ? null
      : { name: "create-service-details", formInstanceId },
    () => detailsTargetRef.current,
  );
  useGuidableTarget(
    runtime === null ? null : { name: "create-service-submit", formInstanceId },
    () => submitTargetRef.current,
  );

  const sessions = runtime?.createServiceForms ?? null;
  useEffect(() => {
    if (sessions === null) return;
    return sessions.publish(sessionToken, { formInstanceId, detailsReady });
  }, [sessions, sessionToken, formInstanceId, detailsReady]);

  const events = runtime?.events ?? null;
  useEffect(() => {
    if (events === null || !detailsReady) return;
    events.emit({ type: "create-service-details-ready", formInstanceId });
  }, [events, formInstanceId, detailsReady]);

  const reportServiceCreated = useCallback(() => {
    events?.emit({ type: "service-created", formInstanceId });
  }, [events, formInstanceId]);

  return { detailsTargetRef, submitTargetRef, reportServiceCreated };
}
