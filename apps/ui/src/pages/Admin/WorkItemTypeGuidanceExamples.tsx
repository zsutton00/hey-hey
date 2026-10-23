import { Button, Stack, TextField, Typography } from "@mui/material";
import type { GuidanceExample } from "./workItemTypeGuidanceForm";

interface Props {
  examples: GuidanceExample[] | undefined;
  onChange: (examples: GuidanceExample[]) => void;
  label: string;
}

export function WorkItemTypeGuidanceExamples({
  examples,
  onChange,
  label,
}: Props) {
  const rows = examples ?? [];
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1">{label}</Typography>
      {rows.map((example, index) => (
        <Stack
          spacing={1}
          key={index}
          role="group"
          aria-label={`${label} ${index + 1}`}
        >
          <TextField
            label="Example title"
            required
            value={example.title}
            error={!example.title.trim()}
            helperText={
              !example.title.trim() ? "Enter an example title." : undefined
            }
            onChange={(event) =>
              onChange(
                rows.map((row, i) =>
                  i === index ? { ...row, title: event.target.value } : row,
                ),
              )
            }
          />
          <TextField
            label="Example guidance"
            required
            multiline
            value={example.guidance}
            error={!example.guidance.trim()}
            helperText={
              !example.guidance.trim() ? "Enter example guidance." : undefined
            }
            onChange={(event) =>
              onChange(
                rows.map((row, i) =>
                  i === index ? { ...row, guidance: event.target.value } : row,
                ),
              )
            }
          />
          <Stack direction="row">
            <Button
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              Remove example
            </Button>
          </Stack>
        </Stack>
      ))}
      <Button onClick={() => onChange([...rows, { title: "", guidance: "" }])}>
        Add {label === "Examples" ? "general example" : "context example"}
      </Button>
    </Stack>
  );
}
