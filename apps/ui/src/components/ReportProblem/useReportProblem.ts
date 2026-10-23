import type { ReportBugRequestDto } from "@hey-hey/ui-common/api";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import axios from "axios";
import { useCallback, useRef, useState } from "react";

export type ReportProblemState =
  | { status: "editing" }
  | { status: "submitting" }
  | { status: "failed"; message: string; throttled: boolean }
  | { status: "succeeded"; bugId: string };

const getFailureMessage = (error: unknown): string => {
  if (!axios.isAxiosError(error)) {
    return "We couldn’t submit your report. Please try again.";
  }

  const responseMessage = (error.response?.data as { message?: unknown })
    ?.message;
  return typeof responseMessage === "string" && responseMessage.trim()
    ? responseMessage
    : "We couldn’t submit your report. Please try again.";
};

export const useReportProblem = () => {
  const [state, setState] = useState<ReportProblemState>({
    status: "editing",
  });
  const inFlightRef = useRef(false);

  const submit = useCallback(async (request: ReportBugRequestDto) => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setState({ status: "submitting" });

    try {
      const response = await unifiedApiClient.reportBug({
        reportBugRequestDto: request,
      });
      setState({
        status: "succeeded",
        bugId: response.data.data.bugId,
      });
    } catch (error) {
      const throttled =
        axios.isAxiosError(error) && error.response?.status === 429;
      setState({
        status: "failed",
        throttled,
        message: throttled
          ? "You’ve submitted too many reports. Try again later."
          : getFailureMessage(error),
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    if (!inFlightRef.current) {
      setState({ status: "editing" });
    }
  }, []);

  return { state, submit, reset };
};
