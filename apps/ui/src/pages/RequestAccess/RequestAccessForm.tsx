import type { ChangeEvent, FormEventHandler } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
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

  return (
    <Box
      component="form"
      noValidate
      onSubmit={onSubmit}
      aria-busy={isSubmitting}
      data-testid="request-access-form"
    >
      <Stack spacing={{ xs: 3, sm: 3.5 }}>
        <Box>
          <Typography component="h2" variant="h4" gutterBottom>
            Create your beta account
          </Typography>
          <Typography color="text.secondary">
            Enter your name, email, and organization. All fields are required.
          </Typography>
        </Box>

        {submitError ? (
          <Alert
            severity="error"
            role="alert"
            aria-live="assertive"
            sx={{ borderRadius: 2 }}
          >
            {submitError}
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
            gap: { xs: 2.5, sm: 3 },
          }}
        >
          <TextField
            id={requestAccessFieldIds.name}
            label="Name"
            value={values.name}
            onChange={changeField("name")}
            error={Boolean(errors.name)}
            helperText={hasAttemptedSubmit ? errors.name : undefined}
            required
            fullWidth
            autoComplete="name"
            inputProps={{
              maxLength:
                privateBetaAccessRequestFieldConstraints.name.maxLength,
            }}
          />
          <TextField
            id={requestAccessFieldIds.workEmail}
            label="Work email"
            type="email"
            value={values.workEmail}
            onChange={changeField("workEmail")}
            error={Boolean(errors.workEmail)}
            helperText={hasAttemptedSubmit ? errors.workEmail : undefined}
            required
            fullWidth
            autoComplete="email"
            inputProps={{
              maxLength:
                privateBetaAccessRequestFieldConstraints.workEmail.maxLength,
            }}
          />
          <TextField
            id={requestAccessFieldIds.organizationName}
            label="Organization name"
            value={values.organizationName}
            onChange={changeField("organizationName")}
            error={Boolean(errors.organizationName)}
            helperText={
              hasAttemptedSubmit ? errors.organizationName : undefined
            }
            required
            fullWidth
            autoComplete="organization"
            inputProps={{
              maxLength:
                privateBetaAccessRequestFieldConstraints.organizationName
                  .maxLength,
            }}
          />
        </Box>

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting}
          sx={{
            alignSelf: { xs: "stretch", sm: "flex-start" },
            minWidth: { sm: 160 },
            textTransform: "none",
          }}
        >
          {isSubmitting ? (
            <>
              <CircularProgress
                color="inherit"
                size={20}
                aria-label="Submitting request"
                sx={{ mr: 1 }}
              />
              Submitting…
            </>
          ) : submitError ? (
            "Retry"
          ) : (
            "Sign up"
          )}
        </Button>

        <Button
          component={Link}
          to="/login"
          variant="text"
          sx={{
            alignSelf: { xs: "stretch", sm: "flex-start" },
            textTransform: "none",
          }}
        >
          Existing User Sign In
        </Button>
      </Stack>
    </Box>
  );
};
