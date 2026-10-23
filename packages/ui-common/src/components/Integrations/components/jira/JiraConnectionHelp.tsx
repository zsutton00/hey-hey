import React from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Alert,
  Divider,
  Link,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface JiraConnectionHelpProps {
  instanceType: "cloud" | "server";
}

export const JiraConnectionHelp: React.FC<JiraConnectionHelpProps> = ({
  instanceType,
}) => {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Setting up your Jira Integration
      </Typography>

      <Typography variant="body1" sx={{ mb: 3 }}>
        This guide will help you connect your Jira{" "}
        {instanceType === "cloud" ? "Cloud" : "Server"} instance to our platform
        for seamless issue tracking and project management.
      </Typography>

      {instanceType === "cloud" ? <CloudHelp /> : <ServerHelp />}

      <Divider sx={{ my: 3 }} />

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Required Permissions</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Your Jira account needs the following permissions:
          </Typography>
          <List dense>
            <ListItem>
              <ListItemText
                primary="Browse Projects"
                secondary="View project details and issues"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Create Issues"
                secondary="Create new issues in projects"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Edit Issues"
                secondary="Modify existing issues"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Add Comments"
                secondary="Comment on issues"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Manage Webhooks"
                secondary="Set up notifications for issue changes (Admin only)"
              />
            </ListItem>
          </List>
        </AccordionDetails>
      </Accordion>

      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Troubleshooting</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <List dense>
            <ListItem>
              <ListItemText
                primary="Connection Failed"
                secondary="Verify your server URL, email, and API token are correct"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Permission Denied"
                secondary="Contact your Jira administrator to grant necessary permissions"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Server Not Reachable"
                secondary="Ensure your Jira server is accessible from the internet (for Server/Data Center)"
              />
            </ListItem>
          </List>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

const CloudHelp: React.FC = () => (
  <Box>
    <Alert severity="info" sx={{ mb: 3 }}>
      For Jira Cloud, you'll need an API token instead of your password for
      security.
    </Alert>

    <Typography variant="h6" gutterBottom>
      Step 1: Get your Jira Cloud URL
    </Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>
      Your Jira Cloud URL follows this format:{" "}
      <code>https://your-domain.atlassian.net</code>
    </Typography>

    <Typography variant="h6" gutterBottom>
      Step 2: Create an API Token
    </Typography>
    <List dense sx={{ mb: 3 }}>
      <ListItem>
        <ListItemText primary="1. Go to your Atlassian Account Settings" />
      </ListItem>
      <ListItem>
        <ListItemText primary="2. Navigate to Security → API tokens" />
      </ListItem>
      <ListItem>
        <ListItemText primary="3. Click 'Create API token'" />
      </ListItem>
      <ListItem>
        <ListItemText primary="4. Give it a label (e.g., 'Hey Hey Integration')" />
      </ListItem>
      <ListItem>
        <ListItemText primary="5. Copy the generated token immediately" />
      </ListItem>
    </List>

    <Box sx={{ p: 2, bgcolor: "grey.100", borderRadius: 1, mb: 3 }}>
      <Typography variant="body2">
        <strong>Quick Link:</strong>{" "}
        <Link
          href="https://id.atlassian.com/manage-profile/security/api-tokens"
          target="_blank"
          rel="noopener noreferrer"
        >
          Create API Token
        </Link>
      </Typography>
    </Box>

    <Typography variant="h6" gutterBottom>
      Step 3: Find your Project Key (Optional)
    </Typography>
    <Typography variant="body2">
      If you want to limit the integration to a specific project, you can find
      the project key in Jira by going to your project settings. It's typically
      a short abbreviation like "PROJ" or "DEV".
    </Typography>
  </Box>
);

const ServerHelp: React.FC = () => (
  <Box>
    <Alert severity="warning" sx={{ mb: 3 }}>
      Jira Server/Data Center instances must be accessible from the internet for
      this integration to work.
    </Alert>

    <Typography variant="h6" gutterBottom>
      Step 1: Verify Server Accessibility
    </Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>
      Ensure your Jira server is accessible via HTTPS from external networks.
      Internal-only servers will not work with cloud-based integrations.
    </Typography>

    <Typography variant="h6" gutterBottom>
      Step 2: Authentication Options
    </Typography>
    <List dense sx={{ mb: 3 }}>
      <ListItem>
        <ListItemText
          primary="API Token (Recommended)"
          secondary="Create a personal API token in your user profile for better security"
        />
      </ListItem>
      <ListItem>
        <ListItemText
          primary="Password"
          secondary="Use your regular Jira password (less secure)"
        />
      </ListItem>
    </List>

    <Typography variant="h6" gutterBottom>
      Step 3: Get Your Server URL
    </Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>
      Use the full URL to your Jira instance, including the protocol:
      <br />
      <code>https://your-jira-server.company.com</code>
    </Typography>

    <Typography variant="h6" gutterBottom>
      Step 4: Check Permissions
    </Typography>
    <Typography variant="body2">
      Contact your Jira administrator to ensure your account has the necessary
      permissions listed in the "Required Permissions" section above.
    </Typography>
  </Box>
);
