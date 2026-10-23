import { useEffect, useState } from "react";
import type { ControllerAuthorizationCadence, MachineDto } from "../../api";
import { ControllerAuthorizationCadenceDialog } from "./ControllerAuthorizationCadenceDialog";
import {
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "./webauthnAssertion";

export interface ControllerAuthorizationPromptRequest {
  cause?: ControllerAuthorizationPromptCause | null;
  errorMessage: string | null;
  machine: MachineDto;
  preferredCadence: ControllerAuthorizationCadence;
}

export interface ControllerAuthorizationPromptCause {
  operation: string;
  purpose: string | null;
}

interface PendingPrompt extends ControllerAuthorizationPromptRequest {
  reject: (error: ControllerAuthorizationClientError) => void;
  resolve: (cadence: ControllerAuthorizationCadence) => void;
}

type PromptListener = (request: PendingPrompt | null) => void;

let listener: PromptListener | null = null;
let activePrompt: PendingPrompt | null = null;
const queuedPrompts: PendingPrompt[] = [];

const publishNext = (): void => {
  activePrompt = queuedPrompts.shift() ?? null;
  listener?.(activePrompt);
};

// eslint-disable-next-line react-refresh/only-export-components
export const requestControllerAuthorizationCadence = (
  request: ControllerAuthorizationPromptRequest
): Promise<ControllerAuthorizationCadence> =>
  new Promise((resolve, reject) => {
    if (!listener) {
      reject(
        new ControllerAuthorizationClientError(
          ControllerAuthorizationClientFailureCode.DialogUnavailable,
          "The controller authorization dialog is unavailable."
        )
      );
      return;
    }
    queuedPrompts.push({ ...request, reject, resolve });
    if (!activePrompt) {
      publishNext();
    }
  });

const settlePrompt = (settle: (prompt: PendingPrompt) => void): void => {
  if (!activePrompt) {
    return;
  }
  const prompt = activePrompt;
  activePrompt = null;
  settle(prompt);
  publishNext();
};

export const ControllerAuthorizationPromptHost = () => {
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [selectedCadence, setSelectedCadence] =
    useState<ControllerAuthorizationCadence | null>(null);

  useEffect(() => {
    const promptListener: PromptListener = (nextPrompt) => {
      setPrompt(nextPrompt);
      setSelectedCadence(nextPrompt?.preferredCadence ?? null);
    };
    listener = promptListener;
    if (activePrompt) {
      listener(activePrompt);
    }
    return () => {
      if (listener === promptListener) {
        listener = null;
      }
    };
  }, []);

  if (!prompt || !selectedCadence) {
    return null;
  }

  return (
    <ControllerAuthorizationCadenceDialog
      cause={prompt.cause}
      errorMessage={prompt.errorMessage}
      machineName={prompt.machine.name}
      onAuthorize={() => {
        settlePrompt((pending) => pending.resolve(selectedCadence));
      }}
      onCadenceChange={setSelectedCadence}
      onCancel={() => {
        settlePrompt((pending) =>
          pending.reject(
            new ControllerAuthorizationClientError(
              ControllerAuthorizationClientFailureCode.ConfirmationDeclined,
              "Controller authorization was cancelled."
            )
          )
        );
      }}
      open
      selectedCadence={selectedCadence}
    />
  );
};
