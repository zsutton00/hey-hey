import React from "react";
import { Box, Typography, Alert } from "@mui/material";
import AnimatedButton from "../../../../components/AnimatedButton";

interface TestResult {
  success: boolean;
  message: string;
}

interface IntegrationTestButtonProps {
  onTest: () => void;
  isFormValid: boolean;
  isTestingConnection: boolean;
  testResult: TestResult | null;
  testButtonText?: string;
  testingText?: string;
}

export const IntegrationTestButton: React.FC<IntegrationTestButtonProps> = ({
  onTest,
  isFormValid,
  isTestingConnection,
  testResult,
  testButtonText = "Test Connection",
  testingText = "Testing Connection...",
}) => {
  const buttonLabel = isTestingConnection ? testingText : testButtonText;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Connection Test
      </Typography>

      <AnimatedButton
        onClick={onTest}
        disabled={!isFormValid || isTestingConnection}
        loading={isTestingConnection}
        variant="outlined"
        fullWidth
        sx={{ mb: 2 }}
      >
        {buttonLabel}
      </AnimatedButton>

      {testResult && (
        <Alert
          severity={testResult.success ? "success" : "error"}
          sx={{ mt: 1 }}
        >
          {testResult.message}
        </Alert>
      )}
    </Box>
  );
};
