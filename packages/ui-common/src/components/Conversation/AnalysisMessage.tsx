import { Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { AnalysisSystemMessageData } from "../../api";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";

// Component to render analysis data
export const AnalysisMessage: React.FC<{
  data: AnalysisSystemMessageData;
  response: string;
  onAcknowledge: () => void;
  isSubmitting: boolean;
}> = ({ data, response, onAcknowledge, isSubmitting }) => {
  const { t } = useTranslation();

  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {data.title || t(KEYS.conversation.analysis.title)}
        </Typography>

        <Stack spacing={1.5}>
          <MarkdownRenderer allowMentionEscapes>{response}</MarkdownRenderer>

          {data.analysis?.recommendations?.length ? (
            <Stack spacing={0.5}>
              <Typography variant="subtitle2">
                {t(KEYS.conversation.analysis.recommendations)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {data.analysis.recommendations.join(", ")}
              </Typography>
            </Stack>
          ) : null}

          <Button
            variant="contained"
            onClick={onAcknowledge}
            disabled={isSubmitting}
          >
            {t(KEYS.conversation.analysis.next)}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};
