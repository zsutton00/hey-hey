import { Box } from "@mui/material";
import type {
  DesignDocStatusByTemplate,
  SupportedDesignDocTemplate,
} from "../../types/designDocStatus";
import { DesignDocStatusSelector } from "../Selectors/DesignDocStatusSelector";
import { TagsInput } from "../Selectors/TagsInput";

export interface DesignDocMetadataProps<
  TTemplate extends SupportedDesignDocTemplate = SupportedDesignDocTemplate
> {
  template: TTemplate;
  // Field values
  status: DesignDocStatusByTemplate[TTemplate];
  tags: string[];

  // Change handlers
  onStatusChange: (status: DesignDocStatusByTemplate[TTemplate]) => void;
  onTagsChange: (tags: string[]) => void;

  // Optional UI controls
  disabled?: boolean;
  showLabels?: boolean;
  showTags?: boolean;
  size?: "small" | "medium";
}

export const DesignDocMetadata = <
  TTemplate extends SupportedDesignDocTemplate
>({
  template,
  status,
  tags,
  onStatusChange,
  onTagsChange,
  disabled = false,
  showLabels = true,
  showTags = false,
  size = "medium",
}: DesignDocMetadataProps<TTemplate>) => {
  const isStatusReadOnly =
    status?.startsWith("GENERATING_") || status?.startsWith("ADR_GENERATING_");

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", md: "row" },
        flexWrap: "wrap",
        gap: 2,
        alignItems: { xs: "stretch", md: "flex-start" },
      }}
    >
      <Box
        sx={{
          flex: { md: "0 1 25%" },
          width: { xs: "100%", md: "auto" },
          maxWidth: "200px",
          minWidth: 140,
        }}
      >
        <DesignDocStatusSelector
          template={template}
          value={status}
          onChange={onStatusChange}
          label={showLabels ? "Status" : undefined}
          disabled={disabled}
          fullWidth
          readOnly={isStatusReadOnly}
          size={size}
        />
      </Box>

      {showTags && (
        <Box
          sx={{
            flex: { md: "1 1 60%" },
            width: { xs: "100%", md: "auto" },
            minWidth: 200,
          }}
        >
          <TagsInput
            value={tags}
            onChange={onTagsChange}
            label={showLabels ? "Tags" : undefined}
            disabled={disabled}
            fullWidth
            size={size}
            placeholder="Add tags..."
          />
        </Box>
      )}
    </Box>
  );
};
