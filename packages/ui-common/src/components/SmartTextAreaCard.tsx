import React from "react";
import { SmarterTextAreaCard } from "./SmarterTextAreaCard";

export type SaveStatus =
  "draft" | "saving" | "saved" | "submitting" | "sent" | "complete";
type SaveMode = "silent" | "feedback" | null;
type SmartTextAreaActionLockBehavior = "immediate" | "external-only";

export interface SmartTextAreaCardProps {
  /** Current text content */
  value: string;
  /** Callback when content changes */
  onChange: (value: string) => void;
  /** Conversation ID used to seed mention search context */
  mentionConversationId?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Header/label text (e.g., from LLM question) */
  headerText?: string;
  /** Current save status */
  saveStatus: SaveStatus;
  /** Current save mode being executed */
  saveMode: SaveMode;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
  /** Callback for save without feedback (optional) */
  onSaveWithoutFeedback?: () => void;
  /** Callback for save with feedback (optional) */
  onSaveWithFeedback?: () => void;
  /** Whether saving is in progress */
  isSaving: boolean;
  /** Custom button text for save without feedback */
  saveWithoutFeedbackText?: string;
  /** Custom button text for save with feedback */
  saveWithFeedbackText?: string;
  /** Custom icon for save without feedback */
  saveWithoutFeedbackIcon?: React.ReactNode;
  /** Custom icon for save with feedback */
  saveWithFeedbackIcon?: React.ReactNode;
  /** Multi-line input, default to true */
  multiline?: boolean;
  /** Error state */
  error?: boolean;
  /** Helper text for errors */
  helperText?: string;
  /** Minimum rows for multiline */
  minRows?: number;
  /** Maximum rows for multiline */
  maxRows?: number;
  /** Required field indicator */
  required?: boolean;
  /** Focus event handler */
  onFocus?: () => void;
  /** Blur event handler */
  onBlur?: () => void;
  /** How save buttons should lock while an action starts */
  actionLockBehavior?: SmartTextAreaActionLockBehavior;
}

// const getStatusIcon = (status: SaveStatus): React.ReactNode => {
//   switch (status) {
//     case "draft":
//       return null; // No icon when just drafting
//     case "saving":
//       return <CircularProgress size={16} />;
//     case "saved":
//       return <CheckCircle fontSize="small" />;
//     case "submitting":
//       return <CircularProgress size={16} />;
//     case "sent":
//       return <SendIcon fontSize="small" />;
//     case "complete":
//       return <CheckCircle fontSize="small" />;
//     default:
//       return null;
//   }
// };

// const getStatusColor = (status: SaveStatus): string => {
//   switch (status) {
//     case "draft":
//       return "text.secondary";
//     case "saving":
//     case "submitting":
//       return "primary.main";
//     case "saved":
//     case "sent":
//     case "complete":
//       return "success.main";
//     default:
//       return "text.secondary";
//   }
// };

export const SmartTextAreaCard = SmarterTextAreaCard;
// export const SmartTextAreaCard: React.FC<SmartTextAreaCardProps> = ({
//   disabled = false,
//   error = false,
//   hasUnsavedChanges,
//   headerText,
//   helperText,
//   isSaving,
//   maxRows = 16,
//   minRows = 3,
//   multiline = true,
//   onBlur,
//   onChange,
//   onFocus,
//   onSaveWithFeedback,
//   onSaveWithoutFeedback,
//   placeholder,
//   required = false,
//   saveMode,
//   saveStatus,
//   saveWithFeedbackIcon,
//   saveWithFeedbackText,
//   saveWithoutFeedbackIcon,
//   saveWithoutFeedbackText,
//   value,
// }) => {
//   const { t } = useTranslation();
//   const theme = useTheme();

//   // Determine which buttons to show
//   const showSaveWithoutFeedback = !!onSaveWithoutFeedback;
//   const showSaveWithFeedback = !!onSaveWithFeedback;
//   // Default texts and icons
//   const defaultSaveWithoutFeedbackText =
//     saveWithoutFeedbackText || t(KEYS.common.save);
//   const defaultSaveWithFeedbackText =
//     saveWithFeedbackText || t(KEYS.initiatives.editor.saveAndGetFeedback);
//   const defaultSaveWithoutFeedbackIcon = saveWithoutFeedbackIcon || <Save />;
//   const defaultSaveWithFeedbackIcon = saveWithFeedbackIcon || <Psychology />;

//   return (
//     <Paper
//       data-testid="smart-textarea-card"
//       elevation={0}
//       sx={{
//         borderRadius: `${theme.shape.borderRadius}px`,
//         overflow: "hidden",
//         border: `1px solid ${theme.palette.divider}`,
//       }}
//     >
//       {/* Header Section */}
//       <Box
//         sx={{
//           display: "flex",
//           minHeight: 48,
//           borderBottom: `1px solid ${
//             theme.palette.mode === "dark" ? theme.palette.divider : "#f5f5f5"
//           }`,
//         }}
//       >
//         {/* Header/Label Text */}
//         <Box
//           sx={{
//             flex: 1,
//             display: "flex",
//             alignItems: "center",
//             px: 2,
//             bgcolor: theme.palette.mode === "dark" ? "grey.800" : "#fcfcfc",
//           }}
//         >
//           {headerText ? (
//             <Typography
//               variant="body2"
//               color="text.primary"
//               sx={{
//                 fontFamily: [
//                   '"Tilt Neon"',
//                   '"Fira Code"',
//                   '"Source Code Pro"',
//                   '"SF Mono"',
//                   '"Cascadia Code"',
//                   '"Consolas"',
//                   "monospace",
//                 ].join(","),
//                 fontSize: "1rem",
//                 lineHeight: 1.5,
//                 padding: "10px 0",
//               }}
//             >
//               {headerText}
//             </Typography>
//           ) : (
//             <Typography
//               variant="body2"
//               color="text.secondary"
//               sx={{
//                 fontFamily: [
//                   '"Tilt Neon"',
//                   '"Fira Code"',
//                   '"Source Code Pro"',
//                   '"SF Mono"',
//                   '"Cascadia Code"',
//                   '"Consolas"',
//                   "monospace",
//                 ].join(","),
//                 fontSize: "0.875rem",
//                 lineHeight: 1.5,
//               }}
//             >
//               {t(KEYS.common.edit)}
//             </Typography>
//           )}
//         </Box>

//         {/* Status Indicator moved to right side */}
//         <Box
//           sx={{
//             width: 48,
//             display: "flex",
//             alignItems: "center",
//             justifyContent: "center",
//             bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
//             color: getStatusColor(saveStatus),
//           }}
//         >
//           {getStatusIcon(saveStatus)}
//         </Box>
//       </Box>

//       {/* Text Input Section */}
//       <Box
//         sx={{
//           bgcolor:
//             theme.palette.mode === "dark"
//               ? "background.paper"
//               : "background.paper",
//         }}
//       >
//         <TextField
//           data-testid="smart-textarea-input"
//           fullWidth
//           multiline={multiline}
//           variant="standard"
//           value={value}
//           onChange={(e) => onChange(e.target.value)}
//           disabled={disabled}
//           placeholder={placeholder}
//           required={required}
//           error={error}
//           onFocus={onFocus}
//           onBlur={onBlur}
//           minRows={multiline ? minRows : undefined}
//           maxRows={multiline ? maxRows : undefined}
//           slotProps={{
//             input: {
//               disableUnderline: true,
//               sx: {
//                 p: 2,
//                 alignItems: multiline ? "flex-start" : "center",
//                 fontSize: "1.125rem",
//                 lineHeight: 1.5,
//               },
//             },
//           }}
//           sx={{
//             "& .MuiInputBase-root": {
//               bgcolor: "transparent",
//             },
//           }}
//         />
//         {helperText && (
//           <Typography
//             variant="caption"
//             color={error ? "error.main" : "text.secondary"}
//             sx={{ px: 2, pb: 1, display: "block" }}
//           >
//             {helperText}
//           </Typography>
//         )}
//       </Box>

//       {/* Action Buttons Section */}
//       {(showSaveWithoutFeedback || showSaveWithFeedback) && (
//         <Box
//           sx={{
//             display: "flex",
//             borderTop: `1px solid ${theme.palette.divider}`,
//             bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
//             opacity: hasUnsavedChanges ? 1 : 0.4,
//             transition: "opacity 0.3s ease-in-out",
//           }}
//         >
//           {/* Save without Feedback Button */}
//           {showSaveWithoutFeedback && (
//             <SlideLeft
//               delay={showSaveWithFeedback ? 0.15 : 0.1}
//               duration="fast"
//               style={{
//                 flex: 1,
//                 display: "flex",
//               }}
//             >
//               <Button
//                 data-testid="smart-textarea-save-without-feedback"
//                 variant="text"
//                 size="small"
//                 onClick={onSaveWithoutFeedback}
//                 disabled={disabled || isSaving || !hasUnsavedChanges}
//                 startIcon={
//                   isSaving && saveMode === "silent" ? (
//                     <CircularProgress size={16} />
//                   ) : (
//                     defaultSaveWithoutFeedbackIcon
//                   )
//                 }
//                 sx={{
//                   width: "100%",
//                   py: 1.5,
//                   borderRadius: 0,
//                   textTransform: "none",
//                 }}
//               >
//                 {isSaving && saveMode === "silent"
//                   ? t(KEYS.common.processing)
//                   : defaultSaveWithoutFeedbackText}
//               </Button>
//             </SlideLeft>
//           )}
//           {/* Save with Feedback Button */}
//           {showSaveWithFeedback && (
//             <SlideRight
//               delay={0.1}
//               duration="fast"
//               style={{
//                 flex: 1,
//                 display: "flex",
//               }}
//             >
//               <Button
//                 data-testid="smart-textarea-save-with-feedback"
//                 variant="text"
//                 size="small"
//                 onClick={onSaveWithFeedback}
//                 disabled={disabled || isSaving || !hasUnsavedChanges}
//                 startIcon={
//                   isSaving && saveMode === "feedback" ? (
//                     <CircularProgress size={16} />
//                   ) : (
//                     defaultSaveWithFeedbackIcon
//                   )
//                 }
//                 sx={{
//                   width: "100%",
//                   py: 1.5,
//                   borderRadius: 0,
//                   borderRight: showSaveWithoutFeedback
//                     ? `1px solid ${theme.palette.divider}`
//                     : "none",
//                   textTransform: "none",
//                   backgroundColor: theme.palette.actionable.main,
//                   color: theme.palette.actionable.contrastText,
//                   "&:hover": {
//                     backgroundColor: theme.palette.actionable.dark,
//                   },
//                 }}
//               >
//                 {isSaving && saveMode === "feedback"
//                   ? t(KEYS.common.processing)
//                   : defaultSaveWithFeedbackText}
//               </Button>
//             </SlideRight>
//           )}
//         </Box>
//       )}
//     </Paper>
//   );
// };
