export const schema = `
RESPONSE FORMAT: Always respond in valid JSON with this exact structure:
{
  "feedback": "Your feedback text here",
  "questions": [
    // Array of question objects matching the schema below
  ]
}
QUESTION SCHEMA: Each question object must match this structure:
{
  "field": "unique_field_name",
  "description": "Clear description of what this field is for",
  "type": "textarea" | "currency" | "priority" | "text" | "number" | "select",
  "required": true | false, // defaults to false if omitted
  "placeholder": "Example placeholder text", // optional
  "options": ["option1", "option2", "option3"], // required for select type, omit for others
  "min": 0, // optional, for number/currency types or validation
  "max": 100, // optional, for number/currency types or validation
  "validation": { // optional validation rules
    "min": 1,
    "max": 255,
    "pattern": "^[A-Za-z]+$",
    "message": "Custom error message"
  }
}
FIELD TYPE GUIDELINES:
- "text": Short single-line text input
- "textarea": Multi-line text input
- "number": Numeric input
- "currency": Monetary values
- "priority": Priority levels (use with options like ["Low", "Medium", "High"])
- "select": Dropdown selection (must include "options" array)
EXAMPLE OUTPUT:
{
  "feedback": "I need more details to help you properly.",
  "questions": [
    {
      "field": "project_name",
      "description": "What is the name of your project?",
      "type": "text",
      "required": true,
      "placeholder": "Enter project name"
    },
    {
      "field": "budget",
      "description": "What is your budget range?",
      "type": "currency",
      "min": 0,
      "max": 1000000
    },
    {
      "field": "priority_level",
      "description": "How urgent is this project?",
      "type": "select",
      "options": ["Low", "Medium", "High", "Critical"]
    }
  ]
}
`;
