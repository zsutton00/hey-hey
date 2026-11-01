import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Dialog,
  DialogContent,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import { ModelSelector } from "../../src/components/AgentSession/ModelSelector";
import { MachinePicker } from "../../src/components/AgentSession/MachinePicker";
import { setCapabilityCatalogForTests } from "../../src/components/AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../src/test/capabilityCatalogFixture";
import {
  ConversationStartRunRequestDtoProviderEnum,
  AuthorizationProtocolVersion,
  MachineExecutionReadinessState,
  CurrentControllerMachineEligibilityState,
  type MachineDto,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../src/api";
setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
const machine: MachineDto = {
  machineId: "fixture-machine",
  currentControllerCredentialId: "fixture-credential",
  name: "MacBook Pro",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};
function Fixture() {
  const [provider, setProvider] =
    useState<ConversationStartRunRequestDtoProviderEnum>(
      ConversationStartRunRequestDtoProviderEnum.Claude,
    );
  const [model, setModel] = useState("claude-opus-5-5");
  const [effort, setEffort] =
    useState<ConversationStartRunRequestDtoReasoningEffortEnum | null>(
      "medium",
    );
  const [fast, setFast] = useState(false);
  return (
    <ThemeProvider theme={createTheme()}>
      <Dialog open fullWidth maxWidth="md">
        <DialogContent>
          <ModelSelector
            provider={provider}
            model={model}
            reasoningEffort={effort}
            onProviderChange={setProvider}
            onModelChange={setModel}
            onReasoningEffortChange={setEffort}
            fastMode={fast}
            onFastModeChange={setFast}
            favorites={[]}
            onSaveFavorite={() => ({ ok: true })}
            onApplyFavorite={() => {}}
            onRenameFavorite={() => ({ ok: true })}
            onDeleteFavorite={() => {}}
            rowEnd={
              <MachinePicker
                machines={[machine]}
                selectedMachineId={machine.machineId}
                onSelect={() => {}}
                disabled
                mobileMode="editor"
              />
            }
          />
          <output data-testid="selection">
            {JSON.stringify({ provider, model, effort, fast })}
          </output>
        </DialogContent>
      </Dialog>
    </ThemeProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
