import { Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import React from "react";
import type {
  ArtifactResponseDto,
  ArtifactStatus,
} from "@hey-hey/ui-common/api";

// Helper function to extract content from ArtifactData union type
const extractArtifactContent = (data: any): React.ReactNode => {
  if (!data) return "";

  // Handle different artifact data types that have content
  if (typeof data.content === "string") {
    return data.content;
  }

  // Handle Q&A pairs
  if (data.question && data.answer) {
    return (
      <>
        <Typography>Q: {data.question}</Typography>
        <Typography>A: {data.answer}</Typography>
      </>
    );
  }

  // Handle other types that might have description or title
  if (data.description) {
    return data.description;
  }

  if (data.title) {
    return data.title;
  }

  // Fallback to JSON string representation
  return JSON.stringify(data).substring(0, 200);
};

export const Artifact: React.FC<{
  artifact: ArtifactResponseDto;
}> = ({ artifact }) => {
  const getTypeColor = (type: string) => {
    // Handle the actual API values
    if (type?.includes("QA_PAIR")) return "primary";
    if (type?.includes("DOCUMENT")) return "info";
    if (type?.includes("TASK")) return "success";
    if (type?.includes("INSIGHT")) return "warning";
    if (type?.includes("NOTE")) return "secondary";
    return "default";
  };

  const getStatusColor = (status: ArtifactStatus) => {
    switch (status) {
      case "ACTIVE":
        return "success";
      case "ARCHIVED":
        return "default";
      case "DRAFT":
        return "warning";
      default:
        return "default";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const truncateContent = (
    content: React.ReactNode,
    maxLength: number = 20000,
  ) => {
    if (typeof content === "string") {
      if (content.length <= maxLength) return content;
      return content.substring(0, maxLength) + "...";
    }
    return content;
  };

  return (
    <Card key={artifact.id}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 2,
          }}
        >
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" gutterBottom>
              {artifact.title || "Untitled Artifact"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {truncateContent(extractArtifactContent(artifact.data))}
            </Typography>
          </Box>
          <Box sx={{ ml: 2, minWidth: "auto" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              {formatDate(artifact.createdAt)}
            </Typography>
          </Box>
        </Box>

        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 0.5 }}>
          <Chip
            label={artifact.type.replace("_", " ")}
            color={getTypeColor(artifact.type) as "primary"}
            size="small"
          />
          <Chip
            label={artifact.status}
            color={getStatusColor(artifact.status) as "primary"}
            size="small"
            variant="outlined"
          />
          {artifact.category && (
            <Chip label={artifact.category} size="small" variant="outlined" />
          )}
          {artifact.sourceType && (
            <Chip
              label={`Source: ${artifact.sourceType}`}
              size="small"
              variant="outlined"
            />
          )}
        </Stack>

        {artifact.tags && artifact.tags.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap", gap: 0.5 }}
            >
              {artifact.tags.map((tag, index) => (
                <Chip key={index} label={tag} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>
        )}

        {/* Additional metadata */}
        <Box sx={{ mt: 2, pt: 1, borderTop: 1, borderColor: "divider" }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              fontSize: "0.75rem",
              color: "text.secondary",
            }}
          >
            <Box sx={{ flex: "1 1 200px" }}>
              <Typography variant="caption" display="block">
                ID: {artifact.id.substring(0, 8)}...
              </Typography>
            </Box>
            {artifact.projectId && (
              <Box sx={{ flex: "1 1 200px" }}>
                <Typography variant="caption" display="block">
                  Project: {artifact.projectId.substring(0, 8)}...
                </Typography>
              </Box>
            )}
            {artifact.parentId && (
              <Box sx={{ flex: "1 1 200px" }}>
                <Typography variant="caption" display="block">
                  Parent: {artifact.parentId.substring(0, 8)}...
                </Typography>
              </Box>
            )}
            <Box sx={{ flex: "1 1 200px" }}>
              <Typography variant="caption" display="block">
                Public: {artifact.isPublic ? "Yes" : "No"}
              </Typography>
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
