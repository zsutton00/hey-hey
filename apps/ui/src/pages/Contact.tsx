import { useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Snackbar,
  Alert,
  Card,
  CardContent,
  Stack,
} from "@mui/material";
import EmailIcon from "@mui/icons-material/Email";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import PhoneIcon from "@mui/icons-material/Phone";

const Contact = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success" as "success" | "error",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, you would send the form data to a server here
    console.log("Form submitted:", formData);

    // Show success message
    setSnackbar({
      open: true,
      message: "Message sent successfully! We will get back to you soon.",
      severity: "success",
    });

    // Reset form
    setFormData({
      name: "",
      email: "",
      message: "",
    });
  };

  const handleCloseSnackbar = () => {
    setSnackbar((prev) => ({
      ...prev,
      open: false,
    }));
  };

  return (
    <Box>
      <Typography variant="h3" component="h1" gutterBottom>
        Contact Us
      </Typography>
      <Typography variant="subtitle1" color="text.secondary" paragraph>
        We'd love to hear from you. Fill out the form below to get in touch.
      </Typography>

      <Stack direction={{ xs: "column", md: "row" }} spacing={4} sx={{ mt: 2 }}>
        <Paper elevation={2} sx={{ p: 4, flex: { xs: "1", md: "7" } }}>
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Message"
              name="message"
              multiline
              rows={4}
              value={formData.message}
              onChange={handleChange}
              margin="normal"
              required
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              sx={{ mt: 3 }}
            >
              Send Message
            </Button>
          </form>
        </Paper>

        <Card elevation={2} sx={{ flex: { xs: "1", md: "5" } }}>
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Contact Information
            </Typography>

            <Stack spacing={3} sx={{ mt: 4 }}>
              <Box sx={{ display: "flex", alignItems: "center" }}>
                <EmailIcon color="primary" sx={{ mr: 2 }} />
                <Typography>contact@example.com</Typography>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center" }}>
                <PhoneIcon color="primary" sx={{ mr: 2 }} />
                <Typography>+1 (555) 123-4567</Typography>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center" }}>
                <LocationOnIcon color="primary" sx={{ mr: 2 }} />
                <Typography>
                  123 Main Street, San Francisco, CA 94105
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Contact;
