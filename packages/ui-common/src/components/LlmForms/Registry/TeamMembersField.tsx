import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  TextField,
  FormControl,
  FormLabel,
  FormHelperText,
  Chip,
  Typography,
  Avatar,
  Stack,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Card,
  CardContent,
  Paper,
  MenuList,
  MenuItem,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../i18n/keys";
import type { FieldComponentProps } from "./types";

interface SuggestedUser {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  confidence: number;
  integrationType: "github" | "jira";
  integrationSources: string[];
}

interface TeamMember {
  email: string;
  name?: string;
  avatar?: string;
  confidence?: number;
  integrationType?: "github" | "jira";
  isManualEntry?: boolean;
}

const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Common email domains for autocomplete
const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "yahoo.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "zoho.com",
];

interface DomainSuggestion {
  domain: string;
  isCustom: boolean;
}

interface TeamMembersFieldProps extends FieldComponentProps {
  suggestedUsers?: SuggestedUser[];
}

export const TeamMembersField: React.FC<TeamMembersFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled,
  isSubmitted,
  suggestedUsers: propSuggestedUsers = [],
}) => {
  const { t } = useTranslation();

  const [selectedMembers, setSelectedMembers] = useState<TeamMember[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [emailError, setEmailError] = useState("");

  // Email autocomplete state
  const [showDropdown, setShowDropdown] = useState(false);
  const [domainSuggestions, setDomainSuggestions] = useState<
    DomainSuggestion[]
  >([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [customDomains, setCustomDomains] = useState<string[]>([]);
  const [atPosition, setAtPosition] = useState(-1); // Position of @ symbol in input

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Parse initial value
  useEffect(() => {
    if (value && typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as TeamMember[];
        setSelectedMembers(Array.isArray(parsed) ? parsed : []);
      } catch {
        // If not valid JSON, treat as single email
        if (isValidEmail(value)) {
          setSelectedMembers([{ email: value, isManualEntry: true }]);
        }
      }
    }
  }, [value]);

  // Update parent component when selectedMembers changes
  useEffect(() => {
    if (onChange) {
      onChange(JSON.stringify(selectedMembers));
    }
  }, [selectedMembers, onChange]);

  // Extract custom domains from selected members
  useEffect(() => {
    const domains = selectedMembers
      .map((member) => member.email.split("@")[1])
      .filter((domain) => domain && !COMMON_EMAIL_DOMAINS.includes(domain))
      .filter((domain, index, self) => self.indexOf(domain) === index); // Remove duplicates

    setCustomDomains(domains);
  }, [selectedMembers]);

  // Filter domains based on partial match after @
  const getFilteredDomains = useCallback(
    (partialDomain: string): DomainSuggestion[] => {
      const allDomains = [
        ...COMMON_EMAIL_DOMAINS.map((domain) => ({ domain, isCustom: false })),
        ...customDomains.map((domain) => ({ domain, isCustom: true })),
      ];

      if (!partialDomain) {
        return allDomains;
      }

      return allDomains.filter(({ domain }) =>
        domain.toLowerCase().startsWith(partialDomain.toLowerCase()),
      );
    },
    [customDomains],
  );

  // Handle input changes and detect @ symbol
  const handleEmailInputChange = useCallback(
    (newValue: string, cursorPosition?: number) => {
      setInputValue(newValue);
      setEmailError("");

      if (!inputRef.current) return;

      const currentCursor =
        cursorPosition ?? inputRef.current.selectionStart ?? newValue.length;

      // Find the last @ symbol before or at cursor position
      let lastAtIndex = -1;
      for (let i = currentCursor - 1; i >= 0; i--) {
        if (newValue[i] === "@") {
          lastAtIndex = i;
          break;
        }
        // Stop if we hit a space (different email)
        if (newValue[i] === " ") {
          break;
        }
      }

      if (lastAtIndex >= 0) {
        // Check if cursor is after @ and there's no space after @
        const textAfterAt = newValue.substring(lastAtIndex + 1, currentCursor);
        const hasSpaceAfterAt = newValue.substring(lastAtIndex).includes(" ");

        if (currentCursor > lastAtIndex && !hasSpaceAfterAt) {
          setAtPosition(lastAtIndex);
          const partialDomain = textAfterAt;
          const suggestions = getFilteredDomains(partialDomain);

          if (suggestions.length > 0) {
            setDomainSuggestions(suggestions);
            setSelectedSuggestionIndex(-1);
            setShowDropdown(true);
          } else {
            setShowDropdown(false);
          }
        } else {
          setShowDropdown(false);
        }
      } else {
        setShowDropdown(false);
      }
    },
    [getFilteredDomains],
  );

  // Complete domain selection
  const completeDomain = useCallback(
    (domain: string) => {
      if (atPosition === -1 || !inputRef.current) return;

      const currentCursor =
        inputRef.current.selectionStart ?? inputValue.length;
      const beforeAt = inputValue.substring(0, atPosition + 1); // Include @
      const afterCursor = inputValue.substring(currentCursor);

      const newValue = beforeAt + domain + afterCursor;
      setInputValue(newValue);
      setShowDropdown(false);
      setAtPosition(-1);

      // Focus back to input and position cursor after domain
      setTimeout(() => {
        if (inputRef.current) {
          const newCursorPos = beforeAt.length + domain.length;
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [atPosition, inputValue],
  );

  const handleAcceptUser = (user: SuggestedUser): void => {
    const newMember: TeamMember = {
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      confidence: user.confidence,
      integrationType: user.integrationType,
      isManualEntry: false,
    };

    setSelectedMembers((prev) => {
      if (prev.some((member) => member.email === user.email)) {
        return prev;
      }
      return [...prev, newMember];
    });
  };

  const handleRejectUser = (user: SuggestedUser): void => {
    // For now, we'll just do nothing since we can't modify the prop
    // In a real implementation, this would notify the parent component
    // to remove this user from the suggestions
    console.log("Rejected user:", user.email);
  };

  const handleAcceptAll = (): void => {
    const newMembers: TeamMember[] = propSuggestedUsers
      .filter(
        (user) =>
          !selectedMembers.some((member) => member.email === user.email),
      )
      .map((user) => ({
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        confidence: user.confidence,
        integrationType: user.integrationType,
        isManualEntry: false,
      }));

    setSelectedMembers((prev) => [...prev, ...newMembers]);
  };

  const handleRejectAll = (): void => {
    // For now, we'll just do nothing since we can't modify the prop
    // In a real implementation, this would notify the parent component
    // to clear all suggestions
    console.log("Rejected all suggested users");
  };

  const handleAddManualEmail = (): void => {
    const email = inputValue.trim();
    if (!email) return;

    // Validate email format
    if (!isValidEmail(email)) {
      setEmailError(t(KEYS.teamMembers.invalidEmail));
      return;
    }

    // Check if email already exists
    if (selectedMembers.some((member) => member.email === email)) {
      setEmailError(t(KEYS.teamMembers.emailExists));
      return;
    }

    const newMember: TeamMember = {
      email,
      isManualEntry: true,
    };

    setSelectedMembers((prev) => [...prev, newMember]);
    setInputValue("");
    setEmailError("");
  };

  const handleRemoveMember = (email: string): void => {
    setSelectedMembers((prev) =>
      prev.filter((member) => member.email !== email),
    );
  };

  const handleInputChange = (newInputValue: string): void => {
    handleEmailInputChange(newInputValue);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (showDropdown && domainSuggestions.length > 0) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev < domainSuggestions.length - 1 ? prev + 1 : 0,
          );
          break;

        case "ArrowUp":
          event.preventDefault();
          setSelectedSuggestionIndex((prev) =>
            prev > 0 ? prev - 1 : domainSuggestions.length - 1,
          );
          break;

        case "Enter":
          event.preventDefault();
          if (selectedSuggestionIndex >= 0) {
            completeDomain(domainSuggestions[selectedSuggestionIndex].domain);
          } else if (domainSuggestions.length > 0) {
            // If no selection, use first suggestion
            completeDomain(domainSuggestions[0].domain);
          }
          break;

        case "Escape":
          event.preventDefault();
          setShowDropdown(false);
          setAtPosition(-1);
          break;

        case "Tab":
          // Allow tab to close dropdown
          setShowDropdown(false);
          setAtPosition(-1);
          break;
      }
    } else if (event.key === "Enter" && inputValue.trim()) {
      event.preventDefault();
      handleAddManualEmail();
    }
  };

  const handleInputClick = (
    event: React.MouseEvent<HTMLInputElement>,
  ): void => {
    // Recheck cursor position on click
    const target = event.target as HTMLInputElement;
    setTimeout(() => {
      handleEmailInputChange(target.value, target.selectionStart ?? undefined);
    }, 0);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
        setAtPosition(-1);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showDropdown]);

  // Filter suggested users that aren't already selected
  const availableSuggestedUsers = propSuggestedUsers.filter(
    (user) => !selectedMembers.some((member) => member.email === user.email),
  );

  return (
    <FormControl
      fullWidth
      margin="normal"
      error={!!error || !!emailError}
      disabled={disabled}
    >
      <FormLabel component="legend">
        {isSubmitted && !disabled ? "" : config.description}
      </FormLabel>

      <Box sx={{ mt: 2 }}>
        {/* Selected Members */}
        {selectedMembers.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {t(KEYS.teamMembers.selectedMembers)} ({selectedMembers.length})
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{ maxHeight: 120, overflow: "auto" }}
            >
              {selectedMembers.map((member) => (
                <Chip
                  key={member.email}
                  label={member.email}
                  onDelete={() => handleRemoveMember(member.email)}
                  variant="filled"
                  size="medium"
                  disabled={disabled}
                  color={member.isManualEntry ? "default" : "primary"}
                  sx={{
                    fontSize: "0.875rem",
                    height: 36,
                    "& .MuiChip-label": {
                      maxWidth: 250,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      px: 1.5,
                    },
                    "& .MuiChip-deleteIcon": {
                      fontSize: "1.1rem",
                    },
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Suggested Users */}
        {availableSuggestedUsers.length > 0 && (
          <Card sx={{ mb: 2, maxWidth: 600 }}>
            <CardContent sx={{ pb: 1 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1,
                }}
              >
                <Typography variant="subtitle2">
                  {t(KEYS.teamMembers.suggestedUsers)} (
                  {availableSuggestedUsers.length})
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleAcceptAll}
                    disabled={disabled}
                    startIcon={<CheckIcon />}
                  >
                    {t(KEYS.teamMembers.acceptAll)}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleRejectAll}
                    disabled={disabled}
                    startIcon={<CloseIcon />}
                  >
                    {t(KEYS.teamMembers.rejectAll)}
                  </Button>
                </Box>
              </Box>

              <Box>
                <List dense sx={{ maxHeight: 240, overflow: "auto" }}>
                  {availableSuggestedUsers.map((user, index) => (
                    <React.Fragment key={user.id}>
                      <ListItem
                        onClick={
                          disabled ? undefined : () => handleAcceptUser(user)
                        }
                        sx={{
                          bgcolor: "grey.50",
                          borderRadius: 1,
                          mb: 0.5,
                          cursor: disabled ? "default" : "pointer",
                          transition: "background-color 0.2s ease-in-out",
                          "&:hover": {
                            bgcolor: disabled ? "grey.50" : "action.hover",
                          },
                        }}
                      >
                        <ListItemAvatar>
                          <Avatar
                            src={user.avatar}
                            sx={{ width: 32, height: 32 }}
                          >
                            <PersonIcon />
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={user.email}
                          secondary={
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                              }}
                            >
                              {user.name && user.name !== user.email && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {user.name}
                                </Typography>
                              )}
                              <Chip
                                label={user.integrationType}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: "0.65rem", height: 16 }}
                              />
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectUser(user);
                            }}
                            disabled={disabled}
                            color="error"
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                      {index < availableSuggestedUsers.length - 1 && (
                        <Divider />
                      )}
                    </React.Fragment>
                  ))}
                </List>
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Manual Email Entry - Always visible */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "flex-start",
            mb: 2,
            position: "relative",
          }}
        >
          <Box sx={{ flex: 1, maxWidth: 400, position: "relative" }}>
            <TextField
              label={t(KEYS.teamMembers.emailAddress)}
              placeholder={t(KEYS.teamMembers.emailPlaceholder)}
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={handleInputClick}
              error={!!emailError}
              helperText={
                emailError ||
                (inputValue.trim() && isValidEmail(inputValue.trim())
                  ? t(KEYS.teamMembers.pressEnterToAdd)
                  : t(KEYS.teamMembers.enterValidEmail))
              }
              disabled={disabled}
              inputRef={inputRef}
              sx={{ width: "100%" }}
            />

            {/* Email Domain Dropdown */}
            {showDropdown && domainSuggestions.length > 0 && (
              <Paper
                ref={dropdownRef}
                sx={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  minWidth: 200,
                  maxWidth: 300,
                  maxHeight: 200,
                  overflow: "auto",
                  border: 1,
                  borderColor: "divider",
                  boxShadow: 3,
                  mt: 0.5,
                }}
              >
                <MenuList dense>
                  {domainSuggestions.map((suggestion, index) => (
                    <MenuItem
                      key={suggestion.domain}
                      selected={index === selectedSuggestionIndex}
                      onClick={() => completeDomain(suggestion.domain)}
                      sx={{
                        fontSize: "0.875rem",
                        py: 0.5,
                        minHeight: 32,
                        "&.Mui-selected": {
                          backgroundColor: "primary.light",
                          color: "primary.contrastText",
                          "&:hover": {
                            backgroundColor: "primary.main",
                          },
                        },
                      }}
                    >
                      <Typography variant="inherit">
                        {suggestion.domain}
                      </Typography>
                    </MenuItem>
                  ))}
                </MenuList>
              </Paper>
            )}
          </Box>
          <Button
            variant="contained"
            onClick={handleAddManualEmail}
            disabled={
              disabled || !inputValue.trim() || !isValidEmail(inputValue.trim())
            }
            startIcon={<AddIcon />}
            sx={{ mt: 1, minWidth: 100 }}
          >
            {t(KEYS.teamMembers.addButton)}
          </Button>
        </Box>
      </Box>

      {(error || emailError) && (
        <FormHelperText>{error || emailError}</FormHelperText>
      )}
    </FormControl>
  );
};
