import { useQueryClient } from "@tanstack/react-query";
import type {
  DemoSandboxAdminOverviewDto,
  DemoSandboxProgramDto,
  DemoTemplateDto,
  SetDemoTemplateDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  demoSandboxAdminKeys,
  demoSandboxAdminOverviewQueryOptions,
} from "../collections/demoSandboxAdmin";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useMutation, type MutationResult } from "../core/useMutation";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";

export interface UseDemoSandboxAdminReturn extends DataHookReturn<DemoSandboxAdminOverviewDto> {
  updateProgram: MutationResult<DemoSandboxProgramDto, DemoSandboxProgramDto>;
  setTemplate: MutationResult<SetDemoTemplateDto, DemoTemplateDto>;
}

export function useDemoSandboxAdmin(
  options: CollectionHookOptions<DemoSandboxAdminOverviewDto> = {},
): UseDemoSandboxAdminReturn {
  const queryClient = useQueryClient();
  const { result, state } = useDataLayerQuery(
    demoSandboxAdminOverviewQueryOptions(),
    { ...options, enabled: options.enabled !== false },
  );
  const data = result.data ?? null;
  // The PUT result is authoritative; the follow-up read refreshes the overview
  // (including activeCount) without turning a failed re-read into a failed save.
  const refresh = () =>
    void invalidateWithFollowUpRead(queryClient, {
      queryKey: demoSandboxAdminKeys.overview(),
      exact: true,
    });
  const updateProgram = useMutation(
    async (demoSandboxProgramDto: DemoSandboxProgramDto) => {
      const response = await unifiedApiClient.setDemoSandboxProgram({
        demoSandboxProgramDto,
      });
      const saved = response.data?.data;
      if (!saved)
        throw new Error("The demo sandbox program update was incomplete.");
      refresh();
      return saved;
    },
  );
  const setTemplate = useMutation(
    async (setDemoTemplateDto: SetDemoTemplateDto) => {
      const response = await unifiedApiClient.setDemoSandboxTemplate({
        setDemoTemplateDto,
      });
      const saved = response.data?.data;
      if (!saved)
        throw new Error("The demo template designation was incomplete.");
      refresh();
      return saved;
    },
  );

  return {
    ...state,
    data,
    isReady: state.isReady && data !== null,
    updateProgram,
    setTemplate,
  };
}
