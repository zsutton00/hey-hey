import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NavigationLineage } from "../types/userTracking";
import {
  createEntityActivation,
  entityActivationsEqual,
  type EntityActivation,
  type EntityActivationId,
  type EntityPresentationSnapshot,
  type EntityActivationType,
  useEntityActivationSink,
} from "./EntityActivationContext";

export type CanonicalPageDescriptor<
  T extends EntityActivationType = EntityActivationType
> = EntityActivation<T>;

export type CanonicalPageComposition =
  | {
      kind: "canonical";
      descriptor: CanonicalPageDescriptor;
    }
  | {
      kind: "observational";
    };

export function createCanonicalPageDescriptor<T extends EntityActivationType>(
  entityType: T,
  entityId: string,
  lineage: NavigationLineage | null,
  presentation?: EntityPresentationSnapshot<T>
): CanonicalPageDescriptor<T> {
  return createEntityActivation(entityType, entityId, lineage, presentation);
}

export function canonicalPageDescriptorsEqual(
  left: CanonicalPageDescriptor | null,
  right: CanonicalPageDescriptor | null
): boolean {
  return entityActivationsEqual(left, right);
}

interface CanonicalPageRegistration {
  descriptor: CanonicalPageDescriptor;
  generation: number;
}

interface CanonicalPageContextValue {
  currentDescriptor: CanonicalPageDescriptor | null;
  register: (descriptor: CanonicalPageDescriptor) => () => void;
}

const CanonicalPageContext = createContext<
  CanonicalPageContextValue | undefined
>(undefined);

function useCanonicalPageContext(): CanonicalPageContextValue {
  const context = useContext(CanonicalPageContext);

  if (!context) {
    throw new Error(
      "Canonical page context must be used within a CanonicalPageProvider."
    );
  }

  return context;
}

export interface CanonicalPageProviderProps {
  children: React.ReactNode;
}

function findNewestRegistration(
  registrations: ReadonlyMap<symbol, CanonicalPageRegistration>
): CanonicalPageRegistration | null {
  let newest: CanonicalPageRegistration | null = null;

  registrations.forEach((registration) => {
    if (newest === null || registration.generation > newest.generation) {
      newest = registration;
    }
  });

  return newest;
}

export const CanonicalPageProvider: React.FC<CanonicalPageProviderProps> = ({
  children,
}) => {
  const activationSink = useEntityActivationSink();
  const registrationsRef = useRef(new Map<symbol, CanonicalPageRegistration>());
  const generationRef = useRef(0);
  const emptyGenerationRef = useRef(0);
  const lastPublishedRef = useRef<CanonicalPageDescriptor | null>(null);
  const [currentDescriptor, setCurrentDescriptor] =
    useState<CanonicalPageDescriptor | null>(null);

  const applyCurrentRegistration = useCallback(() => {
    const newest = findNewestRegistration(registrationsRef.current);
    const nextDescriptor = newest?.descriptor ?? null;

    if (nextDescriptor === null) {
      const emptyGeneration = ++emptyGenerationRef.current;
      queueMicrotask(() => {
        if (
          emptyGenerationRef.current === emptyGeneration &&
          registrationsRef.current.size === 0
        ) {
          lastPublishedRef.current = null;
        }
      });
    } else {
      emptyGenerationRef.current += 1;
    }

    setCurrentDescriptor((current) =>
      canonicalPageDescriptorsEqual(current, nextDescriptor)
        ? current
        : nextDescriptor
    );

    if (
      nextDescriptor !== null &&
      activationSink !== null &&
      !canonicalPageDescriptorsEqual(lastPublishedRef.current, nextDescriptor)
    ) {
      lastPublishedRef.current = nextDescriptor;
      activationSink.onEntityActivated(nextDescriptor);
    }
  }, [activationSink]);

  const register = useCallback(
    (descriptor: CanonicalPageDescriptor): (() => void) => {
      const owner = Symbol("canonical-page-owner");
      const generation = ++generationRef.current;
      registrationsRef.current.set(owner, { descriptor, generation });
      applyCurrentRegistration();

      let released = false;
      return () => {
        if (released) {
          return;
        }

        released = true;
        const newestBeforeRelease = findNewestRegistration(
          registrationsRef.current
        );
        registrationsRef.current.delete(owner);

        if (newestBeforeRelease?.generation === generation) {
          applyCurrentRegistration();
        }
      };
    },
    [applyCurrentRegistration]
  );

  const value = useMemo<CanonicalPageContextValue>(
    () => ({ currentDescriptor, register }),
    [currentDescriptor, register]
  );

  if (!activationSink) {
    throw new Error(
      "CanonicalPageProvider must be used within an EntityActivationProvider."
    );
  }

  return (
    <CanonicalPageContext.Provider value={value}>
      {children}
    </CanonicalPageContext.Provider>
  );
};

export interface CanonicalPageBoundaryProps {
  children: React.ReactNode;
  composition: CanonicalPageComposition;
}

function useStableCanonicalDescriptor(
  descriptor: CanonicalPageDescriptor | null
): CanonicalPageDescriptor | null {
  const descriptorRef = useRef(descriptor);

  if (!canonicalPageDescriptorsEqual(descriptorRef.current, descriptor)) {
    descriptorRef.current = descriptor;
  }

  return descriptorRef.current;
}

export const CanonicalPageBoundary: React.FC<CanonicalPageBoundaryProps> = ({
  children,
  composition,
}) => {
  const { register } = useCanonicalPageContext();
  const descriptor = useStableCanonicalDescriptor(
    composition.kind === "canonical" ? composition.descriptor : null
  );

  useEffect(() => {
    if (descriptor === null) {
      return;
    }

    return register(descriptor);
  }, [descriptor, register]);

  return <>{children}</>;
};

export function useCurrentCanonicalPage(): CanonicalPageDescriptor | null {
  return useCanonicalPageContext().currentDescriptor;
}

export type CanonicalPageEntityId<
  T extends EntityActivationType = EntityActivationType
> = EntityActivationId<T>;
