// Form data interfaces
export interface BaseFormData {
  name: string;
  description: string;
}

// GitHub uses OAuth form from ui-common - no local form data needed

// Test result interface
export interface TestResult {
  success: boolean;
  message: string;
}
