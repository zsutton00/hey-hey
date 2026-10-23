import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  InitiativeResponseDto,
  GenerationSystemMessageData,
} from "../../../../api";
import { usePathService } from "../../../../contexts";
import { useUserAction } from "../../../../contexts/TrackingContext";

interface InitiativeFieldValue {
  content: string;
  organizationId: string;
  projectId: string;
  initiativeId: string;
  conversationId: string;
}

interface UseInitiativeFieldProps {
  value: GenerationSystemMessageData;
  onChange?: (value: InitiativeFieldValue | string | number | object) => void;
  initiatives: InitiativeResponseDto[];
}

interface UseInitiativeFieldReturn {
  reviewedInitiatives: Set<string>;
  allInitiativesReviewed: boolean;
  allInitiativesActive: boolean;
  validationError: string | null;
  response: string;
  handleInitiativeClick: (initiative: InitiativeResponseDto) => void;
  handleAcknowledge: () => void;
  isInitiativesData: (val: unknown) => val is GenerationSystemMessageData;
}

export const useInitiativeField = ({
  value,
  onChange,
  initiatives,
}: UseInitiativeFieldProps): UseInitiativeFieldReturn => {
  const navigate = useNavigate();
  const { projectId } = useParams<{
    projectId: string;
  }>();
  const { trackInitiative } = useUserAction();
  const pathService = usePathService();

  // Track which initiatives have been reviewed
  const [reviewedInitiatives, setReviewedInitiatives] = useState<Set<string>>(
    new Set(),
  );

  // Check if value contains initiatives data
  const isInitiativesData = useCallback(
    (val: unknown): val is GenerationSystemMessageData => {
      return (
        typeof val === "object" &&
        val !== null &&
        "generatedInitiativeIds" in val &&
        Array.isArray(
          (val as GenerationSystemMessageData).generatedInitiativeIds,
        )
      );
    },
    [],
  );

  // Handle initiative click - mark as reviewed and navigate to edit page
  const handleInitiativeClick = useCallback(
    (initiative: InitiativeResponseDto) => {
      // Mark initiative as reviewed
      setReviewedInitiatives((prev) => new Set(prev).add(initiative.id));

      // Track initiative click
      trackInitiative("view", {
        initiativeId: initiative.id,
        initiativeName: initiative.name,
      });

      // Navigate to initiative edit page using PathService
      const editPath = pathService.onboardingInitiative({
        projectId: projectId || "",
        initiativeId: initiative.id,
      });
      navigate(editPath);
    },
    [trackInitiative, navigate, projectId, pathService],
  );

  // Check if all initiatives are reviewed
  const allInitiativesReviewed = useMemo(() => {
    if (!isInitiativesData(value)) return true;
    return value.generatedInitiativeIds!.every((initiativeId) =>
      reviewedInitiatives.has(initiativeId),
    );
  }, [value, reviewedInitiatives, isInitiativesData]);

  // Check if all initiatives have ACTIVE status
  const allInitiativesActive = useMemo(() => {
    if (!isInitiativesData(value) || initiatives.length === 0) return false;
    return initiatives.every((initiative) => initiative.status === "ACTIVE");
  }, [value, initiatives, isInitiativesData]);

  // Validation error message
  const validationError = useMemo(() => {
    if (!isInitiativesData(value) || initiatives.length === 0) return null;

    const inactiveCount = initiatives.filter(
      (initiative) => initiative.status !== "ACTIVE",
    ).length;

    if (inactiveCount > 0) {
      return `Please review and activate all initiatives before submitting. ${inactiveCount} initiative${
        inactiveCount === 1 ? "" : "s"
      } still need${inactiveCount === 1 ? "s" : ""} to be refined.`;
    }

    return null;
  }, [value, initiatives, isInitiativesData]);

  // Update form validation when all initiatives are active
  useEffect(() => {
    if (onChange && allInitiativesActive) {
      const activeInitiativesCount = initiatives.length;
      // Send user creation message as required by backend
      onChange(
        `user created ${activeInitiativesCount} initiative${
          activeInitiativesCount === 1 ? "" : "s"
        }`,
      );
    }
  }, [onChange, allInitiativesActive, initiatives.length]);

  // Handle acknowledge for initiatives list (kept for compatibility)
  const handleAcknowledge = useCallback(() => {
    if (onChange) {
      onChange("acknowledged");
    }
  }, [onChange]);

  // Extract response from the value object if it exists
  const response =
    typeof value === "object" && value !== null && "response" in value
      ? (value as GenerationSystemMessageData & { response?: string })
          .response || ""
      : "";

  return {
    reviewedInitiatives,
    allInitiativesReviewed,
    allInitiativesActive,
    validationError,
    response,
    handleInitiativeClick,
    handleAcknowledge,
    isInitiativesData,
  };
};

// Export types for use by consumers
export type { UseInitiativeFieldProps, UseInitiativeFieldReturn };
