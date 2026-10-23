import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import type { PrivateBetaAccessRequestSubmissionDto } from "@hey-hey/ui-common/api";
import {
  privateBetaAccessRequestFieldConstraints,
  unifiedApiClient,
} from "@hey-hey/ui-common/clients";

export interface RequestAccessFormValues {
  name: string;
  workEmail: string;
  organizationName: string;
}

export type RequestAccessField = keyof RequestAccessFormValues;
export type RequestAccessErrors = Partial<Record<RequestAccessField, string>>;

export const requestAccessFieldIds: Record<RequestAccessField, string> = {
  name: "request-access-name",
  workEmail: "request-access-work-email",
  organizationName: "request-access-organization-name",
};

const requestAccessFields: RequestAccessField[] = [
  "name",
  "workEmail",
  "organizationName",
];

const initialValues: RequestAccessFormValues = {
  name: "",
  workEmail: "",
  organizationName: "",
};

const isValidEmail = (value: string): boolean =>
  value.length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const validateRequestAccess = (
  values: RequestAccessFormValues,
): RequestAccessErrors => {
  const errors: RequestAccessErrors = {};

  const name = values.name.trim();
  if (!name) {
    errors.name = "Enter your name.";
  } else if (
    name.length > privateBetaAccessRequestFieldConstraints.name.maxLength
  ) {
    errors.name = "Name is too long.";
  }

  const workEmail = values.workEmail.trim();
  if (!workEmail) {
    errors.workEmail = "Enter your work email.";
  } else if (!isValidEmail(workEmail)) {
    errors.workEmail = "Enter a valid work email.";
  } else if (
    workEmail.length >
    privateBetaAccessRequestFieldConstraints.workEmail.maxLength
  ) {
    errors.workEmail = "Work email is too long.";
  }

  const organizationName = values.organizationName.trim();
  if (!organizationName) {
    errors.organizationName = "Enter your organization name.";
  } else if (
    organizationName.length >
    privateBetaAccessRequestFieldConstraints.organizationName.maxLength
  ) {
    errors.organizationName = "Organization name is too long.";
  }

  return errors;
};

const toSubmission = (
  values: RequestAccessFormValues,
): PrivateBetaAccessRequestSubmissionDto => ({
  name: values.name.trim(),
  workEmail: values.workEmail.trim(),
  organizationName: values.organizationName.trim(),
});

const getSubmissionErrorMessage = (error: unknown): string => {
  const status = axios.isAxiosError(error)
    ? error.response?.status
    : typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "status" in error.response
      ? error.response.status
      : undefined;

  if (status === 429) {
    return "Too many requests right now. Please wait a moment and try again.";
  }

  return "We couldn't submit your request. Your details are still here; review them and try again.";
};

export const useRequestAccess = () => {
  const [values, setValues] = useState<RequestAccessFormValues>(initialValues);
  const [errors, setErrors] = useState<RequestAccessErrors>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const submittingRef = useRef(false);
  const focusFirstInvalidRef = useRef(false);

  useEffect(() => {
    if (!focusFirstInvalidRef.current) {
      return;
    }
    focusFirstInvalidRef.current = false;

    if (!hasAttemptedSubmit || Object.keys(errors).length === 0) {
      return;
    }

    const firstInvalidField = requestAccessFields.find(
      (field) => errors[field],
    );
    if (firstInvalidField) {
      document
        .getElementById(requestAccessFieldIds[firstInvalidField])
        ?.focus();
    }
  }, [errors, hasAttemptedSubmit]);

  const handleChange = useCallback(
    (field: RequestAccessField, value: string) => {
      const nextValues = { ...values, [field]: value };
      setValues(nextValues);

      if (hasAttemptedSubmit) {
        setErrors(validateRequestAccess(nextValues));
      }
    },
    [hasAttemptedSubmit, values],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (submittingRef.current) {
        return;
      }

      setHasAttemptedSubmit(true);
      focusFirstInvalidRef.current = true;
      const validationErrors = validateRequestAccess(values);
      setErrors(validationErrors);
      setSubmitError(null);

      if (Object.keys(validationErrors).length > 0) {
        return;
      }

      submittingRef.current = true;
      setIsSubmitting(true);

      try {
        const response = await unifiedApiClient.submitPrivateBetaAccessRequest({
          privateBetaAccessRequestSubmissionDto: toSubmission(values),
        });

        if (!response.data.data.accepted) {
          throw new Error("The request was not accepted.");
        }

        setAccepted(true);
      } catch (error: unknown) {
        setSubmitError(getSubmissionErrorMessage(error));
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [values],
  );

  return {
    accepted,
    errors,
    handleChange,
    handleSubmit,
    hasAttemptedSubmit,
    isSubmitting,
    submitError,
    values,
  };
};
