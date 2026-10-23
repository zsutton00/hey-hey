import { useCallback, useRef, useState } from "react";
import type { CreateServiceDto, ServiceDto } from "../../api";
import { useCreateService } from "../../data";

export type CreateServiceDirectorySetupState =
  | { status: "idle" }
  | { status: "creating"; linkDirectory: boolean }
  | { status: "picking"; service: ServiceDto }
  | { status: "binding"; service: ServiceDto; directoryPath: string }
  | { status: "created-without-binding"; service: ServiceDto }
  | { status: "cancelled"; service: ServiceDto }
  | { status: "binding-failed"; service: ServiceDto; error: string }
  | { status: "linked"; service: ServiceDto; directoryPath: string }
  | { status: "creation-failed"; error: string };

export interface UseCreateServiceDirectorySetupOptions {
  onComplete?: (service: ServiceDto) => void;
}

export interface CreateServiceDirectorySetup {
  state: CreateServiceDirectorySetupState;
  create: (input: {
    organizationId: string;
    service: CreateServiceDto;
    linkDirectory: boolean;
  }) => Promise<void>;
  retryLinking: () => Promise<void>;
  finishLater: () => void;
  isBusy: boolean;
}

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;

export function useCreateServiceDirectorySetup(
  options: UseCreateServiceDirectorySetupOptions = {}
): CreateServiceDirectorySetup {
  const [state, setState] = useState<CreateServiceDirectorySetupState>({
    status: "idle",
  });
  const createdServiceRef = useRef<ServiceDto | null>(null);
  const creationPromiseRef = useRef<Promise<ServiceDto> | null>(null);
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  const { mutate: createService } = useCreateService();
  const createOnce = useCallback(
    async (
      organizationId: string,
      service: CreateServiceDto
    ): Promise<ServiceDto> => {
      if (createdServiceRef.current) {
        return createdServiceRef.current;
      }

      if (!creationPromiseRef.current) {
        creationPromiseRef.current = createService({
          organizationId,
          service,
        }).then((createdService) => {
          createdServiceRef.current = createdService;
          return createdService;
        });
      }

      return creationPromiseRef.current;
    },
    [createService]
  );

  const linkRetainedService = useCallback(
    async (service: ServiceDto): Promise<void> => {
      setState({ status: "created-without-binding", service });
      onCompleteRef.current?.(service);
    },
    []
  );

  const create = useCallback(
    async ({
      organizationId,
      service,
      linkDirectory,
    }: {
      organizationId: string;
      service: CreateServiceDto;
      linkDirectory: boolean;
    }): Promise<void> => {
      if (creationPromiseRef.current && !createdServiceRef.current) {
        return;
      }

      if (createdServiceRef.current) {
        if (linkDirectory) {
          await linkRetainedService(createdServiceRef.current);
        }
        return;
      }

      setState({ status: "creating", linkDirectory });

      try {
        const createdService = await createOnce(organizationId, service);
        if (linkDirectory) {
          await linkRetainedService(createdService);
          return;
        }

        setState({
          status: "created-without-binding",
          service: createdService,
        });
        onCompleteRef.current?.(createdService);
      } catch (error) {
        creationPromiseRef.current = null;
        setState({
          status: "creation-failed",
          error: errorMessage(error, "Failed to create service"),
        });
      }
    },
    [createOnce, linkRetainedService]
  );

  const retryLinking = useCallback(async (): Promise<void> => {
    const createdService = createdServiceRef.current;
    if (!createdService) {
      return;
    }
    await linkRetainedService(createdService);
  }, [linkRetainedService]);

  const finishLater = useCallback((): void => {
    const createdService = createdServiceRef.current;
    if (!createdService) {
      return;
    }
    setState({ status: "created-without-binding", service: createdService });
    onCompleteRef.current?.(createdService);
  }, []);

  return {
    state,
    create,
    retryLinking,
    finishLater,
    isBusy:
      state.status === "creating" ||
      state.status === "picking" ||
      state.status === "binding",
  };
}
