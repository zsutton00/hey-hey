import type { ChangeEvent, FormEventHandler } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  BRANDED_FIELD_LABEL_SX,
  BRANDED_FIELD_SX,
  BRANDED_LINK_SX,
  BrandedButton,
} from "@hey-hey/ui-common/components";
import { privateBetaAccessRequestFieldConstraints } from "@hey-hey/ui-common/clients";
import {
  requestAccessFieldIds,
  type RequestAccessErrors,
  type RequestAccessField,
  type RequestAccessFormValues,
} from "./useRequestAccess";

interface RequestAccessFormProps {
  errors: RequestAccessErrors;
  hasAttemptedSubmit: boolean;
  isSubmitting: boolean;
  onChange: (field: RequestAccessField, value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  submitError: string | null;
  values: RequestAccessFormValues;
}

export const RequestAccessForm = ({
  errors,
  hasAttemptedSubmit,
  isSubmitting,
  onChange,
  onSubmit,
  submitError,
  values,
}: RequestAccessFormProps) => {
  const changeField =
    (field: RequestAccessField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(field, event.target.value);
    };

  const fields: Array<{
    field: RequestAccessField;
    id: string;
    label: string;
    type?: string;
    autoComplete: string;
    value: string;
    maxLength: number;
  }> = [
    {
      field: "name",
      id: requestAccessFieldIds.name,
      label: "Name",
      autoComplete: "name",
      value: values.name,
      maxLength: privateBetaAccessRequestFieldConstraints.name.maxLength,
    },
    {
      field: "workEmail",
      id: requestAccessFieldIds.workEmail,
      label: "Email",
      type: "email",
      autoComplete: "email",
      value: values.workEmail,
      maxLength: privateBetaAccessRequestFieldConstraints.workEmail.maxLength,
    },
    {
      field: "organizationName",
      id: requestAccessFieldIds.organizationName,
      label: "Organization name",
      autoComplete: "organization",
      value: values.organizationName,
      maxLength:
        privateBetaAccessRequestFieldConstraints.organizationName.maxLength,
    },
  ];

  return (
    <Box
      component="form"
      noValidate
      onSubmit={onSubmit}
      aria-busy={isSubmitting}
      data-testid="request-access-form"
    >
      <Stack spacing={3}>
        <Box>
          <Typography
            component="h2"
            variant="h5"
            sx={{ color: "#fff", fontWeight: 700 }}
            gutterBottom
          >
            Create your beta account
          </Typography>
          <Typography sx={{ color: "rgb(255 255 255 / 72%)" }}>
            Enter your name, email, and organization. All fields are required.
          </Typography>
        </Box>

        {submitError ? (
          <Alert severity="error" role="alert" aria-live="assertive">
            {submitError}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            columnGap: 3,
          }}
        >
          {fields.map((entry) => (
            <Box key={entry.field}>
              <Box
                component="label"
                htmlFor={entry.id}
                sx={BRANDED_FIELD_LABEL_SX}
              >
                {entry.label} *
              </Box>
              <TextField
                id={entry.id}
                type={entry.type}
                value={entry.value}
                onChange={changeField(entry.field)}
                error={Boolean(errors[entry.field])}
                helperText={
                  hasAttemptedSubmit ? errors[entry.field] : undefined
                }
                required
                fullWidth
                autoComplete={entry.autoComplete}
                inputProps={{ maxLength: entry.maxLength }}
                sx={BRANDED_FIELD_SX}
              />
            </Box>
          ))}
        </Box>

        <BrandedButton type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <CircularProgress
              color="inherit"
              size={24}
              aria-label="Submitting request"
            />
          ) : submitError ? (
            "Retry"
          ) : (
            "Sign up"
          )}
        </BrandedButton>

        <Box
          component={Link}
          to="/login"
          sx={{ ...BRANDED_LINK_SX, alignSelf: "center" }}
        >
          Existing User Sign In
        </Box>
      </Stack>
    </Box>
  );
};
